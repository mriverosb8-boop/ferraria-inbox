import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel, requireActiveHotel } from "@/lib/auth/require-hotel";
import { attachWamidByClientTempId, extractWamid } from "@/lib/outbound-wamid";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

function safeJsonParse(raw: string): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

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
 * Envía el mensaje humano a ferraria-engine (no Twilio desde el frontend).
 * Configura `ENGINE_HUMAN_REPLY_URL` e `INBOX_SHARED_SECRET`.
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

    const engineUrl = process.env.ENGINE_HUMAN_REPLY_URL;
    const sharedSecret = process.env.INBOX_SHARED_SECRET;
    if (!engineUrl || !sharedSecret) {
      return NextResponse.json(
        {
          ok: false,
          skipped: true,
          error:
            "Faltan ENGINE_HUMAN_REPLY_URL o INBOX_SHARED_SECRET. Añádelas en .env.local para enviar al engine.",
        },
        { status: 503 }
      );
    }

    const clientTempId = body.clientTempId?.trim() || null;

    // GATE de tenancy completo, ANTES del fetch al engine (este endpoint no
    // escribe en DB; el engine hace la inserción, por eso no hay candado de
    // update aquí).
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

    const res = await fetch(engineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": sharedSecret,
      },
      body: JSON.stringify(payload),
    });

    const rawBody = await res.text().catch(() => "");

    if (!res.ok) {
      console.error("[send-human-message]", res.status, rawBody);
      return NextResponse.json(
        { error: `El engine respondió ${res.status}`, detail: rawBody.slice(0, 500) },
        { status: 502 }
      );
    }

    // El engine inserta la fila en `Wubby_Whatsapp` ANTES de responder y ya
    // escribe el `wamid`; este update es el backstop para las filas que
    // quedaran sin él. Se ancla en el `client_temp_id` que viaja en el payload,
    // que es el mismo que el engine copia a la fila.
    //
    // Nunca aborta la respuesta: el mensaje ya salió al huésped y el único
    // efecto de fallar acá es que ese mensaje no se pueda cruzar después con
    // `message_statuses`.
    const wamid = extractWamid(safeJsonParse(rawBody));
    if (wamid && clientTempId) {
      await attachWamidByClientTempId({ wamid, clientTempId, hotelId });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
