"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type SVGProps } from "react";
import type { Message } from "@/lib/inbox-types";
import { WhatsappText } from "@/app/components/WhatsappText";
import { avatarFlatColors, initials } from "@/lib/avatar";
import { useConversationMessages } from "../hooks/useConversationMessages";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva | null;
};

function IconWhatsapp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 004.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.13h-.01a8.2 8.2 0 01-4.18-1.15l-.3-.18-3.11.82.83-3.04-.2-.31a8.2 8.2 0 01-1.26-4.38c0-4.54 3.7-8.23 8.24-8.23a8.2 8.2 0 015.82 2.41 8.16 8.16 0 012.41 5.83c0 4.54-3.7 8.23-8.24 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.24-1.47-1.38-1.72-.15-.25-.02-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.16 0-.43.06-.65.31-.23.25-.86.84-.86 2.05s.88 2.38 1 2.54c.13.17 1.74 2.65 4.2 3.72.59.25 1.04.4 1.4.52.59.18 1.12.16 1.55.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29z" />
    </svg>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isGuest = message.sender === "user";
  const isHuman = message.sender === "agent";

  return (
    <div className={`flex ${isGuest ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[86%] rounded-[var(--radius-bubble)] px-3 py-2 text-[13px] leading-relaxed ${
          isGuest
            ? "rounded-bl-[6px] border border-[var(--border-soft)] bg-[var(--bubble-guest)] text-[var(--text-primary)]"
            : isHuman
              ? "rounded-br-[6px] bg-[var(--accent)] text-white"
              : "rounded-br-[6px] border border-[var(--bubble-ai-border)] bg-[var(--bubble-ai)] text-[var(--text-primary)]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.body ? (
            <WhatsappText text={message.body} />
          ) : message.messageType === "image" ? (
            "Imagen"
          ) : (
            "Sin texto"
          )}
        </p>
        <time
          className={`ibx-mono mt-1 block text-[10px] ${
            isHuman ? "text-white/70" : "text-[var(--text-secondary)]"
          }`}
        >
          {message.sentAt}
        </time>
      </div>
    </div>
  );
}

/**
 * Panel derecho de Reservas (docs/REDESIGN.md §6.6): la conversación donde se
 * capturó la reserva, de solo lectura y sin composer. Para responderle al
 * huésped se pasa a Huéspedes con el botón de abajo.
 */
export function ChatPanel({ reserva }: Props) {
  const conversationId = reserva?.conversation_id || reserva?.quote_requests?.conversation_id || null;
  const guestPhone = reserva?.quote_requests?.sender_phone ?? null;
  const { conversation, messages, loading, error } = useConversationMessages({ conversationId, guestPhone });
  const listRef = useRef<HTMLDivElement>(null);
  // En el teléfono el chat arranca plegado: así al abrir una reserva se ve el
  // detalle completo de una, y la pantalla queda con un solo scroll vertical.
  // Desde `xl` el chat es la tercera columna y está siempre abierto. Vuelve a
  // arrancar plegado en cada reserva porque la página remonta este panel con
  // una `key` por reserva.
  const [chatAbierto, setChatAbierto] = useState(false);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    // Se mueve el scroll de la lista y nada más. `scrollIntoView` arrastraba
    // también a los contenedores de arriba, y en el teléfono eso dejaba el
    // encabezado del detalle fuera de pantalla apenas cargaban los mensajes.
    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
  }, [messages.length, reserva?.id, chatAbierto]);

  if (!reserva) {
    return (
      <aside className="hidden min-h-0 flex-col items-center justify-center rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-5 shadow-sm xl:flex">
        <p className="max-w-[240px] text-center text-[13px] leading-relaxed text-[var(--text-secondary)]">
          Acá vas a ver el chat de WhatsApp de la reserva que elijas.
        </p>
      </aside>
    );
  }

  const guestName = reserva.titular_nombre || conversation?.guest.name || "Huésped";
  const avatar = avatarFlatColors(reserva.id);

  return (
    // Abajo de `xl` el chat es el último bloque del detalle, que es una sola
    // columna con scroll: por eso no crece solo (`shrink-0` para que el detalle
    // de arriba nunca quede aplastado ni tapado) y la conversación tiene su
    // propio tope de alto, para que el botón de "Abrir en Huéspedes" siga
    // quedando al final de todo y a la vista.
    <aside className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--border-soft)] bg-[var(--bg-card)] shadow-sm max-xl:shrink-0 xl:h-full xl:min-h-0">
      <header className="flex min-h-14 shrink-0 items-center gap-2.5 border-b border-[var(--border-soft)] px-4 py-3">
        <span
          className="ibx-mono flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] text-[12px] font-bold"
          style={{ background: avatar.bg, color: avatar.fg }}
          aria-hidden
        >
          {initials(guestName)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="grotesk truncate text-[14px] font-semibold text-[var(--text-primary)]">{guestName}</h2>
          <p className="ibx-mono truncate text-[10.5px] text-[var(--text-secondary)]">
            Chat de WhatsApp · solo lectura
          </p>
        </div>
        {/* El estado del bloque se lee como texto, no como un ícono a adivinar. */}
        <button
          type="button"
          onClick={() => setChatAbierto((value) => !value)}
          aria-expanded={chatAbierto}
          aria-controls="reservas-chat-mensajes"
          className="shrink-0 rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-app)] px-3 py-2 text-[12px] font-semibold text-[var(--text-primary)] transition hover:bg-[var(--bg-card)] xl:hidden"
        >
          {chatAbierto ? "Ocultar el chat" : "Ver el chat"}
        </button>
      </header>

      {/* Abajo de `xl` la conversación mide lo que mida su contenido con un tope
          de 55vh; desde `xl` llena la columna (`xl:flex-1`) como venía. */}
      <div
        ref={listRef}
        id="reservas-chat-mensajes"
        className={`${
          chatAbierto ? "block max-xl:max-h-[55vh]" : "hidden"
        } min-h-0 overflow-y-auto bg-[var(--bg-app)] px-3 py-4 scrollbar-app xl:block xl:flex-1`}
      >
        {loading ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">Cargando conversación...</p>
        ) : error ? (
          <p className="rounded-[var(--radius-chip)] border border-[var(--accent)] bg-[var(--red-soft)] px-3 py-2 text-[13px] text-[var(--accent)]">
            {error}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--text-secondary)]">
            Todavía no hay mensajes para mostrar de esta conversación.
          </p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border-soft)] bg-[var(--bg-card)] p-3">
        {conversationId ? (
          <Link
            href={`/?conversationId=${encodeURIComponent(conversationId)}`}
            className="grotesk flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-chip)] bg-[var(--accent)] px-3 text-[13.5px] font-bold text-white shadow-sm transition hover:bg-[var(--accent-hover)]"
          >
            <IconWhatsapp className="h-4 w-4" aria-hidden />
            Abrir en Huéspedes
          </Link>
        ) : (
          <p className="rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-app)] px-3 py-3 text-center text-[12.5px] leading-relaxed text-[var(--text-secondary)]">
            Esta reserva no quedó enlazada a un chat, así que no se puede abrir en Huéspedes.
          </p>
        )}
      </div>
    </aside>
  );
}
