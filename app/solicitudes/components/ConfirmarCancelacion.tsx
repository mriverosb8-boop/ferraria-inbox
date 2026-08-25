"use client";

import {
  CATEGORIA_LABEL,
  normalizeArea,
  type ServiceTicket,
} from "@/lib/service-tickets";

/**
 * Confirmación de "Cancelar". Es el único botón de la pantalla sin vuelta atrás:
 * cancelado es un estado terminal, no hay reabrir. Por eso la confirmación dice
 * qué solicitud es y qué significa cancelarla, en vez de un "¿Estás seguro?".
 */
export function ConfirmarCancelacion({
  ticket,
  enviando,
  onCerrar,
  onConfirmar,
}: {
  ticket: ServiceTicket | null;
  enviando: boolean;
  onCerrar: () => void;
  onConfirmar: () => void;
}) {
  if (!ticket) return null;

  const categoria = CATEGORIA_LABEL[normalizeArea(ticket.categoria)];
  const habitacion = ticket.habitacion?.trim();

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--ink)]/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-2xl shadow-[var(--ink)]/15 ring-1 ring-black/[0.04]">
        <h2 className="grotesk text-lg font-bold tracking-tight text-[var(--ink)]">
          ¿Cancelar esta solicitud?
        </h2>
        <p className="mt-2 text-[14px] font-semibold text-[var(--ink)]">
          {categoria} · {habitacion ? `Habitación ${habitacion}` : "Sin habitación"}
        </p>
        {ticket.descripcion?.trim() && (
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--ink-2)]">
            {ticket.descripcion.trim()}
          </p>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--ink-2)]">
          Cancelarla significa que no se va a atender. No se puede reabrir: si después hay que
          hacerla, toca crear una solicitud nueva. El huésped no recibe ningún aviso automático.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="min-h-[44px] rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2.5 text-[14px] font-semibold text-[var(--ink-2)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            No, dejarla como está
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="min-h-[44px] rounded-xl bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Cancelando..." : "Sí, cancelar la solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
