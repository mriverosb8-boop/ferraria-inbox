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
    <div className="fixed inset-0 z-[500] flex items-center justify-center bg-[var(--ink)]/35 p-4 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-2xl shadow-[var(--ink)]/15 ring-1 ring-black/[0.04]">
        <h2 className="text-lg font-semibold tracking-tight text-[var(--ink)]">
          Rechazar reserva {formatCOT(reserva.quote_request_id)}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[var(--ink-2)]">
          Esta acción marcará la reserva como rechazada. Indica el motivo:
        </p>
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Ej: No hay disponibilidad para esas fechas"
          className="mt-4 min-h-28 w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5 text-sm text-[var(--ink)] outline-none transition placeholder:text-[var(--ink-3)] focus:border-[var(--accent)] focus:bg-[var(--panel)] focus:ring-2 focus:ring-[var(--accent)]/20"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-4 py-2 text-[13px] font-semibold text-[var(--ink-2)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canSubmit}
            className="rounded-xl bg-[var(--accent)] px-4 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Rechazando..." : "Rechazar reserva"}
          </button>
        </div>
      </div>
    </div>
  );
}
