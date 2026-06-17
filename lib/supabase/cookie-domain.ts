/**
 * Dominio de la cookie de sesión Supabase, para compartir login entre los
 * subdominios de ferraria.net (dashboard ↔ inbox).
 *
 * - Vacío / no definido (dev, localhost) → undefined → cookie HOST-ONLY:
 *   comportamiento IDÉNTICO al actual, no rompe el login local.
 * - Producción → ".ferraria.net" → la cookie viaja a todos los subdominios.
 *
 * Es NEXT_PUBLIC_ porque el browser client (client.ts) corre en el navegador
 * y necesita el valor inlineado en el bundle.
 */
export const COOKIE_DOMAIN =
  process.env.NEXT_PUBLIC_COOKIE_DOMAIN?.trim() || undefined;

/**
 * Devuelve `{ domain }` SOLO si hay dominio configurado; `{}` si no.
 * Se mergea sobre las `options` que ya calculó @supabase/ssr, así tocamos
 * únicamente `domain` y dejamos intactos path / sameSite / secure / maxAge.
 */
export function cookieDomainOption(): { domain?: string } {
  return COOKIE_DOMAIN ? { domain: COOKIE_DOMAIN } : {};
}
