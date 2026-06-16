import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel } from "@/lib/auth/require-hotel";
import { resolveAllowedHotelIds } from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const WEBHOOK_URL =
  process.env.CREATE_CONVERSATION_SUMMARY_WEBHOOK_URL ??
  "https://asistentehotelero.com/webhook/create-conversation-summary";

export async function POST(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const body = (await request.json()) as { conversation_id?: string };
    const conversation_id = body.conversation_id?.trim();
    if (!conversation_id) {
      return NextResponse.json({ error: "conversation_id es obligatorio" }, { status: 400 });
    }

    // Ownership antes de disparar el webhook de IA (evita generar resúmenes de
    // conversaciones de otros hoteles / abuso de recurso).
    const supabase = getSupabaseServerClient();
    const allowedHotelIds = await resolveAllowedHotelIds(supabase, auth.user);
    const ownership = await assertConversationInHotel(supabase, conversation_id, allowedHotelIds);
    if (ownership.response) return ownership.response;

    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversation_id }),
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("[create-conversation-summary] webhook", res.status, text);
    }

    return NextResponse.json({ ok: true, webhookOk: res.ok, webhookStatus: res.status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
