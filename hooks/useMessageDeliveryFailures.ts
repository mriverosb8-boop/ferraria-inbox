"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageDeliveryFailure } from "@/lib/inbox-types";

type StatusesResponse = {
  statuses?: MessageDeliveryFailure[];
  error?: string;
};

/**
 * Trae de `GET /api/conversations/[id]/message-statuses` los mensajes salientes
 * que Meta reportó como NO entregados, indexados por `wamid`.
 *
 * Se carga al abrir la conversación y se refresca a mano tras enviar
 * (`refetch`). No usa Realtime a propósito: `message_statuses` es service-role
 * only, así que el navegador no puede suscribirse; y un acuse de fallo no es
 * información que se necesite al segundo.
 *
 * Un fallo del fetch se traga en silencio (solo `console.warn`): el hilo se
 * sigue viendo igual, sin marcas de no entregado. Degradar así es preferible a
 * un banner de error por algo que es puramente decorativo sobre la burbuja.
 */
export function useMessageDeliveryFailures(conversationId: string, hotelId: string | null) {
  const [failures, setFailures] = useState<Map<string, MessageDeliveryFailure>>(
    () => new Map()
  );
  const fetchKeyRef = useRef("");
  const controllerRef = useRef<AbortController | null>(null);

  const load = useCallback(async (convId: string, hid: string) => {
    const key = `${hid}:${convId}`;
    fetchKeyRef.current = key;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const params = new URLSearchParams({ hotelId: hid });
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(convId)}/message-statuses?${params}`,
        { cache: "no-store", signal: controller.signal }
      );
      const json = (await res.json()) as StatusesResponse;
      if (!res.ok) throw new Error(json.error ?? "No se pudieron cargar los estados de envío");
      if (controller.signal.aborted || fetchKeyRef.current !== key) return;

      setFailures(
        new Map((json.statuses ?? []).map((entry) => [entry.wamid, entry]))
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.warn("[useMessageDeliveryFailures]", e);
    }
  }, []);

  useEffect(() => {
    const convId = conversationId.trim();
    const hid = hotelId?.trim() ?? "";
    if (!convId || !hid) {
      fetchKeyRef.current = "";
      setFailures(new Map());
      return;
    }

    // Vaciar antes de pedir: si no, al saltar de conversación se verían por un
    // instante los fallos de la anterior sobre burbujas que no son suyas.
    setFailures(new Map());
    void load(convId, hid);

    return () => {
      controllerRef.current?.abort();
    };
  }, [conversationId, hotelId, load]);

  /**
   * Vuelve a pedir los acuses. Se llama tras enviar: Meta tarda unos segundos
   * en mandar el webhook de status, así que el llamador debe espaciarlo.
   */
  const refetch = useCallback(() => {
    const convId = conversationId.trim();
    const hid = hotelId?.trim() ?? "";
    if (!convId || !hid) return;
    void load(convId, hid);
  }, [conversationId, hotelId, load]);

  return { deliveryFailures: failures, refetchDeliveryFailures: refetch };
}
