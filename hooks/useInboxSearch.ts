"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { Conversation } from "@/lib/inbox-types";
import { getConversationDisplayActivityMs } from "@/lib/chat-utils";

/**
 * Estado de la búsqueda server-side.
 *
 * `empty` y `error` son estados SEPARADOS a propósito: pintar un fallo de red
 * como "no hay resultados" le hace concluir al asesor que el huésped no existe
 * en el sistema.
 */
export type InboxSearchStatus = "idle" | "searching" | "results" | "empty" | "error";

/** Mínimo de caracteres. Igual al que exige el RPC `search_conversations`. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * Ventana del debounce. Sin esto el input dispararía un GET por pulsación: el
 * filtrado era en memoria y no costaba nada, la búsqueda server-side sí.
 */
const SEARCH_DEBOUNCE_MS = 300;

type InboxSearchResponse = {
  conversations?: Conversation[];
  /** Eco del término aplicado por el servidor. `null` si no fue una búsqueda. */
  query?: string | null;
  searchLimit?: number;
  error?: string;
};

export type UseInboxSearchOptions = {
  /** Término crudo del input, sin trim. */
  query: string;
  activeHotelId: string | null;
  /** Conversación abierta: nunca se purga aunque haya entrado por búsqueda. */
  activeConversationId: string;
  setConversations: Dispatch<SetStateAction<Conversation[]>>;
};

export type UseInboxSearchResult = {
  status: InboxSearchStatus;
  /** `true` desde que el término alcanza el mínimo hasta que se vacía. */
  active: boolean;
  /** Ids que devolvió el servidor para el término vigente. */
  resultIds: Set<string>;
  /** Término efectivamente buscado (trim), para los textos de la UI. */
  term: string;
  /**
   * Ids que la búsqueda agregó al array y que NO estaban en la bandeja. Se
   * expone para que los conteos que describen la bandeja puedan excluirlos.
   */
  injectedIds: Set<string>;
  error: string | null;
  /** `true` si el servidor devolvió tantos resultados como el tope. */
  atLimit: boolean;
  retry: () => void;
};

function sortByActivity(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
  });
}

/**
 * Búsqueda server-side de conversaciones por nombre y teléfono.
 *
 * Los resultados se MEZCLAN POR ID en el mismo array `conversations` que usa la
 * bandeja, nunca en uno aparte. No es una preferencia de estilo: `selected`, los
 * handlers de Realtime, `applyConversationRowPatch` y las ocho acciones ubican
 * la conversación por índice en ese array, y todos fallan devolviendo `prev` o
 * haciendo `return` sin error cuando no la encuentran. Un resultado fuera del
 * array se podría abrir en la lista y después no respondería a ninguna acción,
 * en silencio.
 */
