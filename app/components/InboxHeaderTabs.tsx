"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReservasCount } from "@/app/reservas/hooks/useReservasCount";

type InboxHeaderTabsProps = {
  hotelId?: string | null;
  /** Variante para barra de cabecera roja (texto e islas en blanco translúcido). */
  onRed?: boolean;
};

export function InboxHeaderTabs({ hotelId, onRed = false }: InboxHeaderTabsProps) {
  const pathname = usePathname();
  const reservasCount = useReservasCount(hotelId);
  const isReservas = pathname?.startsWith("/reservas");

  const hasPendingReservas = reservasCount > 0;

  const base =
    "grotesk inline-flex items-center rounded-[7px] px-3.5 py-[7px] text-[13.5px] font-semibold transition";
  const active = onRed
    ? "bg-white text-[var(--red-deep)] shadow-sm"
    : "bg-[var(--panel)] text-[var(--ink)] shadow-[var(--shadow-sm)]";
  const inactive = onRed
    ? "bg-transparent text-white/85 hover:bg-white/15"
    : "bg-transparent text-[var(--ink-2)] hover:bg-[var(--panel)]/60";

  const reservasTabClasses = isReservas ? active : inactive;

  const badgeClasses = hasPendingReservas
    ? `ibx-mono ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold animate-pulse ${onRed ? "bg-white text-[var(--red-deep)]" : "bg-[var(--red)] text-white"}`
    : `ibx-mono ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] ${onRed ? "bg-white/20 text-white" : "bg-[var(--panel-3)] text-[var(--ink-3)]"}`;

  return (
    <nav
      className={`hidden shrink-0 items-center gap-0.5 rounded-[10px] p-[3px] sm:flex ${onRed ? "bg-white/15" : "bg-[var(--panel-2)]"}`}
    >
      <Link href="/" className={`${base} ${!isReservas ? active : inactive}`}>
        Conversaciones
      </Link>
      <Link href="/reservas" className={`${base} ${reservasTabClasses}`}>
        {hasPendingReservas && (
          <span
            className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${onRed ? "bg-white" : "bg-[var(--red)]"}`}
            aria-hidden
          />
        )}
        Reservas
        <span className={badgeClasses}>{reservasCount}</span>
      </Link>
    </nav>
  );
}
