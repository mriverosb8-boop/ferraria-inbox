/** Bandeja: GET fusiona `conversations` + mensajes `Wubby_Whatsapp`; PATCH actualiza solo `conversations`. */
import { NextResponse } from "next/server";
import { buildInboxConversations, getConversationDisplayActivityMs } from "@/lib/chat-utils";
import {
  buildHotelWhatsappByIdMap,
  hotelWhatsappMapToRecord,
} from "@/lib/hotel-whatsapp-map";
import { buildReactivateAiFields } from "@/lib/inbox-patch";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
  type AvailableHotel,
} from "@/lib/inbox-tenant";
import {
  CONVERSATIONS_TABLE,
  CONVERSATION_SELECT_COLUMNS,
  GUEST_NAME_MAX_LENGTH,
  type ConversationDbRow,
  type InboxPatchAction,
} from "@/lib/conversation-schema";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel } from "@/lib/auth/require-hotel";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { MESSAGES_LIMIT, POSTGREST_PAGE_SIZE } from "@/lib/message-limits";
import { WUBBY_PREVIEW_COLUMNS, WUBBY_TABLE, type WubbyWhatsappRow } from "@/lib/wubby-schema";

export const dynamic = "force-dynamic";

const HOTELS_TABLE = "hotels";

/**
 * Embedding PostgREST: cada fila de `conversations` con su ÚLTIMO mensaje.
 * Junto al `.order(...)` + `.limit(1, { referencedTable })` de abajo equivale a
 * un `distinct on (conversation_id)`, que el cliente supabase-js no sabe emitir.
 * Se apoya en el FK `wubby_conversation_id_fkey` y en el índice
 * `idx_wubby_conv_recent (conversation_id, created_at DESC, id DESC)`.
 */
const CONVERSATIONS_WITH_LAST_MESSAGE_SELECT = `${CONVERSATION_SELECT_COLUMNS}, ${WUBBY_TABLE}(${WUBBY_PREVIEW_COLUMNS})`;

/** Fila de `conversations` con el array embebido (0 o 1 elementos). */
type ConversationRowWithLastMessage = ConversationDbRow & {
  Wubby_Whatsapp?: WubbyWhatsappRow[] | null;
};

function emptyInboxResponse(availableHotels: AvailableHotel[] = [], activeHotelId: string | null = null) {
  return NextResponse.json({
    conversations: [],
    fetchedConversations: 0,
    // La bandeja ya no embarca historial: el hilo se pide aparte a
    // GET /api/inbox/messages. Se mantiene el campo para no romper el contrato.
    fetchedMessages: 0,
    messageLimit: MESSAGES_LIMIT,
    availableHotels,
    activeHotelId,
    hotelWhatsappById: {},
    truncated: false,
  });
}

