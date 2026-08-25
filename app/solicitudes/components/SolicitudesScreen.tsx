"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AppShell } from "@/app/components/AppShell";
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
    <AppShell hotelId={scopedHotelId}>
    <div className="flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg-app)] text-[var(--text-primary)]">
      <div className="fixed right-4 top-4 z-[600] flex max-w-[min(100vw-2rem,24rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.tipo === "error" ? "alert" : "status"}
            className={`rounded-xl border px-4 py-3 text-[13px] font-semibold shadow-lg ${
              toast.tipo === "error"
                ? "border-[var(--accent)] bg-[var(--red-soft)] text-[var(--accent)]"
                : "border-emerald-300 bg-emerald-50 text-emerald-950"
            }`}
          >
            {toast.mensaje}
          </div>
        ))}
      </div>

      {estado === "error" && error && (
        <div
          className="shrink-0 border-b px-4 py-2 text-center text-[13px]"
          style={{ borderColor: "var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
        >
          {error}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto scrollbar-app p-4 lg:p-5">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
          {/* Encabezado de la pantalla (docs/REDESIGN.md §7.1). Reemplaza a la
              barra roja superior: el logo y los controles de cuenta ya viven en
              el sidebar. */}
          <div>
            <h1 className="grotesk text-[19px] font-bold tracking-tight text-[var(--text-primary)]">
              Tickets de servicio
            </h1>
            <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-secondary)]">
              Solicitudes de los huéspedes detectadas por la IA — mantenimiento, room service, housekeeping.
            </p>
          </div>

          {availableHotels.length >= 2 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-4 shadow-sm">
              <label
                htmlFor="solicitudes-hotel"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--text-secondary)]"
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
                className="w-full cursor-pointer rounded-xl border border-[var(--border-soft)] bg-[var(--bg-app)] px-3.5 py-2.5 text-[14px] text-[var(--text-primary)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
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
                  className={`grotesk min-h-[46px] rounded-[var(--radius-chip)] px-5 py-3 text-[15px] font-semibold transition ${
                    activo
                      ? "bg-[var(--accent)] text-white shadow-sm hover:bg-[var(--accent-hover)]"
                      : "bg-[var(--bg-card)] text-[var(--text-secondary)] ring-1 ring-[var(--border-soft)] hover:bg-[var(--bg-app)]"
                  }`}
                >
                  {FILTRO_LABEL[opcion]}
                </button>
              );
            })}
          </nav>

          {estado === "cargando" && (
            <p className="py-12 text-center text-[15px] text-[var(--text-secondary)]">
              Cargando solicitudes...
            </p>
          )}

          {estado === "sin-acceso" && (
            <div className="rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-8 text-center shadow-sm">
              <p className="grotesk text-[17px] font-bold text-[var(--text-primary)]">
                Tu usuario todavía no tiene acceso a las solicitudes
              </p>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--text-secondary)]">
                Pedile a un administrador que revise tu perfil y el hotel al que estás asignado.
              </p>
            </div>
          )}

          {estado === "lista" && solicitudes.length === 0 && (
            <div className="rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-8 text-center shadow-sm">
              <p className="grotesk text-[17px] font-bold text-[var(--text-primary)]">{vacio.titulo}</p>
              <p className="mx-auto mt-2 max-w-md text-[15px] leading-relaxed text-[var(--text-secondary)]">
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
    </AppShell>
  );
}
