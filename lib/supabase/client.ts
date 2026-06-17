import { createBrowserClient } from "@supabase/ssr";

import { COOKIE_DOMAIN } from "./cookie-domain";

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }
  return COOKIE_DOMAIN
    ? createBrowserClient(url, anon, { cookieOptions: { domain: COOKIE_DOMAIN } })
    : createBrowserClient(url, anon);
}
