import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { resolveTenantContext, type TenantContext } from "@/lib/inbox-tenant";
import type { Capability } from "@/lib/permissions";

/**
 * Capacidades que dan acceso a datos de huéspedes. Los endpoints que las exigen
 * trabajan sobre `guestDataHotelIds`, NO sobre `allowedHotelIds`.
 *
 * La diferencia solo se nota con roles mezclados entre hoteles (operativo en uno,
 * recepcionista en otro). Es un caso que hoy el dashboard no puede crear, pero
 * como los handlers corren con service_role y se saltan la RLS, si apareciera
 * sería una fuga silenciosa entre hoteles del mismo usuario.
 */
const CAPACIDADES_DE_HUESPED: ReadonlySet<Capability> = new Set<Capability>([
  "verConversacionesHuespedes",
  "enviarMensajes",
  "verReservas",
]);

export type CapabilityGateResult = {
  /** Si no es `null`, devolvela tal cual (403). */
  response: NextResponse | null;
  /**
   * Hoteles sobre los que este endpoint puede operar, ya recortados según la
   * capacidad pedida. Reemplaza al `resolveAllowedHotelIds` de antes.
   */
  allowedHotelIds: string[];
  tenant: TenantContext;
};

/**
 * Gate de capacidad para Route Handlers, con el recorte de hoteles incluido.
 *
 * Se usa DESPUÉS de `requireSessionUser` y en el mismo lugar donde antes se
 * llamaba a `resolveAllowedHotelIds`:
 *
 *     const gate = await requireCapability(supabase, auth.user, "verConversacionesHuespedes");
 *     if (gate.response) return gate.response;
 *     const allowedHotelIds = gate.allowedHotelIds;
 *
 * El 403 es deliberadamente genérico: no dice qué rol tiene el usuario ni qué
 * capacidad le falta.
 */
export async function requireCapability(
  supabase: SupabaseClient,
  user: User,
  capability: Capability
): Promise<CapabilityGateResult> {
  const tenant = await resolveTenantContext(supabase, user);

  if (!tenant.capabilities[capability]) {
    return {
      response: NextResponse.json({ error: "No autorizado" }, { status: 403 }),
      allowedHotelIds: [],
      tenant,
    };
  }

  const allowedHotelIds = CAPACIDADES_DE_HUESPED.has(capability)
    ? tenant.guestDataHotelIds
    : tenant.allowedHotelIds;

  return { response: null, allowedHotelIds, tenant };
}

export { CAPACIDADES_DE_HUESPED };
