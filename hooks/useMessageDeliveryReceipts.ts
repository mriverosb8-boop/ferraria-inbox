"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageDeliveryReceipt } from "@/lib/inbox-types";

type StatusesResponse = {
  statuses?: MessageDeliveryReceipt[];
  error?: string;
};

/**
 * Trae de `GET /api/conversations/[id]/message-statuses` los acuses de entrega
 * de Meta —sent, delivered, read, failed— indexados por `wamid`.
 *
 * Se carga al abrir la conversación y se refresca a mano tras enviar
 * (`refetch`). No usa Realtime a propósito: `message_statuses` es service-role
 * only, así que el navegador no puede suscribirse; y un tick que tarda unos
 * segundos en pasar de ✓ a ✓✓ no le cuesta nada a recepción.
 *
 * Consecuencia de no usar Realtime: si el huésped LEE el mensaje mientras la
 * conversación está abierta, el ✓✓ azul no aparece hasta el siguiente envío o
 * hasta reabrir el hilo. Es una subestimación, nunca una sobreestimación, que
 * es el lado seguro del error.
 *
 * Un fallo del fetch se traga en silencio (solo `console.warn`): sin acuses el
 * hilo se sigue viendo, con todos los salientes en ✓. Degradar así es preferible
 * a un banner de error por algo decorativo sobre la burbuja.
 */
export function useMessageDeliveryReceipts(conversationId: string, hotelId: string | null) {
  const [receipts, setReceipts] = useState<Map<string, MessageDeliveryReceipt>>(
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

      setReceipts(
        new Map((json.statuses ?? []).map((entry) => [entry.wamid, entry]))
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.warn("[useMessageDeliveryReceipts]", e);
    }
  }, []);

  useEffect(() => {
    const convId = conversationId.trim();
    const hid = hotelId?.trim() ?? "";
    if (!convId || !hid) {
      fetchKeyRef.current = "";
      setReceipts(new Map());
      return;
    }

    // Vaciar antes de pedir: si no, al saltar de conversación se verían por un
    // instante los acuses de la anterior sobre burbujas que no son suyas.
    setReceipts(new Map());
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

  return { deliveryReceipts: receipts, refetchDeliveryReceipts: refetch };
}
