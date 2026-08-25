"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { readStoredActiveHotelId, writeStoredActiveHotelId } from "@/lib/active-hotel-storage";
import { normalizePhoneDigits } from "@/lib/chat-utils";
import { AppShell } from "@/app/components/AppShell";
import { ChatPanel } from "./components/ChatPanel";
import { RejectModal } from "./components/RejectModal";
import { ReservaCard } from "./components/ReservaCard";
import { TabsHeader } from "./components/TabsHeader";
import { useReservas } from "./hooks/useReservas";
import { formatCOT } from "./lib/formatters";
import type { Reserva, ReservasTab } from "./lib/types";

type Toast = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};

export default function ReservasPage() {
  const [activeTab, setActiveTab] = useState<ReservasTab>("pendientes");
  const [activeHotelId, setActiveHotelId] = useState<string | null>(() => readStoredActiveHotelId());
  const [phoneQuery, setPhoneQuery] = useState("");
  const [selectedReserva, setSelectedReserva] = useState<Reserva | null>(null);
  const [rejectingReserva, setRejectingReserva] = useState<Reserva | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((message: string, type: Toast["type"] = "success") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, 3500);
  }, []);

  const {
    pendientes,
    procesadas,
    pendingCount,
    loading,
    error,
    availableHotels,
    resolvedActiveHotelId,
    completeReserva,
    rejectReserva,
    reopenReserva,
  } = useReservas({
    activeHotelId,
    onNewReserva: (reserva) => addToast(`Nueva reserva: ${reserva.titular_nombre ?? "Huésped"}`, "info"),
  });

  const scopedHotelId = activeHotelId ?? resolvedActiveHotelId;

  useEffect(() => {
    if (resolvedActiveHotelId && activeHotelId === null) {
      setActiveHotelId(resolvedActiveHotelId);
      writeStoredActiveHotelId(resolvedActiveHotelId);
    }
  }, [resolvedActiveHotelId, activeHotelId]);

  const visibleReservas = activeTab === "pendientes" ? pendientes : procesadas;
  const phoneQueryDigits = normalizePhoneDigits(phoneQuery);
  const filteredReservas = useMemo(() => {
    if (!phoneQueryDigits) return visibleReservas;
    return visibleReservas.filter((reserva) => {
      const reservaPhoneDigits = normalizePhoneDigits(reserva.quote_requests?.sender_phone);
      return reservaPhoneDigits.includes(phoneQueryDigits);
    });
  }, [phoneQueryDigits, visibleReservas]);

  const emptyMessage = activeTab === "pendientes"
    ? "No hay reservas pendientes por procesar."
    : "No hay reservas procesadas recientes.";
  const noPhoneMatchMessage = "No hay reservas que coincidan con ese teléfono.";

  const selectedStillVisible = useMemo(
    () => filteredReservas.some((reserva) => reserva.id === selectedReserva?.id),
    [selectedReserva?.id, filteredReservas]
  );

  const handleComplete = async (reserva: Reserva) => {
    setBusyId(reserva.id);
    try {
      await completeReserva(reserva.id);
      if (selectedReserva?.id === reserva.id) setSelectedReserva(null);
      addToast(`Reserva ${formatCOT(reserva.quote_request_id)} marcada como procesada`);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo completar la reserva", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast("Datos copiados al portapapeles");
    } catch {
      addToast("No se pudo copiar al portapapeles", "error");
    }
  };

  const handleReject = async (reason: string) => {
    if (!rejectingReserva) return;
    setBusyId(rejectingReserva.id);
    try {
      await rejectReserva(rejectingReserva.id, reason);
      if (selectedReserva?.id === rejectingReserva.id) setSelectedReserva(null);
      addToast(`Reserva ${formatCOT(rejectingReserva.quote_request_id)} rechazada`);
      setRejectingReserva(null);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo rechazar la reserva", "error");
    } finally {
      setBusyId(null);
    }
  };

  const handleReopen = async (reserva: Reserva) => {
    setBusyId(reserva.id);
    try {
      await reopenReserva(reserva.id);
      addToast(`Reserva ${formatCOT(reserva.quote_request_id)} devuelta a pendientes`);
    } catch (e) {
      addToast(e instanceof Error ? e.message : "No se pudo devolver la reserva a pendientes", "error");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <AppShell hotelId={scopedHotelId}>
    <div className="flex h-full max-h-full min-h-0 w-full flex-col overflow-hidden bg-[var(--bg)] text-[var(--ink)]">
      <div className="fixed right-4 top-4 z-[600] flex max-w-[min(100vw-2rem,24rem)] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`rounded-xl border px-4 py-3 text-[13px] font-semibold shadow-lg ${
              toast.type === "error"
                ? "border-[var(--accent)] bg-[var(--red-soft)] text-[var(--accent)]"
                : toast.type === "info"
                  ? "border-sky-300 bg-sky-50 text-sky-950"
                  : "border-emerald-300 bg-emerald-50 text-emerald-950"
            }`}
            role={toast.type === "error" ? "alert" : "status"}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {error && (
        <div
          className="shrink-0 border-b px-4 py-2 text-center text-[13px]"
          style={{ borderColor: "var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
        >
          {error}
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:overflow-hidden lg:p-5">
        <section className="flex min-h-0 flex-col rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] shadow-sm ring-1 ring-black/[0.03] lg:overflow-hidden">
          {availableHotels.length >= 2 && (
            <div className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)]/80 px-4 py-3">
              <label
                htmlFor="reservas-active-hotel"
                className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[var(--ink-2)]"
              >
                Hotel activo
              </label>
              <select
                id="reservas-active-hotel"
                value={scopedHotelId ?? ""}
                onChange={(event) => {
                  const nextHotelId = event.target.value;
                  setActiveHotelId(nextHotelId);
                  writeStoredActiveHotelId(nextHotelId);
                  setSelectedReserva(null);
                }}
                className="w-full cursor-pointer appearance-none rounded-xl border border-[var(--line)] bg-[var(--panel)] py-2.5 pl-3.5 pr-10 text-[13px] text-[var(--ink)] shadow-sm focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
                style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b665e'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                  backgroundRepeat: "no-repeat",
                  backgroundPosition: "right 0.75rem center",
                  backgroundSize: "1rem",
                }}
              >
                {availableHotels.map((hotel) => (
                  <option key={hotel.id} value={hotel.id}>
                    {hotel.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <TabsHeader
            activeTab={activeTab}
            pendingCount={pendingCount}
            processedCount={procesadas.length}
            onChange={setActiveTab}
          />

          <div className="shrink-0 border-b border-[var(--line)] bg-[var(--panel)]/80 px-4 py-3">
            <input
              type="search"
              inputMode="tel"
              autoComplete="off"
              value={phoneQuery}
              onChange={(event) => setPhoneQuery(event.target.value)}
              placeholder="Buscar por teléfono…"
              className="w-full rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3.5 py-2.5 text-[14px] text-[var(--ink)] shadow-sm placeholder:text-[var(--ink-3)] transition focus:border-[var(--accent)] focus:bg-[var(--panel)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/20"
            />
          </div>

          <div className="p-4 scrollbar-app lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {loading ? (
              <p className="py-12 text-center text-sm text-[var(--ink-2)]">Cargando reservas...</p>
            ) : filteredReservas.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <p className="text-sm font-medium text-[var(--ink-2)]">
                  {phoneQueryDigits && visibleReservas.length > 0 ? noPhoneMatchMessage : emptyMessage}
                </p>
              </div>
            ) : (
              <div className="grid gap-3">
                {filteredReservas.map((reserva) => (
                  <ReservaCard
                    key={reserva.id}
                    reserva={reserva}
                    selected={selectedReserva?.id === reserva.id && selectedStillVisible}
                    processed={activeTab === "procesadas"}
                    actionDisabled={
                      busyId === reserva.id ||
                      (activeTab === "pendientes" && reserva.status !== "pendiente")
                    }
                    onComplete={(item) => void handleComplete(item)}
                    onCopy={(text) => void handleCopy(text)}
                    onViewChat={setSelectedReserva}
                    onReject={setRejectingReserva}
                    onReopen={(item) => void handleReopen(item)}
                  />
                ))}
              </div>
            )}
          </div>
        </section>

        <div
          className={`${
            selectedReserva
              ? "fixed inset-0 z-[100] bg-[var(--bg)] p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(62px+env(safe-area-inset-bottom,0px))] lg:pb-3"
              : "hidden"
          } lg:static lg:z-auto lg:block lg:min-h-0 lg:bg-transparent lg:p-0`}
        >
          <ChatPanel reserva={selectedReserva} onClose={() => setSelectedReserva(null)} />
        </div>
      </main>

      <RejectModal
        key={rejectingReserva?.id ?? "closed"}
        reserva={rejectingReserva}
        submitting={Boolean(busyId && busyId === rejectingReserva?.id)}
        onClose={() => setRejectingReserva(null)}
        onConfirm={(reason) => void handleReject(reason)}
      />
    </div>
    </AppShell>
  );
}
