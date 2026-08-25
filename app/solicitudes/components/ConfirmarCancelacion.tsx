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
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--text-primary)]/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-5 shadow-2xl">
        <h2 className="grotesk text-[17px] font-bold tracking-tight text-[var(--text-primary)]">
          ¿Cancelar esta solicitud?
        </h2>
        <p className="mt-2 text-[14px] font-semibold text-[var(--text-primary)]">
          {categoria} · {habitacion ? `Habitación ${habitacion}` : "Sin habitación"}
        </p>
        {ticket.descripcion?.trim() && (
          <p className="mt-1 text-[14px] leading-relaxed text-[var(--text-secondary)]">
            {ticket.descripcion.trim()}
          </p>
        )}
        <p className="mt-3 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Cancelarla significa que no se va a atender. No se puede reabrir: si después hay que
          hacerla, toca crear una solicitud nueva. El huésped no recibe ningún aviso automático.
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCerrar}
            disabled={enviando}
            className="min-h-[44px] rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-2.5 text-[14px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-app)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            No, dejarla como está
          </button>
          <button
            type="button"
            onClick={onConfirmar}
            disabled={enviando}
            className="min-h-[44px] rounded-[var(--radius-chip)] bg-[var(--accent)] px-4 py-2.5 text-[14px] font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {enviando ? "Cancelando..." : "Sí, cancelar la solicitud"}
          </button>
        </div>
      </div>
    </div>
  );
}
