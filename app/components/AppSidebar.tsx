"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useReservasCount } from "@/app/reservas/hooks/useReservasCount";
import { useSolicitudesCount } from "@/app/solicitudes/hooks/useSolicitudesCount";
import { useCapabilities } from "@/hooks/useCapabilities";
import type { RealtimeUiStatus } from "@/hooks/useInboxRealtime";
import { initials } from "@/lib/avatar";
import { INBOX_PATH, RESERVAS_PATH, SOLICITUDES_PATH } from "@/lib/routes";
import { createClient } from "@/lib/supabase/client";
import { BrandHeaderMark } from "./BrandHeaderMark";
import { ChangelogPanel, SparkMark, useChangelog } from "./ChangelogModal";
import { FeedbackModal } from "./FeedbackModal";
import { HEADER_MENU_ROW_CLASS } from "./HeaderMobileMenu";
import { HelpModal } from "./HelpModal";
import { LogoutButton } from "./LogoutButton";
import { ThemeToggle } from "./ThemeToggle";

/** Vista client-side de la página de conversaciones. NO son rutas. */
export type InboxView = "guests" | "staff";

/**
 * Query param que hace enlazable la vista Staff. "Staff" no es una ruta (sería
 * duplicar toda la pantalla de conversaciones), pero sin nada en la URL el
 * sidebar no podría llevar a ella desde Reservas o Tickets.
 */
export const VISTA_PARAM = "vista";
export const VISTA_STAFF = "staff";

/** Destino del sidebar para la vista Staff dentro de la bandeja. */
export const STAFF_HREF = `${INBOX_PATH}?${VISTA_PARAM}=${VISTA_STAFF}`;

export type AppSidebarProps = {
  /** Hotel activo: alimenta los contadores de Reservas y Tickets. */
  hotelId?: string | null;
  /**
   * Vista activa dentro de la bandeja. Solo la manda `/`: desde Reservas o
   * Tickets no hay vista que resaltar y "Huéspedes" queda apagado.
   */
  inboxView?: InboxView;
  /**
   * Cambio de vista sin navegar. Cuando llega, Huéspedes y Staff dejan de ser
   * enlaces y pasan a ser botones: la bandeja ya está montada y recargarla
   * perdería la conversación abierta.
   */
  onInboxViewChange?: (view: InboxView) => void;
  /**
   * Gate por engine. Si el hotel activo no corre en el engine no hay guard que
   * impida que la IA le conteste al personal, así que la entrada no existe.
   */
  showStaff?: boolean;
  /** Conversaciones de staff con mensajes sin leer. Sin no leídas, sin badge. */
  staffUnreadCount?: number;
  /** Chat abierto en móvil: la barra inferior tapa el composer y se esconde. */
  hideMobileNav?: boolean;
  /**
   * Estado de la actualización en vivo de la bandeja. Solo lo manda la bandeja:
   * Reservas y Tickets no tienen suscripción en vivo, así que ahí no se pinta
   * un indicador que no describiría nada.
   */
  realtimeStatus?: RealtimeUiStatus;
};

type BadgeTone = "urgent" | "muted";

type NavEntry = {
  key: string;
  label: string;
  ariaLabel: string;
  href: string;
  icon: (props: { className?: string }) => React.ReactElement;
  active: boolean;
  onSelect?: () => void;
  badge: { text: string; tone: BadgeTone } | null;
};

function IconChatBubble({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
    </svg>
  );
}

/** Personal del hotel (dos siluetas). */
function IconStaff({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5v-1a3.5 3.5 0 00-3.5-3.5h-4A3.5 3.5 0 004 18.5v1" />
      <circle cx="9.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19.5v-1a3.5 3.5 0 00-2.6-3.4M15.5 5.2a3 3 0 010 5.6" />
    </svg>
  );
}

function IconCalendar({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5" />
    </svg>
  );
}

