import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import { assertConversationInHotel, requireActiveHotel } from "@/lib/auth/require-hotel";
import { CONVERSATIONS_TABLE } from "@/lib/conversation-schema";
import { buildGuestPhoneOrFilter } from "@/lib/inbox-fetch-messages";
import { WUBBY_TABLE } from "@/lib/wubby-schema";

export const dynamic = "force-dynamic";

const STATUSES_TABLE = "message_statuses";

/**
 * Tope de wamids que se cruzan por petición. El `.in()` viaja en la URL de
 * PostgREST y cada wamid mide 62 caracteres, así que 250 son ~16 KB: entra sin
 * problema y cubre de sobra el tramo del hilo que alguien mira. Se toman los
 * MÁS RECIENTES; los fallos viejos ya no le sirven a recepción.
 */
const MAX_WAMIDS = 250;

type RouteContext = { params: Promise<{ id: string }> };

type MessageStatusRow = {
  wamid: string | null;
  status: string | null;
  error_code: number | null;
  error_title: string | null;
};

/**
 * GET /api/conversations/[id]/message-statuses?hotelId=…
 *
 * Devuelve los acuses de Meta FALLIDOS de los mensajes salientes de una
 * conversación, para que el inbox pueda marcar la burbuja como no entregada.
 *
 * Por qué existe este endpoint y no una query directa desde el navegador:
 * `message_statuses` solo es accesible con la service role, así que el cliente
 * no puede leerla ni con el JWT del usuario.
 *
 * Por qué el cruce va por `wamid` y no por `conversation_id`: en producción esa
 * columna de `message_statuses` viene NULL en el 100 % de las filas y
 * `hotel_id` en un 16 %. La lista de wamids se deriva de `Wubby_Whatsapp`
 * filtrada por el hotel ya autorizado, así que además es el camino tenant-safe:
 * un wamid ajeno nunca entra en el `.in()`.
 *
 * Solo se devuelve `status = 'failed'`. Los acuses sent/delivered/read existen
 * en la tabla, pero el inbox aún pinta ✓/✓✓ contra el estado local del
 * optimista; convertir esos ticks en estado real de Meta es otro cambio.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const conversationId = (await context.params).id?.trim();
    if (!conversationId) {
      return NextResponse.json({ error: "conversationId es obligatorio" }, { status: 400 });
    }

    const tenant = await requireActiveHotel(request, auth.user);
    if (tenant.response) return tenant.response;

    const ownership = await assertConversationInHotel(
      tenant.supabase,
      conversationId,
      tenant.allowedHotelIds
    );
    if (ownership.response) return ownership.response;
    const hotelId = ownership.hotelId;

    const { data: conversation, error: conversationError } = await tenant.supabase
      .from(CONVERSATIONS_TABLE)
      .select("guest_phone")
      .eq("id", conversationId)
      .eq("hotel_id", hotelId)
      .maybeSingle();

    if (conversationError) {
      console.error("[message-statuses] lookup conversación", conversationError.message);
      return NextResponse.json({ error: "No se pudo leer la conversación" }, { status: 502 });
    }

    // El hilo se resuelve por teléfono + hotel (igual que `/api/inbox/messages`):
    // las filas que escribe n8n no traen `conversation_id`.
    const orFilter = buildGuestPhoneOrFilter(String(conversation?.guest_phone ?? ""));
    if (!orFilter) {
      return NextResponse.json({ statuses: [] });
    }

    const { data: wubbyRows, error: wubbyError } = await tenant.supabase
      .from(WUBBY_TABLE)
      .select("wamid")
      .eq("hotel_id", hotelId)
      .or(orFilter)
      .not("wamid", "is", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(MAX_WAMIDS);

    if (wubbyError) {
      console.error("[message-statuses] lookup wamids", wubbyError.message);
      return NextResponse.json({ error: "No se pudieron leer los mensajes" }, { status: 502 });
    }

    const wamids = Array.from(
      new Set(
        (wubbyRows ?? [])
          .map((row) => (typeof row.wamid === "string" ? row.wamid.trim() : ""))
          .filter(Boolean)
      )
    );

    // Sin wamids no hay nada que cruzar. Es el caso ESPERADO en los mensajes
    // históricos y en los hoteles que aún envían por n8n, no un error.
    if (wamids.length === 0) {
      return NextResponse.json({ statuses: [] });
    }

    const { data: statusRows, error: statusError } = await tenant.supabase
      .from(STATUSES_TABLE)
      .select("wamid, status, error_code, error_title")
      .in("wamid", wamids)
      .eq("status", "failed");

    if (statusError) {
      console.error("[message-statuses] lookup statuses", statusError.message);
      return NextResponse.json({ error: "No se pudieron leer los estados" }, { status: 502 });
    }

    const statuses = ((statusRows ?? []) as MessageStatusRow[])
      .filter((row) => typeof row.wamid === "string" && row.wamid.trim())
      .map((row) => ({
        wamid: String(row.wamid).trim(),
        status: row.status ?? "failed",
        errorCode: row.error_code ?? null,
        errorTitle: row.error_title ?? null,
      }));

    return NextResponse.json({ statuses });
  } catch (e) {
    console.error("[message-statuses]", e);
    return NextResponse.json({ error: "Error desconocido" }, { status: 500 });
  }
}
