import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { cookieDomainOption } from "./cookie-domain";

export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, { ...options, ...cookieDomainOption() });
          });
        } catch {
          // Llamado desde un Server Component sin mutar cookies; el middleware mantiene la sesión.
        }
      },
    },
  });
}
