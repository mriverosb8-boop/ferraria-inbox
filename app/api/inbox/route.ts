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

/**
 * Tope de conversaciones traídas por actividad. Con ~800 en el hotel más grande
 * y ~26 nuevas por día, la consulta sin acotar cruzaba el tope de página de
 * PostgREST (1000) en unos días y se recortaba EN SILENCIO: 200 OK con la lista
 * incompleta. Este límite es explícito y sabemos exactamente qué deja afuera.
 *
 * No es una página: no hay cursor ni "cargar más". Lo que cae fuera del tope y
 * fuera del set protegido de abajo NO es alcanzable desde la bandeja, porque la
 * búsqueda del cliente filtra el array ya cargado.
 */
const CONVERSATIONS_PAGE_SIZE = 300;

/**
 * Set protegido: conversaciones que no pueden faltar aunque queden fuera del
 * tope por actividad. A propósito MÁS AMPLIO que el chip "Atención" — acá no se
 * clasifica, se garantiza un superconjunto. Traer de más es barato (~37 filas en
 * el hotel más grande, 97 en el de más carga operativa); perder una no.
 *
 * `request` —no `status`— es la columna donde vive `pending`: el dominio de
 * `status` es open / completed / human_control. `human_control` va aparte porque
 * `mapOperationalFromConversationRow` lo clasifica como `requires_attention`.
 */
const PROTECTED_CONVERSATIONS_FILTER = [
  "request.eq.pending",
  "status.eq.human_control",
  "blocked.eq.true",
  "needs_human.eq.true",
  "unread_count.gt.0",
].join(",");

/**
 * Consulta base de bandeja para un hotel: columnas de `conversations` + embed
 * del último mensaje. La comparten la consulta por actividad y la del set
 * protegido, así que el embed y su `limit(1)` no pueden divergir entre las dos.
 */
function buildInboxConversationsQuery(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  hotelId: string
) {
  return supabase
    .from(CONVERSATIONS_TABLE)
    .select(CONVERSATIONS_WITH_LAST_MESSAGE_SELECT)
    .eq("hotel_id", hotelId)
    .order("created_at", { referencedTable: WUBBY_TABLE, ascending: false })
    .order("id", { referencedTable: WUBBY_TABLE, ascending: false })
    .limit(1, { referencedTable: WUBBY_TABLE });
}

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
    total: 0,
    conversationsPageSize: CONVERSATIONS_PAGE_SIZE,
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

    // Independientes entre sí: ninguna necesita el resultado de otra, así que
    // van en paralelo y el GET cuesta un round trip, no tres.
    const [recentResult, protectedResult, totalResult] = await Promise.all([
      // A) Las más recientes por actividad. `sort_activity_at` es la columna
      // generada `coalesce(last_guest_message_at, created_at)`; el orden por
      // `id` desempata para que el corte sea determinista. Ambos los cubre
      // `idx_conversations_hotel_activity`.
      buildInboxConversationsQuery(supabase, activeHotelId)
        .order("sort_activity_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(CONVERSATIONS_PAGE_SIZE),
      // B) El set protegido, sin límite: son decenas de filas y perder una es
      // justamente lo que este tope no puede permitirse.
      buildInboxConversationsQuery(supabase, activeHotelId).or(PROTECTED_CONVERSATIONS_FILTER),
      // Total real del hotel. `head: true` no trae filas, solo el conteo.
      supabase
        .from(CONVERSATIONS_TABLE)
        .select("id", { count: "exact", head: true })
        .eq("hotel_id", activeHotelId),
    ]);

    if (recentResult.error) {
      console.error("[inbox GET] conversations", recentResult.error);
      return NextResponse.json({ error: recentResult.error.message }, { status: 502 });
    }

    if (protectedResult.error) {
      console.error("[inbox GET] conversations protegidas", protectedResult.error);
      return NextResponse.json({ error: protectedResult.error.message }, { status: 502 });
    }

    if (totalResult.error) {
      console.error("[inbox GET] total de conversaciones", totalResult.error);
      return NextResponse.json({ error: totalResult.error.message }, { status: 502 });
    }

    const recentRows = (recentResult.data ?? []) as unknown as ConversationRowWithLastMessage[];
    const protectedRows = (protectedResult.data ??
      []) as unknown as ConversationRowWithLastMessage[];

    // Unión por id. El set protegido se solapa casi por completo con las más
    // recientes (hoy aporta 1 fila nueva en el hotel más grande), así que la
    // dedup no es una optimización: sin ella la misma conversación entraría dos
    // veces y `buildInboxConversations` la duplicaría en la bandeja.
    const rowById = new Map<string, ConversationRowWithLastMessage>();
    for (const row of recentRows) rowById.set(String(row.id), row);
    for (const row of protectedRows) {
      const id = String(row.id);
      if (!rowById.has(id)) rowById.set(id, row);
    }
    const rawRows = [...rowById.values()];

    // El warn ya no vigila la consulta principal: con `CONVERSATIONS_PAGE_SIZE`
    // el recorte es explícito y conocido, y el cliente lo ve comparando
    // `fetchedConversations` contra `total`. Ahora vigila la ÚNICA consulta que
    // sigue sin límite propio, la del set protegido.
    //
    // SIN gate de NODE_ENV a propósito. El cap no produce error: PostgREST
    // corta el resultado y responde 200 OK, así que las conversaciones que
    // faltan no dejan rastro en ningún lado. Este warn es la ÚNICA señal, y el
    // único entorno donde un hotel podría llegar al tope es producción —
    // gatearlo fuera de ella lo apagaba justo donde hace falta.
    //
    // Va a los logs del servidor (Vercel), no a la consola del navegador, y
    // emite solo `hotel_id` y conteos: sin nombres de hotel ni datos de huésped.
    if (protectedRows.length >= POSTGREST_PAGE_SIZE) {
      console.warn("[inbox GET] conversaciones protegidas en el tope de página de PostgREST", {
        hotelId: activeHotelId,
        fetchedProtected: protectedRows.length,
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
      // Reemplaza a `truncated`, que con el tope sería `true` de forma
      // permanente y por lo tanto no informaría nada. `total` es el count real
      // del hotel: con él, `fetchedConversations < total` dice que hay recorte y
      // además CUÁNTO falta, que es lo que un booleano nunca pudo decir.
      total: totalResult.count ?? convRows.length,
      conversationsPageSize: CONVERSATIONS_PAGE_SIZE,
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

    // `returning=representation` con las columnas de bandeja: la fila resultante
    // es POST-update, así que trae también los campos derivados que el `patch` no
    // toca pero que el cliente necesita para recalcular el estado visible (p. ej.
    // `blocked`, que ninguna acción escribe y sin embargo tiene precedencia en
    // `mapOperationalFromConversationRow`). Sigue funcionando como candado de
    // existencia: sin fila, 404.
    const { data: updatedRow, error } = await supabase
      .from(CONVERSATIONS_TABLE)
      .update(patch)
      .eq("id", conversationId)
      .eq("hotel_id", ownership.hotelId)
      .select(CONVERSATION_SELECT_COLUMNS)
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

    // `conversation` permite al cliente aplicar `applyConversationRowPatch` —el
    // mismo handler que consume Realtime— en vez de recargar la bandeja entera.
    return NextResponse.json({
      ok: true,
      conversationId,
      action,
      conversation: updatedRow,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
