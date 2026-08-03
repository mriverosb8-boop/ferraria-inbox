import type { SupabaseClient } from "@supabase/supabase-js";
import { isWaLidIdentifier, normalizePhoneDigits, readWaLid } from "@/lib/chat-utils";
import {
  MAX_WUBBY_FETCH_PAGES,
  MAX_WUBBY_FETCH_ROWS,
  POSTGREST_PAGE_SIZE,
} from "@/lib/message-limits";
import { WUBBY_SELECT_COLUMNS, WUBBY_TABLE, type WubbyWhatsappRow } from "@/lib/wubby-schema";

/**
 * Resultado de un barrido paginado. `truncated` indica que se alcanzó
 * `MAX_WUBBY_FETCH_ROWS` o `MAX_WUBBY_FETCH_PAGES` y quedaron filas sin traer:
 * el barrido corta y devuelve lo acumulado, nunca lanza por truncamiento.
 */
export type WubbyFetchResult = {
  rows: WubbyWhatsappRow[];
  truncated: boolean;
};

/** `conversations.id` es uuid; nada que no lo sea entra al filtro. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PostgREST .or() para sender/recipient.
 *
 * Teléfono: se emiten las dos formas, con y sin `+`, porque en producción la
 * misma línea aparece de las dos maneras.
 *
 * LID de Meta (`CO.28322187600722863`): se usa el valor CRUDO. Normalizarlo a
 * dígitos generaba `28322187600722863`, que no matchea ninguna fila — de ahí el
 * historial vacío. Tampoco se emite la variante con `+`: un LID nunca la tiene.
 * El valor va entre comillas dobles porque lleva un punto.
 */
export function buildGuestPhoneOrFilter(guestPhone: string): string {
  if (isWaLidIdentifier(guestPhone)) {
    const lid = readWaLid(guestPhone);
    return [`sender.eq."${lid}"`, `recipient.eq."${lid}"`].join(",");
  }

  const digits = normalizePhoneDigits(guestPhone);
  if (!digits) return "";
  const plus = `+${digits}`;
  return [
    `sender.eq.${digits}`,
    `sender.eq.${plus}`,
    `recipient.eq.${digits}`,
    `recipient.eq.${plus}`,
  ].join(",");
}

/**
 * Filtro de historial: `conversation_id` como criterio PRINCIPAL y el match por
 * identidad como COMPLEMENTO, unidos por OR.
 *
 * `conversation_id` es FK a `conversations.id` (`wubby_conversation_id_fkey`) y
 * está indexado por `idx_wubby_conv_recent`; es el mismo criterio con el que la
 * lista arma el preview, y por eso el preview sí salía cuando el hilo no.
 *
 * El match por identidad se mantiene porque las filas antiguas traen
 * `conversation_id` en NULL: sin él, hilos viejos se vaciarían.
 */
export function buildGuestHistoryOrFilter(
  guestPhone: string,
  conversationId?: string | null
): string {
  const parts: string[] = [];
  const convId = String(conversationId ?? "").trim();
  // Solo se interpola si tiene forma de UUID. Hoy quien llega acá ya pasó por
  // un `.eq("id", …)` contra una columna uuid, así que un id inválido nunca
  // llega; la comprobación evita que ese blindaje dependa del tipo de columna.
  if (UUID_PATTERN.test(convId)) parts.push(`conversation_id.eq.${convId}`);

  const phoneFilter = buildGuestPhoneOrFilter(guestPhone);
  if (phoneFilter) parts.push(phoneFilter);

  return parts.join(",");
}

/**
 * Barrido paginado del historial de un huésped.
 *
 * Consulta en orden DESCENDENTE (más reciente primero) aunque devuelva
 * ASCENDENTE: así, si se alcanza el tope, lo que se descarta son los mensajes
 * más ANTIGUOS. Truncar la cola nueva de un hilo de chat sería el fallo
 * equivocado —el usuario dejaría de ver justo lo que acaba de pasar—.
 * El `reverse()` final restaura el orden que espera el merge.
 */
async function fetchWubbyPagesAscending(
  supabase: SupabaseClient,
  hotelIds: string[],
  orFilter: string | null
): Promise<WubbyFetchResult> {
  if (hotelIds.length === 0) return { rows: [], truncated: false };

  const all: WubbyWhatsappRow[] = [];
  let from = 0;
  let truncated = false;
  let done = false;

  for (let page = 0; page < MAX_WUBBY_FETCH_PAGES && !done; page += 1) {
    const to = from + POSTGREST_PAGE_SIZE - 1;
    let query = supabase
      .from(WUBBY_TABLE)
      .select(WUBBY_SELECT_COLUMNS)
      .in("hotel_id", hotelIds)
      // `created_at` no es único (hay colisiones reales): sin desempate por `id`
      // el orden entre filas empatadas no es estable y los bordes de página
      // pueden duplicar u omitir filas.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to);

    if (orFilter) {
      query = query.or(orFilter);
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const batch = (data ?? []) as unknown as WubbyWhatsappRow[];
    all.push(...batch);

    if (all.length >= MAX_WUBBY_FETCH_ROWS) {
      // Acumulado de más reciente a más antiguo: el corte descarta la cola
      // antigua y conserva los últimos MAX_WUBBY_FETCH_ROWS mensajes.
      all.length = MAX_WUBBY_FETCH_ROWS;
      truncated = true;
      done = true;
    } else if (batch.length < POSTGREST_PAGE_SIZE) {
      done = true;
    } else {
      from += POSTGREST_PAGE_SIZE;
    }
  }

  if (!done) truncated = true;

  all.reverse();
  return { rows: all, truncated };
}

/**
 * Historial de un huésped en un hotel: por `conversation_id` cuando se conoce,
 * más el match por identidad (teléfono con/sin `+`, o LID crudo) para las filas
 * antiguas que no traen `conversation_id`. El filtro por `hotel_id` lo aplica
 * `fetchWubbyPagesAscending` en TODAS las páginas.
 */
export async function fetchWubbyRowsForGuestAtHotel(
  supabase: SupabaseClient,
  hotelId: string,
  guestPhone: string,
  conversationId?: string | null
): Promise<WubbyFetchResult> {
  const orFilter = buildGuestHistoryOrFilter(guestPhone, conversationId);
  if (!orFilter) return { rows: [], truncated: false };
  return fetchWubbyPagesAscending(supabase, [hotelId], orFilter);
}

/**
 * Historial de un huésped acotado a un conjunto de hoteles permitidos
 * (`.in("hotel_id", ...)`). Para el fallback por teléfono sin conversationId,
 * donde el hotel no se puede derivar de una fila concreta.
 */
export async function fetchWubbyRowsForGuestAcrossHotels(
  supabase: SupabaseClient,
  hotelIds: string[],
  guestPhone: string
): Promise<WubbyFetchResult> {
  const orFilter = buildGuestPhoneOrFilter(guestPhone);
  if (!orFilter) return { rows: [], truncated: false };
  return fetchWubbyPagesAscending(supabase, hotelIds, orFilter);
}
