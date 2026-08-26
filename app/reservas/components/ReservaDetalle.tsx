"use client";

import type { ReactNode, SVGProps } from "react";
import { avatarFlatColors, initials } from "@/lib/avatar";
import {
  SIN_DATO,
  buildOperaClipboardText,
  formatCOT,
  formatConteo,
  formatFechaOpcional,
  formatHabitacionCorta,
  formatSiNo,
  formatTiempoRelativo,
  formatTotalOpcional,
  getQuoteTaxAmounts,
} from "../lib/formatters";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva | null;
  processed: boolean;
  actionDisabled: boolean;
  onBack: () => void;
  onComplete: (reserva: Reserva) => void;
  onCopy: (text: string) => void;
  onReject: (reserva: Reserva) => void;
  onReopen: (reserva: Reserva) => void;
};

function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
    </svg>
  );
}

function IconCopy(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5a1.125 1.125 0 01-1.125-1.125v-1.5a3.375 3.375 0 00-3.375-3.375H9.75"
      />
    </svg>
  );
}

function IconUndo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
      />
    </svg>
  );
}

function IconBan(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M5.636 5.636l12.728 12.728" />
    </svg>
  );
}

function IconArrowLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
    </svg>
  );
}

/** Card con el label de sección en monospace mayúscula (docs/REDESIGN.md §6.4). */
function Card({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 shadow-sm">
      <h3 className="ibx-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {titulo}
      </h3>
      <dl className="mt-3">{children}</dl>
    </section>
  );
}

