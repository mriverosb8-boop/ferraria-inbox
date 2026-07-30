import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhoneDigits } from "@/lib/chat-utils";
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

/** PostgREST .or() para sender/recipient en dígitos y con prefijo +. */
export function buildGuestPhoneOrFilter(guestDigits: string): string {
  const digits = normalizePhoneDigits(guestDigits);
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

/** Historial de un huésped en un hotel; match + y sin + en sender/recipient. */
export async function fetchWubbyRowsForGuestAtHotel(
  supabase: SupabaseClient,
  hotelId: string,
  guestDigits: string
): Promise<WubbyFetchResult> {
  const orFilter = buildGuestPhoneOrFilter(guestDigits);
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
  guestDigits: string
): Promise<WubbyFetchResult> {
  const orFilter = buildGuestPhoneOrFilter(guestDigits);
  if (!orFilter) return { rows: [], truncated: false };
  return fetchWubbyPagesAscending(supabase, hotelIds, orFilter);
}
