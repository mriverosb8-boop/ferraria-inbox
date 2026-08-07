import type { MessageDeliveryReceipt } from "@/lib/inbox-types";

/**
 * Traducción de los códigos de error de Meta a algo que un recepcionista pueda
 * leer y actuar.
 *
 * Por qué existe: `message_statuses.error_title` viene en inglés y en jerga de
 * plataforma ("Message Undeliverable", "Re-engagement message"). Recepción no
 * tiene por qué descifrar eso mientras un huésped espera; necesita saber dos
 * cosas: si es culpa nuestra, y qué hacer ahora. Por eso cada texto cierra con
 * la acción sugerida.
 *
 * Regla de redacción: cada entrada debe poder leerse sola, sin el chip ni el
 * código al lado. Y nunca se dice "bot": el producto es un "agente".
 *
 * Lo que NO está mapeado cae al fallback `Meta reportó: …` en
 * `resolveDeliveryFailureReason`, que muestra el título crudo. Es preferible un
 * texto en inglés a inventar una explicación que no corresponda al código.
 */
const DELIVERY_FAILURE_COPY: Record<number, string> = {
  // Límite de calidad por usuario. NO es un error del sistema ni del número:
  // Meta frena el envío para proteger la experiencia del destinatario.
  131049:
    "Meta no entregó este mensaje al huésped por sus políticas de calidad. No es un error del sistema; puedes intentar más tarde o contactarlo por otro medio.",

  // El caso más frecuente en producción: el número simplemente no recibe.
  131026:
    "El número del huésped no pudo recibir el mensaje. Puede que no tenga WhatsApp o que el número esté mal escrito. Verifícalo o contáctalo por otro medio.",

  // Ventana de 24 h cerrada: solo se puede reabrir con plantilla aprobada.
  131047:
    "Pasaron más de 24 horas desde el último mensaje del huésped, así que WhatsApp no permite escribirle libremente. Usa una plantilla para reabrir la conversación.",

  131048:
    "WhatsApp bloqueó el envío por límite de mensajes hacia este huésped. Espera un rato antes de volver a intentarlo.",

  130472:
    "WhatsApp no entregó el mensaje porque este número está dentro de una prueba de Meta. Contacta al huésped por otro medio.",

  131051:
    "WhatsApp no admite este tipo de contenido. Intenta enviarlo como texto o como archivo adjunto.",

  131053:
    "El archivo adjunto no se pudo subir a WhatsApp. Revisa el formato y el tamaño, y vuelve a enviarlo.",

  132000:
    "La plantilla no coincide con los datos enviados. Revisa que estén completos todos los campos de la plantilla.",

  132001:
    "La plantilla no existe o no está aprobada para este hotel. Revisa las plantillas disponibles.",

  132015:
    "Meta pausó esta plantilla por baja calidad. Usa otra plantilla o contacta al huésped por otro medio.",

  132016:
    "Meta deshabilitó esta plantilla. Usa otra plantilla o contacta al huésped por otro medio.",

  133010:
    "El número de WhatsApp del hotel no está registrado en Meta. Esto requiere revisión técnica.",
};

/**
 * Motivo legible del fallo, o `null` si Meta no dio ninguna pista.
 *
 * Orden de preferencia:
 *  1. Copy propio del código (lo entendible).
 *  2. `Meta reportó: {título crudo}` — en inglés, pero es información real.
 *  3. `null` — el chip "No entregado" queda solo, sin línea secundaria.
 *
 * El código se prioriza sobre el título porque Meta a veces manda títulos
 * genéricos con códigos específicos, nunca al revés.
 */
export function resolveDeliveryFailureReason(failure: MessageDeliveryReceipt): string | null {
  if (failure.errorCode != null) {
    const mapped = DELIVERY_FAILURE_COPY[failure.errorCode];
    if (mapped) return mapped;
  }

  const title = failure.errorTitle?.trim();
  if (title) return `Meta reportó: ${title}`;

  return null;
}
