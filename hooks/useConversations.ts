"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Conversation } from "@/lib/inbox-types";
import {
  hotelWhatsappMapFromRecord,
  type HotelWhatsappByIdMap,
} from "@/lib/hotel-whatsapp-map";
import { getConversationDisplayActivityMs } from "@/lib/chat-utils";
import { MESSAGES_LIMIT } from "@/lib/message-limits";
import { writeStoredActiveHotelId } from "@/lib/active-hotel-storage";
import { type RealtimeUiStatus, useInboxRealtime } from "@/hooks/useInboxRealtime";

type AvailableHotel = {
  id: string;
  name: string;
};

type InboxResponse = {
  conversations: Conversation[];
  fetchedRows?: number;
  availableHotels?: AvailableHotel[];
  activeHotelId?: string | null;
  hotelWhatsappById?: Record<string, string>;
  error?: string;
};

function sortByLastActivity(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
  });
}

export type RefetchOptions = {
  /** Si es true, no muestra el estado global de carga ni vacía la lista en error (ideal para reconciliación). */
  silent?: boolean;
  /** Señal para abortar el fetch en vuelo (p. ej. cuando un cambio de hotel recrea `load`). */
  signal?: AbortSignal;
};

export type UseConversationsOptions = {
  activeConversationId?: string;
  activeHotelId?: string | null;
};

/** Ventana de coalescing para recargas por reconciliación Realtime sin contexto local. */
const MISSING_CONTEXT_DEBOUNCE_MS = 800;

export type { AvailableHotel };

