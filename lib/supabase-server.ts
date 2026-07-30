import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Credenciales del cliente servidor, validadas al CARGAR el módulo.
 *
 * La service role no tiene fallback a la anon key. Con la RLS cerrada
 * (`conversations`, `Wubby_Whatsapp`, `hotel_users` y `hotels` solo exponen
 * política de SELECT para `authenticated`, cero políticas de escritura) la anon
 * key no puede escribir: cada UPDATE/INSERT afectaría 0 filas sin devolver
 * error, así que `PATCH /api/inbox` respondería 404 "Conversación no
 * encontrada" y la bandeja aparentaría funcionar mientras nada se guarda. Un
 * despliegue sin la variable debe no arrancar, no degradarse en silencio.
 *
 * La anon key sigue siendo legítima donde el control de acceso ES la RLS y la
 * autoriza el JWT del usuario: `lib/supabase/client.ts` (navegador),
 * `lib/supabase/server.ts` (SSR con cookies) y `lib/supabase/middleware.ts`.
 * Ninguno pasa por acá.
 */
function readServerCredentials(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    const missing = [
      url ? null : "NEXT_PUBLIC_SUPABASE_URL",
      serviceRoleKey ? null : "SUPABASE_SERVICE_ROLE_KEY",
    ]
      .filter(Boolean)
      .join(", ");

    throw new Error(
      `[supabase-server] Faltan variables de entorno obligatorias: ${missing}. ` +
        "El cliente servidor exige la service role; la anon key NO es un fallback válido " +
        "porque la RLS solo tiene políticas de SELECT y toda escritura fallaría en silencio."
    );
  }

  return { url, serviceRoleKey };
}

const { url: SUPABASE_URL, serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY } = readServerCredentials();

let cached: SupabaseClient | null = null;

/**
 * Cliente Supabase solo para servidor (Route Handlers, Server Components).
 * Siempre con `SUPABASE_SERVICE_ROLE_KEY`: omite RLS a propósito, por eso cada
 * llamador es responsable de su propio gate de tenancy (`requireSessionUser` +
 * `assertConversationInHotel` / `requireActiveHotel`).
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (cached) return cached;

  cached = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
