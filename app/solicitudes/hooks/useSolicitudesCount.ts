"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Contador del badge de la pestaña Solicitudes: abiertas + en curso.
 *
 * Polling y no Realtime, y no es por pereza: no está confirmado que
 * `service_tickets` esté en la publicación `supabase_realtime`. Si no lo está,
 * la suscripción se conecta sin error y no dispara nunca — el badge quedaría
 * congelado en cero y nadie se enteraría. Un número que llega 30 segundos tarde
 * es honesto; un canal mudo no. Migrar a Realtime es cambiar este archivo.
 *
 * El recorte por área lo hace el endpoint: un operativo de mantenimiento ve el
 * número de SUS solicitudes, no el del hotel entero. Si contara todo, el badge
 * marcaría trabajo pendiente que esa persona no puede ni abrir.
 */
const POLL_MS = 30_000;

export function useSolicitudesCount(hotelId: string | null | undefined) {
  const scopedHotelId = typeof hotelId === "string" ? hotelId.trim() : "";
  const [count, setCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ count: "1" });
      if (scopedHotelId) params.set("hotelId", scopedHotelId);
      const response = await fetch(`/api/solicitudes?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) {
        // Un 403 (rol sin la capacidad) no es un error a reportar: es un
        // contador que no aplica. Queda en cero y la pestaña no lleva badge.
        setCount(0);
        return;
      }
      const payload = (await response.json()) as { count?: number };
      setCount(payload.count ?? 0);
    } catch (e) {
      // Un corte de red no puede inventar un número: se deja el último conocido.
      console.warn("[useSolicitudesCount] No se pudo actualizar el contador", e);
    }
  }, [scopedHotelId]);

  useEffect(() => {
    let timer: number | null = null;

    const arrancar = () => {
      if (timer === null) timer = window.setInterval(() => void load(), POLL_MS);
    };
    const parar = () => {
      if (timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    // Con la pestaña oculta no se consulta: recepción deja el inbox abierto todo
    // el turno y la tablet no tiene por qué gastar batería en segundo plano.
    const alCambiarVisibilidad = () => {
      if (document.visibilityState === "visible") {
        void load();
        arrancar();
      } else {
        parar();
      }
    };

    void (async () => {
      await load();
    })();

    if (document.visibilityState === "visible") arrancar();
    document.addEventListener("visibilitychange", alCambiarVisibilidad);

    return () => {
      parar();
      document.removeEventListener("visibilitychange", alCambiarVisibilidad);
    };
  }, [load]);

  return count;
}
