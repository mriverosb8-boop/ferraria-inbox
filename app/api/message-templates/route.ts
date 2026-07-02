import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
} from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { fetchHotelMessageTemplates } from "@/lib/message-templates";

export const dynamic = "force-dynamic";

/** Plantillas de WhatsApp activas del hotel activo (scoped al tenant del usuario). */
export async function GET(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const requestedHotelId = new URL(request.url).searchParams.get("hotelId")?.trim() ?? "";

    const supabase = getSupabaseServerClient();
    const allowedHotelIds = await resolveAllowedHotelIds(supabase, auth.user);
    const availableHotels = await resolveAvailableHotels(supabase, allowedHotelIds);
    const { activeHotelId, forbidden } = resolveActiveHotelId(
      requestedHotelId,
      allowedHotelIds,
      availableHotels
    );

    if (forbidden) {
      return NextResponse.json({ error: "No autorizado para este hotel" }, { status: 403 });
    }
    if (!activeHotelId) {
      return NextResponse.json({ templates: [], activeHotelId: null });
    }

    const templates = await fetchHotelMessageTemplates(supabase, activeHotelId);
    return NextResponse.json({ templates, activeHotelId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error("[message-templates GET]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
