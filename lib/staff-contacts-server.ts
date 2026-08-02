import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

/**
 * Piezas de `staff_contacts` que SOLO corren en el servidor (Route Handlers).
 * Separado de `lib/staff-contacts.ts` porque ese lo importa el modal del
 * navegador.
 */

const isDev = process.env.NODE_ENV !== "production";

/** Violación de UNIQUE (hotel_id, phone). */
const UNIQUE_VIOLATION = "23505";
/** Violación de CHECK (formato de phone / largo de name). */
const CHECK_VIOLATION = "23514";

/**
 * Traduce un error de Postgres a una respuesta para el usuario.
 *
 * El detalle crudo de Supabase NUNCA sale a producción: el `details` de un
 * 23505 trae el valor de la llave (o sea, el teléfono del contacto) y el
 * `message` puede exponer nombres de constraints. En producción se loguea solo
 * el `code`; el crudo queda detrás de `isDev`.
 */
export function staffContactDbErrorResponse(
  scope: string,
  error: PostgrestError
): NextResponse {
  if (isDev) {
    console.error(scope, error);
  } else {
    console.error(scope, error.code ?? "sin_code");
  }

  if (error.code === UNIQUE_VIOLATION) {
    return NextResponse.json(
      { error: "Ese número ya está registrado para este hotel" },
      { status: 409 }
    );
  }
  if (error.code === CHECK_VIOLATION) {
    return NextResponse.json(
      { error: "Los datos del contacto no tienen un formato válido" },
      { status: 400 }
    );
  }

  return NextResponse.json(
    { error: isDev ? error.message : "No se pudo guardar el contacto" },
    { status: 502 }
  );
}

/**
 * Log del catch-all de las routes. Mismo criterio que el de Postgrest: en
 * producción no sale el mensaje, porque un error envuelto puede arrastrar el
 * teléfono o el nombre del contacto.
 */
export function logStaffContactFailure(scope: string, e: unknown): void {
  if (isDev) {
    console.error(scope, e);
    return;
  }
  console.error(scope, "error no controlado");
}

/**
 * URL del endpoint de invalidación de cache del engine.
 *
 * El engine cachea los contactos de staff para clasificar mensajes entrantes.
 * Cada endpoint del engine tiene su propia variable con la URL completa
 * (`ENGINE_SEND_TEMPLATE_URL`, `ENGINE_HUMAN_REPLY_URL`, …); acá aceptamos una
 * propia y, si no está, derivamos el origen de la de plantillas para no exigir
 * una variable nueva en el despliegue.
 */
function resolveInvalidateUrl(): string | null {
  const explicit = process.env.ENGINE_STAFF_CONTACTS_INVALIDATE_URL?.trim();
  if (explicit) return explicit;

  const fallbackBase = process.env.ENGINE_SEND_TEMPLATE_URL?.trim();
  if (!fallbackBase) return null;

  try {
    const url = new URL(fallbackBase);
    url.pathname = "/inbox/staff-contacts/invalidate";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Avisa al engine que los contactos de un hotel cambiaron, para que bote su
 * cache antes de que expire el TTL (5 min).
 *
 * Best-effort a propósito: el endpoint del engine todavía NO existe (tanda E2).
 * Cualquier fallo —variable ausente, 404, timeout— se traga en silencio y sin
 * loguear el cuerpo. El peor caso es que el engine siga con datos viejos unos
 * minutos, no que el usuario vea un error al guardar un contacto.
 */
export async function notifyEngineStaffContactsChanged(hotelId: string): Promise<void> {
  const url = resolveInvalidateUrl();
  const sharedSecret = process.env.INBOX_SHARED_SECRET;
  if (!url || !sharedSecret || !hotelId) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": sharedSecret,
      },
      body: JSON.stringify({ hotelId }),
      // Un engine caído no puede colgar la respuesta del inbox.
      signal: AbortSignal.timeout(2500),
    });
  } catch {
    // Silencio deliberado: lo cubre el TTL del cache del engine.
  }
}