/** Fila del desglose: label a la izquierda, cifra en monospace a la derecha. */
function Fila({
  label,
  value,
  mono = true,
  destacado = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
  destacado?: boolean;
}) {
  const vacio = value === SIN_DATO;
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-[5px] ${
        destacado ? "mt-1 border-t border-[var(--border-soft)] pt-2.5" : ""
      }`}
    >
      <dt className="shrink-0 text-[13px] text-[var(--text-secondary)]">{label}</dt>
      <dd
        className={`min-w-0 break-words text-right ${mono && !vacio ? "ibx-mono" : ""} ${
          destacado ? "text-[14.5px] font-bold" : "text-[13px] font-semibold"
        } ${vacio ? "font-normal text-[var(--text-secondary)]" : "text-[var(--text-primary)]"}`}
      >
        {value}
      </dd>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  const vacio = value === SIN_DATO;
  return (
    <div className="rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 py-3 shadow-sm">
      <p className="ibx-mono text-[10.5px] font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
        {label}
      </p>
      <p
        className={`grotesk mt-1.5 truncate text-[17px] ${
          vacio ? "text-[14px] font-medium text-[var(--text-secondary)]" : "font-bold text-[var(--text-primary)]"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

/**
 * Detalle de la reserva seleccionada (docs/REDESIGN.md §6.4 y §6.5).
 *
 * Todo lo que se ve acá viene tal cual de la cotización: acá no se recalcula
 * ni una noche ni un peso. Lo que la cotización no traiga se pinta como "Sin
 * dato" en gris, nunca como cero ni como error.
 */
export function ReservaDetalle({
  reserva,
  processed,
  actionDisabled,
  onBack,
  onComplete,
  onCopy,
  onReject,
  onReopen,
}: Props) {
  if (!reserva) {
    return (
      <section className="hidden min-h-0 items-center justify-center xl:flex">
        <p className="max-w-[280px] text-center text-[13.5px] leading-relaxed text-[var(--text-secondary)]">
          Elegí una reserva de la lista para ver el detalle y pasarla al PMS.
        </p>
      </section>
    );
  }

  const quote = reserva.quote_requests;
  const nombre = reserva.titular_nombre || "Titular sin nombre";
  const avatar = avatarFlatColors(reserva.id);
  const { subtotalBeforeIva, ivaAmount, totalAmount } = getQuoteTaxAmounts(quote);

  const desayuno = quote?.breakfast_included == null ? SIN_DATO : formatSiNo(quote.breakfast_included);
  const mascotas = quote?.pets == null ? SIN_DATO : formatSiNo(quote.pets);

  return (
    <section className="flex min-h-0 flex-col gap-3.5 xl:overflow-y-auto xl:pr-1 scrollbar-app">
      <header className="flex flex-wrap items-start gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[40px] shrink-0 items-center gap-2 rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-card)] px-3 text-[13px] font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-app)] xl:hidden"
        >
          <IconArrowLeft className="h-4 w-4" aria-hidden />
          Volver a la lista
        </button>

        <div className="flex w-full min-w-0 items-start gap-3">
          <span
            className="ibx-mono flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] text-[14px] font-bold"
            style={{ background: avatar.bg, color: avatar.fg }}
            aria-hidden
          >
            {initials(nombre)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="grotesk truncate text-[21px] font-bold tracking-tight text-[var(--text-primary)]">
              {nombre}
            </h2>
            <p className="ibx-mono mt-0.5 truncate text-[11.5px] text-[var(--text-secondary)]">
              {reserva.cedula || SIN_DATO} · {reserva.correo || SIN_DATO}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <span className="ibx-mono rounded-full bg-[var(--red-soft)] px-2.5 py-1 text-[11px] font-semibold text-[var(--accent)]">
              {formatCOT(reserva.quote_request_id)}
            </span>
            <span className="ibx-mono text-[11.5px] text-[var(--text-secondary)]">
              {formatTiempoRelativo(reserva.created_at)}
            </span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Entrada" value={formatFechaOpcional(quote?.fecha_entrada, quote?.fecha_salida)} />
        <StatCard label="Salida" value={formatFechaOpcional(quote?.fecha_salida, quote?.fecha_entrada)} />
        <StatCard
          label="Habitación"
          value={formatHabitacionCorta(quote?.num_rooms, quote?.room_type_requested)}
        />
        <StatCard label="Total" value={formatTotalOpcional(totalAmount)} />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Card titulo="Datos del titular">
          <Fila label="Titular" value={reserva.titular_nombre || SIN_DATO} mono={false} />
          <Fila label="Documento" value={reserva.cedula || SIN_DATO} />
          <Fila label="Correo" value={reserva.correo || SIN_DATO} />
          <Fila label="Teléfono" value={quote?.sender_phone || SIN_DATO} />
          <Fila label="Notas" value={reserva.notas?.trim() || "Sin notas"} mono={false} />
        </Card>

        <Card titulo="Cotización">
          <Fila label="Noches" value={formatConteo(quote?.nights)} />
          {/* Una fila por dato. Apareados ("Adultos · Niños", "2 · Sin dato")
              había que adivinar cuál valor era de cuál etiqueta, y con un dato
              ausente en el medio la lectura se volvía ambigua. */}
          <Fila label="Adultos" value={formatConteo(quote?.adults)} />
          <Fila label="Niños" value={formatConteo(quote?.children)} />
          <Fila label="Desayuno" value={desayuno} mono={false} />
          <Fila label="Mascotas" value={mascotas} mono={false} />
          <Fila label="Subtotal sin IVA" value={formatTotalOpcional(subtotalBeforeIva)} />
          <Fila label="IVA 19%" value={formatTotalOpcional(ivaAmount)} />
          <Fila label="Total con IVA" value={formatTotalOpcional(totalAmount)} destacado />
        </Card>
      </div>

      {reserva.status === "rechazada" && reserva.rejection_reason ? (
        <p className="rounded-[var(--radius-card)] border border-[var(--accent)] bg-[var(--red-soft)] px-4 py-3 text-[13px] leading-relaxed text-[var(--accent)]">
          <span className="font-semibold">Motivo del rechazo:</span> {reserva.rejection_reason}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 pb-1">
        {!processed && (
          <button
            type="button"
            onClick={() => onComplete(reserva)}
            disabled={actionDisabled}
            className="grotesk inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-chip)] bg-[var(--accent)] px-4 text-[13.5px] font-bold text-white shadow-sm transition hover:bg-[var(--accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconCheck className="h-4 w-4" aria-hidden />
            Completar
          </button>
        )}
        <button
          type="button"
          onClick={() => onCopy(buildOperaClipboardText(reserva))}
          className="grotesk inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-card)] px-4 text-[13.5px] font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--bg-app)]"
        >
          <IconCopy className="h-4 w-4" aria-hidden />
          Copiar datos
        </button>
        {processed && (
          <button
            type="button"
            onClick={() => onReopen(reserva)}
            disabled={actionDisabled}
            className="grotesk inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-chip)] px-4 text-[13.5px] font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-card)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconUndo className="h-4 w-4" aria-hidden />
            Volver a pendientes
          </button>
        )}
        {!processed && (
          <button
            type="button"
            onClick={() => onReject(reserva)}
            disabled={actionDisabled}
            className="grotesk ml-auto inline-flex min-h-[42px] items-center gap-2 rounded-[var(--radius-chip)] px-4 text-[13.5px] font-semibold text-[var(--accent)] transition hover:bg-[var(--red-soft)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <IconBan className="h-4 w-4" aria-hidden />
            Rechazar
          </button>
        )}
      </div>
    </section>
  );
}
