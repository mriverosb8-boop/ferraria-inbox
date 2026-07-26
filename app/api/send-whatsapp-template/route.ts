import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
} from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { fetchHotelMessageTemplateByName } from "@/lib/message-templates";
import { normalizeColombianWhatsappNumber } from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

const GENERIC_TEMPLATE_ERROR = "No se pudo enviar la plantilla";

/**
 * Mensaje de error del engine para mostrar al usuario. Prioriza
 * `error`/`message`/`detail` del JSON (incluido el anidado de Meta
 * `{ error: { message } }`), que viene curado.
 *
 * Si el cuerpo no es JSON o no trae ninguna de esas claves, devuelve un
 * genérico: el crudo puede ser un stack del engine y NO debe llegar al cliente
 * (queda en el `console.error` del servidor).
 */
function readEngineError(parsed: unknown): string {
  if (parsed && typeof parsed === "object") {
    const record = parsed as Record<string, unknown>;
    for (const key of ["error", "message", "detail"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
      if (value && typeof value === "object") {
        const nested = (value as Record<string, unknown>).message;
        if (typeof nested === "string" && nested.trim()) return nested.trim();
      }
    }
  }
  return GENERIC_TEMPLATE_ERROR;
}

export async function POST(request: Request) {
  try {
    const auth = await requireSessionUser();
    if (auth.response) return auth.response;

    const body = (await request.json()) as {
      to?: string;
      templateName?: string;
      variables?: Record<string, unknown>;
      activeHotelId?: string | null;
      hotelId?: string | null;
    };

    const to = normalizeColombianWhatsappNumber(body.to ?? "");
    const templateName = body.templateName?.trim() ?? "";
    const requestedHotelId =
      (typeof body.activeHotelId === "string" ? body.activeHotelId : body.hotelId)?.trim() ?? "";

    if (!to) {
      return NextResponse.json({ error: "El número de WhatsApp es obligatorio" }, { status: 400 });
    }

    const supabase = getSupabaseServerClient();
    const allowedHotelIds = await resolveAllowedHotelIds(supabase, auth.user);
    const availableHotels = await resolveAvailableHotels(supabase, allowedHotelIds);
    const { activeHotelId, forbidden } = resolveActiveHotelId(
      requestedHotelId,
      allowedHotelIds,
      availableHotels
    );

    if (forbidden) {
      return NextResponse.json({ error: "No autorizado para este hotel" }, { status: 403 });
    }
    if (!activeHotelId) {
      return NextResponse.json({ error: "activeHotelId es obligatorio" }, { status: 400 });
    }

    if (!templateName) {
      return NextResponse.json({ error: "La plantilla es obligatoria" }, { status: 400 });
    }

    const template = await fetchHotelMessageTemplateByName(supabase, activeHotelId, templateName);
    if (!template) {
      return NextResponse.json({ error: "Plantilla no válida para este hotel" }, { status: 400 });
    }

    const variables: Record<string, string> = {};
    for (const variable of template.variables) {
      const value = String(body.variables?.[variable.key] ?? "").trim();
      if (!value) {
        return NextResponse.json(
          { error: `La variable ${variable.key} es obligatoria` },
          { status: 400 }
        );
      }
      variables[variable.key] = value;
    }

    const payload = {
      to,
      templateName,
      activeHotelId,
      ...(template.variables.length > 0 ? { variables } : {}),
    };

    // Sin URL o sin secreto NO hay envío: fallar explícito, nunca caer a un
    // destino por defecto.
    const engineUrl = process.env.ENGINE_SEND_TEMPLATE_URL;
    const sharedSecret = process.env.INBOX_SHARED_SECRET;
    if (!engineUrl || !sharedSecret) {
      console.error(
        "[send-whatsapp-template] faltan ENGINE_SEND_TEMPLATE_URL o INBOX_SHARED_SECRET"
      );
      return NextResponse.json(
        {
          error:
            "Envío no configurado: faltan ENGINE_SEND_TEMPLATE_URL o INBOX_SHARED_SECRET",
        },
        { status: 500 }
      );
    }

    const res = await fetch(engineUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-inbox-secret": sharedSecret,
      },
      body: JSON.stringify(payload),
    });

    // El engine devuelve el resultado real de Meta (n8n devolvía "[object
    // Object]"): lo parseamos para propagar el motivo real del fallo.
    const raw = await res.text().catch(() => "");
    let parsed: unknown = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = null;
    }

    if (!res.ok) {
      console.error("[send-whatsapp-template]", res.status, raw);
      return NextResponse.json({ error: readEngineError(parsed) }, { status: 502 });
    }

    return NextResponse.json({ ok: true, result: parsed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