export async function GET(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const supabase = getSupabaseServerClient();
    const allowedHotelIds = await resolveAllowedHotelIds(supabase, auth.user);
    const requestedHotelId = new URL(request.url).searchParams.get("hotelId")?.trim() ?? "";
    const availableHotels = await resolveAvailableHotels(supabase, allowedHotelIds);
    const { activeHotelId, forbidden } = resolveActiveHotelId(
      requestedHotelId,
      allowedHotelIds,
      availableHotels
    );

    // Sin PII: `userId` / `email` se emitían en CADA GET, incluidos los refetch
    // silenciosos. Y solo fuera de producción, con conteos en vez de los arrays
    // completos de hoteles.
    if (process.env.NODE_ENV !== "production") {
      console.log("[inbox GET] tenant access", {
        allowedHotelCount: allowedHotelIds.length,
        availableHotelCount: availableHotels.length,
        activeHotelId,
        requestedHotelId: requestedHotelId || null,
      });
    }

    if (forbidden) {
      return NextResponse.json({ error: "No autorizado para ver este hotel" }, { status: 403 });
    }

    if (allowedHotelIds.length === 0 || !activeHotelId) {
      return emptyInboxResponse(availableHotels, activeHotelId);
    }

    const { data: hotelWaRows, error: hotelWaError } = await supabase
      .from(HOTELS_TABLE)
      .select("id, whatsapp_number")
      .in("id", allowedHotelIds);

    if (hotelWaError) {
      console.error("[inbox GET] hotels whatsapp", hotelWaError);
      return NextResponse.json({ error: hotelWaError.message }, { status: 502 });
    }

    const hotelWhatsappById = buildHotelWhatsappByIdMap(hotelWaRows ?? []);

    const convResult = await supabase
      .from(CONVERSATIONS_TABLE)
      .select(CONVERSATIONS_WITH_LAST_MESSAGE_SELECT)
      .eq("hotel_id", activeHotelId)
      .order("updated_at", { ascending: false })
      .order("created_at", { referencedTable: WUBBY_TABLE, ascending: false })
      .order("id", { referencedTable: WUBBY_TABLE, ascending: false })
      .limit(1, { referencedTable: WUBBY_TABLE });

    if (convResult.error) {
      console.error("[inbox GET] conversations", convResult.error);
      return NextResponse.json({ error: convResult.error.message }, { status: 502 });
    }

    const rawRows = (convResult.data ?? []) as unknown as ConversationRowWithLastMessage[];

    // Esta query no pagina: si el hotel supera el tope de página de PostgREST,
    // la respuesta se recorta EN SILENCIO y faltarían conversaciones en la
    // bandeja. Barranquilla ya va por 743.
    if (process.env.NODE_ENV !== "production" && rawRows.length >= POSTGREST_PAGE_SIZE) {
      console.warn("[inbox GET] conversations en el tope de página de PostgREST", {
        activeHotelId,
        fetched: rawRows.length,
        pageSize: POSTGREST_PAGE_SIZE,
      });
    }

    const convRows: ConversationDbRow[] = [];
    const lastMessageByConversationId = new Map<string, WubbyWhatsappRow>();

    for (const raw of rawRows) {
      const { Wubby_Whatsapp: embedded, ...conv } = raw;
      convRows.push(conv as ConversationDbRow);
      const lastRow = Array.isArray(embedded) ? embedded[0] : null;
      if (lastRow) {
        lastMessageByConversationId.set(String(conv.id), lastRow);
      }
    }

    const conversations = buildInboxConversations(convRows, lastMessageByConversationId);
    conversations.sort((a, b) => {
      return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
    });

    return NextResponse.json({
      conversations,
      fetchedConversations: convRows.length,
      // Cero por diseño: la bandeja ya no embarca historial.
      fetchedMessages: 0,
      messageLimit: MESSAGES_LIMIT,
      availableHotels,
      activeHotelId,
      hotelWhatsappById: hotelWhatsappMapToRecord(hotelWhatsappById),
      // Sin barrido paginado no hay nada que truncar; el campo se mantiene
      // porque ya forma parte del contrato de la respuesta.
      truncated: false,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    console.error("[inbox GET]", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const body = (await request.json()) as {
      conversationId?: string;
      action?: InboxPatchAction;
      guestName?: string;
    };

    const conversationId = body.conversationId?.trim();
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId es obligatorio" }, { status: 400 });
    }

    const action = body.action;
    if (
      action !== "human_control" &&
      action !== "reactivate_ai" &&
      action !== "completed" &&
      action !== "resolve_request" &&
      action !== "reopen" &&
      action !== "mark_read" &&
      action !== "rename"
    ) {
      return NextResponse.json(
        {
          error:
            "action debe ser human_control, reactivate_ai, completed, resolve_request, reopen, mark_read o rename",
        },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    let patch: Record<string, unknown> = { updated_at: now };

    switch (action) {
      case "human_control":
        patch = {
          ...patch,
          needs_human: true,
          ai_active: false,
          status: "human_control",
        };
        break;
      case "reactivate_ai":
        patch = {
          ...patch,
          ...buildReactivateAiFields(now),
          status: "open",
        };
        break;
      case "completed":
        patch = {
          ...patch,
          ...buildReactivateAiFields(now),
          request: null,
          status: "completed",
        };
        break;
      case "resolve_request":
        patch = {
          ...patch,
          request: null,
        };
        break;
      case "reopen":
        // Inversa de `completed`: reabrir pone `status = 'open'` y respeta
        // `ai_active` / `needs_human` dejados al cerrar (p. ej. IA reactivada).
        patch = {
          ...patch,
          status: "open",
        };
        break;
      case "mark_read":
        patch = {
          ...patch,
          unread_count: 0,
          last_read_at: now,
        };
        break;
      case "rename": {
        const guestName = typeof body.guestName === "string" ? body.guestName.trim() : "";
        if (!guestName) {
          return NextResponse.json(
            { error: "El nombre del huésped no puede estar vacío" },
            { status: 400 }
          );
        }
        if (guestName.length > GUEST_NAME_MAX_LENGTH) {
          return NextResponse.json(
            { error: `El nombre no puede superar ${GUEST_NAME_MAX_LENGTH} caracteres` },
            { status: 400 }
          );
        }
        patch = {
          ...patch,
          guest_name: guestName,
        };
        break;
      }
      default:
        return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();

    // Ownership obligatorio para TODAS las acciones: deriva el hotel de la
    // conversación y valida que pertenezca a un hotel permitido del usuario.
    const allowedHotelIds = await resolveAllowedHotelIds(supabase, auth.user);
    const ownership = await assertConversationInHotel(supabase, conversationId, allowedHotelIds);
    if (ownership.response) return ownership.response;

    const { data: updatedRow, error } = await supabase
      .from(CONVERSATIONS_TABLE)
      .update(patch)
      .eq("id", conversationId)
      .eq("hotel_id", ownership.hotelId)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("[inbox PATCH]", error);
      return NextResponse.json(
        { error: error.message || "No se pudo actualizar la conversación" },
        { status: 502 }
      );
    }
    if (!updatedRow) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, conversationId, action });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
