import { NextResponse } from "next/server";
import { requireActiveHotel } from "@/lib/auth/require-hotel";
import { requireSessionUser } from "@/lib/auth/require-user";
import {
  STAFF_CONTACTS_TABLE,
  STAFF_CONTACT_COLUMNS,
  STAFF_CONTACT_NAME_MAX,
  STAFF_CONTACT_ROLE_MAX,
  mapStaffContactRow,
  type StaffContactDbRow,
} from "@/lib/staff-contacts";
import {
  logStaffContactFailure,
  notifyEngineStaffContactsChanged,
  staffContactDbErrorResponse,
} from "@/lib/staff-contacts-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Edita nombre/cargo y activa o desactiva un contacto de staff.
 *
 * NO hay DELETE: dar de baja es `is_active = false`, así el histórico de
 * clasificación de conversaciones sigue teniendo a quién apuntar.
 *
 * El teléfono NO se edita acá: cambiarlo es dar de baja el contacto viejo y
 * crear uno nuevo, para no romper el UNIQUE (hotel_id, phone) ni dejar
 * conversaciones ya clasificadas apuntando a un número que cambió.
 *
 * Doble candado en el UPDATE: `.eq("id", …)` + `.eq("hotel_id", activeHotelId)`.
 * Con la service role, un `id` de otro hotel sin el segundo `.eq` sería una
 * escritura cruzada entre tenants.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const contactId = (await context.params).id?.trim();
    if (!contactId) {
      return NextResponse.json({ error: "El id del contacto es obligatorio" }, { status: 400 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      hotelId?: string | null;
      activeHotelId?: string | null;
      name?: string;
      role?: string | null;
      isActive?: boolean;
    };

    const requestedHotelId =
      (typeof body.activeHotelId === "string" ? body.activeHotelId : body.hotelId)?.trim() ?? "";

    const tenant = await requireActiveHotel(request, auth.user, { requestedHotelId });
    if (tenant.response) return tenant.response;
    if (!tenant.activeHotelId) {
      return NextResponse.json({ error: "hotelId es obligatorio" }, { status: 400 });
    }

    const patch: Record<string, unknown> = {};

    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) {
        return NextResponse.json({ error: "El nombre es obligatorio" }, { status: 400 });
      }
      if (name.length > STAFF_CONTACT_NAME_MAX) {
        return NextResponse.json(
          { error: `El nombre no puede pasar de ${STAFF_CONTACT_NAME_MAX} caracteres` },
          { status: 400 }
        );
      }
      patch.name = name;
    }

    if (body.role !== undefined) {
      const role = body.role === null ? "" : String(body.role).trim();
      if (role.length > STAFF_CONTACT_ROLE_MAX) {
        return NextResponse.json(
          { error: `El cargo no puede pasar de ${STAFF_CONTACT_ROLE_MAX} caracteres` },
          { status: 400 }
        );
      }
      patch.role = role || null;
    }

    if (body.isActive !== undefined) {
      if (typeof body.isActive !== "boolean") {
        return NextResponse.json({ error: "isActive debe ser booleano" }, { status: 400 });
      }
      patch.is_active = body.isActive;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "No hay cambios que guardar" }, { status: 400 });
    }

    // La tabla no tiene trigger de `updated_at`: lo mantiene esta route.
    patch.updated_at = new Date().toISOString();

    const { data, error } = await tenant.supabase
      .from(STAFF_CONTACTS_TABLE)
      .update(patch)
      .eq("id", contactId)
      .eq("hotel_id", tenant.activeHotelId)
      .select(STAFF_CONTACT_COLUMNS)
      .maybeSingle();

    if (error) {
      return staffContactDbErrorResponse("[staff-contacts PATCH]", error);
    }
    if (!data) {
      return NextResponse.json({ error: "Contacto no encontrado" }, { status: 404 });
    }

    // Fire-and-forget: si el engine no responde, el TTL de su cache lo cubre.
    await notifyEngineStaffContactsChanged(tenant.activeHotelId);

    return NextResponse.json({
      ok: true,
      contact: mapStaffContactRow(data as StaffContactDbRow),
    });
  } catch (e) {
    logStaffContactFailure("[staff-contacts PATCH]", e);
    return NextResponse.json({ error: "No se pudo actualizar el contacto" }, { status: 500 });
  }
}
