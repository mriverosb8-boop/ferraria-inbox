import type {
  WhatsappTemplateName,
  WhatsappTemplateVariables,
} from "@/lib/whatsapp-templates";

export async function sendWhatsappTemplate(payload: {
  to: string;
  templateName: WhatsappTemplateName;
  activeHotelId: string;
  variables?: WhatsappTemplateVariables;
}): Promise<void> {
  const res = await fetch("/api/send-whatsapp-template", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error("No se pudo enviar la plantilla");
  }
}
