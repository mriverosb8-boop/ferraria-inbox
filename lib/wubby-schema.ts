/**
 * Fila de la tabla `Wubby_Whatsapp`.
 * Columnas con espacios o guiones se leen por clave entre comillas en el objeto.
 */
export type WubbyWhatsappRow = {
  id: string | number;
  created_at: string;
  hotel_id?: string | null;
  message: string | null;
  recipient: string | null;
  sender: string | null;
  cotizacion?: string | null;
  /** p. ej. `audio` (voz transcrito) o `text` */
  format?: string | null;
  message_type?: string | null;
  media_url?: string | null;
  media_storage_path?: string | null;
  media_mime_type?: string | null;
  media_caption?: string | null;
  media_filename?: string | null;
  media_meta_id?: string | null;
  media_bucket?: string | null;
  meta_media_id?: string | null;
  storage_path?: string | null;
  image_url?: string | null;
  file_url?: string | null;
  /** `yes` si el mensaje provocó handoff a humano */
  cause_request?: string | null;
  /** `yes` si el caso requiere atención humana (alertas Realtime) */
  cause_of_request?: string | null;
  /** UUID del cliente para reconciliar optimista con realtime */
  client_temp_id?: string | null;
} & Record<string, unknown>;

export const WUBBY_TABLE = "Wubby_Whatsapp";

/**
 * Columnas de `Wubby_Whatsapp` que consume la bandeja, en vez de `select("*")`.
 * La tabla tiene 18 columnas reales; aquí van las 16 que alguien lee.
 *
 * Quedan FUERA a propósito (sin ningún lector en el repo):
 * - `cotizacion`: solo se lee de `conversations`, nunca de una fila Wubby.
 * - `classified`: cero usos en todo el código.
 *
 * Incluida por duda: `conversation_id`, que no usa el merge del inbox pero sí
 * `readUrgentConversationKey` en el camino Realtime; mantenerla evita que la
 * misma fila tenga forma distinta según de dónde venga.
 *
 * OJO: varios lectores de `chat-utils` (media_url, message_type,
 * cause_of_request, storage_path…) buscan claves que NO existen como columnas
 * en esta tabla; resuelven a `undefined` igual con `*` que con esta lista.
 */
export const WUBBY_SELECT_COLUMNS = [
  "id",
  "created_at",
  "message",
  "sender",
  "recipient",
  "hotel_id",
  "conversation_id",
  "format",
  "origin",
  "cause_request",
  "media_storage_path",
  "media_mime_type",
  "media_caption",
  "media_meta_id",
  "media_bucket",
  "client_temp_id",
].join(", ");

/**
 * Columnas mínimas para reconstruir el preview de la lista a partir del ÚLTIMO
 * mensaje de cada conversación. Es el subconjunto exacto que consume la cascada
 * de `resolveMessageBodyAndPreview`: `message` → `media_caption` → emoji por
 * `media_mime_type`, más `format` (tipo cuando no hay mime),
 * `media_storage_path` (distingue "hay media sin caption" de "(vacío)"),
 * `created_at` (etiqueta de hora y orden de la lista), `id` (desempate) y
 * `conversation_id` (clave de emparejamiento).
 *
 * NO incluye `media_url`, `media_filename` ni `message_type`: no existen como
 * columnas en la tabla y sus lectores resuelven a `undefined` de todas formas.
 */
export const WUBBY_PREVIEW_COLUMNS = [
  "id",
  "conversation_id",
  "created_at",
  "message",
  "format",
  "media_caption",
  "media_mime_type",
  "media_storage_path",
].join(", ");
