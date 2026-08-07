import assert from "node:assert/strict";
import test from "node:test";

import {
  findLastInboundInstantMs,
  isReplyBlockedByMetaPolicy,
  parseWhatsappInstantMs,
  resolveLastGuestInstantMs,
} from "./meta-window.ts";

/**
 * Los mensajes se tipan sueltos a propósito: `Message` tiene muchos campos
 * opcionales que no le importan a la ventana, y fijarlos acá volvería el test
 * frágil ante cambios de la UI.
 */
type TestMessage = {
  id: string;
  body: string;
  sentAt: string;
  sentAtIso?: string;
  sender: "user" | "ai" | "agent";
  format?: string;
};

function msg(partial: Partial<TestMessage> & { sender: TestMessage["sender"] }): TestMessage {
  return {
    id: partial.id ?? "m1",
    body: partial.body ?? "",
    sentAt: partial.sentAt ?? "",
    sentAtIso: partial.sentAtIso,
    sender: partial.sender,
    format: partial.format,
  };
}

/** El instante real de "2026-08-07 12:26:53" en Bogotá es 17:26:53Z. */
const ANA_NAIVE = "2026-08-07 12:26:53";
const ANA_UTC_MS = Date.UTC(2026, 7, 7, 17, 26, 53);

// ---------------------------------------------------------------------------
// Parseo: naive = Bogotá SIEMPRE, con offset = se respeta
// ---------------------------------------------------------------------------

test("un timestamp naive de Wubby se interpreta en Bogotá, no en la zona del navegador", () => {
  assert.equal(parseWhatsappInstantMs(ANA_NAIVE), ANA_UTC_MS);
  assert.equal(parseWhatsappInstantMs("2026-08-07T12:26:53"), ANA_UTC_MS);
  assert.equal(parseWhatsappInstantMs("2026-08-07T12:26:53.482"), ANA_UTC_MS + 482);
});

test("un timestamp con offset propio se respeta tal cual", () => {
  assert.equal(parseWhatsappInstantMs("2026-08-07T17:26:53Z"), ANA_UTC_MS);
  assert.equal(parseWhatsappInstantMs("2026-08-07T12:26:53-05:00"), ANA_UTC_MS);
  assert.equal(parseWhatsappInstantMs("2026-08-07T19:26:53+02:00"), ANA_UTC_MS);
});

test("lo ilegible devuelve null en vez de NaN o de una fecha inventada", () => {
  assert.equal(parseWhatsappInstantMs(null), null);
  assert.equal(parseWhatsappInstantMs(""), null);
  assert.equal(parseWhatsappInstantMs("   "), null);
  assert.equal(parseWhatsappInstantMs("ayer por la tarde"), null);
});

// ---------------------------------------------------------------------------
// Caso Ana Niño: media pura, sin texto, con conversation_id NULL
// ---------------------------------------------------------------------------

test("media pura reciente sin conversation_id deja la ventana ABIERTA", () => {
  // Fila 39936: PDF sin `message`, así que la columna del trigger quedó null.
  const blocked = isReplyBlockedByMetaPolicy(
    {
      lastGuestMessageAt: null,
      messages: [
        msg({ id: "39936", body: "", sentAtIso: ANA_NAIVE, sender: "user", format: "image" }),
      ],
    },
    ANA_UTC_MS + 60 * 60 * 1000 // una hora después
  );
  assert.equal(blocked, false);
});

test("el hilo rescata la ventana aunque la columna del trigger venga vacía", () => {
  const resolved = resolveLastGuestInstantMs({
    lastGuestMessageAt: null,
    messages: [msg({ sentAtIso: ANA_NAIVE, sender: "user" })],
  });
  assert.equal(resolved, ANA_UTC_MS);
});

// ---------------------------------------------------------------------------
// Ventana vencida y ausencia de entrantes
// ---------------------------------------------------------------------------

test("último entrante hace 25 h queda BLOQUEADO", () => {
  const blocked = isReplyBlockedByMetaPolicy(
    {
      lastGuestMessageAt: null,
      messages: [msg({ sentAtIso: ANA_NAIVE, sender: "user" })],
    },
    ANA_UTC_MS + 25 * 60 * 60 * 1000
  );
  assert.equal(blocked, true);
});

test("a las 24 h justas todavía NO bloquea; un milisegundo después sí", () => {
  const source = { lastGuestMessageAt: null, messages: [msg({ sentAtIso: ANA_NAIVE, sender: "user" })] };
  const exact = ANA_UTC_MS + 24 * 60 * 60 * 1000;
  assert.equal(isReplyBlockedByMetaPolicy(source, exact), false);
  assert.equal(isReplyBlockedByMetaPolicy(source, exact + 1), true);
});

