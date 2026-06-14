import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { CONVERSATIONS_TABLE } from "@/lib/conversation-schema";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
  type AvailableHotel,
} from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";

/**
 * Resuelve el hotel activo de la petición y valida que el usuario tenga acceso.
 *
 * Idioma `{ response }` igual que `requireSessionUser`: si `response !== null`,
 * devuélvela tal cual (403 forbidden). El caso "sin hotel activo" NO es un error
 * aquí: se expone como `activeHotelId: null` para que cada endpoint decida su
 * política (400 "hotelId obligatorio" vs. 200 con lista vacía).
 *
 * El `hotelId` pedido puede venir de fuentes distintas (query `?hotelId`, body,
 * formData); por eso `options.requestedHotelId` permite inyectarlo. Si se omite,
 * se lee de `?hotelId`.
 */
export type ActiveHotelResult = {
  response: NextResponse | null;
  supabase: SupabaseClient;
  allowedHotelIds: string[];
  availableHotels: AvailableHotel[];
  activeHotelId: string | null;
};

export async function requireActiveHotel(
  request: Request,
  user: User,
  options?: { requestedHotelId?: string }
): Promise<ActiveHotelResult> {
  const supabase = getSupabaseServerClient();
  const allowedHotelIds = await resolveAllowedHotelIds(supabase, user);

  const requestedHotelId = (
    options?.requestedHotelId ??
    new URL(request.url).searchParams.get("hotelId") ??
    ""
  ).trim();

  const availableHotels = await resolveAvailableHotels(supabase, allowedHotelIds);
  const { activeHotelId, forbidden } = resolveActiveHotelId(
    requestedHotelId,
    allowedHotelIds,
    availableHotels
  );

  if (forbidden) {
    return {
      response: NextResponse.json(
        { error: "No autorizado para ver este hotel" },
        { status: 403 }
      ),
      supabase,
      allowedHotelIds,
      availableHotels,
      activeHotelId: null,
    };
  }

  return { response: null, supabase, allowedHotelIds, availableHotels, activeHotelId };
}

/**
 * Confirma que una fila (`id`) pertenece a un hotel permitido, derivando el
 * `hotel_id` de la propia fila. Útil cuando conocemos el `id` pero el cliente no
 * envía `hotelId`. Devuelve el `hotelId` real para usarlo como doble candado en
 * el `update().eq("hotel_id", hotelId)` posterior.
 */
export type HotelOwnershipResult =
  | { response: NextResponse; hotelId: null }
  | { response: null; hotelId: string };

export async function assertRowInAllowedHotel(
  supabase: SupabaseClient,
  table: string,
  id: string,
  allowedHotelIds: string[]
): Promise<HotelOwnershipResult> {
  const { data, error } = await supabase
    .from(table)
    .select("id, hotel_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return {
      response: NextResponse.json({ error: error.message }, { status: 502 }),
      hotelId: null,
    };
  }
  if (!data) {
    return {
      response: NextResponse.json({ error: "Recurso no encontrado" }, { status: 404 }),
      hotelId: null,
    };
  }

  const hotelId = data.hotel_id != null ? String(data.hotel_id).trim() : "";
  if (!hotelId || !allowedHotelIds.includes(hotelId)) {
    return {
      response: NextResponse.json({ error: "No autorizado para este hotel" }, { status: 403 }),
      hotelId: null,
    };
  }

  return { response: null, hotelId };
}

/** Alias conveniente de `assertRowInAllowedHotel` para la tabla `conversations`. */
export function assertConversationInHotel(
  supabase: SupabaseClient,
  id: string,
  allowedHotelIds: string[]
): Promise<HotelOwnershipResult> {
  return assertRowInAllowedHotel(supabase, CONVERSATIONS_TABLE, id, allowedHotelIds);
}
