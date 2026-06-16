import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel, requireActiveHotel } from "@/lib/auth/require-hotel";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

async function readHotelWhatsappConfig(hotelId: string | null | undefined): Promise<{
  whatsappPhoneNumberId: string | null;
  whatsappNumber: string | null;
}> {
  const empty = { whatsappPhoneNumberId: null, whatsappNumber: null };
  const trimmedHotelId = typeof hotelId === "string" ? hotelId.trim() : "";
  if (!trimmedHotelId) return empty;

  try {
    const supabase = getSupabaseServerClient();
    const { data: hotel, error } = await supabase
      .from("hotels")
      .select("whatsapp_phone_number_id, whatsapp_number")
      .eq("id", trimmedHotelId)
      .maybeSingle();

    if (error) {
      console.error("[send-human-message] hotel lookup failed", error);
      return empty;
    }

    return {
      whatsappPhoneNumberId: hotel?.whatsapp_phone_number_id ?? null,
      whatsappNumber: hotel?.whatsapp_number ?? null,
    };
  } catch (e) {
    console.error("[send-human-message] hotel lookup exception", e);
    return empty;
  }
}

/**
 * Envía el mensaje humano a n8n (no Twilio desde el frontend).
 * Configura `N8N_SEND_MESSAGE_WEBHOOK_URL` con la URL del webhook de n8n.
 */
export async function POST(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const body = (await request.json()) as {
      guestPhone?: string;
      message?: string;
      conversationId?: string;
      hotelId?: string | null;
      clientTempId?: string;
    };

    const guestPhone = body.guestPhone?.trim();
    const message = body.message?.trim();
    if (!guestPhone || !message) {
      return NextResponse.json({ error: "guestPhone y message son obligatorios" }, { status: 400 });
    }

    const webhook = process.env.N8N_SEND_MESSAGE_WEBHOOK_URL;
    if (!webhook) {
      return NextResponse.json(
        {
          ok: false,
          skipped: true,
          error:
            "N8N_SEND_MESSAGE_WEBHOOK_URL no está definida. Añádela en .env.local para enviar a n8n.",
        },
        { status: 503 }
      );
    }

    const clientTempId = body.clientTempId?.trim() || null;

    // GATE de tenancy completo, ANTES del fetch a n8n (este endpoint no escribe
    // en DB; n8n hace la inserción, por eso no hay candado de update aquí).
    // 1) el hotelId del cliente debe pertenecer al usuario;
    const tenant = await requireActiveHotel(request, auth.user, {
      requestedHotelId: body.hotelId ?? undefined,
    });
    if (tenant.response) return tenant.response;

    // 2) ownership del conversationId → su hotel_id es el AUTORITATIVO.
    //    assertConversationInHotel hace: conversations.select("id, hotel_id")
    //    .eq("id", conversationId) y valida hotel_id ∈ allowedHotelIds.
    const conversationId = body.conversationId?.trim() || null;
    let hotelId: string;
    if (conversationId) {
      const ownership = await assertConversationInHotel(
        tenant.supabase,
        conversationId,
        tenant.allowedHotelIds
      );
      if (ownership.response) return ownership.response;
      hotelId = ownership.hotelId;
    } else if (tenant.activeHotelId) {
      hotelId = tenant.activeHotelId;
    } else {
      return NextResponse.json({ error: "hotelId es obligatorio" }, { status: 400 });
    }

    // 3) config de WhatsApp derivada del hotel autoritativo, nunca del cliente.
    const hotelWhatsapp = await readHotelWhatsappConfig(hotelId);

    const payload = {
      guestPhone,
      message,
      conversationId,
      hotelId,
      whatsappPhoneNumberId: hotelWhatsapp.whatsappPhoneNumberId,
      whatsappNumber: hotelWhatsapp.whatsappNumber,
      source: "FerrarIA-inbox",
      sentAt: new Date().toISOString(),
      clientTempId,
    };

    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[send-human-message]", res.status, text);
      return NextResponse.json(
        { error: `Webhook respondió ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
