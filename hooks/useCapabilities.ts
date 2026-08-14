"use client";

import { useEffect, useState } from "react";
import type { CapabilityMap } from "@/lib/permissions";

/**
 * Capacidades del usuario, leídas de `/api/me`.
 *
 * Devuelve `null` mientras carga o si la petición falla. Los consumidores tratan
 * ese `null` como "todavía no sé" y pintan lo de siempre: si mostráramos menos
 * durante la carga, las pestañas parpadearían en cada navegación para las
 * recepcionistas, que son el 99% de las sesiones.
 *
 * Que el estado de carga sea permisivo no abre nada: esto decide qué pestañas se
 * dibujan, no a qué datos se llega. Todo endpoint tiene su propio gate y la RLS
 * está detrás.
 */
export function useCapabilities(): CapabilityMap | null {
  const [capabilities, setCapabilities] = useState<CapabilityMap | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as { capabilities?: CapabilityMap };
        if (!cancelled && json.capabilities) {
          setCapabilities(json.capabilities);
        }
      } catch {
        // Silencioso: el fallback es "pintar lo de siempre".
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return capabilities;
}