export function useInboxSearch({
  query,
  activeHotelId,
  activeConversationId,
  setConversations,
}: UseInboxSearchOptions): UseInboxSearchResult {
  const [status, setStatus] = useState<InboxSearchStatus>("idle");
  const [resultIds, setResultIds] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const [atLimit, setAtLimit] = useState(false);
  /** Cambiarlo re-dispara el efecto: es el botón "Reintentar". */
  const [retryTick, setRetryTick] = useState(0);

  /**
   * Ids que ESTA búsqueda agregó al array. Solo los que no estaban ya: una
   * conversación que también está en la bandeja no se purga al limpiar el input.
   * Sin este registro el array crecería sin techo durante la sesión.
   *
   * Duplicado en ref + estado a propósito: el ref es la fuente de verdad que
   * leen los callbacks de forma síncrona, y el estado es lo que se expone, para
   * que los conteos que lo excluyen se recalculen cuando cambia. Un ref solo no
   * dispara render y los chips se quedarían con el valor viejo.
   */
  const injectedIdsRef = useRef<Set<string>>(new Set());
  const [injectedIds, setInjectedIds] = useState<Set<string>>(() => new Set());

  const activeConversationIdRef = useRef(activeConversationId);
  activeConversationIdRef.current = activeConversationId;

  const term = query.trim();
  const active = term.length >= SEARCH_MIN_LENGTH;

  const purgeInjected = useCallback(() => {
    if (injectedIdsRef.current.size === 0) return;

    // La conversación abierta NO se purga: sacarla del array vaciaría el panel
    // del hilo que el asesor está leyendo. Sale del registro y pasa a ser parte
    // del set de trabajo hasta el próximo refetch de bandeja.
    const open = activeConversationIdRef.current?.trim();
    const toRemove = new Set(injectedIdsRef.current);
    if (open) toRemove.delete(open);

    // El registro se vacía SIEMPRE, incluso si lo único que había era la
    // conversación abierta: a partir de acá cuenta como parte de la bandeja.
    injectedIdsRef.current = new Set();
    setInjectedIds(injectedIdsRef.current);

    if (toRemove.size === 0) return;
    setConversations((prev) => prev.filter((c) => !toRemove.has(c.id)));
  }, [setConversations]);

  const mergeResults = useCallback(
    (found: Conversation[]) => {
      if (found.length === 0) return;

      // Caja para sacar del updater qué ids se agregaron de verdad, sin
      // provocar un setState dentro de él. Mismo patrón que `handoffSlot` en
      // `useInboxRealtime`. Es un Set para que la doble invocación del updater
      // en StrictMode no duplique.
      const addedIds = new Set<string>();

      setConversations((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        let changed = false;
        for (const conv of found) {
          // Si ya estaba, se conserva la copia en memoria: tiene `messages`,
          // `messagesLoaded` y los parches de Realtime / envíos optimistas que
          // la fila del servidor no trae.
          if (byId.has(conv.id)) continue;
          byId.set(conv.id, conv);
          addedIds.add(conv.id);
          changed = true;
        }
        if (!changed) return prev;
        return sortByActivity([...byId.values()]);
      });

      if (addedIds.size === 0) return;
      const nextInjected = new Set(injectedIdsRef.current);
      for (const id of addedIds) nextInjected.add(id);
      injectedIdsRef.current = nextInjected;
      setInjectedIds(nextInjected);
    },
    [setConversations]
  );

  // Al cambiar de hotel, `load` reemplaza el array entero: los ids inyectados
  // del hotel anterior ya no están y el registro quedaría mintiendo.
  useEffect(() => {
    if (injectedIdsRef.current.size === 0) return;
    injectedIdsRef.current = new Set();
    setInjectedIds(injectedIdsRef.current);
  }, [activeHotelId]);

  useEffect(() => {
    if (!active) {
      purgeInjected();
      setStatus("idle");
      // Solo si había algo: un Set nuevo por corrida forzaría un render extra
      // y recalcularía `filtered` sin que nada haya cambiado.
      setResultIds((prev) => (prev.size === 0 ? prev : new Set()));
      setError(null);
      setAtLimit(false);
      return;
    }

    setStatus("searching");
    setError(null);

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ q: term });
          if (activeHotelId) params.set("hotelId", activeHotelId);
          const res = await fetch(`/api/inbox?${params.toString()}`, {
            cache: "no-store",
            signal: controller.signal,
          });
          const json = (await res.json()) as InboxSearchResponse;
          if (!res.ok) {
            throw new Error(json.error ?? "No se pudo buscar");
          }
          // Respuesta fuera de orden: el término ya cambió. El abort del cleanup
          // cubre el caso normal; el eco cubre el que se le escapa (respuesta ya
          // en vuelo cuando se disparó la siguiente).
          if (typeof json.query === "string" && json.query !== term) return;

          const found = json.conversations ?? [];
          mergeResults(found);
          setResultIds(new Set(found.map((c) => c.id)));
          setAtLimit(
            typeof json.searchLimit === "number" && found.length >= json.searchLimit
          );
          setStatus(found.length === 0 ? "empty" : "results");
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") return;
          console.warn("[useInboxSearch]", e);
          setError(e instanceof Error ? e.message : "Error de red");
          setStatus("error");
        }
      })();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [term, active, activeHotelId, retryTick, purgeInjected, mergeResults]);

  const retry = useCallback(() => setRetryTick((n) => n + 1), []);

  return { status, active, resultIds, term, injectedIds, error, atLimit, retry };
}
