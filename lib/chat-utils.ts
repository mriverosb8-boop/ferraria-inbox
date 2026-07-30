import type { ConversationDbRow } from "@/lib/conversation-schema";
import type { ControlMode, Conversation, Message, MessageSender, OperationalStatus } from "@/lib/inbox-types";
import {
  type HotelWhatsappByIdMap,
  resolveHotelWaIdentitiesForRow,
} from "@/lib/hotel-whatsapp-map";
import { MESSAGES_LIMIT } from "@/lib/message-limits";
import type { WubbyWhatsappRow } from "@/lib/wubby-schema";

/**
 * Teléfono solo dígitos para comparar identidades (Twilio `whatsapp:+…`, Meta sin prefijo, etc.).
 */
export function normalizePhoneDigits(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/whatsapp:/gi, "")
    .replace(/\+/g, "")
    .replace(/\s/g, "")
    .replace(/\D/g, "");
}

export function parseHotelPhoneDigitsCsv(raw: string | null | undefined): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => normalizePhoneDigits(value))
    .filter(Boolean);
}

export function getHotelPhoneDigitsFromEnv(): string[] {
  const values = parseHotelPhoneDigitsCsv(
    process.env.HOTEL_WHATSAPP_PHONE_DIGITS ??
      process.env.NEXT_PUBLIC_HOTEL_WHATSAPP_PHONE_DIGITS
  );

  if (values.length > 0) {
    return values;
  }

  // Fallback seguro para desarrollo: sin líneas reales hardcodeadas.
  // En producción configura HOTEL_WHATSAPP_PHONE_DIGITS o
  // NEXT_PUBLIC_HOTEL_WHATSAPP_PHONE_DIGITS en Vercel.
  return [];
}

/** Líneas WhatsApp del hotel en dígitos, leídas desde variables de entorno. */
export const DEFAULT_HOTEL_PHONE_DIGITS = getHotelPhoneDigitsFromEnv();

/** Identidad WhatsApp/Twilio normalizada para comparar (+E.164). */
export function normalizeWaIdentity(raw: string | null | undefined): string {
  const digits = normalizePhoneDigits(raw);
  return digits ? `+${digits}` : "";
}

export type ResolveHotelWaIdentitiesOptions = {
  /** Si viene definido (p. ej. `TWILIO_WHATSAPP_ADDRESS`), se fusiona al conjunto. */
  twilioEnv?: string | null;
  /** CSV opcional adicional para pruebas o inyección explícita. */
  extraCsvEnv?: string | null;
};

/**
 * Conjunto de líneas del hotel (+E.164) para routing y clasificación de burbujas.
 * En producción configura `HOTEL_WHATSAPP_PHONE_DIGITS` (server) o
 * `NEXT_PUBLIC_HOTEL_WHATSAPP_PHONE_DIGITS` si la clasificación corre en cliente.
 */
export function resolveHotelWaIdentitiesSet(opts?: ResolveHotelWaIdentitiesOptions): Set<string> {
  const set = new Set<string>();
  const add = (raw: string | null | undefined) => {
    const id = normalizeWaIdentity(raw);
    if (id) set.add(id);
  };

  for (const digits of DEFAULT_HOTEL_PHONE_DIGITS) {
    add(String(digits));
  }

  add(opts?.twilioEnv ?? process.env.TWILIO_WHATSAPP_ADDRESS);
  add(process.env.WHATSAPP_BUSINESS_PHONE_NUMBER);
  add(process.env.META_WHATSAPP_BUSINESS_PHONE);

  const csv =
    opts?.extraCsvEnv ??
    process.env.HOTEL_WHATSAPP_PHONE_DIGITS ??
    process.env.NEXT_PUBLIC_HOTEL_WHATSAPP_PHONE_DIGITS;
  if (csv) {
    for (const part of csv.split(",")) add(part.trim());
  }

  return set;
}

function inferDominantWaBusinessIdentity(rows: WubbyWhatsappRow[]): string | null {
  const counts = countIdentityOccurrences(rows);
  let best: string | null = null;
  let max = 0;
  for (const [k, v] of counts) {
    if (v > max) {
      max = v;
      best = k;
    }
  }
  return best;
}

