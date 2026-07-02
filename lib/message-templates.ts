import type { SupabaseClient } from "@supabase/supabase-js";

/** Tabla `message_templates`: plantillas de WhatsApp por hotel. */
export const MESSAGE_TEMPLATES_TABLE = "message_templates";

/** Variable de una plantilla (se completa antes de enviar). */
export type TemplateVariable = {
  key: string;
  label: string;
  placeholder: string;
};

/** Plantilla lista para la UI (derivada de una fila de `message_templates`). */
export type MessageTemplate = {
  id: string;
  /** Nombre de la plantilla en Meta: es lo que se manda al webhook de envío. */
  name: string;
  /** Etiqueta visible en el selector. */
  title: string;
  languageCode: string;
  category: string;
  bodyTemplate: string;
  footer: string | null;
  variables: TemplateVariable[];
};

export type MessageTemplateRow = {
  id: string;
  hotel_id: string;
  name: string;
  title: string;
  language_code: string;
  category: string;
  body_template: string;
  footer: string | null;
  variables: unknown;
  is_active: boolean;
};

/**
 * Parseo defensivo del jsonb `variables`. Soporta:
 *  - shape de Meta/posicional: `{ label, example, position }` (el usado en la DB)
 *  - shape explícito: `{ key | name, label, placeholder }`
 *  - strings sueltos: `["Nombre", "Fecha", ...]`
 *
 * `key` es el identificador que viaja en el payload de envío. Para plantillas
 * posicionales de Meta se usa el número de `position` (1, 2, 3…), que es lo que
 * espera el body de la plantilla (`{{1}}`, `{{2}}`, …).
 */
export function parseTemplateVariables(raw: unknown): TemplateVariable[] {
  if (!Array.isArray(raw)) return [];

  const out: TemplateVariable[] = [];
  raw.forEach((item, index) => {
    if (typeof item === "string") {
      const label = item.trim();
      if (label) out.push({ key: String(index + 1), label, placeholder: "" });
      return;
    }
    if (!item || typeof item !== "object") return;
    const rec = item as Record<string, unknown>;

    const key =
      typeof rec.key === "string" && rec.key.trim()
        ? rec.key.trim()
        : typeof rec.name === "string" && rec.name.trim()
          ? rec.name.trim()
          : typeof rec.position === "number" && Number.isFinite(rec.position)
            ? String(rec.position)
            : String(index + 1);

    const label = typeof rec.label === "string" && rec.label.trim() ? rec.label.trim() : key;

    const placeholder =
      typeof rec.placeholder === "string" && rec.placeholder.trim()
        ? rec.placeholder.trim()
        : typeof rec.example === "string" && rec.example.trim()
          ? `Ej: ${rec.example.trim()}`
          : "";

    out.push({ key, label, placeholder });
  });

  return out;
}

export function mapMessageTemplateRow(row: MessageTemplateRow): MessageTemplate {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    languageCode: row.language_code,
    category: row.category,
    bodyTemplate: row.body_template,
    footer: row.footer,
    variables: parseTemplateVariables(row.variables),
  };
}

const TEMPLATE_COLUMNS =
  "id, hotel_id, name, title, language_code, category, body_template, footer, variables, is_active";

/** Plantillas activas de un hotel, ordenadas por título. */
export async function fetchHotelMessageTemplates(
  supabase: SupabaseClient,
  hotelId: string
): Promise<MessageTemplate[]> {
  const { data, error } = await supabase
    .from(MESSAGE_TEMPLATES_TABLE)
    .select(TEMPLATE_COLUMNS)
    .eq("hotel_id", hotelId)
    .eq("is_active", true)
    .order("title", { ascending: true });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => mapMessageTemplateRow(row as MessageTemplateRow));
}

/** Una plantilla activa por `name` dentro de un hotel (para validar el envío). */
export async function fetchHotelMessageTemplateByName(
  supabase: SupabaseClient,
  hotelId: string,
  name: string
): Promise<MessageTemplate | null> {
  const { data, error } = await supabase
    .from(MESSAGE_TEMPLATES_TABLE)
    .select(TEMPLATE_COLUMNS)
    .eq("hotel_id", hotelId)
    .eq("name", name)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapMessageTemplateRow(data as MessageTemplateRow) : null;
}
