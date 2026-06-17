/** Bandeja: GET fusiona `conversations` + mensajes `Wubby_Whatsapp`; PATCH actualiza solo `conversations`. */
import { NextResponse } from "next/server";
import { getConversationDisplayActivityMs, mergeConversationsTableWithMessages } from "@/lib/chat-utils";
import {
  buildHotelWhatsappByIdMap,
  hotelWhatsappMapToRecord,
} from "@/lib/hotel-whatsapp-map";
import { fetchAllWubbyRowsForHotel } from "@/lib/inbox-fetch-messages";
import { buildReactivateAiFields } from "@/lib/inbox-patch";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
  type AvailableHotel,
} from "@/lib/inbox-tenant";
import {
  CONVERSATIONS_TABLE,
  type ConversationDbRow,
  type InboxPatchAction,
} from "@/lib/conversation-schema";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel } from "@/lib/auth/require-hotel";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { MESSAGES_LIMIT } from "@/lib/message-limits";

export const dynamic = "force-dynamic";

const HOTELS_TABLE = "hotels";

function emptyInboxResponse(availableHotels: AvailableHotel[] = [], activeHotelId: string | null = null) {
  return NextResponse.json({
    conversations: [],
    fetchedConversations: 0,
    fetchedMessages: 0,
    messageLimit: MESSAGES_LIMIT,
    availableHotels,
    activeHotelId,
    hotelWhatsappById: {},
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

    console.log("[inbox GET] tenant access", {
      userId: auth.user.id,
      email: auth.user.email,
      allowedHotelIds,
      availableHotels,
      activeHotelId,
      requestedHotelId: requestedHotelId || null,
    });

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
      .select("*")
      .eq("hotel_id", activeHotelId)
      .order("updated_at", { ascending: false });

    if (convResult.error) {
      console.error("[inbox GET] conversations", convResult.error);
      return NextResponse.json({ error: convResult.error.message }, { status: 502 });
    }

    let msgRows;
    try {
      msgRows = await fetchAllWubbyRowsForHotel(supabase, activeHotelId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al cargar mensajes";
      console.error("[inbox GET] messages", e);
      return NextResponse.json({ error: msg }, { status: 502 });
    }

    const convRows = (convResult.data ?? []) as ConversationDbRow[];

    const conversations = mergeConversationsTableWithMessages(convRows, msgRows, {
      hotelWhatsappById,
      messageLimit: MESSAGES_LIMIT,
    });
    conversations.sort((a, b) => {
      return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
    });

    return NextResponse.json({
      conversations,
      fetchedConversations: convRows.length,
      fetchedMessages: msgRows.length,
      messageLimit: MESSAGES_LIMIT,
      availableHotels,
      activeHotelId,
      hotelWhatsappById: hotelWhatsappMapToRecord(hotelWhatsappById),
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
      action !== "mark_read"
    ) {
      return NextResponse.json(
        {
          error:
            "action debe ser human_control, reactivate_ai, completed, resolve_request, reopen o mark_read",
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
