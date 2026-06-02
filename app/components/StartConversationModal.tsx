"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { sendWhatsappTemplate } from "@/lib/send-whatsapp-template";
import {
  getWhatsappTemplate,
  normalizeColombianWhatsappNumber,
  WHATSAPP_TEMPLATES,
  type WhatsappTemplateName,
  type WhatsappTemplateVariables,
} from "@/lib/whatsapp-templates";

type StartConversationModalProps = {
  open: boolean;
  activeHotelId: string | null;
  onClose: () => void;
  onSuccess: () => void;
  onError: () => void;
};

export function StartConversationModal({
  open,
  activeHotelId,
  onClose,
  onSuccess,
  onError,
}: StartConversationModalProps) {
  const [phone, setPhone] = useState("");
  const [templateName, setTemplateName] = useState<WhatsappTemplateName>(
    WHATSAPP_TEMPLATES[0].value
  );
  const [templateVariables, setTemplateVariables] = useState<WhatsappTemplateVariables>({});
  const [submitting, setSubmitting] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const selectedTemplate = useMemo(
    () => getWhatsappTemplate(templateName) ?? WHATSAPP_TEMPLATES[0],
    [templateName]
  );

  useEffect(() => {
    if (!open) return;

    setValidationError(null);
  }, [open]);

  useEffect(() => {
    setTemplateVariables({});
    setValidationError(null);
  }, [templateName]);

  if (!open) {
    return null;
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const normalizedPhone = normalizeColombianWhatsappNumber(phone);
    if (!normalizedPhone) {
      setValidationError("Ingresa un número de WhatsApp.");
      return;
    }

    const hotelId = activeHotelId?.trim();
    if (!hotelId) {
      setValidationError("Selecciona un hotel antes de enviar la plantilla.");
      return;
    }

    const variables: WhatsappTemplateVariables = {};
    for (const variable of selectedTemplate.variables) {
      const value = templateVariables[variable.key]?.trim() ?? "";
      if (!value) {
        setValidationError(`Completa el campo "${variable.label}".`);
        return;
      }
      variables[variable.key] = value;
    }

    setSubmitting(true);
    setValidationError(null);
    try {
      await sendWhatsappTemplate({
        to: normalizedPhone,
        templateName,
        activeHotelId: hotelId,
        ...(selectedTemplate.variables.length > 0 ? { variables } : {}),
      });
      setPhone("");
      setTemplateName(WHATSAPP_TEMPLATES[0].value);
      setTemplateVariables({});
      onSuccess();
      onClose();
    } catch {
      onError();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250]" role="dialog" aria-modal="true" aria-labelledby="start-conversation-title">
      <button
        type="button"
        className="absolute inset-0 bg-[#1f1f1c]/35 backdrop-blur-sm"
        aria-label="Cerrar modal"
        onClick={submitting ? undefined : onClose}
      />
      <div className="absolute left-1/2 top-1/2 flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),28rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-[#e7dfd4] bg-white shadow-2xl shadow-[#1f1f1c]/15 ring-1 ring-black/[0.04]">
        <div className="border-b border-[#e7dfd4] bg-[#f8f6f2] px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
            WhatsApp Business
          </p>
          <h2 id="start-conversation-title" className="mt-1 text-lg font-semibold tracking-tight text-[#1f1f1c]">
            Comenzar conversación
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6b665e]">
            Envía una plantilla aprobada para abrir un nuevo hilo con el huésped.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="min-h-0 space-y-4 overflow-y-auto px-5 py-5 scrollbar-app">
          <div>
            <label htmlFor="start-whatsapp-phone" className="mb-1.5 block text-[12px] font-semibold text-[#3d3a36]">
              Número de WhatsApp
            </label>
            <input
              id="start-whatsapp-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value);
                setValidationError(null);
              }}
              placeholder="Ej: 573001234567"
              className="w-full rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] px-3.5 py-3 text-base text-[#1f1f1c] shadow-sm placeholder:text-[#9c968c] transition focus:border-[#c8a97e] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20 lg:text-[14px]"
              disabled={submitting}
            />
            {validationError && (
              <p className="mt-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900">
                {validationError}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="start-whatsapp-template" className="mb-1.5 block text-[12px] font-semibold text-[#3d3a36]">
              Plantilla
            </label>
            <select
              id="start-whatsapp-template"
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value as WhatsappTemplateName)}
              className="w-full cursor-pointer appearance-none rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] py-3 pl-3.5 pr-10 text-[14px] text-[#1f1f1c] shadow-sm focus:border-[#c8a97e] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%236b665e'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
                backgroundRepeat: "no-repeat",
                backgroundPosition: "right 0.75rem center",
                backgroundSize: "1rem",
              }}
              disabled={submitting}
            >
              {WHATSAPP_TEMPLATES.map((template) => (
                <option key={template.value} value={template.value}>
                  {template.label}
                </option>
              ))}
            </select>
          </div>

          {selectedTemplate.variables.length > 0 && (
            <div className="space-y-3 rounded-2xl border border-[#e7dfd4] bg-[#f8f6f2]/80 p-3.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
                Variables de plantilla
              </p>
              {selectedTemplate.variables.map((variable) => (
                <div key={variable.key}>
                  <label
                    htmlFor={`start-template-variable-${variable.key}`}
                    className="mb-1.5 block text-[12px] font-semibold text-[#3d3a36]"
                  >
                    {variable.label}
                  </label>
                  <input
                    id={`start-template-variable-${variable.key}`}
                    type="text"
                    value={templateVariables[variable.key] ?? ""}
                    onChange={(event) => {
                      setTemplateVariables((current) => ({
                        ...current,
                        [variable.key]: event.target.value,
                      }));
                      setValidationError(null);
                    }}
                    placeholder={variable.placeholder}
                    className="w-full rounded-xl border border-[#e7dfd4] bg-white px-3.5 py-3 text-base text-[#1f1f1c] shadow-sm placeholder:text-[#9c968c] transition focus:border-[#c8a97e] focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20 lg:text-[14px]"
                    disabled={submitting}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-xl border border-[#e7dfd4] bg-white px-4 py-2.5 text-[13px] font-semibold text-[#6b665e] shadow-sm transition hover:bg-[#f1ece4] hover:text-[#1f1f1c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting}
              aria-busy={submitting}
              className="rounded-xl bg-gradient-to-r from-[#c4a574] to-[#b8956a] px-4 py-2.5 text-[13px] font-semibold text-white shadow-md shadow-[#c8a97e]/25 ring-1 ring-[#b8956a]/40 transition hover:from-[#b8956a] hover:to-[#a8825c] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting ? "Enviando..." : "Enviar plantilla"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
