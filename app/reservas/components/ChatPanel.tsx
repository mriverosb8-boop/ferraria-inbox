"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { Message } from "@/lib/inbox-types";
import { WhatsappText } from "@/app/components/WhatsappText";
import { useConversationMessages } from "../hooks/useConversationMessages";
import type { Reserva } from "../lib/types";

type Props = {
  reserva: Reserva | null;
  onClose: () => void;
};

function MessageBubble({ message }: { message: Message }) {
  const isGuest = message.sender === "user";

  return (
    <div className={`flex ${isGuest ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[86%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm ring-1 ${
          isGuest
            ? "rounded-bl-md bg-[var(--panel-3)] text-[var(--ink)] ring-[var(--line)]"
            : "rounded-br-md bg-[var(--red-soft)] text-[var(--ink)] ring-[var(--accent)]"
        }`}
      >
        <p className="whitespace-pre-wrap break-words">
          {message.body ? (
            <WhatsappText text={message.body} />
          ) : message.messageType === "image" ? (
            "Imagen"
          ) : (
            "—"
          )}
        </p>
        <time className="mt-1 block text-[10px] font-medium text-[var(--ink-2)]">{message.sentAt}</time>
      </div>
    </div>
  );
}

export function ChatPanel({ reserva, onClose }: Props) {
  const conversationId = reserva?.conversation_id || reserva?.quote_requests?.conversation_id || null;
  const guestPhone = reserva?.quote_requests?.sender_phone ?? null;
  const { conversation, messages, loading, error } = useConversationMessages({ conversationId, guestPhone });
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, reserva?.id]);

  if (!reserva) {
    return (
      <aside className="flex h-full min-h-0 flex-col rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm ring-1 ring-black/[0.03]">
        <div className="flex flex-1 items-center justify-center text-center">
          <p className="max-w-[240px] text-[13px] leading-relaxed text-[var(--ink-3)]">
            Selecciona “Ver chat” en una reserva para ver la conversación.
          </p>
        </div>
      </aside>
    );
  }

  const guestName = reserva.titular_nombre ?? conversation?.guest.name ?? "Huésped";

  return (
    <aside className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--panel)] shadow-sm ring-1 ring-black/[0.03]">
      <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-semibold text-[var(--ink)]">{guestName}</h2>
          <p className="truncate text-[11px] text-[var(--ink-3)]">Chat de WhatsApp · solo lectura</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ink-2)] transition hover:bg-[var(--panel-3)] hover:text-[var(--ink)]"
          aria-label="Cerrar chat"
        >
          ×
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--panel-2)] px-3 py-4 scrollbar-app">
        {loading ? (
          <p className="py-8 text-center text-[13px] text-[var(--ink-2)]">Cargando conversación...</p>
        ) : error ? (
          <p className="rounded-xl border border-[var(--accent)] bg-[var(--red-soft)] px-3 py-2 text-[13px] text-[var(--accent)]">
            {error}
          </p>
        ) : messages.length === 0 ? (
          <p className="py-8 text-center text-[13px] text-[var(--ink-3)]">Sin mensajes cargados para esta conversación.</p>
        ) : (
          <div className="space-y-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            <div ref={bottomRef} className="h-px" aria-hidden />
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--line)] bg-[var(--panel)] p-3">
        {conversationId ? (
          <Link
            href={`/?conversationId=${encodeURIComponent(conversationId)}`}
            className="flex w-full items-center justify-center rounded-xl border border-[var(--accent)] bg-[var(--panel-2)] px-3 py-2.5 text-[12px] font-semibold text-[var(--ink)] transition hover:bg-[var(--panel-3)]"
          >
            Abrir en inbox
          </Link>
        ) : (
          <span className="block rounded-xl border border-[var(--line)] bg-[var(--panel-2)] px-3 py-2.5 text-center text-[12px] text-[var(--ink-3)]">
            {guestPhone ? "Abrir en inbox no disponible sin conversation_id" : "Reserva sin conversation_id ni teléfono"}
          </span>
        )}
      </div>
    </aside>
  );
}
