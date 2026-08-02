import { normalizeColombianWhatsappNumber } from "@/lib/whatsapp-templates";

/**
 * Contactos del personal del hotel (`staff_contacts`).
 *
 * La tabla nace con la RLS cerrada: SOLO política de SELECT por tenant
 * (`user_hotel_ids()`), cero políticas de escritura. Por eso todo INSERT/UPDATE
 * pasa por las routes de `/app/api/staff-contacts/**` con la service role, y
 * cada una repite el gate de tenancy a mano
 * (`requireSessionUser` + `requireActiveHotel` + `.eq("hotel_id", ...)`).
 *
 * No hay borrado duro: desactivar es `is_active = false`.
 */
export const STAFF_CONTACTS_TABLE = "staff_contacts";

/**
 * Plantilla fija con la que la recepción reabre la ventana de 24 h contra un
 * contacto de STAFF (no huésped). Se envía directo, sin selector.
 *
 * ⚠️ Este string tiene que coincidir LETRA POR LETRA con:
 *   1. el nombre de la plantilla aprobada en Meta, y
 *   2. la columna `name` de su fila en `message_templates` del hotel.
 *
 * Si a un hotel le falta esa fila, `POST /api/send-whatsapp-template` responde
 * "Plantilla no válida para este hotel" y el botón muestra un aviso explicando
 * exactamente eso. Se asume SIN variables: si la fila del hotel declara alguna,
 * el envío va a fallar pidiéndola.
 */
export const STAFF_CONTACT_TEMPLATE_NAME = "contactar_staff";

/** Límite del CHECK de la columna `name` en la base. */
export const STAFF_CONTACT_NAME_MAX = 120;
/** No hay CHECK en `role`, pero acotamos para no depender de un fallo del motor. */
export const STAFF_CONTACT_ROLE_MAX = 120;

export type StaffContact = {
  id: string;
  hotelId: string;
  phone: string;
  name: string;
  role: string | null;
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
};

export type StaffContactDbRow = {
  id: string;
  hotel_id: string;
  phone: string;
  name: string;
  role: string | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

/** Columnas que devolvemos al cliente (evita filtrar columnas nuevas sin querer). */
export const STAFF_CONTACT_COLUMNS =
  "id, hotel_id, phone, name, role, is_active, created_at, updated_at";

export function mapStaffContactRow(row: StaffContactDbRow): StaffContact {
  return {
    id: String(row.id),
    hotelId: String(row.hotel_id),
    phone: String(row.phone ?? ""),
    name: String(row.name ?? ""),
    role: row.role?.trim() ? row.role.trim() : null,
    isActive: row.is_active !== false,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

/**
 * El CHECK de la columna `phone`: solo dígitos, 8 a 15, sin `+` y con
 * indicativo de país.
 */
const PHONE_PATTERN = /^[0-9]{8,15}$/;

/**
 * Normaliza el teléfono en el SERVIDOR (nunca confiamos en lo que teclea el
 * usuario): quita `+`, espacios, guiones y paréntesis, y antepone `57` a los
 * celulares colombianos de 10 dígitos que empiezan en 3.
 *
 * Devuelve `null` si el resultado no cumple el CHECK de la base, para responder
 * un 400 claro en vez de dejar reventar al motor con un 23514.
 */
export function normalizeStaffPhone(value: string): string | null {
  const digits = normalizeColombianWhatsappNumber(value ?? "");
  return PHONE_PATTERN.test(digits) ? digits : null;
}

/** Formato legible para la UI: `+57 300 123 4567` (best-effort, sin librerías). */
export function formatStaffPhone(phone: string): string {
  if (!/^\d+$/.test(phone)) return phone;
  if (phone.length === 12 && phone.startsWith("57")) {
    return `+57 ${phone.slice(2, 5)} ${phone.slice(5, 8)} ${phone.slice(8)}`;
  }
  return `+${phone}`;
}

/*
 * El aviso de invalidación al engine vive en `lib/staff-contacts-server.ts`:
 * este módulo lo importa también el modal del navegador y no debe arrastrar
 * código de servidor al bundle del cliente.
 */
