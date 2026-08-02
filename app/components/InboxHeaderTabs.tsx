"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useReservasCount } from "@/app/reservas/hooks/useReservasCount";

/** Vista client-side de la página de conversaciones. NO son rutas. */
export type InboxView = "guests" | "staff";

type InboxHeaderTabsProps = {
  hotelId?: string | null;
  /** Variante para barra de cabecera roja (texto e islas en blanco translúcido). */
  onRed?: boolean;
  /**
   * Vista activa dentro de la página de conversaciones. "Staff" NO es una ruta:
   * es un cambio de lista en la misma pantalla, así que el tab tiene que vivir
   * acá arriba (con su contador siempre a la vista) pero mandar el estado hacia
   * abajo. Sin `onInboxViewChange` el componente se comporta como antes:
   * "Huéspedes" vuelve a ser un `Link` a "/" (es lo que necesita /reservas).
   */
  inboxView?: InboxView;
  onInboxViewChange?: (view: InboxView) => void;
  /**
   * Gate por engine. Si el hotel activo no corre en el engine no hay guard que
   * impida que la IA le conteste al personal, así que la feature no existe: el
   * tab no se renderiza y el header queda "Huéspedes | Reservas".
   */
  showStaffTab?: boolean;
  /** Conversaciones de staff con mensajes sin leer. Sin no leídas, sin badge. */
  staffUnreadCount?: number;
};

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5" />
    </svg>
  );
}

function IconChatBubble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  );
}

/** Personal del hotel (dos siluetas). Mismo trazo que el de la bandeja. */
function IconStaff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5v-1a3.5 3.5 0 00-3.5-3.5h-4A3.5 3.5 0 004 18.5v1" />
      <circle cx="9.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19.5v-1a3.5 3.5 0 00-2.6-3.4M15.5 5.2a3 3 0 010 5.6" />
    </svg>
  );
}

export function InboxHeaderTabs({
  hotelId,
  onRed = false,
  inboxView = "guests",
  onInboxViewChange,
  showStaffTab = false,
  staffUnreadCount = 0,
}: InboxHeaderTabsProps) {
  const pathname = usePathname();
  const reservasCount = useReservasCount(hotelId);
  const isReservas = pathname?.startsWith("/reservas");

  const hasPendingReservas = reservasCount > 0;

  /**
   * Solo la página de conversaciones puede cambiar de vista sin navegar. Desde
   * /reservas el tab Staff no se pinta: llevaría a "/" y caería en Huéspedes,
   * que es exactamente lo contrario de lo que promete el tab.
   */
  const canSwitchView = !isReservas && typeof onInboxViewChange === "function";
  const selectView = (view: InboxView) => {
    onInboxViewChange?.(view);
  };

  const staffTabVisible = canSwitchView && showStaffTab;
  const staffActive = staffTabVisible && inboxView === "staff";
  const guestsActive = !isReservas && !staffActive;
  const hasStaffUnread = staffTabVisible && staffUnreadCount > 0;
  const staffUnreadLabel = staffUnreadCount > 99 ? "99+" : String(staffUnreadCount);

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

  // Mismo patrón visual que el badge de Reservas pendiente. La diferencia es que
  // sin no leídas el tab Staff no lleva badge en vez de llevar un "0" apagado:
  // el cero permanente entrena a ignorarlo y este contador sí exige mirar.
  const staffBadgeClasses = `ibx-mono ml-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold animate-pulse ${onRed ? "bg-white text-[var(--red-deep)]" : "bg-[var(--red)] text-white"}`;

  // Pill compacto solo-móvil (las pestañas de texto se ocultan bajo sm).
  const mobilePill = `grotesk inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 py-[7px] text-[13px] font-semibold transition sm:hidden ${
    onRed ? "bg-white/15 text-white hover:bg-white/25" : "bg-[var(--panel-2)] text-[var(--ink)] hover:bg-[var(--panel)]"
  }`;
  const mobilePillActive = `grotesk inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-2.5 py-[7px] text-[13px] font-semibold transition sm:hidden ${
    onRed ? "bg-white text-[var(--red-deep)]" : "bg-[var(--panel)] text-[var(--ink)] shadow-[var(--shadow-sm)]"
  }`;
  const mobileBadgeClasses = `ibx-mono rounded-md px-1.5 py-0.5 text-[10px] font-semibold animate-pulse ${
    onRed ? "bg-white text-[var(--red-deep)]" : "bg-[var(--red)] text-white"
  }`;

  return (
    <>
      <nav
        className={`hidden shrink-0 items-center gap-0.5 rounded-[10px] p-[3px] sm:flex ${onRed ? "bg-white/15" : "bg-[var(--panel-2)]"}`}
      >
        {canSwitchView ? (
          <button
            type="button"
            onClick={() => selectView("guests")}
            className={`${base} ${guestsActive ? active : inactive}`}
            aria-current={guestsActive ? "page" : undefined}
          >
            Huéspedes
          </button>
        ) : (
          <Link href="/" className={`${base} ${guestsActive ? active : inactive}`}>
            Huéspedes
          </Link>
        )}

        {staffTabVisible && (
          <button
            type="button"
            onClick={() => selectView("staff")}
            className={`${base} ${staffActive ? active : inactive}`}
            aria-current={staffActive ? "page" : undefined}
          >
            {hasStaffUnread && (
              <span
                className={`mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${onRed ? "bg-white" : "bg-[var(--red)]"}`}
                aria-hidden
              />
            )}
            Staff
            {hasStaffUnread && (
              <span
                className={staffBadgeClasses}
                aria-label={`${staffUnreadCount} mensajes del personal sin leer`}
              >
                {staffUnreadLabel}
              </span>
            )}
          </button>
        )}

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

      {/* Móvil: el tab Staff es su propio pill, al lado del de Reservas. Sin él
          el personal quedaría inalcanzable desde el teléfono, que es donde la
          recepción trabaja de noche. */}
      {staffTabVisible && (
        <button
          type="button"
          onClick={() => selectView(staffActive ? "guests" : "staff")}
          className={staffActive ? mobilePillActive : mobilePill}
          aria-label={staffActive ? "Ver conversaciones de huéspedes" : "Ver conversaciones del personal"}
          title={staffActive ? "Huéspedes" : "Staff"}
        >
          {staffActive ? (
            <IconChatBubble className="h-[18px] w-[18px]" />
          ) : (
            <IconStaff className="h-[18px] w-[18px]" />
          )}
          {!staffActive && hasStaffUnread && (
            <span className={mobileBadgeClasses}>{staffUnreadLabel}</span>
          )}
        </button>
      )}

      {isReservas ? (
        <Link href="/" className={mobilePill} aria-label="Ver conversaciones" title="Conversaciones">
          <IconChatBubble className="h-[18px] w-[18px]" />
        </Link>
      ) : (
        <Link href="/reservas" className={mobilePill} aria-label="Ver reservas" title="Reservas">
          <IconCalendar className="h-[18px] w-[18px]" />
          {hasPendingReservas && <span className={mobileBadgeClasses}>{reservasCount}</span>}
        </Link>
      )}
    </>
  );
}