function countIdentityOccurrences(rows: WubbyWhatsappRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const side of [row.sender, row.recipient]) {
      const id = normalizeWaIdentity(typeof side === "string" ? side : String(side ?? ""));
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Primera línea de negocio inferida (compatibilidad); preferir `resolveHotelWaIdentitiesSet`.
 * Si hay números conocidos por env/constantes, devuelve uno de ellos; si no, la identidad más frecuente en el histórico.
 */
export function inferTwilioIdentity(rows: WubbyWhatsappRow[], envTwilio?: string | null): string | null {
  const known = resolveHotelWaIdentitiesSet({ twilioEnv: envTwilio });
  const firstKnown = known.values().next().value as string | undefined;
  if (firstKnown) return firstKnown;
  return inferDominantWaBusinessIdentity(rows);
}

function isHumanAnswerSender(raw: string | null | undefined): boolean {
  return String(raw ?? "").trim().toLowerCase() === "human answer";
}

/** Dígitos del hotel desde el Set (+E.164) de resolveHotelWaIdentitiesForRow. */
function hotelPhoneDigitsFromIdentities(hotelIdentities: Set<string>): string {
  const first = hotelIdentities.values().next().value as string | undefined;
  return first ? normalizePhoneDigits(first) : "";
}

/**
 * Teléfono del huésped para agrupar mensajes: solo dígitos (sin +).
 * Hotel = línea del mapa por hotel_id; "Human Answer" → huésped en recipient.
 */
export function inferGuestPhone(row: WubbyWhatsappRow, hotelIdentities: Set<string>): string {
  const senderRaw = String(row.sender ?? "").trim();
  const recipientRaw = String(row.recipient ?? "").trim();
  const senderDigits = normalizePhoneDigits(senderRaw);
  const recipientDigits = normalizePhoneDigits(recipientRaw);
  const hotelDigits = hotelPhoneDigitsFromIdentities(hotelIdentities);

  if (isHumanAnswerSender(senderRaw)) {
    return recipientDigits || "unknown";
  }
  if (hotelDigits && senderDigits && senderDigits === hotelDigits) {
    return recipientDigits || "unknown";
  }
  return senderDigits || recipientDigits || "unknown";
}

export function getRowField(row: WubbyWhatsappRow, ...keys: string[]): unknown {
  for (const k of keys) {
    if (k in row && row[k] !== undefined && row[k] !== null) return row[k];
  }
  return undefined;
}

/** Columna `format` en Wubby_Whatsapp (`audio`, `text`, …). */
export function readMessageFormat(row: WubbyWhatsappRow): string | undefined {
  const v = getRowField(row, "format", "Format");
  if (v == null) return undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function readStringField(row: WubbyWhatsappRow, ...keys: string[]): string | undefined {
  const v = getRowField(row, ...keys);
  if (v == null) return undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

function readMediaUrl(row: WubbyWhatsappRow): string | undefined {
  return readStringField(
    row,
    "media_url",
    "mediaUrl",
    "Media_Url",
    "Media_URL",
    "image_url",
    "imageUrl",
    "file_url",
    "fileUrl",
    "url"
  );
}

function readMediaMimeType(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "media_mime_type", "mediaMimeType", "mime_type", "Mime_Type");
}

function readMediaStoragePath(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "media_storage_path", "mediaStoragePath", "storage_path");
}

function readMediaCaption(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "media_caption", "mediaCaption", "caption");
}

function readMediaFilename(row: WubbyWhatsappRow): string | undefined {
  return readStringField(
    row,
    "media_filename",
    "mediaFilename",
    "filename",
    "file_name",
    "fileName",
    "document_filename",
    "documentFilename"
  );
}

function readMediaBucket(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "media_bucket", "mediaBucket", "bucket");
}

/** Columna `wamid`: id de Meta del mensaje. `undefined` en filas históricas. */
function readWamid(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "wamid", "waMid", "meta_wamid");
}

/** Columna `reaction_to_wamid`: solo filas de reacción; wamid del mensaje reaccionado. */
function readReactionToWamid(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "reaction_to_wamid", "reactionToWamid");
}

function readMetaMediaId(row: WubbyWhatsappRow): string | undefined {
  return readStringField(row, "media_meta_id", "mediaMetaId", "meta_media_id", "metaMediaId", "media_id", "Media_Id");
}

function readMessageType(row: WubbyWhatsappRow, format?: string): string | undefined {
  return readStringField(row, "message_type", "messageType", "Message_Type", "Message Type") ?? format;
}

