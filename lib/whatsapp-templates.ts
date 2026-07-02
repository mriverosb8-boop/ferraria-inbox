/**
 * Las plantillas de WhatsApp ahora viven en la tabla `message_templates` de
 * Supabase (por hotel); ver `lib/message-templates.ts`. Este módulo conserva
 * solo el helper de normalización del número colombiano.
 */
export function normalizeColombianWhatsappNumber(value: string): string {
  const digits = value.replace(/\D/g, "");

  if (digits.length === 10 && digits.startsWith("3")) {
    return `57${digits}`;
  }

  return digits;
}
