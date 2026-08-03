import { isWaLidIdentifier, readWaLid } from "@/lib/chat-utils";

/**
 * Las plantillas de WhatsApp ahora viven en la tabla `message_templates` de
 * Supabase (por hotel); ver `lib/message-templates.ts`. Este módulo conserva
 * solo el helper de normalización del número colombiano.
 *
 * Un LID de Meta (`CO.28322187600722863`) NO es un teléfono: sale tal cual, sin
 * dígitos ni indicativo. Antes se le arrancaban las letras y el engine recibía
 * un destinatario inventado. El detector es el mismo de la carga del hilo, no
 * una regex duplicada.
 */
export function normalizeColombianWhatsappNumber(value: string): string {
  if (isWaLidIdentifier(value)) return readWaLid(value);

  const digits = value.replace(/\D/g, "");

  if (digits.length === 10 && digits.startsWith("3")) {
    return `57${digits}`;
  }

  return digits;
}
