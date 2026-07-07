import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { sendPushToHotel } from "@/lib/push/send";

export const dynamic = "force-dynamic";

type NotifyBody = {
  hotel_id?: string;
  conversation_id?: string;
  title?: string;
  body?: string;
};

/** Compara el secreto en tiempo constante (evita fuga por timing). */
function secretMatches(provided: string | null): boolean {
  const expected = process.env.PUSH_NOTIFY_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Disparo de push desde n8n cuando un caso pasa a needs_human.
 * Auth por secreto compartido (header x-push-secret), NO por sesión Supabase.
 * Best-effort: un fallo de envío nunca debe tumbar el flujo de n8n.
 */
export async function POST(request: Request) {
  if (!secretMatches(request.headers.get("x-push-secret"))) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  let body: NotifyBody;
  try {
    body = (await request.json()) as NotifyBody;
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const hotelId = typeof body.hotel_id === "string" ? body.hotel_id.trim() : "";
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  if (!hotelId || !conversationId) {
    return NextResponse.json({ error: "Faltan hotel_id o conversation_id" }, { status: 400 });
  }

  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : "FerrarIA Inbox";
  const messageBody =
    typeof body.body === "string" && body.body.trim()
      ? body.body.trim()
      : "Un huésped requiere atención humana.";

  try {
    const result = await sendPushToHotel(hotelId, {
      title,
      body: messageBody,
      conversation_id: conversationId,
      hotel_id: hotelId,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    // Best-effort: devolvemos 200 ok:false para que n8n no reintente ni falle duro.
    console.error("[push/notify POST]", e);
    return NextResponse.json({ ok: false, error: "push_failed" }, { status: 200 });
  }
}
