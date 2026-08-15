import assert from "node:assert/strict";
import test from "node:test";

import {
  esCambioRedundante,
  esTransicionValida,
  estadoDe,
  ordenarTickets,
  patchParaEstado,
  tiempoTranscurrido,
  TICKET_ESTADOS,
  type ServiceTicket,
  type TicketEstado,
} from "./service-tickets.ts";

function ticket(partial: Partial<ServiceTicket> & { id: string }): ServiceTicket {
  return {
    hotel_id: "h-1",
    conversation_id: "c-1",
    categoria: "mantenimiento",
    descripcion: "El aire no enfría",
    habitacion: "301",
    estado: "abierto",
    created_at: "2026-08-16T10:00:00",
    en_curso_at: null,
    resuelto_at: null,
    cancelado_at: null,
    ...partial,
  };
}

test("desde abierto se puede tomar, resolver y cancelar", () => {
  assert.equal(esTransicionValida("abierto", "en_curso"), true);
  assert.equal(esTransicionValida("abierto", "resuelto"), true);
  assert.equal(esTransicionValida("abierto", "cancelado"), true);
});

test("desde en_curso ya no se puede volver a abierto", () => {
  assert.equal(esTransicionValida("en_curso", "resuelto"), true);
  assert.equal(esTransicionValida("en_curso", "cancelado"), true);
  assert.equal(esTransicionValida("en_curso", "abierto"), false);
});

test("resuelto y cancelado son terminales: no hay reabrir", () => {
  for (const terminal of ["resuelto", "cancelado"] as const) {
    for (const destino of TICKET_ESTADOS) {
      assert.equal(
        esTransicionValida(terminal, destino),
        false,
        `${terminal} no debería poder pasar a ${destino}`
      );
    }
  }
});

test("pedir el mismo estado es redundante, no inválido", () => {
  for (const estado of TICKET_ESTADOS) {
    assert.equal(esCambioRedundante(estado, estado), true);
    // Y nunca se cuela como transición: los botones no deben ofrecerlo.
    assert.equal(esTransicionValida(estado, estado), false);
  }
});

test("cada estado estampa su propio timestamp y solo resolver guarda autoría", () => {
  const ahora = "2026-08-16T12:00:00.000Z";
  const userId = "u-1";

  const tomado = patchParaEstado("en_curso", { ahora, userId });
  assert.equal(tomado.estado, "en_curso");
  assert.equal(tomado.en_curso_at, ahora);
  assert.equal(tomado.resolved_by, undefined);

  const resuelto = patchParaEstado("resuelto", { ahora, userId });
  assert.equal(resuelto.resuelto_at, ahora);
  assert.equal(resuelto.resolved_by, userId);
  assert.equal(resuelto.en_curso_at, undefined, "resolver no debe pisar en_curso_at");

  const cancelado = patchParaEstado("cancelado", { ahora, userId });
  assert.equal(cancelado.cancelado_at, ahora);
  assert.equal(cancelado.resolved_by, undefined, "cancelar no es resolver");
});

test("un estado con basura se lee como abierto en vez de romper la pantalla", () => {
  assert.equal(estadoDe({ estado: "EN_CURSO " } as ServiceTicket), "abierto");
  assert.equal(estadoDe({ estado: "en_curso" } as ServiceTicket), "en_curso");
  assert.equal(estadoDe({ estado: null } as ServiceTicket), "abierto");
  assert.equal(estadoDe({ estado: "pendiente" } as ServiceTicket), "abierto");
});

test("las pendientes van arriba y la más vieja primero", () => {
  const orden = ordenarTickets([
    ticket({ id: "nueva", created_at: "2026-08-16T11:00:00" }),
    ticket({ id: "resuelta", estado: "resuelto", resuelto_at: "2026-08-16T11:30:00" }),
    ticket({ id: "vieja", created_at: "2026-08-16T08:00:00" }),
    ticket({ id: "en-curso", estado: "en_curso", created_at: "2026-08-16T09:00:00" }),
  ]).map((t) => t.id);

  assert.deepEqual(orden, ["vieja", "en-curso", "nueva", "resuelta"]);
});

test("el historial cerrado va de lo más reciente a lo más viejo", () => {
  const orden = ordenarTickets([
    ticket({ id: "vieja", estado: "resuelto", resuelto_at: "2026-08-14T10:00:00" }),
    ticket({ id: "reciente", estado: "cancelado", cancelado_at: "2026-08-16T10:00:00" }),
  ]).map((t) => t.id);

  assert.deepEqual(orden, ["reciente", "vieja"]);
});

test("una fecha ilegible no se cuela como la más urgente", () => {
  const orden = ordenarTickets([
    ticket({ id: "sin-fecha", created_at: null }),
    ticket({ id: "con-fecha", created_at: "2026-08-16T09:00:00" }),
  ]).map((t) => t.id);

  assert.deepEqual(orden, ["con-fecha", "sin-fecha"]);
});

test("el tiempo transcurrido se lee en hora de Bogotá, no en la del navegador", () => {
  // 10:00 Bogotá es 15:00 UTC. Doce minutos después son las 15:12 UTC.
  const ahora = Date.parse("2026-08-16T15:12:00Z");
  assert.equal(tiempoTranscurrido("2026-08-16T10:00:00", ahora), "hace 12 minutos");
  // El mismo instante escrito con offset explícito tiene que dar lo mismo.
  assert.equal(tiempoTranscurrido("2026-08-16T15:00:00+00:00", ahora), "hace 12 minutos");
});

test("singular, plural y días", () => {
  const base = Date.parse("2026-08-16T15:00:00Z");
  const hace = (ms: number) => tiempoTranscurrido(new Date(base - ms).toISOString(), base);

  assert.equal(hace(60_000), "hace 1 minuto");
  assert.equal(hace(3 * 60 * 60_000), "hace 3 horas");
  assert.equal(hace(24 * 60 * 60_000), "hace 1 día");
  assert.equal(hace(4 * 24 * 60 * 60_000), "hace 4 días");
});

test("sin fecha legible no se inventa una antigüedad", () => {
  assert.equal(tiempoTranscurrido(null), null);
  assert.equal(tiempoTranscurrido(""), null);
  assert.equal(tiempoTranscurrido("ayer por la tarde"), null);
});

test("una fecha en el futuro se muestra como recién, no como 'en 3 horas'", () => {
  const ahora = Date.parse("2026-08-16T15:00:00Z");
  assert.equal(tiempoTranscurrido("2026-08-16T18:00:00Z", ahora), "recién");
});

test("los estados declarados son exactamente los cuatro de la base", () => {
  const esperados: TicketEstado[] = ["abierto", "en_curso", "resuelto", "cancelado"];
  assert.deepEqual([...TICKET_ESTADOS], esperados);
});
