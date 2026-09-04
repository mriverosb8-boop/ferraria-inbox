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
 * Color de marca del canal, para el chip de la lista y el badge del encabezado.
 *
 * Fuente ÚNICA: la lista de la izquierda y el encabezado del hilo tienen que
 * pintar exactamente el mismo color, o el mismo canal se lee como dos cosas
 * distintas según dónde lo mires.
 *
 * `whatsapp` es `null` a propósito, no un verde: el canal mayoritario NO lleva
 * chip. Si todas las filas llevaran uno, el chip dejaría de significar algo.
 *
 * Los tres son colores de marca sobre los que va texto blanco. El de Booking lo
 * fijó Matías; los de Expedia y Airbnb quedan acá listos para cuando entren esos
 * canales y se cambian en este solo punto.
 */
const CHANNEL_BRAND_COLORS: Record<MessageChannel, string | null> = {
  whatsapp: null,
  booking: "#003580",
  expedia: "#00355F",
  airbnb: "#FF5A5F",
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
 * Color de marca del canal, o `null` cuando el canal no lleva distintivo.
 *
 * `null` es la señal de "no pintes chip", no un color faltante: hoy solo
 * WhatsApp cae ahí, y es a propósito.
 */
export function channelBrandColor(channel: MessageChannel): string | null {
  return CHANNEL_BRAND_COLORS[channel];
}

/**
 * ¿Es un canal de OTA (agencia externa) y no WhatsApp?
 *
 * Marca la frontera de CUATRO comportamientos distintos del inbox:
 *
 * 1. La ventana de 24 h de Meta no aplica: es una regla de WhatsApp Business y
 *    citarla en un hilo de Booking es mentirle a recepción. Tampoco hay botón
 *    de plantilla, que también es de Meta.
 * 2. `conversations.guest_phone` NO es un teléfono, es el UUID del hilo de
 *    Channex. Mostrarlo como teléfono produce un número inventado.
 * 3. Al engine hay que mandarle ese UUID SIN normalizar, o el envío se va por
 *    el canal equivocado. Ver `pickEngineIdentity`.
 * 4. No se pueden mandar archivos: el engine rechaza los adjuntos en estos
 *    canales. El texto sí sale.
 */
export function isOtaChannel(channel: MessageChannel): boolean {
  return channel !== "whatsapp";
}

/**
 * Cuál de las dos formas del identificador del huésped se le manda al engine.
 *
 * El engine busca la conversación de OTA con una comparación EXACTA contra
 * `conversations.guest_phone`. En OTA esa columna guarda el UUID del hilo de
 * Channex, y la versión normalizada le arranca los guiones: la búsqueda no
 * encuentra nada, el engine concluye que la conversación no es de OTA y manda
 * la respuesta por WhatsApp a un número de 19 dígitos que no existe.
 *
 * Recibe las dos cadenas ya calculadas en vez de calcularlas, para que la regla
 * —que es la que decide por qué canal sale el mensaje— quede en un módulo sin
 * dependencias y se pueda probar sola.
 */
export function pickEngineIdentity(
  channel: MessageChannel,
  rawIdentity: string,
  normalizedIdentity: string
): string {
  if (!isOtaChannel(channel)) return normalizedIdentity;
  // El respaldo evita mandar vacío, que el engine rechaza de plano.
  return rawIdentity.trim() || normalizedIdentity;
}
