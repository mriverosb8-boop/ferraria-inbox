import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { cookieDomainOption } from "./cookie-domain";

const GET_USER_TIMEOUT_MS = 8_000;

function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach(({ name, value, ...opts }) => {
    to.cookies.set(name, value, opts);
  });
}

/**
 * getUser() llama a la API de Auth; en Edge puede colgarse (red/DNS) y dejar
 * la app sin responder. Evitamos eso con un timeout explícito.
 */
async function getUserOrNull(supabase: SupabaseClient) {
  try {
    const { data, error } = await Promise.race([
      supabase.auth.getUser(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("getUser timeout")), GET_USER_TIMEOUT_MS);
      }),
    ]);
    if (error) {
      console.warn("[middleware] getUser error:", error.message);
      return null;
    }
    return data.user;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[middleware] getUser no disponible (timeout o error):", msg);
    return null;
  }
}

/**
 * Refresca la sesión de Supabase y aplica reglas de acceso:
 * - Sin sesión: /api/* → 401; resto → /login
 * - Con sesión en /login → /
 */
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    console.error("[middleware] Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY");
    return supabaseResponse;
  }

  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, { ...options, ...cookieDomainOption() });
        });
      },
    },
  });

  const user = await getUserOrNull(supabase);

  const pathname = request.nextUrl.pathname;

  if (user && pathname === "/login") {
    const redirect = NextResponse.redirect(new URL("/", request.url));
    copyCookies(supabaseResponse, redirect);
    return redirect;
  }

  if (!user) {
    if (pathname.startsWith("/api")) {
      const unauthorized = NextResponse.json({ error: "No autorizado" }, { status: 401 });
      copyCookies(supabaseResponse, unauthorized);
      return unauthorized;
    }
    if (pathname !== "/login") {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      const redirect = NextResponse.redirect(loginUrl);
      copyCookies(supabaseResponse, redirect);
      return redirect;
    }
  }

  return supabaseResponse;
}
