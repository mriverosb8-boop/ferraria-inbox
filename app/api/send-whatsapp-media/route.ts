import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel, requireActiveHotel } from "@/lib/auth/require-hotel";
import { nowInColombiaNaive } from "@/lib/colombia-time";
import { normalizePhoneDigits, normalizeWaIdentity } from "@/lib/chat-utils";
import { CONVERSATIONS_TABLE, CONVERSATION_SELECT_COLUMNS } from "@/lib/conversation-schema";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { WUBBY_TABLE } from "@/lib/wubby-schema";

export const dynamic = "force-dynamic";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_MIME_TYPE = "application/pdf";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;
const DEFAULT_GRAPH_API_VERSION = "v21.0";
const HOTELS_TABLE = "hotels";
const OPTIONAL_WUBBY_COLUMNS = [
  "conversation_id",
  "direction",
  "sender_type",
  "message_author",
  "from_ai",
  "message_type",
  "media_storage_path",
  "media_mime_type",
  "media_caption",
  "media_filename",
  "media_meta_id",
  "meta_media_id",
  "media_bucket",
  "whatsapp_message_id",
  "hotel_id",
] as const;

type WhatsappMediaType = "image" | "document";

type MetaMediaUploadResponse = {
  id?: string;
  error?: { message?: string };
};

type MetaMessageResponse = {
  messages?: Array<{ id?: string }>;
  error?: { message?: string };
};

function readEnv(...keys: string[]): string {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function cloudApiToNumber(raw: string): string {
  return normalizeWaIdentity(raw).replace(/^\+/, "");
}

async function readHotelWhatsappConfig(
  hotelId: string | null
): Promise<
  | { ok: true; phoneNumberId: string; sender: string }
  | { ok: false; error: string }
> {
  if (!hotelId) {
    return { ok: false, error: "El hotel no tiene WhatsApp configurado" };
  }

  const supabase = getSupabaseServerClient();
  const { data: hotel, error } = await supabase
    .from(HOTELS_TABLE)
    .select("whatsapp_phone_number_id, whatsapp_number")
    .eq("id", hotelId)
    .maybeSingle();

  if (error) {
    console.error("[send-whatsapp-media] hotel lookup failed", error);
    return { ok: false, error: "El hotel no tiene WhatsApp configurado" };
  }

  const phoneNumberId = String(hotel?.whatsapp_phone_number_id ?? "").trim();
  const sender = normalizePhoneDigits(hotel?.whatsapp_number ?? "");

  if (!phoneNumberId || !sender) {
    return { ok: false, error: "El hotel no tiene WhatsApp configurado" };
  }

  return { ok: true, phoneNumberId, sender };
}

function readMissingColumn(errorMessage: string): string | null {
  const quoted = errorMessage.match(/'([^']+)' column/i)?.[1];
  if (quoted) return quoted;
  const unquoted = errorMessage.match(/column "?([A-Za-z0-9_]+)"? (?:of relation .* )?does not exist/i)?.[1];
  return unquoted ?? null;
}

function sanitizeFilename(value: string, fallback: string): string {
  const name = value.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ");
  return name || fallback;
}

function extensionForMime(mimeType: string): string {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === PDF_MIME_TYPE) return "pdf";
  return "jpg";
}

function validateMedia(file: File): { ok: true; whatsappType: WhatsappMediaType } | { ok: false; error: string } {
  if (ALLOWED_IMAGE_TYPES.has(file.type)) {
    if (file.size > MAX_IMAGE_BYTES) {
      return { ok: false, error: "La imagen no puede superar 5 MB" };
    }
    return { ok: true, whatsappType: "image" };
  }

  if (file.type === PDF_MIME_TYPE) {
    if (file.size > MAX_PDF_BYTES) {
      return { ok: false, error: "El PDF no puede superar 10 MB" };
    }
    return { ok: true, whatsappType: "document" };
  }

  return { ok: false, error: "Solo se permiten imágenes JPG, PNG, WebP o PDF" };
}

