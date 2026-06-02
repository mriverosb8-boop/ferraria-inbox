import { NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth/require-user";
import {
  resolveActiveHotelId,
  resolveAllowedHotelIds,
  resolveAvailableHotels,
} from "@/lib/inbox-tenant";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import {
  getWhatsappTemplate,
  normalizeColombianWhatsappNumber,
  type WhatsappTemplateVariables,
} from "@/lib/whatsapp-templates";

export const dynamic = "force-dynamic";

const DEFAULT_TEMPLATE_WEBHOOK_URL =
  "https://asistentehotelero.com/webhook/enviar-plantilla-whatsapp";

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

    const template = getWhatsappTemplate(templateName);
    if (!template) {
      return NextResponse.json({ error: "Plantilla no válida" }, { status: 400 });
    }

    const variables: WhatsappTemplateVariables = {};
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

    const webhook =
      process.env.N8N_WHATSAPP_TEMPLATE_WEBHOOK_URL ?? DEFAULT_TEMPLATE_WEBHOOK_URL;

    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.error("[send-whatsapp-template]", res.status, text);
      return NextResponse.json(
        { error: `Webhook respondió ${res.status}`, detail: text.slice(0, 500) },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error desconocido";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
