import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { capabilitiesForRoles } from "@/lib/permissions";
import { INBOX_PATH, LOGIN_PATH, RESERVAS_PATH, landingPathFor } from "@/lib/routes";
import { cookieDomainOption } from "./cookie-domain";

const GET_USER_TIMEOUT_MS = 8_000;
/** Más corto que el de getUser: es un SELECT de una fila, no una llamada a Auth. */
const ROLE_QUERY_TIMEOUT_MS = 3_000;

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
 * Capacidades del usuario leyendo `hotel_users` con la anon key + su JWT.
 *
 * Funciona porque la policy `hotel_users_self_select` deja leer la propia fila;
 * no hace falta service_role en el Edge (y no debería andar acá).
 *
 * FALLA ABIERTO A PROPÓSITO. Si la consulta se cuelga o revienta devuelve
 * `null` y el middleware no redirige a nadie. El razonamiento: este redirect es
 * UX, no seguridad — el candado real son el gate de capacidad de cada endpoint
 * y la RLS. Fallar cerrado ante un hipo de red dejaría a una recepcionista sin
 * poder abrir la bandeja con un huésped esperando, que es el peor resultado
 * posible; fallar abierto, en cambio, le muestra a un operativo una pantalla
 * cuyos datos igual no puede cargar.
 */
async function capabilitiesOrNull(supabase: SupabaseClient, userId: string) {
  try {
    const { data, error } = await Promise.race([
      supabase.from("hotel_users").select("role").eq("user_id", userId),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("hotel_users timeout")), ROLE_QUERY_TIMEOUT_MS);
      }),
    ]);
    if (error) {
      console.warn("[middleware] hotel_users error:", error.message);
      return null;
    }
    return capabilitiesForRoles((data ?? []).map((row) => row.role));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[middleware] rol no disponible (timeout o error):", msg);
    return null;
  }
}

/**
 * ¿Esta ruta necesita conocer el rol?
 *
 * Solo las pantallas gateadas. El matcher del middleware cubre casi todo, así
 * que consultar el rol siempre significaría un viaje extra a la base en CADA
 * navegación y cada petición a `/api/*`. Los endpoints ya traen su propio gate,
 * así que acá alcanza con las rutas donde el usuario puede aterrizar.
 */
function needsRoleCheck(pathname: string): boolean {
  return (
    pathname === INBOX_PATH ||
    pathname === LOGIN_PATH ||
    pathname === RESERVAS_PATH ||
    pathname.startsWith(`${RESERVAS_PATH}/`)
  );
}

/**
 * Refresca la sesión de Supabase y aplica reglas de acceso:
 * - Sin sesión: /api/* → 401; resto → /login
 * - Con sesión en /login → su pantalla de aterrizaje según el rol
 * - Con sesión en una ruta que su rol no cubre → rebote a su aterrizaje
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

  if (user && needsRoleCheck(pathname)) {
    const capabilities = await capabilitiesOrNull(supabase, user.id);

    // `capabilities === null` = la consulta falló: no redirigimos (falla abierto).
    const destino = capabilities ? landingPathFor(capabilities) : INBOX_PATH;

    const rutaProhibida =
      capabilities != null &&
      ((pathname === INBOX_PATH && !capabilities.verConversacionesHuespedes) ||
        (pathname.startsWith(RESERVAS_PATH) && !capabilities.verReservas));

    if (pathname === LOGIN_PATH || rutaProhibida) {
      const redirect = NextResponse.redirect(new URL(destino, request.url));
      copyCookies(supabaseResponse, redirect);
      return redirect;
    }
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
