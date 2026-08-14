import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { resolveTenantContext } from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/**
 * Rol, área y capacidades del usuario de la sesión.
 *
 * Existe porque las pestañas del header son cliente y hasta ahora sacaban su
 * config de `/api/inbox` — endpoint que un `operativo` ya no puede llamar. Sin
 * una fuente aparte, el operativo no podría saber ni qué tiene permitido ver.
 *
 * NO lleva gate de capacidad a propósito: todo usuario con sesión necesita poder
 * preguntar qué puede hacer. No expone nada del hotel más allá de los ids que el
 * usuario ya tiene asignados.
 */
export async function GET() {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const supabase = getSupabaseServerClient();
    const tenant = await resolveTenantContext(supabase, auth.user);

    return NextResponse.json({
      capabilities: tenant.capabilities,
      // Roles y áreas de las membresías, sin el hotel_id: al cliente le alcanza
      // para decidir qué pintar, y el filtro real siempre pasa por el servidor.
      roles: [...new Set(tenant.memberships.map((m) => m.role).filter(Boolean))],
      areas: [...new Set(tenant.memberships.map((m) => m.area).filter(Boolean))],
    });
  } catch (error) {
    const isDev = process.env.NODE_ENV !== "production";
    console.error("[api/me] fallo al resolver el contexto del usuario");
    return NextResponse.json(
      { error: isDev && error instanceof Error ? error.message : "Error interno" },
      { status: 500 }
    );
  }
}
