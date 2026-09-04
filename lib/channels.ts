/**
 * Canal por el que llegó la conversación.
 *
 * `conversations.channel` es `text` con default `'whatsapp'`, y el engine
 * escribe el mismo dominio en `Wubby_Whatsapp.channel`. Los tres valores de OTA
 * entran por Channex.
 *
 * Se declara como unión cerrada a propósito, pero NUNCA se castea: todo lo que
 * viene de la base pasa por `normalizeChannel`, que trata cualquier valor
 * desconocido como `whatsapp`. Si el engine agrega un cuarto canal antes que el
 * inbox, la bandeja lo sigue mostrando en vez de romperse o pintar un vacío.
 */
export type MessageChannel = "whatsapp" | "booking" | "expedia" | "airbnb";

const CHANNEL_LABELS: Record<MessageChannel, string> = {
  whatsapp: "WhatsApp",
  booking: "Booking.com",
  expedia: "Expedia",
  airbnb: "Airbnb",
};

/**
 * Valor de la columna → canal conocido. Cualquier cosa que no reconozcamos
 * (null, texto raro, canal nuevo del engine) cae a `whatsapp`, que es el default
 * de la columna y el canal del 100% del histórico.
 */
export function normalizeChannel(raw: unknown): MessageChannel {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (value === "booking" || value === "expedia" || value === "airbnb") return value;
  return "whatsapp";
}

/** Nombre del canal tal como lo lee recepción. Es la marca, no el valor crudo. */
export function channelLabel(channel: MessageChannel): string {
  return CHANNEL_LABELS[channel];
}

/**
 * ¿Es un canal de OTA (agencia externa) y no WhatsApp?
 *
 * Marca la frontera de TRES comportamientos distintos del inbox:
 *
 * 1. La ventana de 24 h de Meta no aplica: es una regla de WhatsApp Business y
 *    citarla en un hilo de Booking es mentirle a recepción.
 * 2. `conversations.guest_phone` NO es un teléfono, es el UUID del hilo de
 *    Channex. Mostrarlo como teléfono produce un número inventado (ver
 *    `isOtaIdentifierDisplayable` abajo).
 * 3. Todavía no hay egreso por estos canales en el engine, así que el
 *    compositor va deshabilitado.
 */
export function isOtaChannel(channel: MessageChannel): boolean {
  return channel !== "whatsapp";
}

/**
 * Motivo visible por el que recepción todavía no puede responder por un canal
 * de OTA. Es el texto que reemplaza al de la ventana de 24 h de Meta.
 *
 * No nombra el engine, Channex ni ninguna tabla: recepción no sabe qué es eso y
 * saberlo no la ayuda a atender al huésped.
 */
export function otaReplyUnavailableCopy(channel: MessageChannel): string {
  return `Todavía no puedes responder por ${channelLabel(channel)} desde aquí.`;
}
