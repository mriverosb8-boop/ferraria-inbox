/** Estado de la conversación en la operación (cola de recepción + IA). */
export type OperationalStatus = "ai_active" | "requires_attention" | "closed";

export type ControlMode = "ai" | "human";

export type MessageSender = "user" | "ai" | "agent";

/** Entrega del mensaje saliente (optimista → confirmado en DB). */
export type MessageDeliveryStatus = "pending" | "confirmed";

export interface AiMessageMeta {
  latencyMs: number;
  tokens: number;
}

/** Reserva PMS: solo se muestra si hay datos reales o derivados. */
export interface ReservationDetails {
  confirmationCode: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  roomType: string;
  bookingStatus: string;
}

export interface Guest {
  id: string;
  name: string;
  phone: string;
  property: string;
  language: string;
  internalNotes: string;
  tags: string[];
  /** 0–100; sin datos de Supabase será bajo o 0 */
  profileCompleteness: number;
  reservation: ReservationDetails;
}

export interface Message {
  id: string;
  body: string;
  /** ISO o etiqueta corta según build */
  sentAt: string;
  /**
   * ISO 8601 del mensaje (p. ej. `created_at` de la fila) para reglas de negocio
   * p. ej. ventana de 24 h de Meta; omitido en mensajes solo locales.
   */
  sentAtIso?: string;
  sender: MessageSender;
  /**
   * Columna `format` en Wubby_Whatsapp: `audio` = voz transcrito, `text` = texto, etc.
   */
  format?: string;
  messageType?: "text" | "image" | "video" | "audio" | "document" | "file" | string;
  mediaUrl?: string | null;
  mediaStoragePath?: string | null;
  mediaMimeType?: string | null;
  mediaCaption?: string | null;
  mediaFilename?: string | null;
  mediaBucket?: string | null;
  metaMediaId?: string | null;
  /**
   * Columna `cause_request`: `yes` = disparó escalación (badge en burbuja).
   */
  causeRequest?: string;
  /**
   * Columna `cause_of_request`: `yes` = requiere atención humana (alertas Realtime).
   */
  causeOfRequest?: string;
  aiMeta?: AiMessageMeta;
  /** UUID generado en cliente; persiste en `Wubby_Whatsapp.client_temp_id`. */
  clientTempId?: string;
  /** Solo mensajes salientes creados en cliente; histórico sin campo = confirmado en UI. */
  status?: MessageDeliveryStatus;
}

export interface Conversation {
  /** UUID de la fila en `conversations` */
  id: string;
  guest: Guest;
  lastMessagePreview: string;
  lastMessageAt: string;
  /** ISO 8601 del último mensaje (panel derecho) */
  lastActivityIso: string;
  unreadCount: number;
  operationalStatus: OperationalStatus;
  controlMode: ControlMode;
  channelLabel: string;
  messages: Message[];
  /** Teléfono huésped normalizado (+E.164) para envío / matching */
  guestPhone: string;
  /** Copia de `conversations.needs_human` */
  needsHuman: boolean;
  /** Copia de `conversations.ai_active` */
  aiActive: boolean;
  /** Copia de `conversations.status` */
  dbStatus: string | null;
  blocked: boolean;
  blockedAt: string | null;
  /**
   * Copia directa de `conversations.request`.
   * Cuando vale `"pending"`, la IA detectó que el caso requiere seguimiento humano.
   * El agente lo resuelve desde el inbox (vuelve a `null`).
   */
  request: string | null;
}
