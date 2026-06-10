"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReservasCount } from "@/app/reservas/hooks/useReservasCount";

type InboxHeaderTabsProps = {
  hotelId?: string | null;
};

export function InboxHeaderTabs({ hotelId }: InboxHeaderTabsProps) {
  const pathname = usePathname();
  const reservasCount = useReservasCount(hotelId);
  const isReservas = pathname?.startsWith("/reservas");

  const hasPendingReservas = reservasCount > 0;

  const base =
    "inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] font-semibold transition sm:px-3";
  const active = "border-[#e7dfd4] bg-white text-[#1f1f1c] shadow-sm";
  const inactive = "border-transparent bg-transparent text-[#6b665e] hover:border-[#e7dfd4] hover:bg-white/70";

  const reservasTabClasses = isReservas
    ? active
    : hasPendingReservas
      ? "border-transparent bg-transparent text-[#1f1f1c] hover:border-[#e7dfd4] hover:bg-white/70"
      : inactive;

  const badgeClasses = hasPendingReservas
    ? "ml-1.5 rounded-md bg-rose-500 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-white shadow-sm ring-1 ring-rose-600/40 animate-pulse"
    : "ml-1.5 rounded-md bg-[#f1ece4] px-1.5 py-0.5 font-mono text-[10px] text-[#6b665e]";

  return (
    <nav className="hidden shrink-0 items-center gap-1 rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] p-1 sm:flex">
      <Link href="/" className={`${base} ${!isReservas ? active : inactive}`}>
        Conversaciones
      </Link>
      <Link href="/reservas" className={`${base} ${reservasTabClasses}`}>
        {hasPendingReservas && (
          <span
            className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500"
            aria-hidden
          />
        )}
        Reservas
        <span className={badgeClasses}>{reservasCount}</span>
      </Link>
    </nav>
  );
}
