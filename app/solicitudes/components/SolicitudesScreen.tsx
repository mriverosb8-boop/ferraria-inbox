"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BrandHeaderMark } from "@/app/components/BrandHeaderMark";
import { HeaderMobileMenu } from "@/app/components/HeaderMobileMenu";
import { InboxHeaderTabs } from "@/app/components/InboxHeaderTabs";
import { LogoutButton } from "@/app/components/LogoutButton";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { readStoredActiveHotelId, writeStoredActiveHotelId } from "@/lib/active-hotel-storage";
import {
  FILTRO_LABEL,
  SOLICITUDES_FILTROS,
  type ServiceTicket,
  type SolicitudesFiltro,
  type TicketEstado,
} from "@/lib/service-tickets";
import { useSolicitudes } from "../hooks/useSolicitudes";
import { ConfirmarCancelacion } from "./ConfirmarCancelacion";
import { TicketCard } from "./TicketCard";

type Toast = { id: number; tipo: "ok" | "error"; mensaje: string };

const VACIO: Readonly<Record<SolicitudesFiltro, { titulo: string; detalle: string }>> = {
  abiertas: {
    titulo: "No hay solicitudes abiertas",
    detalle:
      "Acá van apareciendo los pedidos que los huéspedes hacen por WhatsApp: toallas, aire acondicionado, room service. La lista se actualiza sola.",
  },
  resueltas: {
    titulo: "Todavía no hay solicitudes resueltas",
    detalle: "Cuando marques una como resuelta, la vas a encontrar acá.",
  },
  canceladas: {
    titulo: "No hay solicitudes canceladas",
    detalle: "Acá quedan las que se decidió no atender.",
  },
  todas: {
    titulo: "Todavía no hay solicitudes",
    detalle:
      "Acá van apareciendo los pedidos que los huéspedes hacen por WhatsApp: toallas, aire acondicionado, room service. La lista se actualiza sola.",
  },
};

