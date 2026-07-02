export async function sendWhatsappTemplate(payload: {
  to: string;
  /** Nombre de la plantilla en Meta (columna `name` de `message_templates`). */
  templateName: string;
  activeHotelId: string;
  variables?: Record<string, string>;
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