test("sin ningún mensaje entrante queda BLOQUEADO", () => {
  const soloSalientes = [
    msg({ id: "a", sentAtIso: ANA_NAIVE, sender: "ai" }),
    msg({ id: "b", sentAtIso: ANA_NAIVE, sender: "agent" }),
  ];
  assert.equal(
    isReplyBlockedByMetaPolicy({ lastGuestMessageAt: null, messages: soloSalientes }, ANA_UTC_MS + 1000),
    true
  );
  assert.equal(isReplyBlockedByMetaPolicy({ lastGuestMessageAt: null, messages: [] }, ANA_UTC_MS), true);
  assert.equal(isReplyBlockedByMetaPolicy({}, ANA_UTC_MS), true);
});

test("solo cuentan los entrantes: una respuesta del hotel no reabre la ventana", () => {
  const blocked = isReplyBlockedByMetaPolicy(
    {
      lastGuestMessageAt: null,
      messages: [
        msg({ id: "viejo", sentAtIso: ANA_NAIVE, sender: "user" }),
        // El hotel contestó 25 h después: saliente, no abre nada.
        msg({ id: "nuevo", sentAtIso: "2026-08-08T13:26:53", sender: "agent" }),
      ],
    },
    ANA_UTC_MS + 25 * 60 * 60 * 1000
  );
  assert.equal(blocked, true);
});

// ---------------------------------------------------------------------------
// Combinación de fuentes: siempre la más reciente
// ---------------------------------------------------------------------------

test("entre columna e hilo gana el más reciente, venga de donde venga", () => {
  const viejo = "2026-08-06T12:00:00-05:00";

  // La columna va adelantada (el hilo llegó truncado).
  assert.equal(
    resolveLastGuestInstantMs({
      lastGuestMessageAt: "2026-08-07T17:26:53Z",
      messages: [msg({ sentAtIso: viejo, sender: "user" })],
    }),
    ANA_UTC_MS
  );

  // El hilo va adelantado (el trigger no corrió).
  assert.equal(
    resolveLastGuestInstantMs({
      lastGuestMessageAt: viejo,
      messages: [msg({ sentAtIso: ANA_NAIVE, sender: "user" })],
    }),
    ANA_UTC_MS
  );
});

test("el hilo desordenado igual entrega el entrante más reciente", () => {
  const found = findLastInboundInstantMs([
    msg({ id: "c", sentAtIso: "2026-08-05T09:00:00", sender: "user" }),
    msg({ id: "a", sentAtIso: ANA_NAIVE, sender: "user" }),
    msg({ id: "b", sentAtIso: "2026-08-06T09:00:00", sender: "user" }),
  ]);
  assert.equal(found, ANA_UTC_MS);
});

test("un mensaje sin sentAtIso no rompe ni gana", () => {
  const found = findLastInboundInstantMs([
    msg({ id: "sin-fecha", sender: "user" }),
    msg({ id: "con-fecha", sentAtIso: ANA_NAIVE, sender: "user" }),
  ]);
  assert.equal(found, ANA_UTC_MS);
});

// ---------------------------------------------------------------------------
// Independencia de la zona del operador
// ---------------------------------------------------------------------------

test("un operador en UTC+2 obtiene el mismo veredicto que en Bogotá", () => {
  const source = {
    lastGuestMessageAt: null,
    messages: [msg({ sentAtIso: ANA_NAIVE, sender: "user" })],
  };
  const abierta = ANA_UTC_MS + 2 * 60 * 60 * 1000;
  const vencida = ANA_UTC_MS + 25 * 60 * 60 * 1000;

  const original = process.env.TZ;
  const veredictos: Record<string, [boolean, boolean]> = {};
  try {
    for (const tz of ["America/Bogota", "Europe/Madrid", "Asia/Tokyo", "UTC"]) {
      process.env.TZ = tz;
      veredictos[tz] = [
        isReplyBlockedByMetaPolicy(source, abierta),
        isReplyBlockedByMetaPolicy(source, vencida),
      ];
    }
  } finally {
    process.env.TZ = original;
  }

  // UTC+2 (Madrid en agosto) es justo la zona del reporte original.
  assert.deepEqual(veredictos["Europe/Madrid"], veredictos["America/Bogota"]);
  assert.deepEqual(veredictos["Asia/Tokyo"], veredictos["America/Bogota"]);
  assert.deepEqual(veredictos["UTC"], veredictos["America/Bogota"]);
  assert.deepEqual(veredictos["America/Bogota"], [false, true]);
});

test("el instante parseado no depende de la zona del proceso", () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = "Europe/Madrid";
    assert.equal(parseWhatsappInstantMs(ANA_NAIVE), ANA_UTC_MS);
    process.env.TZ = "Asia/Tokyo";
    assert.equal(parseWhatsappInstantMs(ANA_NAIVE), ANA_UTC_MS);
  } finally {
    process.env.TZ = original;
  }
});
