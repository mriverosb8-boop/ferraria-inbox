import { NextResponse } from "next/server";
import { requireActiveHotel } from "@/lib/auth/require-hotel";
import { requireSessionUser } from "@/lib/auth/require-user";
import {
  STAFF_CONTACTS_TABLE,
  STAFF_CONTACT_COLUMNS,
  STAFF_CONTACT_NAME_MAX,
  STAFF_CONTACT_ROLE_MAX,
  mapStaffContactRow,
  normalizeStaffPhone,
  type StaffContactDbRow,
} from "@/lib/staff-contacts";
import {
  logStaffContactFailure,
  notifyEngineStaffContactsChanged,
  staffContactDbErrorResponse,
} from "@/lib/staff-contacts-server";

export const dynamic = "force-dynamic";

/**
 * Contactos del personal del hotel activo.
 *
 * Gate en orden: `requireSessionUser` → `requireActiveHotel` → todo query con
 * `.eq("hotel_id", activeHotelId)`. El cliente de `requireActiveHotel` es el de
 * service role (omite RLS), así que el filtro por hotel es el único aislamiento
 * real y va en el query mismo, nunca en el post-filtrado.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const tenant = await requireActiveHotel(request, auth.user, {
      capability: "verConversacionesHuespedes",
    });
    if (tenant.response) return tenant.response;
    if (!tenant.activeHotelId) {
      return NextResponse.json({ contacts: [], activeHotelId: null });
    }

    const { data, error } = await tenant.supabase
      .from(STAFF_CONTACTS_TABLE)
      .select(STAFF_CONTACT_COLUMNS)
      .eq("hotel_id", tenant.activeHotelId)
      .order("is_active", { ascending: false })
      .order("name", { ascending: true });

    if (error) {
      return staffContactDbErrorResponse("[staff-contacts GET]", error);
    }

    const contacts = ((data ?? []) as StaffContactDbRow[]).map(mapStaffContactRow);
    return NextResponse.json({ contacts, activeHotelId: tenant.activeHotelId });
  } catch (e) {
    logStaffContactFailure("[staff-contacts GET]", e);
    return NextResponse.json({ error: "No se pudieron cargar los contactos" }, { status: 500 });
  }
}

/** Crea un contacto de staff en el hotel activo. */
export async function POST(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const body = (await request.json().catch(() => ({}))) as {
      hotelId?: string | null;
      activeHotelId?: string | null;
      name?: string;
      phone?: string;
      role?: string | null;
    };

    const requestedHotelId =
      (typeof body.activeHotelId === "string" ? body.activeHotelId : body.hotelId)?.trim() ?? "";

    const tenant = await requireActiveHotel(request, auth.user, {
      requestedHotelId,
      capability: "verConversacionesHuespedes",
    });
    if (tenant.response) return tenant.response;
    if (!tenant.activeHotelId) {
      return NextResponse.json({ error: "hotelId es obligatorio" }, { status: 400 });
    }

    const name = (body.name ?? "").trim();
    if (!name) {
      return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
    }
    if (name.length > STAFF_CONTACT_NAME_MAX) {
      return NextResponse.json(
        { error: `El nombre no puede pasar de ${STAFF_CONTACT_NAME_MAX} caracteres` },
        { status: 400 }
      );
    }

    // La normalización es del servidor: el navegador puede mandar '+57', espacios
    // o guiones y acá queda en el formato exacto que exige el CHECK de la tabla.
    const phone = normalizeStaffPhone(body.phone ?? "");
    if (!phone) {
      return NextResponse.json(
        { error: "El número no es válido. Usa el formato con indicativo, ej: +57 300 123 4567" },
        { status: 400 }
      );
    }

    const roleRaw = (body.role ?? "").trim();
    if (roleRaw.length > STAFF_CONTACT_ROLE_MAX) {
      return NextResponse.json(
        { error: `El cargo no puede pasar de ${STAFF_CONTACT_ROLE_MAX} caracteres` },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const { data, error } = await tenant.supabase
      .from(STAFF_CONTACTS_TABLE)
      .insert({
        hotel_id: tenant.activeHotelId,
        name,
        phone,
        role: roleRaw || null,
        is_active: true,
        updated_at: now,
      })
      .select(STAFF_CONTACT_COLUMNS)
      .maybeSingle();

    if (error) {
      return staffContactDbErrorResponse("[staff-contacts POST]", error);
    }
    if (!data) {
      return NextResponse.json({ error: "No se pudo guardar el contacto" }, { status: 502 });
    }

    // Fire-and-forget: si el engine no responde, el TTL de su cache lo cubre.
    await notifyEngineStaffContactsChanged(tenant.activeHotelId);

    return NextResponse.json({
      ok: true,
      contact: mapStaffContactRow(data as StaffContactDbRow),
    });
  } catch (e) {
    logStaffContactFailure("[staff-contacts POST]", e);
    return NextResponse.json({ error: "No se pudo guardar el contacto" }, { status: 500 });
  }
}