export function useConversations(options?: UseConversationsOptions) {
  const activeHotelId = options?.activeHotelId ?? null;
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [availableHotels, setAvailableHotels] = useState<AvailableHotel[]>([]);
  const [resolvedActiveHotelId, setResolvedActiveHotelId] = useState<string | null>(null);
  const [hotelWhatsappById, setHotelWhatsappById] = useState<HotelWhatsappByIdMap>(() => new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [urgentHandoffBannerVisible, setUrgentHandoffBannerVisible] = useState(false);
  const [realtimeUiStatus, setRealtimeUiStatus] = useState<RealtimeUiStatus>("waiting");
  const [realtimeErrorDetail, setRealtimeErrorDetail] = useState<string | undefined>(undefined);

  const dismissUrgentHandoffBanner = useCallback(() => {
    setUrgentHandoffBannerVisible(false);
  }, []);

  const onRealtimeConnection = useCallback((status: RealtimeUiStatus, detail?: string) => {
    setRealtimeUiStatus(status);
    setRealtimeErrorDetail(status === "error" ? detail : undefined);
  }, []);

  // Ref siempre-actualizado de la conversación activa. Permite que `load` lea el
  // valor vigente SIN listar activeConversationId en sus deps, evitando recrear
  // `load` —y re-disparar el efecto [load], que recarga /api/inbox completo— en
  // cada cambio de conversación seleccionada. Se sincroniza en cada render.
  const activeConversationIdRef = useRef(options?.activeConversationId);
  activeConversationIdRef.current = options?.activeConversationId;

  const load = useCallback(async (refetchOptions?: RefetchOptions) => {
    const silent = refetchOptions?.silent === true;
    const signal = refetchOptions?.signal;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      // Hace un GET a /api/inbox. `useStoredHotelId=false` fuerza la petición sin
      // ?hotelId= (usado por el reintento de auto-recuperación).
      const fetchInbox = async (useStoredHotelId: boolean) => {
        const params = new URLSearchParams();
        if (useStoredHotelId && activeHotelId) {
          params.set("hotelId", activeHotelId);
        }
        const query = params.toString();
        const res = await fetch(query ? `/api/inbox?${query}` : "/api/inbox", {
          cache: "no-store",
          signal,
        });
        const json = (await res.json()) as InboxResponse;
        return { res, json };
      };

      let { res, json } = await fetchInbox(true);

      // Auto-recuperación: si el hotelId almacenado es de un hotel que el usuario
      // actual no tiene permitido, el server responde 403. Descartamos el id stale
      // y reintentamos UNA sola vez sin él → cae a availableHotels[0] (su hotel).
      // El reintento nunca manda hotelId, así que no puede re-disparar este 403.
      if (!res.ok && res.status === 403 && activeHotelId) {
        writeStoredActiveHotelId(null);
        ({ res, json } = await fetchInbox(false));
      }

      if (!res.ok) {
        throw new Error(json.error ?? "No se pudo cargar la bandeja");
      }
      const sorted = sortByLastActivity(json.conversations ?? []);
      const activeId = activeConversationIdRef.current?.trim();
      setConversations((prev) => {
        if (!activeId) return sorted;
        const prevActive = prev.find((c) => c.id === activeId);
        if (!prevActive || prevActive.messages.length <= MESSAGES_LIMIT) return sorted;
        return sorted.map((c) =>
          c.id === activeId ? { ...c, messages: prevActive.messages } : c
        );
      });
      setAvailableHotels(json.availableHotels ?? []);
      setResolvedActiveHotelId(json.activeHotelId ?? null);
      setHotelWhatsappById(hotelWhatsappMapFromRecord(json.hotelWhatsappById ?? {}));
      setError(null);
    } catch (e) {
      // Fetch abortado (p. ej. un cambio de hotel recreó `load` y canceló este):
      // no es un error de UI, simplemente quedó obsoleto.
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!silent) {
        setError(e instanceof Error ? e.message : "Error de red");
        setConversations([]);
      } else {
        console.warn("[useConversations] Refresco silencioso falló", e);
      }
    } finally {
      // Si se abortó, un nuevo `load` ya tomó el control del estado de carga:
      // no lo apaguemos por debajo del fetch vigente.
      if (!silent && !signal?.aborted) setLoading(false);
    }
  }, [activeHotelId]);

  useEffect(() => {
    const controller = new AbortController();
    void load({ signal: controller.signal });
    return () => controller.abort();
  }, [load]);

  const loadRef = useRef(load);
  loadRef.current = load;

  // Debounce trailing-edge SOLO para el camino de reconciliación Realtime
  // (`onMissingContext`): si llegan varios eventos sin contexto en una ventana
  // corta, se colapsan en UNA sola recarga al final de la ráfaga, en vez de una
  // recarga completa por evento. No afecta montaje ni visibilitychange.
  const missingContextTimerRef = useRef<number | null>(null);

  const scheduleMissingContextReload = useCallback(() => {
    if (missingContextTimerRef.current != null) {
      window.clearTimeout(missingContextTimerRef.current);
    }
    missingContextTimerRef.current = window.setTimeout(() => {
      missingContextTimerRef.current = null;
      void loadRef.current({ silent: true });
    }, MISSING_CONTEXT_DEBOUNCE_MS);
  }, []);

  // Limpia el timer pendiente al desmontar: evita recargas tras unmount y fugas.
  useEffect(() => {
    return () => {
      if (missingContextTimerRef.current != null) {
        window.clearTimeout(missingContextTimerRef.current);
        missingContextTimerRef.current = null;
      }
    };
  }, []);

  const markConversationRead = useCallback(async (conversationId: string) => {
    const id = conversationId.trim();
    if (!id) return;

    setConversations((prev) =>
      prev.map((c) => (c.id === id && c.unreadCount > 0 ? { ...c, unreadCount: 0 } : c))
    );

    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: id, action: "mark_read" }),
      });
      if (!res.ok) {
        throw new Error(`mark_read ${res.status}`);
      }
    } catch (e) {
      console.warn("[useConversations] No se pudo marcar como leída", e);
      void loadRef.current({ silent: true });
    }
  }, []);

  // Reconciliación puntual: refetch silencioso cuando la pestaña vuelve al foco,
  // útil si el socket de Realtime estuvo en background o el tab estuvo dormido.
  useEffect(() => {
    const onVisible = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        void loadRef.current({ silent: true });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!urgentHandoffBannerVisible) return;
    const t = window.setTimeout(() => {
      setUrgentHandoffBannerVisible(false);
    }, 8000);
    return () => clearTimeout(t);
  }, [urgentHandoffBannerVisible]);

  // Realtime: reemplaza el polling. Si llega un evento sin contexto local
  // (p. ej. nueva conversación o mensaje de un teléfono aún no cargado),
  // disparamos un refetch silencioso para reconciliar.
  useInboxRealtime({
    setConversations,
    activeConversationId: options?.activeConversationId,
    activeHotelId: resolvedActiveHotelId,
    hotelWhatsappById,
    onMissingContext: () => {
      scheduleMissingContextReload();
    },
    onUrgentHandoffBanner: () => {
      setUrgentHandoffBannerVisible(true);
    },
    onRealtimeConnection,
  });

  return {
    conversations,
    setConversations,
    loading,
    error,
    refetch: load,
    markConversationRead,
    urgentHandoffBannerVisible,
    dismissUrgentHandoffBanner,
    realtimeUiStatus,
    realtimeErrorDetail,
    availableHotels,
    activeHotelId: resolvedActiveHotelId,
  };
}
