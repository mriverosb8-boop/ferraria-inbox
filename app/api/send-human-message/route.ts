import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel, requireActiveHotel } from "@/lib/auth/require-hotel";
import { attachWamidByClientTempId, extractWamid } from "@/lib/outbound-wamid";
import { readEngineError } from "@/lib/engine-error";
import { DEFAULT_COMPOSER_LANGUAGE, normalizeLanguageCode } from "@/lib/language-names";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

/** Lo que ve la asesora cuando el engine falla sin decir nada aprovechable. */
const GENERIC_ENGINE_ERROR = "No se pudo enviar el mensaje por WhatsApp.";

/**
 * Errores del engine que garantizan que el mensaje NO salió al huésped: la
 * traducción se hace ANTES de mandarlo a Meta, así que si falla ahí no hay nada
 * enviado. Son los únicos casos en los que la bandeja puede devolverle el texto
 * a la asesora para reintentar sin riesgo de mandar el mensaje dos veces.
 *
 * Contrato de `POST /inbox/human-reply` (ferraria-engine, `src/routes/inbox.ts`).
 */
const ENGINE_NOT_SENT_ERRORS = new Set([
  // 502: el traductor no respondió, o alteró datos protegidos y se descartó.
  "translation_failed",
  // 400: código de idioma que no es ISO 639-1 de dos letras.
  "invalid_target_lang",
  // 400: llegaron dos idiomas distintos en el mismo envío.
  "conflicting_target_lang",
  // 400: el hotel todavía responde por n8n, donde no hay traducción.
  "translation_not_supported",
]);

/** Copy de respaldo si el engine no manda `detail`. */
const NOT_SENT_FALLBACK_COPY: Record<string, string> = {
  translation_failed:
    "No se pudo traducir el mensaje, así que no se envió. Reintenta o mándalo en español.",
  invalid_target_lang: "El idioma destino no es válido. El mensaje no se envió.",
  conflicting_target_lang: "Llegaron dos idiomas destino distintos. El mensaje no se envió.",
  translation_not_supported:
    "Este hotel todavía no soporta traducción de salida. Envía el mensaje en español.",
};

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
      /**
       * ISO 639-1 del idioma en que la asesora quiere que SALGA el mensaje. Ella
       * siempre escribe en español: si viene otro idioma, el engine traduce
       * antes de enviar y guarda el español en `message`.
       */
      targetLang?: string | null;
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
      capability: "enviarMensajes",
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

    // Español = camino de siempre: el campo NO viaja y el engine hace
    // exactamente lo mismo que antes de que existiera la traducción de salida.
    // Un código basura tampoco viaja: se ignora en vez de gastar un 400.
    const normalizedTargetLang = normalizeLanguageCode(body.targetLang);
    const targetLang =
      normalizedTargetLang && normalizedTargetLang !== DEFAULT_COMPOSER_LANGUAGE
        ? normalizedTargetLang
        : null;

    const payload = {
      guestPhone,
      message,
      // Solo una de las dos grafías: mandar las dos es `conflicting_target_lang`.
      ...(targetLang ? { targetLang } : {}),
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
      // Nunca el cuerpo crudo: puede traer un stack del engine o el payload de
      // Meta con el teléfono del huésped adentro, y esto se loguea en producción.
      const engineMessage = readEngineError(safeJsonParse(rawBody), GENERIC_ENGINE_ERROR);
      console.error("[send-human-message]", res.status, engineMessage);

      // Fallo de traducción: el engine no llegó a enviarle nada al huésped, y
      // eso hay que decírselo a la bandeja con un código, no con texto suelto,
      // para que pueda devolverle el mensaje a la asesora sin adivinar.
      const engineBody = safeJsonParse(rawBody) as { error?: unknown; detail?: unknown } | null;
      const engineError = typeof engineBody?.error === "string" ? engineBody.error : null;
      if (engineError && ENGINE_NOT_SENT_ERRORS.has(engineError)) {
        const detail = typeof engineBody?.detail === "string" ? engineBody.detail.trim() : "";
        return NextResponse.json(
          {
            code: engineError,
            // `notSent` es la garantía explícita: el mensaje NO salió, se puede
            // reintentar sin duplicar.
            notSent: true,
            error: detail || NOT_SENT_FALLBACK_COPY[engineError],
          },
          { status: res.status }
        );
      }

      return NextResponse.json({ error: engineMessage }, { status: 502 });
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
