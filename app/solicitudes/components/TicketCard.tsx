"use client";

import Link from "next/link";
import {
  CATEGORIA_LABEL,
  ESTADO_LABEL,
  estadoDe,
  normalizeArea,
  tiempoTranscurrido,
  type ServiceTicket,
  type TicketEstado,
} from "@/lib/service-tickets";

/**
 * Colores del estado. El texto SIEMPRE dice el estado en palabras: el color es
 * refuerzo, nunca la única señal (hay tablets con brillo bajo y gente que no
 * distingue estos tonos).
 */
const ESTADO_CLASES: Readonly<Record<TicketEstado, string>> = {
  abierto: "bg-[var(--accent)]/12 text-[var(--accent)] ring-1 ring-[var(--accent)]/25",
  en_curso: "bg-amber-500/15 text-amber-700 ring-1 ring-amber-500/30",
  resuelto: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-500/30",
  cancelado: "bg-[var(--panel-3)] text-[var(--ink-3)] ring-1 ring-[var(--line)]",
};

const BOTON_BASE =
  "grotesk min-h-[46px] flex-1 rounded-xl px-4 py-3 text-[15px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50";

export function TicketCard({
  ticket,
  resaltado,
  ocupado,
  onCambiarEstado,
  onPedirCancelacion,
}: {
  ticket: ServiceTicket;
  resaltado: boolean;
  ocupado: boolean;
  onCambiarEstado: (ticket: ServiceTicket, estado: TicketEstado) => void;
  onPedirCancelacion: (ticket: ServiceTicket) => void;
}) {
  const estado = estadoDe(ticket);
  const categoria = CATEGORIA_LABEL[normalizeArea(ticket.categoria)];
  const habitacion = ticket.habitacion?.trim();
  const desde = tiempoTranscurrido(ticket.created_at);
  const descripcion = ticket.descripcion?.trim();

  const puedeTomar = estado === "abierto";
  const puedeResolver = estado === "abierto" || estado === "en_curso";
  const puedeCancelar = puedeResolver;
  const cerrada = !puedeResolver;

  return (
    <article
      id={`solicitud-${ticket.id}`}
      className={`rounded-[16px] border bg-[var(--panel)] p-4 shadow-sm transition ${
        resaltado
          ? "border-[var(--accent)] ring-2 ring-[var(--accent)]/35"
          : "border-[var(--line)] ring-1 ring-black/[0.03]"
      } ${cerrada ? "opacity-90" : ""}`}
    >
      {resaltado && (
        <p className="mb-2.5 rounded-lg bg-[var(--accent)]/10 px-3 py-2 text-[13px] font-semibold text-[var(--accent)]">
          Esta es la solicitud de la notificación que abriste.
        </p>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <h2 className="grotesk text-[15px] font-bold uppercase tracking-wide text-[var(--ink)]">
          {categoria}
        </h2>
        <p className="text-[14px] font-semibold text-[var(--ink-2)]">
          {/* Sin número de habitación se dice así, con todas las letras: es un
              dato que falta, no una habitación llamada "—". */}
          {habitacion ? `Habitación ${habitacion}` : "Sin habitación"}
        </p>
      </div>

      <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-[var(--ink-2)]">
        <span
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-[12px] font-semibold ${ESTADO_CLASES[estado]}`}
        >
          {ESTADO_LABEL[estado]}
        </span>
        {/* Si la fecha no se puede leer no se inventa una antigüedad: se omite. */}
        {desde && <span>· {desde}</span>}
      </p>

      <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-[var(--ink)]">
        {descripcion || "La solicitud llegó sin descripción."}
      </p>

      {!cerrada && (
        <div className="mt-4 flex flex-wrap gap-2">
          {puedeTomar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onCambiarEstado(ticket, "en_curso")}
              className={`${BOTON_BASE} bg-[var(--panel-2)] text-[var(--ink)] ring-1 ring-[var(--line)] hover:bg-[var(--panel-3)]`}
            >
              Tomar
            </button>
          )}
          {puedeResolver && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onCambiarEstado(ticket, "resuelto")}
              className={`${BOTON_BASE} bg-emerald-600 text-white hover:bg-emerald-700`}
            >
              Resolver
            </button>
          )}
          {puedeCancelar && (
            <button
              type="button"
              disabled={ocupado}
              onClick={() => onPedirCancelacion(ticket)}
              className={`${BOTON_BASE} max-w-[10rem] bg-transparent text-[var(--ink-2)] ring-1 ring-[var(--line)] hover:bg-[var(--panel-2)]`}
            >
              Cancelar
            </button>
          )}
        </div>
      )}

      {ticket.conversation_id && (
        <Link
          href={`/?conversationId=${encodeURIComponent(ticket.conversation_id)}`}
          className="mt-3 inline-block text-[14px] font-semibold text-[var(--accent)] underline underline-offset-2 hover:opacity-80"
        >
          Ver conversación
        </Link>
      )}
    </article>
  );
}
