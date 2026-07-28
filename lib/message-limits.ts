export const MESSAGES_LIMIT = 325;
/** Tamaño máximo por página en PostgREST/Supabase (el .limit() superior no lo supera). */
export const POSTGREST_PAGE_SIZE = 1000;
/**
 * Tope duro de filas acumuladas en un barrido de `Wubby_Whatsapp`. Al
 * alcanzarlo el fetch CORTA y marca `truncated: true`; nunca lanza. Existe para
 * acotar el pico de memoria por invocación: sin él el bucle de paginación
 * crecía con el tamaño de la tabla del hotel.
 */
export const MAX_WUBBY_FETCH_ROWS = 15000;
/**
 * Backstop independiente sobre el número de iteraciones. `MAX_WUBBY_FETCH_ROWS`
 * se alcanza en 15 páginas llenas; las 5 restantes son margen por si PostgREST
 * devolviera páginas cortas sin agotar el conjunto.
 */
export const MAX_WUBBY_FETCH_PAGES = 20;
/** @deprecated Usar fetchAllWubbyRowsForHotel con paginación .range(). */
export const MESSAGE_FETCH_LIMIT = 8000;

/** Tras cargar historial completo (>325), no recortar al añadir mensajes. */
export function appendConversationMessages<T>(current: T[], added: T): T[] {
  const next = [...current, added];
  return next.length > MESSAGES_LIMIT ? next : next.slice(-MESSAGES_LIMIT);
}
