/** Estado de la conversación en la operación (cola de recepción + IA). */
export type OperationalStatus = "ai_active" | "requires_attention" | "closed";

export type ControlMode = "ai" | "human";

export type MessageSender = "user" | "ai" | "agent";

/** Entrega del mensaje saliente (optimista → confirmado en DB). */
export type MessageDeliveryStatus = "pending" | "confirmed";

/**
 * Acuse de Meta que reporta un mensaje saliente como NO entregado, tal y como
 * lo sirve `GET /api/conversations/[id]/message-statuses`.
 *
 * La fuente es `message_statuses` (service-role only), y se cruza con la
 * burbuja por `wamid`. Los mensajes sin `wamid` —históricos, y todo lo que
 * envían los hoteles que aún van por n8n— no aparecen acá y se pintan como
 * siempre: no hay forma de mapearlos.
 */
export interface MessageDeliveryFailure {
  wamid: string;
  /** Siempre `"failed"` hoy: el endpoint no devuelve otros estados. */
  status: string;
  /** Código de error de Meta, p. ej. 131026 (Message Undeliverable). */
  errorCode: number | null;
  /** Título legible del error de Meta; puede venir vacío. */
  errorTitle: string | null;
}

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
   * Columna `wamid`: id de Meta del mensaje, clave contra la que resuelven las
   * reacciones. `null` en mensajes anteriores al 30 jul 2026 y en los
   * optimistas creados en cliente (aún sin fila en DB).
   */
  wamid?: string | null;
  /**
   * Columna `reaction_to_wamid`: no-null SOLO en filas de reacción, apuntando al
   * `wamid` del mensaje reaccionado. Estas filas no son burbujas: se pintan como
   * badge sobre su objetivo. Si el target no se encuentra, caen a burbuja de
   * texto normal.
   */
  reactionToWamid?: string | null;
  /**
   * Columna `cause_request`: `yes` = disparó escalación (badge en burbuja).
   */
  causeRequest?: string;
  /**
   * Columna `message_translated`: texto EXACTO que le llegó al huésped cuando el
   * engine tradujo la respuesta a su idioma. `null`/ausente = lo enviado es
   * idéntico a `body`, que siempre va en español (todo lo interno en español).
   *
   * Es solo lectura y solo informativo: la burbuja sigue mostrando `body` y no
   * hay ningún camino que reenvíe o edite este texto.
   */
  translatedBody?: string | null;
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
  /**
   * ISO 8601 del último mensaje ENTRANTE del huésped, copiado de
   * `conversations.last_guest_message_at` (timestamptz mantenida por trigger).
   *
   * `null` significa que el huésped nunca escribió. Es un valor ESPERADO, no un
   * error: implica composer bloqueado por la ventana de 24 h de Meta. Nada de
   * warnings ni estados de carga para ese caso.
   *
   * Sustituye a derivar la ventana del array `messages`, que la bandeja ya no
   * trae. La columna ya viene con offset; no aplicar conversiones extra.
   */
  lastGuestMessageAt: string | null;
  operationalStatus: OperationalStatus;
  controlMode: ControlMode;
  channelLabel: string;
  /**
   * Hilo de la conversación. Ojo: cuando llega desde `GET /api/inbox` es un
   * array PROVISIONAL (el recorte a `MESSAGES_LIMIT` de los mensajes que el
   * servidor pudo atribuir a este teléfono), no el historial del huésped. Solo
   * es autoritativo cuando `messagesLoaded === true`.
   */
  messages: Message[];
  /**
   * `true` únicamente cuando el hilo se cargó desde `GET /api/inbox/messages`,
   * que sí devuelve el historial completo del huésped. Es un flag de cliente:
   * el servidor lo emite siempre en `false`. Consúltalo antes de tratar la
   * ausencia de un mensaje en `messages` como información real.
   */
  messagesLoaded: boolean;
  /** Teléfono huésped normalizado (+E.164) para envío / matching */
  guestPhone: string;
  /** Copia de `conversations.needs_human` */
  needsHuman: boolean;
  /** Copia de `conversations.ai_active` */
  aiActive: boolean;
  /** Copia de `conversations.status` */
  dbStatus: string | null;
  /**
   * Fecha en que la IA volvió SOLA a la conversación (barrido del engine tras
   * ~2 h sin actividad humana), o `null` si la última reactivación la hizo una
   * persona desde el inbox.
   *
   * Existe para que la recepcionista distinga las dos cosas: una IA que volvió
   * sola en una conversación que ella creía suya no puede aparecer sin aviso.
   *
   * Opcional: las conversaciones que se construyen en cliente (optimistas) no
   * lo traen, y por Realtime llega solo si la fila se vuelve a emitir.
   */
  autoReactivatedAt?: string | null;
  /**
   * Fecha en que el triage del engine escaló esta conversación Y sigue sin
   * atender; `null` si ya la tomaron, la resolvieron o la cerraron.
   *
   * No es la columna cruda: `readTriageEscalatedAt` ya cruzó `ai_triage_at` con
   * `needs_human` y `status`. Quien lee este campo no tiene que volver a
   * decidir nada — si tiene fecha, hay un huésped esperando a una persona.
   *
   * Opcional por la misma razón que `autoReactivatedAt`: las conversaciones
   * optimistas que arma el cliente no lo traen.
   */
  triageEscalatedAt?: string | null;
  blocked: boolean;
  blockedAt: string | null;
  /**
   * Copia directa de `conversations.request`.
   * Cuando vale `"pending"`, la IA detectó que el caso requiere seguimiento humano.
   * El agente lo resuelve desde el inbox (vuelve a `null`).
   */
  request: string | null;
  /**
   * `true` cuando el teléfono del hilo está en `staff_contacts` (activo) del
   * hotel. NO es una columna de `conversations`: lo deriva `GET /api/inbox`
   * cruzando teléfonos normalizados, así que Realtime nunca lo trae.
   *
   * Por eso el merge de Realtime (`{ ...prev, ...cambios }`) lo conserva solo.
   * Consecuencia aceptada: una conversación que NACE por Realtime queda sin
   * marca hasta el próximo refetch de la bandeja.
   *
   * Opcional a propósito: las conversaciones construidas en cliente (optimistas,
   * mocks) simplemente no lo traen y se pintan como huésped.
   */
  isStaff?: boolean;
}
