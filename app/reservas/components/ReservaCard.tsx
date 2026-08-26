"use client";

import { avatarFlatColors, initials } from "@/lib/avatar";
import {
  SIN_DATO,
  formatCOT,
  formatFechaOpcional,
  formatHabitacionCorta,
  formatTiempoRelativo,
  formatTotalOpcional,
  getQuoteTaxAmounts,
} from "../lib/formatters";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva;
  selected: boolean;
  onSelect: (reserva: Reserva) => void;
};

function Dato({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  const vacio = value === SIN_DATO;
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="shrink-0 text-[12px] text-[var(--text-secondary)]">{label}</span>
      <span
        className={`truncate text-[12.5px] font-semibold ${mono && !vacio ? "ibx-mono" : ""} ${
          vacio ? "font-normal text-[var(--text-secondary)]" : "text-[var(--text-primary)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Tarjeta de la lista de Reservas (docs/REDESIGN.md §6.3).
 *
 * Solo resume y selecciona: el detalle completo y las acciones viven en el
 * panel del centro, para que la lista se pueda barrer de un vistazo desde una
 * tablet sin scroll infinito.
 */
export function ReservaCard({ reserva, selected, onSelect }: Props) {
  const quote = reserva.quote_requests;
  const nombre = reserva.titular_nombre || "Titular sin nombre";
  const cot = formatCOT(reserva.quote_request_id);
  const { totalAmount } = getQuoteTaxAmounts(quote);
  const avatar = avatarFlatColors(reserva.id);

  return (
    <article>
      <button
        type="button"
        onClick={() => onSelect(reserva)}
        aria-current={selected ? "true" : undefined}
        className={`w-full rounded-[var(--radius-card)] border bg-[var(--bg-card)] p-3.5 text-left shadow-sm transition ${
          selected
            ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
            : "border-[var(--border-soft)] hover:border-[var(--text-secondary)]/40"
        }`}
      >
        <div className="flex items-start gap-3">
          <span
            className="ibx-mono flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-[13px] font-bold"
            style={{ background: avatar.bg, color: avatar.fg }}
            aria-hidden
          >
            {initials(nombre)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="grotesk truncate text-[14.5px] font-semibold text-[var(--text-primary)]">
              {nombre}
            </p>
            <p className="ibx-mono mt-0.5 truncate text-[11px] text-[var(--text-secondary)]">
              {cot} · {formatTiempoRelativo(reserva.created_at)}
            </p>
          </div>
          {reserva.status !== "pendiente" && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                reserva.status === "rechazada"
                  ? "bg-[var(--red-soft)] text-[var(--accent)]"
                  : "bg-[var(--success-bg)] text-[var(--success-text)]"
              }`}
            >
              {reserva.status === "rechazada" ? "Rechazada" : "Completada"}
            </span>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5">
          <Dato label="Entrada" value={formatFechaOpcional(quote?.fecha_entrada, quote?.fecha_salida)} />
          <Dato label="Salida" value={formatFechaOpcional(quote?.fecha_salida, quote?.fecha_entrada)} />
          <Dato
            label="Habitación"
            value={formatHabitacionCorta(quote?.num_rooms, quote?.room_type_requested)}
          />
          <Dato label="Total" value={formatTotalOpcional(totalAmount)} mono />
        </div>
      </button>
    </article>
  );
}