function mediaUrlLooksLikeImage(url: string): boolean {
  const withoutQuery = url.split(/[?#]/)[0]?.toLowerCase() ?? "";
  return /\.(avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/.test(withoutQuery);
}

export type MediaKind = "image" | "video" | "audio" | "pdf" | "document" | "file";

/** Pistas de mime para documentos office/texto que NO son pdf. */
const DOCUMENT_MIME_HINTS = [
  "msword", "wordprocessingml",           // .doc .docx
  "ms-excel", "spreadsheetml",            // .xls .xlsx
  "ms-powerpoint", "presentationml",      // .ppt .pptx
  "opendocument", "rtf",                  // .odt/.ods, .rtf
  "text/plain", "text/csv",               // .txt .csv
];

/** Categoría de render a partir del mime (fuente de verdad; `format` upstream no es fiable). */
export function resolveMediaKind(mime: string | null | undefined): MediaKind {
  const m = mime?.trim().toLowerCase() ?? "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m === "application/pdf") return "pdf";
  if (DOCUMENT_MIME_HINTS.some((h) => m.includes(h))) return "document";
  return "file";
}

function readMessageMedia(row: WubbyWhatsappRow): {
  messageType: string;
  mediaUrl: string | null;
  mediaStoragePath: string | null;
  mediaMimeType: string | null;
  mediaCaption: string | null;
  mediaFilename: string | null;
  mediaBucket: string | null;
  metaMediaId: string | null;
} {
  const fmt = readMessageFormat(row);
  const declaredType = readMessageType(row, fmt);
  const mediaUrl = readMediaUrl(row) ?? null;
  const mediaStoragePath = readMediaStoragePath(row) ?? null;
  const mediaMimeType = readMediaMimeType(row) ?? null;
  const mediaCaption = readMediaCaption(row) ?? null;
  const mediaFilename = readMediaFilename(row) ?? null;
  const mediaBucket = readMediaBucket(row) ?? null;
  const metaMediaId = readMetaMediaId(row) ?? null;
  const normalizedType = declaredType?.trim().toLowerCase();
  const isImageByType = normalizedType === "image";
  const isDocumentByType = normalizedType === "document" || normalizedType === "file";
  const isImageByUrl = mediaUrl ? mediaUrlLooksLikeImage(mediaUrl) : false;

  // El mime manda. El upstream (n8n) escribe `format="image"` para casi todo,
  // así que solo confiamos en `format`/type cuando no hay mime.
  const kind: MediaKind | null = mediaMimeType
    ? resolveMediaKind(mediaMimeType)
    : isDocumentByType
    ? "document"
    : isImageByType || Boolean(mediaStoragePath) || isImageByUrl
    ? "image"
    : null;
  const messageType = kind === "pdf" ? "document" : kind ?? declaredType ?? "text";

  return { messageType, mediaUrl, mediaStoragePath, mediaMimeType, mediaCaption, mediaFilename, mediaBucket, metaMediaId };
}

/**
 * Cuerpo y preview de un mensaje a partir de su fila. Único sitio donde vive la
 * cascada `message` → `media_caption` → emoji por mime, para que el preview de
 * la lista y el de la burbuja no puedan divergir.
 */
function resolveMessageBodyAndPreview(row: WubbyWhatsappRow): {
  body: string;
  previewRaw: string;
  media: ReturnType<typeof readMessageMedia>;
} {
  const media = readMessageMedia(row);
  const messageRaw = String(row.message ?? "").trim();
  const isImage = media.messageType.trim().toLowerCase() === "image";
  const hasMedia = Boolean(media.mediaStoragePath || media.mediaUrl);
  const body = messageRaw || media.mediaCaption || (hasMedia ? "" : "(vacío)");
  const kind = resolveMediaKind(media.mediaMimeType);
  const previewRaw =
    body ||
    (kind === "pdf" || kind === "document"
      ? `📎 ${media.mediaFilename ?? "Documento"}`
      : kind === "video"
      ? "🎥 Video"
      : kind === "audio"
      ? "🎙️ Audio"
      : isImage
      ? "📷 Imagen"
      : media.mediaStoragePath
      ? "📎 Archivo"
      : "—");

  return { body, previewRaw, media };
}

/**
 * Preview + etiqueta de hora de la lista, sin construir el `Message` completo.
 * La bandeja no necesita remitente ni media, así que la fila puede venir con
 * solo `WUBBY_PREVIEW_COLUMNS`.
 */
export function buildConversationPreviewFromRow(row: WubbyWhatsappRow): {
  previewRaw: string;
  lastMessageLabel: string;
  createdAtIso: string;
} {
  return {
    previewRaw: resolveMessageBodyAndPreview(row).previewRaw,
    lastMessageLabel: formatMessageDisplayListTime(row as Record<string, unknown>),
    createdAtIso: typeof row.created_at === "string" ? row.created_at : String(row.created_at ?? ""),
  };
}

/** Columna `cause_request` (`yes` = disparó handoff a humano). */
export function readCauseRequest(row: WubbyWhatsappRow): string | undefined {
  const v = getRowField(row, "cause_request", "Cause_Request", "causeRequest");
  if (v == null) return undefined;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/** Columna `cause_of_request` (alerta Realtime: requiere humano). */
export function readCauseOfRequestColumn(row: WubbyWhatsappRow): string | undefined {
  const v = getRowField(row, "cause_of_request", "Cause_Of_Request", "causeOfRequest");
  if (v == null) return undefined;
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t.length > 0 ? t : undefined;
}

/**
 * Misma regla para badge “Solicitó agente humano”, banner y notificación de escritorio.
 * Acepta fila Supabase o `Message` (campos en camelCase).
 */
export function messageNeedsHumanAlert(messageOrRow: Record<string, unknown>): boolean {
  const raw =
    messageOrRow["cause_of_request"] ??
    messageOrRow["Cause_Of_Request"] ??
    messageOrRow["causeOfRequest"] ??
    messageOrRow["cause_request"] ??
    messageOrRow["Cause_Request"] ??
    messageOrRow["causeRequest"] ??
    messageOrRow["request"] ??
    messageOrRow["requires_human"] ??
    messageOrRow["requiresHuman"] ??
    messageOrRow["needs_human"] ??
    messageOrRow["needsHuman"];

  const normalized = String(raw ?? "").trim().toLowerCase();

  return (
    raw === true ||
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "si" ||
    normalized === "sí"
  );
}

/** @deprecated Preferir messageNeedsHumanAlert */
export function messageRowRequiresHumanUrgent(row: WubbyWhatsappRow): boolean {
  return messageNeedsHumanAlert(row as Record<string, unknown>);
}

export function toBool(v: unknown, defaultVal = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    return ["true", "1", "yes", "si", "sí", "t"].includes(t);
  }
  return defaultVal;
}

/** Lectura flexible de flag “IA activa” si existe columna en BD. */
export function readAiActive(row: WubbyWhatsappRow, fallback = true): boolean {
  const raw = getRowField(row, "ai_active", "AI Active", "ai_enabled", "AI_Enabled", "ia_activa");
  if (raw === undefined || raw === null) return fallback;
  return toBool(raw, fallback);
}

export function readNeedsHuman(row: WubbyWhatsappRow): boolean {
  return toBool(getRowField(row, "Needs Human", "needs_human", "needsHuman"), false);
}

/**
 * Clasificación de mensaje para la burbuja.
 * - Sender = línea hotel → saliente (IA/agente por defecto).
 * - Recipient = línea hotel y sender no es hotel → entrante huésped.
 * Columnas opcionales (`message_author`, `sender_role`, `from_ai`, …) tienen prioridad cuando existen.
 */
export function classifyMessageSender(
  row: WubbyWhatsappRow,
  guestNorm: string,
  hotelIdentities: Set<string>
): MessageSender {
  const s = normalizeWaIdentity(row.sender ?? "");
  const r = normalizeWaIdentity(row.recipient ?? "");
  const senderRaw = String(row.sender ?? "").trim();

  if (isHumanAnswerSender(senderRaw)) {
    return "agent";
  }

  if (guestNorm && s === guestNorm) return "user";

  const originRaw = getRowField(row, "origin");
  if (typeof originRaw === "string") {
    const o = originRaw.trim().toLowerCase();
    if (o === "human") return "agent";
    if (o === "ai") return "ai";
    if (o === "client" || o === "guest" || o === "user") return "user";
  }

  const explicit =
    getRowField(row, "message_author", "sender_role", "Sender Role", "role", "tipo", "author") ??
    getRowField(row, "from_ai", "fromAI");
  if (typeof explicit === "string") {
    const e = explicit.toLowerCase();
    if (/human|agent|staff|person|recepci|operad/i.test(e)) return "agent";
    if (/ai|bot|assistant|automat/i.test(e)) return "ai";
  }
  if (toBool(explicit, false) === false && getRowField(row, "from_ai") != null) {
    return toBool(getRowField(row, "from_ai"), true) ? "ai" : "agent";
  }

  const senderLower = String(row.sender ?? "").toLowerCase();
  if (senderLower.includes("agent") || senderLower.includes("human")) return "agent";

  const directionRaw = getRowField(row, "direction", "Direction");
  if (typeof directionRaw === "string") {
    const d = directionRaw.trim().toLowerCase();
    if (d === "inbound" || d === "incoming") return "user";
    if (d === "outbound" || d === "outgoing") return "ai";
  }

  const senderTypeRaw = getRowField(row, "sender_type", "senderType", "Sender_Type");
  if (typeof senderTypeRaw === "string") {
    const st = senderTypeRaw.trim().toLowerCase();
    if (/guest|visitor|customer|^user$/i.test(st)) return "user";
    if (/human|^agent$|staff|employee/i.test(st)) return "agent";
    if (/ai|assistant|bot|^business$/i.test(st)) return "ai";
  }

  if (s && hotelIdentities.has(s)) {
    return "ai";
  }
  if (r && hotelIdentities.has(r) && (!s || !hotelIdentities.has(s))) {
    return "user";
  }

  return "ai";
}

export function formatMessageListTime(iso: string, locale = "es"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Ayer";
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

export function formatMessageDetailTime(iso: string, locale = "es"): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function isMediaMessage(message: Record<string, unknown>): boolean {
  const type = String(
    message.whatsapp_type ??
      message.message_type ??
      message.messageType ??
      message.type ??
      message.media_type ??
      ""
  )
    .trim()
    .toLowerCase();

  return (
    type === "image" ||
    type === "document" ||
    type === "pdf" ||
    Boolean(message.media_url) ||
    Boolean(message.mediaUrl) ||
    Boolean(message.media_storage_path) ||
    Boolean(message.mediaStoragePath) ||
    Boolean(message.media_type) ||
    Boolean(message.media_mime_type) ||
    Boolean(message.mediaMimeType) ||
    Boolean(message.media_filename) ||
    Boolean(message.mediaFilename)
  );
}

export function getMessageDisplayDate(message: Record<string, unknown>): Date {
  const raw =
    message.created_at ??
    message.createdAt ??
    message.sentAtIso;
  const date = new Date(String(raw ?? ""));

  if (Number.isNaN(date.getTime())) {
    return new Date(0);
  }

  return date;
}

export function getMessageDisplayMs(message: Record<string, unknown>): number {
  return getMessageDisplayDate(message).getTime();
}

export function formatMessageDisplayTime(message: Record<string, unknown>, locale = "es-CO"): string {
  const date = getMessageDisplayDate(message);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatMessageDisplayListTime(message: Record<string, unknown>, locale = "es"): string {
  const d = getMessageDisplayDate(message);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(d);
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate()
  ) {
    return "Ayer";
  }
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(d);
}

export function getConversationDisplayActivityMs(conversation: Pick<Conversation, "messages" | "lastActivityIso">): number {
  const lastMessage = conversation.messages.at(-1);
  if (lastMessage) {
    return getMessageDisplayMs(lastMessage as unknown as Record<string, unknown>);
  }
  return new Date(conversation.lastActivityIso).getTime();
}

export function displayGuestName(guestName: string | null | undefined, guestPhone: string): string {
  const n = typeof guestName === "string" ? guestName.trim() : "";
  if (n.length > 0) return n;
  return guestPhone || "—";
}

function readBoolCol(v: boolean | null | undefined, defaultVal: boolean): boolean {
  if (v === null || v === undefined) return defaultVal;
  return v;
}

function readUnreadCount(v: number | string | null | undefined): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

/**
 * Estado operativo y modo control a partir de la tabla `conversations`.
 */
export function mapOperationalFromConversationRow(row: ConversationDbRow): {
  operationalStatus: OperationalStatus;
  controlMode: ControlMode;
} {
  const st = String(row.status ?? "").toLowerCase();
  const needsHuman = readBoolCol(row.needs_human, false);
  const aiActive = readBoolCol(row.ai_active, true);
  const blocked = readBoolCol(row.blocked, false);

  if (st === "completed") {
    return { operationalStatus: "closed", controlMode: "human" };
  }
  if (blocked) {
    return { operationalStatus: "requires_attention", controlMode: aiActive ? "ai" : "human" };
  }
  if (st === "human_control") {
    return { operationalStatus: "requires_attention", controlMode: "human" };
  }
  if (needsHuman) {
    return { operationalStatus: "requires_attention", controlMode: "human" };
  }
  if (!aiActive) {
    return { operationalStatus: "requires_attention", controlMode: "human" };
  }
  return { operationalStatus: "ai_active", controlMode: "ai" };
}

function emptyReservation() {
  return {
    confirmationCode: "—",
    checkIn: "—",
    checkOut: "—",
    adults: 0,
    children: 0,
    roomType: "—",
    bookingStatus: "—",
  };
}

/**
 * Bandeja: metadatos desde `conversations`, historial desde `Wubby_Whatsapp`.
 * Orden de `convRows` se respeta (p. ej. `updated_at` desc desde la API).
 */
export function mergeConversationsTableWithMessages(
  convRows: ConversationDbRow[],
  msgRows: WubbyWhatsappRow[],
  options: { hotelWhatsappById: HotelWhatsappByIdMap; messageLimit?: number }
): Conversation[] {
  if (convRows.length === 0) return [];

  // Decorate-sort-undecorate: `getMessageDisplayMs` construye un `Date` por
  // llamada y dentro del comparador se ejecutaba ~2·N·log₂(N) veces (≈300k
  // objetos temporales para 11,5k filas). Precalculado son N.
  const decorated = msgRows.map((row) => ({
    row,
    ms: getMessageDisplayMs(row as Record<string, unknown>),
  }));
  decorated.sort((a, b) => a.ms - b.ms);
  const sortedMsgs = decorated.map((d) => d.row);

  const messageLimit = options.messageLimit ?? MESSAGES_LIMIT;
  const messagesByPhone = new Map<string, WubbyWhatsappRow[]>();
  for (const row of sortedMsgs) {
    const rowHotelIdentities = resolveHotelWaIdentitiesForRow(row, options.hotelWhatsappById);
    const g = inferGuestPhone(row, rowHotelIdentities);
    if (!g || g === "unknown") continue;
    let list = messagesByPhone.get(g);
    if (!list) {
      list = [];
      messagesByPhone.set(g, list);
    }
    list.push(row);
  }

  // Un único recorte por teléfono al terminar. Antes se hacía `slice(-limit)`
  // en CADA fila procesada, creando un array nuevo por mensaje (≈1,2M slots de
  // array desechados por petición en el hotel más grande).
  for (const [phone, list] of messagesByPhone) {
    if (list.length > messageLimit) {
      messagesByPhone.set(phone, list.slice(-messageLimit));
    }
  }

  const out: Conversation[] = [];

  for (const cr of convRows) {
    const guestPhoneDigits = normalizePhoneDigits(cr.guest_phone ?? "");
    const guestPhone = guestPhoneDigits ? `+${guestPhoneDigits}` : "";
    const msgList = guestPhoneDigits ? messagesByPhone.get(guestPhoneDigits) ?? [] : [];

    const lastRow = msgList.length > 0 ? msgList[msgList.length - 1]! : null;
    const lastMessage = lastRow
      ? buildMessageFromWubbyRow(
          lastRow,
          guestPhone,
          resolveHotelWaIdentitiesForRow(lastRow, options.hotelWhatsappById)
        )
      : null;

    const messages: Message[] = msgList.map(
      (msgRow) =>
        buildMessageFromWubbyRow(
          msgRow,
          guestPhone,
          resolveHotelWaIdentitiesForRow(msgRow, options.hotelWhatsappById)
        ).message
    );

    out.push(
      buildConversationFromRow(cr, {
        lastPreview: lastMessage ? lastMessage.previewRaw : "Sin mensajes",
        lastMessageAt: lastMessage ? lastMessage.lastMessageLabel : "—",
        lastActivityIso: lastRow ? lastRow.created_at : cr.created_at || cr.updated_at,
        messages,
      })
    );
  }

  return out;
}

/**
 * Único constructor de `Conversation`. Todo lo que no depende del hilo sale de
 * la fila de `conversations`; lo que sí depende llega por `parts`. Lo comparten
 * el merge con historial (reservas) y la bandeja sin historial.
 */
function buildConversationFromRow(
  cr: ConversationDbRow,
  parts: {
    lastPreview: string;
    lastMessageAt: string;
    lastActivityIso: string;
    messages: Message[];
  }
): Conversation {
  const guestPhoneDigits = normalizePhoneDigits(cr.guest_phone ?? "");
  const guestPhone = guestPhoneDigits ? `+${guestPhoneDigits}` : "";
  const phoneDisplay = guestPhone || String(cr.guest_phone ?? "").trim() || "—";

  const { operationalStatus, controlMode } = mapOperationalFromConversationRow(cr);
  const cotizacion =
    cr.cotizacion != null && String(cr.cotizacion).trim() !== "" ? String(cr.cotizacion) : null;

  const guest = {
    id: cr.id,
    name: displayGuestName(cr.guest_name, phoneDisplay),
    phone: phoneDisplay,
    property: cotizacion ? cotizacion : "Sin propiedad indicada",
    language: "—",
    internalNotes: readBoolCol(cr.blocked, false)
      ? cr.blocked_at
        ? `Bloqueado · ${cr.blocked_at}`
        : "Bloqueado"
      : "Sin notas internas en Supabase.",
    tags: cotizacion ? [cotizacion.slice(0, 24)] : [],
    profileCompleteness: cotizacion ? 35 : 15,
    reservation: emptyReservation(),
  };

  const requestRaw = typeof cr.request === "string" ? cr.request.trim() : cr.request;
  const requestValue =
    typeof requestRaw === "string" && requestRaw.length > 0 ? requestRaw : null;

  return {
    id: cr.id,
    guest,
    guestPhone: phoneDisplay,
    needsHuman: readBoolCol(cr.needs_human, false),
    aiActive: readBoolCol(cr.ai_active, true),
    dbStatus: cr.status,
    blocked: readBoolCol(cr.blocked, false),
    blockedAt: cr.blocked_at,
    request: requestValue,
    lastMessagePreview:
      parts.lastPreview.length > 120 ? `${parts.lastPreview.slice(0, 117)}…` : parts.lastPreview,
    lastMessageAt: parts.lastMessageAt,
    lastActivityIso: parts.lastActivityIso,
    unreadCount: readUnreadCount(cr.unread_count),
    lastGuestMessageAt: cr.last_guest_message_at ?? null,
    operationalStatus,
    controlMode,
    channelLabel: "WhatsApp",
    messages: parts.messages,
    // El servidor nunca marca un hilo como autoritativo. En la bandeja
    // `messages` va directamente vacío; el hilo lo carga
    // GET /api/inbox/messages y es el cliente quien pone `true`.
    messagesLoaded: false,
  };
}

/**
 * Bandeja: una `Conversation` por fila de `conversations`, con `messages: []`.
 *
 * El preview sale del último mensaje que la propia query ya resolvió (embedding
 * PostgREST con `limit 1` por conversación), no de barrer el histórico.
 * `lastActivityIso` se alimenta del `created_at` de ese mensaje para que el
 * orden de la lista sea idéntico al que producía el merge con historial; solo
 * cae a la fila de `conversations` cuando no hay ningún mensaje.
 */
export function buildInboxConversations(
  convRows: ConversationDbRow[],
  lastMessageByConversationId: Map<string, WubbyWhatsappRow>
): Conversation[] {
  const out: Conversation[] = [];

  for (const cr of convRows) {
    const lastRow = lastMessageByConversationId.get(String(cr.id));
    const preview = lastRow ? buildConversationPreviewFromRow(lastRow) : null;

    out.push(
      buildConversationFromRow(cr, {
        lastPreview: preview ? preview.previewRaw : "Sin mensajes",
        lastMessageAt: preview ? preview.lastMessageLabel : "—",
        lastActivityIso: preview ? preview.createdAtIso : cr.created_at || cr.updated_at,
        messages: [],
      })
    );
  }

  return out;
}

/** Expone semilla estable para avatares. */
export function guestSeed(guestPhone: string): string {
  return guestPhone;
}

/**
 * Dado un row de `Wubby_Whatsapp` y el teléfono del huésped (conversación destino),
 * deriva el `Message` para Realtime / UI incremental.
 *
 * `hotelIdentities` debe ser el set del whatsapp_number del hotel de la fila
 * (vía `resolveHotelWaIdentitiesForRow` + mapa `hotel_id → whatsapp_number`).
 */
export function buildMessageFromWubbyRow(
  row: WubbyWhatsappRow,
  guestPhone: string,
  hotelIdentities: Set<string>
): {
  message: Message;
  previewRaw: string;
  createdAtIso: string;
  lastMessageLabel: string;
} {
  const guestNorm = normalizeWaIdentity(guestPhone);
  const sender = classifyMessageSender(row, guestNorm, hotelIdentities);

  const fmt = readMessageFormat(row);
  const { body, previewRaw, media } = resolveMessageBodyAndPreview(row);
  const {
    messageType,
    mediaUrl,
    mediaStoragePath,
    mediaMimeType,
    mediaCaption,
    mediaFilename,
    mediaBucket,
    metaMediaId,
  } = media;
  const causeReqHandoff = readCauseRequest(row);
  const causeOfReq = readCauseOfRequestColumn(row);
  const clientTempIdRaw = readStringField(row, "client_temp_id", "clientTempId");
  const clientTempId = clientTempIdRaw?.trim() || undefined;

  return {
    message: {
      id: String(row.id),
      body,
      sentAt: formatMessageDisplayTime(row as Record<string, unknown>),
      sentAtIso: typeof row.created_at === "string" ? row.created_at : String(row.created_at ?? ""),
      sender,
      ...(clientTempId ? { clientTempId, status: "confirmed" as const } : {}),
      ...(fmt ? { format: fmt } : {}),
      messageType,
      mediaUrl,
      mediaStoragePath,
      mediaMimeType,
      mediaCaption,
      mediaFilename,
      mediaBucket,
      metaMediaId,
      wamid: readWamid(row) ?? null,
      reactionToWamid: readReactionToWamid(row) ?? null,
      ...(causeReqHandoff ? { causeRequest: causeReqHandoff } : {}),
      ...(causeOfReq ? { causeOfRequest: causeOfReq } : {}),
    },
    previewRaw,
    createdAtIso: row.created_at,
    lastMessageLabel: formatMessageDisplayListTime(row as Record<string, unknown>),
  };
}

/** Devuelve la conversación cuyo `guestPhone` matchea el `sender` o `recipient` del row. */
export function findConversationForWubbyRow(
  conversations: Conversation[],
  row: WubbyWhatsappRow
): Conversation | null {
  const s = normalizePhoneDigits(row.sender ?? "");
  const r = normalizePhoneDigits(row.recipient ?? "");
  if (!s && !r) return null;
  for (const c of conversations) {
    const cp = normalizePhoneDigits(c.guestPhone);
    if (!cp) continue;
    if (cp === s || cp === r) return c;
  }
  return null;
}

/**
 * Aplica un patch incremental sobre una conversación existente a partir de un row
 * actualizado de `conversations`. Preserva mensajes ya cargados.
 */
export function applyConversationRowPatch(
  existing: Conversation,
  row: ConversationDbRow
): Conversation {
  const { operationalStatus, controlMode } = mapOperationalFromConversationRow(row);
  const requestRaw = typeof row.request === "string" ? row.request.trim() : row.request;
  const requestValue =
    typeof requestRaw === "string" && requestRaw.length > 0 ? requestRaw : null;

  const normalizedPhone = normalizeWaIdentity(row.guest_phone ?? "");
  const phoneDisplay =
    normalizedPhone || String(row.guest_phone ?? "").trim() || existing.guestPhone;
  const name = displayGuestName(row.guest_name, phoneDisplay);

  const cotizacion =
    row.cotizacion != null && String(row.cotizacion).trim() !== ""
      ? String(row.cotizacion)
      : null;

  return {
    ...existing,
    guest: {
      ...existing.guest,
      id: row.id,
      name,
      phone: phoneDisplay,
      property: cotizacion ? cotizacion : existing.guest.property,
      tags: cotizacion ? [cotizacion.slice(0, 24)] : existing.guest.tags,
    },
    guestPhone: phoneDisplay,
    needsHuman: row.needs_human ?? false,
    aiActive: row.ai_active ?? true,
    dbStatus: row.status,
    blocked: row.blocked ?? false,
    blockedAt: row.blocked_at,
    // El trigger que mantiene `last_guest_message_at` dispara un UPDATE en
    // `conversations`, así que este es el camino por el que el composer se
    // desbloquea en vivo cuando el huésped escribe. Sin propagarlo, con la
    // bandeja ya sin `messages`, se quedaría bloqueado hasta el próximo refetch.
    lastGuestMessageAt: row.last_guest_message_at ?? null,
    request: requestValue,
    unreadCount: readUnreadCount(row.unread_count),
    operationalStatus,
    controlMode,
  };
}