/** Tickets de servicio: una tablilla con un chulo. */
function IconClipboard({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75h6a.75.75 0 01.75.75v.75a.75.75 0 01-.75.75H9a.75.75 0 01-.75-.75V4.5A.75.75 0 019 3.75z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 5.25h1.125c.621 0 1.125.504 1.125 1.125v12.75c0 .621-.504 1.125-1.125 1.125H6.375A1.125 1.125 0 015.25 19.125V6.375c0-.621.504-1.125 1.125-1.125H7.5" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13.5l1.875 1.875L15 11.25" />
    </svg>
  );
}

// ── Conexión del navegador ─────────────────────────────────────────────────
// Se lee con `useSyncExternalStore` para no arrancar con un `useEffect` que
// corrija el estado después de hidratar (eso pinta "Sin conexión" por un frame
// en cada carga). En el servidor se asume conectado.
const onlineListeners = new Set<() => void>();

function subscribeOnline(callback: () => void): () => void {
  onlineListeners.add(callback);
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    onlineListeners.delete(callback);
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function readOnline(): boolean {
  return navigator.onLine;
}

/** Iniciales del usuario a partir del email ("ana.perez@…" → "AP"). */
function initialsFromEmail(email: string | null): string {
  if (!email) return "··";
  const local = email.split("@")[0] ?? "";
  const spaced = local.replace(/[._+-]+/g, " ").trim();
  if (!spaced) return "··";
  return initials(spaced);
}

/**
 * Sidebar terracota fijo de la app.
 *
 * En escritorio es una columna de 90px que no scrollea. Bajo `lg` esos 90px no
 * caben al lado de una conversación, así que el mismo elemento se repinta como
 * barra inferior fija — es el mismo nodo del DOM y no dos copias, para que el
 * modal de novedades exista una sola vez en la página.
 */
export function AppSidebar({
  hotelId,
  inboxView = "guests",
  onInboxViewChange,
  showStaff = false,
  staffUnreadCount = 0,
  hideMobileNav = false,
  realtimeStatus,
}: AppSidebarProps) {
  const pathname = usePathname();
  const capabilities = useCapabilities();
  const reservasCount = useReservasCount(hotelId);
  const solicitudesCount = useSolicitudesCount(hotelId);
  const online = useSyncExternalStore(subscribeOnline, readOnline, () => true);
  const [email, setEmail] = useState<string | null>(null);
  const changelog = useChangelog();
  const [menuOpen, setMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!cancelled) setEmail(data.user?.email ?? null);
      } catch {
        // Sin sesión legible el avatar queda genérico; no es un error a mostrar.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cierre del menú de usuario: click afuera o Escape, igual que el resto de
  // los popovers de la app.
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!feedbackSent) return;
    const timer = window.setTimeout(() => setFeedbackSent(false), 4000);
    return () => window.clearTimeout(timer);
  }, [feedbackSent]);

  const userInitials = useMemo(() => initialsFromEmail(email), [email]);

  const isReservas = Boolean(pathname?.startsWith(RESERVAS_PATH));
  const isSolicitudes = Boolean(pathname?.startsWith(SOLICITUDES_PATH));

  /**
   * Gate por rol. `capabilities` es `null` mientras carga: en ese caso se pinta
   * todo, como siempre, para no parpadear la navegación en cada pantalla.
   */
  const puedeVerHuespedes = capabilities?.verConversacionesHuespedes !== false;
  const puedeVerReservas = capabilities?.verReservas !== false;
  const puedeVerSolicitudes = capabilities?.verSolicitudes !== false;

  const canSwitchView = typeof onInboxViewChange === "function";
  const staffVisible = canSwitchView && showStaff && puedeVerHuespedes;
  const staffActive = staffVisible && inboxView === "staff";
  const guestsActive = !isReservas && !isSolicitudes && !staffActive;

  const hasStaffUnread = staffVisible && staffUnreadCount > 0;
  const hasPendingReservas = reservasCount > 0;
  const hasPendingSolicitudes = solicitudesCount > 0;

  const entries: NavEntry[] = [];

  if (puedeVerHuespedes) {
    entries.push({
      key: "guests",
      label: "Huéspedes",
      ariaLabel: "Ver conversaciones de huéspedes",
      href: INBOX_PATH,
      icon: IconChatBubble,
      active: guestsActive,
      onSelect: canSwitchView ? () => onInboxViewChange?.("guests") : undefined,
      badge: null,
    });
  }

  if (staffVisible) {
    entries.push({
      key: "staff",
      label: "Staff",
      ariaLabel: hasStaffUnread
        ? `Ver conversaciones del personal · ${staffUnreadCount} sin leer`
        : "Ver conversaciones del personal",
      href: STAFF_HREF,
      icon: IconStaff,
      active: staffActive,
      onSelect: () => onInboxViewChange?.("staff"),
      // Mismo criterio que hoy: sin no leídas no hay badge en vez de un "0"
      // apagado, porque el cero permanente entrena a ignorarlo.
      badge: hasStaffUnread
        ? { text: staffUnreadCount > 99 ? "99+" : String(staffUnreadCount), tone: "urgent" }
        : null,
    });
  }

  if (puedeVerReservas) {
    entries.push({
      key: "reservas",
      label: "Reservas",
      ariaLabel: `Ver reservas · ${reservasCount} pendientes`,
      href: RESERVAS_PATH,
      icon: IconCalendar,
      active: isReservas,
      // Reservas sí lleva el número siempre, como hoy: es una cola que se
      // vacía y el cero es información, no ruido.
      badge: {
        text: reservasCount > 99 ? "99+" : String(reservasCount),
        tone: hasPendingReservas ? "urgent" : "muted",
      },
    });
  }

  if (puedeVerSolicitudes) {
    entries.push({
      key: "tickets",
      label: "Tickets",
      ariaLabel: hasPendingSolicitudes
        ? `Ver tickets de servicio · ${solicitudesCount} sin resolver`
        : "Ver tickets de servicio",
      href: SOLICITUDES_PATH,
      icon: IconClipboard,
      active: isSolicitudes,
      badge: hasPendingSolicitudes
        ? { text: solicitudesCount > 99 ? "99+" : String(solicitudesCount), tone: "urgent" }
        : null,
    });
  }

  /**
   * Copy del indicador de actualización en vivo. Nada de "Realtime", "canal" ni
   * "conectado": lo que necesita saber recepción es si la bandeja se actualiza
   * sola o si le toca darle al botón de refrescar.
   */
  const liveCopy: Record<RealtimeUiStatus, { label: string; dot: string; background: string; color: string }> = {
    connected: {
      label: "En vivo",
      dot: "var(--success-text)",
      background: "var(--success-bg)",
      color: "var(--success-text)",
    },
    waiting: { label: "Conectando", dot: "#ffe08a", background: "rgba(255,255,255,.18)", color: "#fff" },
    error: { label: "Actualiza a mano", dot: "var(--sidebar)", background: "#fff", color: "var(--sidebar)" },
  };
  const live = realtimeStatus ? liveCopy[realtimeStatus] : null;

  const itemBase =
    "grotesk relative flex select-none flex-col items-center justify-center gap-1 rounded-[12px] px-1 py-2 text-[10.5px] font-semibold leading-none transition max-lg:min-w-0 max-lg:flex-1 lg:w-full lg:py-2.5";
  // Hover sobre el rojo: overlay blanco al 10%. No se oscurece el terracota.
  const itemInactive = "text-white/85 hover:bg-white/10";
  const itemActive = "bg-white shadow-sm";

  return (
    <>
    <aside
      aria-label="Navegación principal"
      className={`flex shrink-0 items-center ${hideMobileNav ? "max-lg:hidden" : ""} max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-[200] max-lg:h-[calc(62px+env(safe-area-inset-bottom,0px))] max-lg:flex-row max-lg:gap-1 max-lg:px-2 max-lg:pb-[env(safe-area-inset-bottom,0px)] lg:h-full lg:w-[90px] lg:flex-col lg:gap-3 lg:overflow-hidden lg:px-2 lg:py-3`}
      style={{ background: "var(--sidebar)" }}
    >
      <div className="hidden shrink-0 lg:block">
        <BrandHeaderMark size="sm" />
      </div>

      <nav
        aria-label="Secciones"
        className="ibx-scroll flex min-w-0 flex-1 items-center max-lg:flex-row max-lg:justify-around max-lg:gap-1 lg:min-h-0 lg:w-full lg:flex-col lg:items-stretch lg:justify-start lg:gap-1.5 lg:overflow-y-auto"
      >
        {entries.map((entry) => {
          const Icon = entry.icon;
          const badgeClasses = entry.active
            ? "bg-[var(--sidebar)] text-white"
            : entry.badge?.tone === "urgent"
              ? "bg-white text-[var(--sidebar)] animate-pulse"
              : "bg-white/20 text-white";
          const content = (
            <>
              <Icon className="h-[19px] w-[19px]" />
              <span className="max-w-full truncate">{entry.label}</span>
              {entry.badge && (
                <span
                  className={`ibx-mono absolute right-0.5 top-0.5 rounded-md px-1 py-0.5 text-[9.5px] font-semibold ${badgeClasses}`}
                  aria-hidden
                >
                  {entry.badge.text}
                </span>
              )}
            </>
          );

          const className = `${itemBase} ${entry.active ? itemActive : itemInactive}`;
          const style = entry.active ? { color: "var(--sidebar)" } : undefined;

          return entry.onSelect ? (
            <button
              key={entry.key}
              type="button"
              onClick={entry.onSelect}
              className={className}
              style={style}
              aria-label={entry.ariaLabel}
              aria-current={entry.active ? "page" : undefined}
            >
              {content}
            </button>
          ) : (
            <Link
              key={entry.key}
              href={entry.href}
              className={className}
              style={style}
              aria-label={entry.ariaLabel}
              aria-current={entry.active ? "page" : undefined}
            >
              {content}
            </Link>
          );
        })}
      </nav>

      <div className="flex shrink-0 items-center max-lg:flex-row max-lg:gap-1 lg:w-full lg:flex-col lg:gap-2">
        {/* Los dos indicadores van juntos y solo en escritorio: en la barra
            inferior de un teléfono no hay ancho para un texto que casi siempre
            dice lo mismo, y un punto suelto sin label no explica nada.
            "En línea" es la conexión del navegador; "En vivo" es si la bandeja
            se está actualizando sola. */}
        {live && (
          <p
            className="ibx-mono hidden w-full items-start gap-1 rounded-[10px] px-1.5 py-1 text-[9.5px] font-semibold leading-[1.3] lg:flex"
            style={{ background: live.background, color: live.color }}
            role="status"
          >
            <span
              className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: live.dot }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">{live.label}</span>
          </p>
        )}

        <p
          className="ibx-mono hidden items-center gap-1.5 rounded-full px-2 py-1 text-[9.5px] font-semibold lg:inline-flex"
          style={
            online
              ? { background: "var(--success-bg)", color: "var(--success-text)" }
              : { background: "rgba(255,255,255,.18)", color: "#fff" }
          }
          role="status"
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: online ? "var(--success-text)" : "#fff" }}
            aria-hidden
          />
          {online ? "En línea" : "Sin red"}
        </p>

        <div ref={menuRef} className="flex shrink-0 items-center justify-center lg:w-full">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            className="grotesk relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-bold uppercase transition hover:bg-white/25"
            style={{ background: "rgba(255,255,255,.18)", color: "#fff", border: "1px solid rgba(255,255,255,.3)" }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label={email ? `Tu cuenta · ${email}` : "Tu cuenta"}
          >
            {userInitials}
            {/* Punto de novedades sin leer. La acción vive adentro del menú,
                acá solo avisa que hay algo nuevo. */}
            {changelog.hasUnseen && (
              <span
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
                style={{ background: "#ffe08a", boxShadow: "0 0 0 2px var(--sidebar)" }}
                aria-hidden
              />
            )}
          </button>

          {menuOpen && (
            /* Fijo y no absoluto: en escritorio el sidebar recorta lo que se
               sale de sus 90px, así que un popover anclado adentro quedaría
               cortado. */
            <div
              role="menu"
              className="fixed bottom-[calc(62px+env(safe-area-inset-bottom,0px)+0.5rem)] right-2 z-[260] w-64 overflow-hidden rounded-2xl py-1 lg:bottom-3 lg:left-[98px] lg:right-auto"
              style={{ border: "1px solid var(--border-soft)", background: "var(--bg-card)", boxShadow: "var(--shadow-lg)" }}
            >
              <p
                className="ibx-mono truncate px-3.5 pb-2 pt-2.5 text-[11px] font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                {email ?? "Sesión iniciada"}
              </p>
              <div style={{ borderTop: "1px solid var(--border-soft)" }} />

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  changelog.openPanel();
                }}
                className={HEADER_MENU_ROW_CLASS}
                role="menuitem"
              >
                <SparkMark className="h-4 w-4 shrink-0" style={{ color: "var(--gold)" }} aria-hidden />
                Novedades
                {changelog.hasUnseen && (
                  <span
                    className="grotesk ml-auto rounded-full px-1.5 py-0.5 text-[10.5px] font-bold"
                    style={{ background: "var(--gold-soft)", color: "var(--gold)" }}
                  >
                    Nuevo
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setFeedbackOpen(true);
                }}
                className={HEADER_MENU_ROW_CLASS}
                role="menuitem"
              >
                <IconFeedback className="h-4 w-4 shrink-0" aria-hidden />
                Enviar feedback
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  setHelpOpen(true);
                }}
                className={HEADER_MENU_ROW_CLASS}
                role="menuitem"
              >
                <IconHelp className="h-4 w-4 shrink-0" aria-hidden />
                Ayuda
              </button>

              <div style={{ borderTop: "1px solid var(--border-soft)" }} />
              <ThemeToggle variant="opciones" />
              <div style={{ borderTop: "1px solid var(--border-soft)" }} />
              <LogoutButton variant="menu" />
            </div>
          )}
        </div>
      </div>
    </aside>

    {/* Los modales cuelgan por fuera del sidebar: bajo `lg` con un chat abierto
        el sidebar entero se oculta, y adentro se irían con él. */}
    <ChangelogPanel open={changelog.open} onClose={changelog.close} />
    <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    <FeedbackModal
      open={feedbackOpen}
      activeHotelId={hotelId ?? null}
      onClose={() => setFeedbackOpen(false)}
      onSuccess={() => setFeedbackSent(true)}
    />
    {feedbackSent && (
      <div
        className="grotesk fixed right-4 top-4 z-[320] max-w-[min(100vw-2rem,22rem)] rounded-xl px-4 py-3 text-[13px] font-semibold leading-snug"
        style={{
          border: "1px solid var(--live)",
          background: "var(--live-soft)",
          color: "var(--live)",
          boxShadow: "var(--shadow-lg)",
        }}
        role="status"
      >
        ¡Gracias! Tu feedback fue enviado.
      </div>
    )}
    </>
  );
}

function IconHelp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.6 9.3a2.5 2.5 0 114.4 1.9c-.8.8-2 1.2-2 2.6" />
      <path strokeLinecap="round" d="M12 17.2h.01" />
    </svg>
  );
}

function IconFeedback({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className={className} aria-hidden>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M20 14.5a2.5 2.5 0 01-2.5 2.5H9l-4 3.5V6.5A2.5 2.5 0 017.5 4h10A2.5 2.5 0 0120 6.5v8z"
      />
      <path strokeLinecap="round" d="M9 9.5h7M9 12.8h4.5" />
    </svg>
  );
}