export function SolicitudesScreen() {
  const searchParams = useSearchParams();
  const ticketIdBuscado = searchParams.get("ticketId")?.trim() ?? "";

  const [filtro, setFiltro] = useState<SolicitudesFiltro>("abiertas");
  const [activeHotelId, setActiveHotelId] = useState<string | null>(() => readStoredActiveHotelId());
  const [cancelando, setCancelando] = useState<ServiceTicket | null>(null);
  const [ocupadoId, setOcupadoId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const avisar = useCallback((mensaje: string, tipo: Toast["tipo"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((previos) => [...previos, { id, tipo, mensaje }]);
    window.setTimeout(() => setToasts((previos) => previos.filter((t) => t.id !== id)), 3500);
  }, []);

  const {
    solicitudes,
    estado,
    error,
    availableHotels,
    resolvedActiveHotelId,
    cambiarEstado,
  } = useSolicitudes({ activeHotelId, filtro });

  const scopedHotelId = activeHotelId ?? resolvedActiveHotelId;

  useEffect(() => {
    if (resolvedActiveHotelId && activeHotelId === null) {
      setActiveHotelId(resolvedActiveHotelId);
      writeStoredActiveHotelId(resolvedActiveHotelId);
    }
  }, [resolvedActiveHotelId, activeHotelId]);

  /**
   * Deep-link del push (`/solicitudes?ticketId=…`).
   *
   * Si la solicitud no está en la lista visible puede ser que ya la resolvieron,
   * así que se pasa UNA sola vez al filtro "Todas" antes de darla por perdida.
   * Si tampoco está ahí (es de otro hotel, o no existe), no pasa nada: la
   * pantalla se comporta como una lista normal en vez de mostrar un error por
   * algo que el usuario no puede arreglar.
   */
  const yaBusqueEnTodas = useRef(false);
  const yaHiceScroll = useRef(false);

  useEffect(() => {
    if (!ticketIdBuscado || estado !== "lista") return;
    const encontrada = solicitudes.some((t) => t.id === ticketIdBuscado);

    if (!encontrada && !yaBusqueEnTodas.current && filtro !== "todas") {
      yaBusqueEnTodas.current = true;
      setFiltro("todas");
      return;
    }
    if (!encontrada || yaHiceScroll.current) return;

    yaHiceScroll.current = true;
    const nodo = document.getElementById(`solicitud-${ticketIdBuscado}`);
    nodo?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [ticketIdBuscado, estado, solicitudes, filtro]);

  const aplicarCambio = async (ticket: ServiceTicket, nuevoEstado: TicketEstado) => {
    setOcupadoId(ticket.id);
    try {
      await cambiarEstado(ticket.id, nuevoEstado);
      if (nuevoEstado === "en_curso") avisar("Solicitud tomada");
      if (nuevoEstado === "resuelto") avisar("Solicitud resuelta");
      if (nuevoEstado === "cancelado") avisar("Solicitud cancelada");
      setCancelando(null);
    } catch (e) {
      avisar(e instanceof Error ? e.message : "No se pudo actualizar la solicitud", "error");
    } finally {
      setOcupadoId(null);
    }
  };

  const vacio = VACIO[filtro];

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <div className="fixed right-4 top-4 z-[600] flex max-w-[min(100vw-2rem,24rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tipo === "error" ? "alert" : "status"}
            className={`rounded-xl border px-4 py-3 text-[13px] font-semibold shadow-lg ring-1 ${
              toast.tipo === "error"
                ? "border-rose-300 bg-rose-50 text-rose-950 ring-rose-200"
                : "border-emerald-300 bg-emerald-50 text-emerald-950 ring-emerald-200"
            }`}
          >
            {toast.mensaje}
          </div>
        ))}
      </div>

      <header
        className="flex h-[52px] shrink-0 items-center px-4 lg:h-14 lg:px-6"
        style={{
          background: "linear-gradient(100deg, var(--red-deep) 0%, var(--red) 62%, #fb5142 100%)",
          borderBottom: "1px solid var(--red-deep)",
          boxShadow: "0 1px 8px rgba(196,43,32,.25)",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <BrandHeaderMark size="sm" />
          <div className="min-w-0">
            <h1 className="grotesk truncate text-[16px] font-bold tracking-tight text-white">
              Ferrar<span style={{ color: "rgba(255,255,255,.82)" }}>IA</span>
            </h1>
            <p className="hidden truncate text-[11px] leading-tight text-white/80 sm:block">
              Solicitudes de los huéspedes
            </p>
          </div>
          <InboxHeaderTabs hotelId={scopedHotelId} onRed />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <div className="hidden items-center gap-1 sm:flex">
            <ThemeToggle />
            <LogoutButton onRed />
          </div>
          <HeaderMobileMenu onRed>
            <ThemeToggle variant="menu" />
            <LogoutButton onRed variant="menu" />
          </HeaderMobileMenu>
        </div>
      </header>

      {estado === "error" && error && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-[13px] text-rose-900">
          {error}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-app p-4 lg:p-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {availableHotels.length >= 2 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-4 shadow-sm">
              <label
                htmlFor="solicitudes-hotel"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-2)]"
              >
                Hotel activo
              </label>
              <select
                id="solicitudes-hotel"
                value={scopedHotelId ?? ""}
                onChange={(event) => {
                  setActiveHotelId(event.target.value);
                  writeStoredActiveHotelId(event.target.value);
                }}
                className="w-full cursor-pointer rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] shadow-sm focus:border-[var(--red)] focus:outline-none focus:ring-2 focus:ring-[var(--red)]/20"
              >
                {availableHotels.map((hotel) => (
                  <option key={hotel.id} value={hotel.id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <nav className="flex flex-wrap gap-2" aria-label="Filtrar solicitudes">
            {SOLICITUDES_FILTROS.map((opcion) => {
              const activo = opcion === filtro;
              return (
                <button
                  key={opcion}
                  type="button"
                  onClick={() => setFiltro(opcion)}
                  aria-current={activo ? "page" : undefined}
                  className={`grotesk min-h-[46px] rounded-xl px-5 py-3 text-[15px] font-semibold transition ${
                    activo
                      ? "bg-[var(--red)] text-white shadow-sm"
                      : "bg-[var(--panel)] text-[var(--ink-2)] ring-1 ring-[var(--line)] hover:bg-[var(--panel-2)]"
                  }`}
                >
                  {FILTRO_LABEL[opcion]}
                </button>
              );
            })}
          </nav>

          {estado === "cargando" && (
            <p className="py-12 text-center text-[15px] text-[var(--ink-2)]">
              Cargando solicitudes...
            </p>
          )}

          {estado === "sin-acceso" && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center shadow-sm">
              <p className="grotesk text-[17px] font-bold text-[var(--ink)]">
                Tu usuario todavía no tiene acceso a las solicitudes
              </p>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--ink-2)]">
                Pedile a un administrador que revise tu perfil y el hotel al que estás asignado.
              </p>
            </div>
          )}

          {estado === "lista" && solicitudes.length === 0 && (
            <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center shadow-sm">
              <p className="grotesk text-[17px] font-bold text-[var(--ink)]">{vacio.titulo}</p>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--ink-2)]">
                {vacio.detalle}
              </p>
            </div>
          )}

          {estado === "lista" &&
            solicitudes.map((ticket) => (
              <TicketCard
                key={ticket.id}
                ticket={ticket}
                resaltado={Boolean(ticketIdBuscado) && ticket.id === ticketIdBuscado}
                ocupado={ocupadoId === ticket.id}
                onCambiarEstado={(item, nuevoEstado) => void aplicarCambio(item, nuevoEstado)}
                onPedirCancelacion={setCancelando}
              />
            ))}
        </div>
      </main>

      <ConfirmarCancelacion
        ticket={cancelando}
        enviando={Boolean(cancelando && ocupadoId === cancelando.id)}
        onCerrar={() => setCancelando(null)}
        onConfirmar={() => {
          if (cancelando) void aplicarCambio(cancelando, "cancelado");
        }}
      />
    </div>
  );
}
