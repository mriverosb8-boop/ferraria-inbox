"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { Conversation, Message } from "@/lib/inbox-types";

type MessagesResponse = {
  messages?: Message[];
  error?: string;
};

/**
 * Carga el historial autoritativo de la conversación seleccionada desde
 * `GET /api/inbox/messages` y lo escribe en el estado compartido marcando
 * `messagesLoaded: true`.
 *
 * Devuelve `loadingMessages` (hay un fetch en vuelo) y `messagesError` (el
 * fetch falló). El consumidor usa el primero para tapar el hilo con un
 * skeleton y el segundo para degradar a lo que haya en memoria en vez de
 * quedarse en skeleton permanente.
 */
export function useInboxConversationMessages(
  conversationId: string,
  hotelId: string | null,
  setConversations: Dispatch<SetStateAction<Conversation[]>>
) {
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const fetchKeyRef = useRef("");

  useEffect(() => {
    const convId = conversationId.trim();
    const hid = hotelId?.trim() ?? "";
    if (!convId || !hid) {
      setLoadingMessages(false);
      setMessagesError(null);
      return;
    }

    const key = `${hid}:${convId}`;
    fetchKeyRef.current = key;
    let cancelled = false;

    void (async () => {
      setLoadingMessages(true);
      setMessagesError(null);
      try {
        const params = new URLSearchParams({ conversationId: convId, hotelId: hid });
        const res = await fetch(`/api/inbox/messages?${params}`, { cache: "no-store" });
        const json = (await res.json()) as MessagesResponse;
        if (!res.ok) {
          throw new Error(json.error ?? "No se pudo cargar el historial");
        }
        if (cancelled || fetchKeyRef.current !== key) return;

        const messages = json.messages ?? [];
        setConversations((prev) =>
          prev.map((c) => (c.id === convId ? { ...c, messages, messagesLoaded: true } : c))
        );
      } catch (e) {
        if (!cancelled && fetchKeyRef.current === key) {
          console.warn("[useInboxConversationMessages]", e);
          setMessagesError(e instanceof Error ? e.message : "No se pudo cargar el historial");
        }
      } finally {
        if (!cancelled && fetchKeyRef.current === key) {
          setLoadingMessages(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, hotelId, setConversations]);

  return { loadingMessages, messagesError };
}
