"use client";

import {
  abreviarHabitacion,
  buildOperaClipboardText,
  formatCOT,
  formatFecha,
  formatRoomType,
  formatSiNo,
  formatTiempoRelativo,
  formatTotal,
  getQuoteTaxAmounts,
} from "../lib/formatters";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva;
  selected: boolean;
  processed?: boolean;
  actionDisabled?: boolean;
  onComplete: (reserva: Reserva) => void;
  onCopy: (text: string) => void;
  onViewChat: (reserva: Reserva) => void;
  onReject: (reserva: Reserva) => void;
  onReopen: (reserva: Reserva) => void;
};

export function ReservaCard({
  reserva,
  selected,
  processed,
  actionDisabled,
  onComplete,
  onCopy,
  onViewChat,
  onReject,
  onReopen,
}: Props) {
  const quote = reserva.quote_requests;
  const cot = formatCOT(reserva.quote_request_id);
  const roomLabel = `${quote?.num_rooms ?? 0}x ${abreviarHabitacion(quote?.room_type_requested)}`;
  const fullRoomLabel = `${quote?.num_rooms ?? 0} x ${formatRoomType(quote?.room_type_requested)}`;
  const { subtotalBeforeIva, ivaAmount, totalAmount } = getQuoteTaxAmounts(quote);
  const notes = reserva.notas?.trim() || "Sin notas";

  return (
    <article
      className={`rounded-[16px] bg-[var(--panel)] p-4 shadow-sm ring-1 ring-black/[0.03] transition ${
        selected
          ? "border-2 border-[var(--accent)]"
          : "border border-[var(--line)]"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-[var(--ink)]">
            {reserva.titular_nombre || "Titular sin nombre"}
          </h3>
          <p className="mt-1 truncate text-[12px] text-[var(--ink-2)]">
            {quote?.sender_phone ?? "—"} · {reserva.correo || "sin correo"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-[var(--ink-3)]">{cot}</span>
          <span className="text-[12px] text-[var(--ink-3)]">{formatTiempoRelativo(reserva.created_at)}</span>
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px] sm:grid-cols-4">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Entrada</dt>
          <dd className="mt-1 font-semibold text-[var(--ink)]">
            {formatFecha(quote?.fecha_entrada, quote?.fecha_salida)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Salida</dt>
          <dd className="mt-1 font-semibold text-[var(--ink)]">
            {formatFecha(quote?.fecha_salida, quote?.fecha_entrada)}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Habitación</dt>
          <dd className="mt-1 font-semibold text-[var(--ink)]">{roomLabel}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Total</dt>
          <dd className="mt-1 font-semibold tabular-nums text-[var(--ink)]">{formatTotal(totalAmount)}</dd>
        </div>
      </dl>

      <div className="mt-4 grid gap-4 text-[13px] text-[var(--ink-2)] lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Datos del titular</p>
          <div className="mt-2 space-y-1.5">
            <p><span className="font-semibold text-[var(--ink-2)]">Titular:</span> {reserva.titular_nombre || "—"}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Documento:</span> {reserva.cedula || "—"}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Correo:</span> {reserva.correo || "—"}</p>
            <p className="break-words"><span className="font-semibold text-[var(--ink-2)]">Notas:</span> {notes}</p>
          </div>
        </section>

        <section className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-3)]">Cotización</p>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
            <p><span className="font-semibold text-[var(--ink-2)]">Entrada:</span> {formatFecha(quote?.fecha_entrada, quote?.fecha_salida)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Salida:</span> {formatFecha(quote?.fecha_salida, quote?.fecha_entrada)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Noches:</span> {quote?.nights ?? 0}</p>
            <p className="col-span-2"><span className="font-semibold text-[var(--ink-2)]">Habitación:</span> {fullRoomLabel}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Adultos:</span> {quote?.adults ?? 0}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Niños:</span> {quote?.children ?? 0}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Mascotas:</span> {formatSiNo(quote?.pets)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Desayuno:</span> {formatSiNo(quote?.breakfast_included)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Subtotal sin IVA:</span> {formatTotal(subtotalBeforeIva)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">IVA 19%:</span> {formatTotal(ivaAmount)}</p>
            <p><span className="font-semibold text-[var(--ink-2)]">Total con IVA:</span> {formatTotal(totalAmount)}</p>
          </div>
        </section>
      </div>

      {reserva.status === "rechazada" && reserva.rejection_reason ? (
        <p className="mt-3 rounded-xl border border-[var(--accent)] bg-[var(--red-soft)] px-3 py-2 text-[13px] text-[var(--accent)]">
          <span className="font-semibold">Motivo de rechazo:</span> {reserva.rejection_reason}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {!processed ? (
          <button
            type="button"
            onClick={() => onComplete(reserva)}
            disabled={actionDisabled}
            className="rounded-xl bg-emerald-600 px-3 py-2 text-[12px] font-semibold text-white shadow-sm ring-1 ring-emerald-700/30 transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Completar
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onCopy(buildOperaClipboardText(reserva))}
          className="rounded-xl border border-[var(--line)] bg-[var(--panel)] px-3 py-2 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-3)]"
        >
          Copiar datos
        </button>
        <button
          type="button"
          onClick={() => onViewChat(reserva)}
          className="rounded-xl border border-[var(--accent)] bg-[var(--panel)] px-3 py-2 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-3)]"
        >
          Ver chat
        </button>
        {processed ? (
          <button
            type="button"
            onClick={() => onReopen(reserva)}
            disabled={actionDisabled}
            className="rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-3)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Volver a pendientes
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onReject(reserva)}
            disabled={actionDisabled}
            className="rounded-xl px-3 py-2 text-[12px] font-semibold text-[var(--accent)] transition hover:bg-[var(--red-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rechazar
          </button>
        )}
      </div>
    </article>
  );
}
