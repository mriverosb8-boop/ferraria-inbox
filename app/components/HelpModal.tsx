"use client";

import { useEffect } from "react";

type HelpModalProps = {
  open: boolean;
  onClose: () => void;
};

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md border border-[#e7dfd4] bg-[#f1ece4] px-1.5 py-0.5 text-[11px] font-semibold tracking-wide text-[#5c574f]">
      {children}
    </span>
  );
}

export function HelpModal({ open, onClose }: HelpModalProps) {
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-[300]" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
      <button
        type="button"
        className="absolute inset-0 bg-[#1f1f1c]/35 backdrop-blur-sm"
        aria-label="Cerrar guía"
        onClick={onClose}
      />
      <div className="absolute left-1/2 top-1/2 flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),44rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl border border-[#e7dfd4] bg-white shadow-2xl shadow-[#1f1f1c]/15 ring-1 ring-black/[0.04]">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[#e7dfd4] bg-[#f8f6f2] px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
              Atención a huéspedes
            </p>
            <h2 id="help-modal-title" className="mt-1 text-lg font-semibold tracking-tight text-[#1f1f1c]">
              Guía del Inbox
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#6b665e] transition hover:bg-[#ece5d9] hover:text-[#1f1f1c]"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4.5 w-4.5">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto px-5 py-5 text-[14px] leading-relaxed text-[#3d3a36] scrollbar-app">
          <section>
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">¿Qué es esto?</h3>
            <p className="mt-1.5">
              El Inbox es donde se atiende a los huéspedes que escriben por WhatsApp. La mayor parte del
              tiempo, el agente de IA responde solo las preguntas frecuentes. Tú intervienes cuando una
              conversación requiere atención humana.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">La Cola operativa (lista de la izquierda)</h3>
            <p className="mt-1.5">
              Todas las conversaciones aparecen en la Cola operativa. Filtros arriba:
            </p>
            <ul className="mt-2 space-y-1.5">
              <li><strong>Todas</strong> — todas las conversaciones.</li>
              <li><strong>Sin leer</strong> — mensajes nuevos sin abrir.</li>
              <li><strong>IA activa</strong> — las maneja el agente solo (no necesitas hacer nada).</li>
              <li><strong>Atención</strong> — las que te necesitan a ti. Tu filtro principal.</li>
            </ul>
            <p className="mt-3">Etiquetas de estado de cada conversación:</p>
            <ul className="mt-2 space-y-1.5">
              <li><Tag>PENDIENTE</Tag> — esperando ser atendida.</li>
              <li><Tag>REQUIERE ATENCIÓN</Tag> — pasó a un humano.</li>
              <li><Tag>HUMANO</Tag> — la atiende una persona.</li>
              <li><Tag>IA ACTIVA</Tag> — la maneja el agente solo.</li>
              <li><Tag>COMPLETADA</Tag> — ya se resolvió.</li>
            </ul>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Cuándo el agente se apaga solo (importante)</h3>
            <p className="mt-1.5">
              El agente se apaga automáticamente —sin que tengas que hacer nada— en estos casos. Cuando
              pasa, la conversación queda en <Tag>REQUIERE ATENCIÓN</Tag> y debes responder tú:
            </p>
            <ul className="mt-2 space-y-1.5">
              <li>El huésped envía una imagen.</li>
              <li>El huésped envía un documento o PDF.</li>
              <li>El agente no puede resolver la consulta o el huésped pide un humano (etiqueta «Solicitó agente humano»).</li>
            </ul>
            <p className="mt-3">
              En todos estos casos no necesitas pulsar <strong>«Tomar control humano»</strong> — el agente
              ya está apagado. Solo entra y responde.
            </p>
            <p className="mt-3">
              <strong>Audios:</strong> el agente sí maneja los audios. Los transcribe y responde como un
              mensaje normal, pero verás un pequeño aviso de «mensaje transcrito» — por si la transcripción
              no quedó bien, revísalo.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Cómo sé que una conversación me necesita</h3>
            <p className="mt-1.5">
              Suena una alerta, aparece un mensaje de aviso, y la conversación se marca con
              {" "}<Tag>REQUIERE ATENCIÓN</Tag>. La forma más rápida de verlas todas: el filtro
              {" "}<strong>Atención</strong>.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Atender una conversación</h3>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Abre la conversación con <Tag>REQUIERE ATENCIÓN</Tag> (o usa el filtro Atención).</li>
              <li>Lee el historial.</li>
              <li>Responde en el recuadro «Responder como agente humano…» y envía con Enter. Adjunta imágenes con el ícono al lado del recuadro.</li>
              <li>Cierra la conversación según corresponda (ver abajo).</li>
            </ol>
            <p className="mt-3">
              <strong>«Tomar control humano»</strong> solo lo necesitas si el agente no se apagó solo pero
              igual quieres intervenir en una conversación que la IA está manejando.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Cerrar una conversación: dos botones distintos</h3>

            <p className="mt-2 font-semibold text-[#1f1f1c]">
              Asunto resuelto <span className="font-normal text-rose-700">(rojo)</span>
            </p>
            <ul className="mt-1.5 space-y-1.5">
              <li>Solo aparece cuando hubo un problema.</li>
              <li>Lo pulsas después de solucionar ese problema puntual.</li>
              <li>No cierra la conversación.</li>
            </ul>

            <p className="mt-3 font-semibold text-[#1f1f1c]">Marcar como completado</p>
            <ul className="mt-1.5 space-y-1.5">
              <li>Cierra la conversación y reactiva el agente de IA para los siguientes mensajes.</li>
            </ul>

            <p className="mt-3">
              Secuencia típica cuando hubo un problema: resuelves → <strong>Asunto resuelto</strong> → al
              terminar todo → <strong>Marcar como completado</strong>.
            </p>

            <p className="mt-3 rounded-xl border border-[#d8bd93] bg-[#faf6ee] px-3.5 py-2.5">
              <strong>Regla de oro:</strong> al terminar, pulsa «Marcar como completado». Si no, el agente
              sigue apagado para ese chat y no responderá automáticamente.
            </p>

            <p className="mt-3">Otros botones:</p>
            <ul className="mt-2 space-y-1.5">
              <li><strong>Reactivar IA</strong> — reenciende el agente sin cerrar la conversación.</li>
              <li><strong>Crear resumen del chat</strong> — resume el último problema de la conversación.</li>
            </ul>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Cotizaciones</h3>
            <p className="mt-1.5">
              El huésped llena un formulario y el sistema cotiza automáticamente.
            </p>
            <p className="mt-3">
              A veces la cotización falla y se escala a un humano para cotizar manualmente. Esto pasa cuando
              faltan tarifas cargadas en el PMS del hotel para esas fechas — no es un error de la IA, simplemente no
              están todas las tarifas subidas, y por eso es imposible cotizar automáticamente. En esos casos
              (que son minoría), cotiza manualmente.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Reservas</h3>
            <p className="mt-1.5">
              Si el huésped completa el proceso de reserva (llenando el formulario tras cotizar), aparece el
              número de reservas pendientes en rojo junto a <strong>Reservas</strong> (arriba, al lado de
              Conversaciones).
            </p>
            <p className="mt-3">Para procesarla:</p>
            <ol className="mt-2 list-decimal space-y-1.5 pl-5">
              <li>Ve a la pestaña Reservas («Reservas por subir al PMS»).</li>
              <li>En Pendientes verás la reserva con todos los datos ya completos: datos del titular (nombre, documento, correo, notas) y la cotización completa (fechas, habitación, huéspedes, total con IVA).</li>
              <li>Revisa la reserva y súbela al PMS del hotel.</li>
              <li>
                Pulsa Completar si la reserva procede, o Rechazar si ya no aplica.
                <ul className="mt-1.5 space-y-1.5 pl-5">
                  <li><strong>Copiar datos</strong> te copia la información (útil para subirla al PMS).</li>
                  <li><strong>Ver chat</strong> abre la conversación de esa reserva.</li>
                </ul>
              </li>
            </ol>
            <p className="mt-3 rounded-xl border border-[#d8bd93] bg-[#faf6ee] px-3.5 py-2.5">
              <strong>Importante:</strong> si el huésped ya hizo todo el proceso, los datos ya están en la
              pestaña Reservas — no se los pidas de nuevo. Solo revisas y completas.
            </p>
          </section>

          <section className="mt-5">
            <h3 className="text-[15px] font-semibold text-[#1f1f1c]">Si algo no funciona</h3>
            <ul className="mt-2 space-y-1.5">
              <li>
                Algo raro con la IA (responde mal, no se reactiva, comportamiento extraño): escríbele
                directamente a{" "}
                <a
                  href="mailto:matias.riveros@ferraria.net"
                  className="font-semibold text-[#8a6d3f] underline decoration-[#c8a97e]/60 underline-offset-2 hover:text-[#6f562f]"
                >
                  matias.riveros@ferraria.net
                </a>
                .
              </li>
            </ul>
          </section>
        </div>

        <div className="flex shrink-0 justify-end border-t border-[#e7dfd4] bg-[#f8f6f2] px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-[#e7dfd4] bg-white px-4 py-2 text-[13px] font-semibold text-[#6b665e] shadow-sm transition hover:bg-[#f1ece4] hover:text-[#1f1f1c]"
          >
            Cerrar
          </button>
        </div>
      </div>
    </div>
  );
}
