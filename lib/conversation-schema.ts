/** Fila de la tabla `conversations` (estado de bandeja). */
export const CONVERSATIONS_TABLE = "conversations";

/**
 * Columnas de `conversations` que consume la bandeja, en vez de `select("*")`.
 *
 * Queda FUERA `last_read_at`: la escribe el PATCH `mark_read` pero no la lee
 * nadie en cliente ni en el merge.
 *
 * Incluida por duda: `hotel_id`, que el merge no usa pero es el discriminador
 * de tenant y su ausencia haría mentir al cast `as ConversationDbRow`.
 */
export const CONVERSATION_SELECT_COLUMNS = [
  "id",
  "hotel_id",
  "guest_phone",
  "guest_name",
  "status",
  "needs_human",
  "ai_active",
  "cotizacion",
  "blocked",
  "blocked_at",
  "request",
  "unread_count",
  "last_guest_message_at",
  "created_at",
  "updated_at",
].join(", ");

export type ConversationDbRow = {
  id: string;
  hotel_id?: string | null;
  guest_phone: string | null;
  guest_name: string | null;
  status: string | null;
  needs_human: boolean | null;
  ai_active: boolean | null;
  cotizacion: string | null;
  blocked: boolean | null;
  blocked_at: string | null;
  /**
   * Marca operativa cuando la IA detecta que el caso necesita atención humana.
   * - "pending": la IA marcó el caso para seguimiento humano
   * - null / otro valor: caso sin pendiente activo
   */
  request: string | null;
  unread_count: number | null;
  last_read_at: string | null;
  /**
   * Último mensaje ENTRANTE del huésped (timestamptz, trigger AFTER INSERT en
   * `Wubby_Whatsapp` + backfill). `null` = el huésped nunca escribió.
   */
  last_guest_message_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboxPatchAction =
  | "human_control"
  | "reactivate_ai"
  | "completed"
  | "resolve_request"
  | "reopen"
  | "mark_read"
  | "rename";

/** Largo máximo permitido para `guest_name` editado desde el inbox. */
export const GUEST_NAME_MAX_LENGTH = 80;