async function insertWubbyRowWithFallback(row: Record<string, unknown>) {
  const supabase = getSupabaseServerClient();
  let candidate = { ...row };

  for (let attempt = 0; attempt <= OPTIONAL_WUBBY_COLUMNS.length; attempt += 1) {
    const { data, error } = await supabase
      .from(WUBBY_TABLE)
      .insert(candidate)
      .select("*")
      .single();

    if (!error) return { data, error: null };

    const missingColumn = readMissingColumn(error.message);
    if (
      !missingColumn ||
      !OPTIONAL_WUBBY_COLUMNS.includes(missingColumn as (typeof OPTIONAL_WUBBY_COLUMNS)[number]) ||
      !(missingColumn in candidate)
    ) {
      return { data: null, error };
    }

    const rest = { ...candidate };
    delete rest[missingColumn];
    candidate = rest;
  }

  return { data: null, error: new Error("No se pudo insertar el mensaje saliente") };
}

export async function POST(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const formData = await request.formData();
    const conversationId = String(formData.get("conversationId") ?? "").trim();
    const toRaw = String(formData.get("to") ?? "").trim();
    const caption = String(formData.get("caption") ?? "").trim();
    const hotelIdRaw = String(formData.get("hotelId") ?? "").trim();
    const clientTempId = String(formData.get("clientTempId") ?? "").trim() || null;
    const file = formData.get("file");

    if (!conversationId) {
      return NextResponse.json({ error: "conversationId es obligatorio" }, { status: 400 });
    }
    if (!toRaw) {
      return NextResponse.json({ error: "to es obligatorio" }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "El archivo es obligatorio" }, { status: 400 });
    }

    const validation = validateMedia(file);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // GATE de tenancy ANTES de cualquier efecto (storage/Meta/insert):
    // 1) el hotelId del formData debe pertenecer al usuario;
    // 2) la conversación debe ser suya, y SU hotel es el autoritativo para enviar.
    const tenant = await requireActiveHotel(request, auth.user, { requestedHotelId: hotelIdRaw });
    if (tenant.response) return tenant.response;
    const ownership = await assertConversationInHotel(
      tenant.supabase,
      conversationId,
      tenant.allowedHotelIds
    );
    if (ownership.response) return ownership.response;
    const hotelId = ownership.hotelId;

    const hotelWhatsapp = await readHotelWhatsappConfig(hotelId);
    if (!hotelWhatsapp.ok) {
      return NextResponse.json({ error: hotelWhatsapp.error }, { status: 400 });
    }

    const token = readEnv("WHATSAPP_TOKEN", "WHATSAPP_ACCESS_TOKEN", "META_WHATSAPP_TOKEN");
    const graphVersion = readEnv("WHATSAPP_GRAPH_API_VERSION", "META_GRAPH_API_VERSION") || DEFAULT_GRAPH_API_VERSION;
    const phoneNumberId = hotelWhatsapp.phoneNumberId;
    const sender = hotelWhatsapp.sender;

    if (!token) {
      return NextResponse.json(
        { error: "Falta WHATSAPP_TOKEN/WHATSAPP_ACCESS_TOKEN" },
        { status: 500 }
      );
    }

    const to = cloudApiToNumber(toRaw);
    if (!to) {
      return NextResponse.json({ error: "Número destino inválido" }, { status: 400 });
    }

    const whatsappType = validation.whatsappType;
    const isDocument = whatsappType === "document";
    const filename = sanitizeFilename(
      file.name,
      isDocument ? `documento-${Date.now()}.pdf` : `imagen-${Date.now()}.${extensionForMime(file.type)}`
    );
    const storageBucket =
      readEnv("WHATSAPP_MEDIA_BUCKET", "NEXT_PUBLIC_WHATSAPP_MEDIA_BUCKET") || "hotel-media";
    const extension = extensionForMime(file.type);
    const storagePath = `outgoing/${conversationId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    const supabase = getSupabaseServerClient();
    const uploadResult = await supabase.storage.from(storageBucket).upload(storagePath, fileBuffer, {
      contentType: file.type,
      upsert: false,
    });

    if (uploadResult.error) {
      return NextResponse.json({ error: uploadResult.error.message }, { status: 502 });
    }

    const mediaForm = new FormData();
    mediaForm.append("messaging_product", "whatsapp");
    mediaForm.append("file", new Blob([fileBuffer], { type: file.type }), filename);

    const mediaRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: mediaForm,
      }
    );
    const mediaPayload = (await mediaRes.json().catch(() => ({}))) as MetaMediaUploadResponse;
    if (!mediaRes.ok || !mediaPayload.id) {
      return NextResponse.json(
        { error: mediaPayload.error?.message ?? `Meta media respondió ${mediaRes.status}` },
        { status: 502 }
      );
    }

    const mediaObject = isDocument
      ? {
          document: {
            id: mediaPayload.id,
            filename,
            ...(caption ? { caption } : {}),
          },
        }
      : {
          image: {
            id: mediaPayload.id,
            ...(caption ? { caption } : {}),
          },
        };

    const messageRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to,
          type: whatsappType,
          ...mediaObject,
        }),
      }
    );
    const messagePayload = (await messageRes.json().catch(() => ({}))) as MetaMessageResponse;
    if (!messageRes.ok) {
      return NextResponse.json(
        { error: messagePayload.error?.message ?? `Meta messages respondió ${messageRes.status}` },
        { status: 502 }
      );
    }

    const now = nowInColombiaNaive();
    const metaMessageId = messagePayload.messages?.[0]?.id ?? null;
    const insertPayload = {
      created_at: now,
      message: caption || "",
      recipient: normalizePhoneDigits(toRaw),
      sender,
      conversation_id: conversationId,
      ...(clientTempId ? { client_temp_id: clientTempId } : {}),
      ...(hotelId ? { hotel_id: hotelId } : {}),
      direction: "outbound",
      origin: "human",
      format: whatsappType,
      message_type: whatsappType,
      media_storage_path: storagePath,
      media_mime_type: file.type,
      media_caption: caption || null,
      media_filename: filename,
      media_meta_id: mediaPayload.id,
      meta_media_id: mediaPayload.id,
      media_bucket: storageBucket,
      whatsapp_message_id: metaMessageId,
    };

    const insertResult = await insertWubbyRowWithFallback(insertPayload);
    if (insertResult.error) {
      return NextResponse.json(
        { error: insertResult.error.message ?? "No se pudo guardar el mensaje saliente" },
        { status: 502 }
      );
    }

    // Antes este UPDATE no tenía `.select()` ni comprobación: si fallaba, la
    // conversación quedaba en el estado anterior y nadie se enteraba.
    //
    // NO aborta la petición si falla. Llegados acá el archivo ya salió por la
    // API de Meta y la fila de `Wubby_Whatsapp` ya está insertada: responder 502
    // haría que el cliente borre la burbuja optimista (ver el manejo de `!res.ok`
    // en InboxApp) de un mensaje que el huésped SÍ recibió. Se registra el fallo
    // y se devuelve `conversation: null`; el cliente conserva su estado local y
    // Realtime reconcilia.
    const { data: conversationRow, error: conversationError } = await supabase
      .from(CONVERSATIONS_TABLE)
      .update({
        updated_at: now,
        unread_count: 0,
        last_read_at: now,
        needs_human: true,
        ai_active: false,
        status: "human_control",
      })
      .eq("id", conversationId)
      .eq("hotel_id", hotelId)
      .select(CONVERSATION_SELECT_COLUMNS)
      .maybeSingle();

    if (conversationError) {
      console.error("[send-whatsapp-media] update conversación", {
        conversationId,
        hotelId,
        error: conversationError.message,
      });
    } else if (!conversationRow) {
      console.error("[send-whatsapp-media] update conversación sin filas", {
        conversationId,
        hotelId,
      });
    }

    return NextResponse.json({
      ok: true,
      message: insertResult.data,
      // Fila de `conversations` (distinta de `message`, que es la de
      // `Wubby_Whatsapp`): alimenta `applyConversationRowPatch` en el cliente.
      conversation: conversationRow ?? null,
      mediaId: mediaPayload.id,
      whatsappMessageId: metaMessageId,
      mediaStoragePath: storagePath,
      mediaBucket: storageBucket,
      mediaFilename: filename,
      whatsappType,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
