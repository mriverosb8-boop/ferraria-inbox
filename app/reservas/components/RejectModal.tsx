"use client";

import { useState } from "react";
import { formatCOT } from "../lib/formatters";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva | null;
  submitting: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
};

export function RejectModal({ reserva, submitting, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState("");

  if (!reserva) return null;

  const canSubmit = reason.trim().length > 0 && !submitting;

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--text-primary)]/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reservas-rechazo-titulo"
    >
      <div className="w-full max-w-md rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-5 shadow-2xl">
        <h2
          id="reservas-rechazo-titulo"
          className="grotesk text-[18px] font-bold tracking-tight text-[var(--text-primary)]"
        >
          Rechazar la reserva{" "}
          <span className="ibx-mono text-[16px] text-[var(--accent)]">
            {formatCOT(reserva.quote_request_id)}
          </span>
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--text-secondary)]">
          La reserva queda marcada como rechazada. Contá el motivo:
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej: No hay disponibilidad para esas fechas"
          aria-label="Motivo del rechazo"
          className="mt-4 min-h-28 w-full resize-none rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-app)] px-3 py-2.5 text-[14px] text-[var(--text-primary)] outline-none transition placeholder:text-[var(--text-secondary)] focus:border-[var(--accent)] focus:bg-[var(--bg-card)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="grotesk min-h-[42px] rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 text-[13.5px] font-semibold text-[var(--text-secondary)] transition hover:bg-[var(--bg-app)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
            className="grotesk min-h-[42px] rounded-[var(--radius-chip)] bg-[var(--accent)] px-4 text-[13.5px] font-bold text-white shadow-sm transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Rechazando..." : "Rechazar reserva"}
          </button>
        </div>
      </div>
    </div>
  );
}
