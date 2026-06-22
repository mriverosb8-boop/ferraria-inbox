"use client";

import type { ClipboardEvent, SVGProps } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { avatarFlatColors, initials, splitLeadingEmoji } from "@/lib/avatar";
import {
  formatMessageDetailTime,
  formatMessageDisplayTime,
  getConversationDisplayActivityMs,
  messageNeedsHumanAlert,
  normalizePhoneDigits,
} from "@/lib/chat-utils";
import { appendConversationMessages } from "@/lib/message-limits";
import { upsertConversationMessage } from "@/lib/message-upsert";
import type { ControlMode, Conversation, Message, OperationalStatus } from "@/lib/inbox-types";
import { CONVERSATIONS_TABLE } from "@/lib/conversation-schema";
import { useConversations } from "@/hooks/useConversations";
import { useFollowupTimers } from "@/hooks/useFollowupTimers";
import { useInboxConversationMessages } from "@/hooks/useInboxConversationMessages";
import { WUBBY_TABLE } from "@/lib/wubby-schema";
import { BrandHeaderMark } from "./BrandHeaderMark";
import { FollowupTimer } from "./FollowupTimer";
import { InboxListSkeleton, InboxLoadingSkeleton } from "./InboxLoadingSkeleton";
import { InboxHeaderTabs } from "./InboxHeaderTabs";
import { LogoutButton } from "./LogoutButton";
import { Spinner } from "./Spinner";
import { readStoredActiveHotelId, writeStoredActiveHotelId } from "@/lib/active-hotel-storage";
import { StartConversationModal } from "./StartConversationModal";
import { HelpModal } from "./HelpModal";

type StatusFilter = "all" | "unread" | "ai_active" | "requires_attention" | "closed";

/** Ventana de conversación (WhatsApp / Meta) desde el último mensaje con `sender: "user"`. */
const META_INBOX_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Imágenes/PDFs más recientes que esto cargan signed-url al abrir; el resto espera clic del usuario. */
const LAZY_MEDIA_AUTO_LOAD_MS = 24 * 60 * 60 * 1000;
/** Composer humano: altura mínima (1 línea) y máxima (~6 líneas) antes de scroll interno. */
const COMPOSER_MIN_HEIGHT_PX = 38;
const COMPOSER_MAX_HEIGHT_PX = 140;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PDF_MIME_TYPE = "application/pdf";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 10 * 1024 * 1024;

function BlockedBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md bg-[#ebe6e0] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#6b665e] ring-1 ring-[#d4cdc3] ${className}`}
    >
      Bloqueado
    </span>
  );
}

function formatBlockedAtColombia(iso: string): string {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: "America/Bogota",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = (parts.find((p) => p.type === "month")?.value ?? "").replace(/\.$/, "");
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  return `Bloqueado el ${day} de ${month}, ${hour}:${minute}`;
}

function isPdfFile(file: File | null): boolean {
  return file?.type === PDF_MIME_TYPE;
}

function isMessageDocument(message: Message): boolean {
  return (
    message.messageType?.trim().toLowerCase() === "document" ||
    message.mediaMimeType?.trim().toLowerCase() === PDF_MIME_TYPE
  );
}

function formatFileSize(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}

function sortConversationsByActivity(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
  });
}

function isReplyBlockedByMetaPolicy(messages: Message[]): boolean {
  const fromGuest = messages.filter((m) => m.sender === "user");
  if (fromGuest.length === 0) {
    return true;
  }
  const last = fromGuest[fromGuest.length - 1]!;
  const raw = last.sentAtIso?.trim();
  if (!raw) {
    return true;
  }
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) {
    return true;
  }
  return Date.now() - ms > META_INBOX_REPLY_WINDOW_MS;
}

/** Descriptor de estado operativo en tokens del rediseño (Dirección D). */
type StatusKind = "attention" | "ia" | "done";
const operationalConfig: Record<
  OperationalStatus,
  { label: string; short: string; kind: StatusKind }
> = {
  ai_active: { label: "IA activa", short: "IA", kind: "ia" },
  requires_attention: { label: "Requiere atención", short: "Atención", kind: "attention" },
  closed: { label: "Resuelto", short: "Hecho", kind: "done" },
};

/** Punto de color sólido (token D). */
function Dot({ size = 7, color }: { size?: number; color: string }) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, borderRadius: 999, background: color, flexShrink: 0 }}
      className="inline-block"
    />
  );
}

/**
 * Token de estado de la conversación.
 * `attention` → pill rojo sólido; `ia` → verde; `pending` → dorado; `done` → gris ink-3.
 */
function StatusToken({ kind, pending }: { kind: StatusKind; pending?: boolean }) {
  if (pending) {
    return (
      <span
        className="grotesk inline-flex items-center gap-1.5"
        style={{
          padding: "3px 9px 3px 7px",
          background: "var(--red)",
          color: "#fff",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.01em",
        }}
      >
        <Dot size={6} color="rgba(255,255,255,.85)" />
        Pendiente
      </span>
    );
  }
  if (kind === "attention") {
    return (
      <span
        className="grotesk inline-flex items-center gap-1.5"
        style={{
          padding: "3px 9px 3px 7px",
          background: "var(--red)",
          color: "#fff",
          borderRadius: 999,
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.01em",
        }}
      >
        <Dot size={6} color="rgba(255,255,255,.85)" />
        Atención
      </span>
    );
  }
  const map: Record<Exclude<StatusKind, "attention">, { color: string; label: string }> = {
    ia: { color: "var(--live)", label: "IA activa" },
    done: { color: "var(--ink-3)", label: "Resuelto" },
  };
  const { color, label } = map[kind];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)", letterSpacing: "0.01em" }}
    >
      <Dot color={color} />
      {label}
    </span>
  );
}

function IconSearch(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  );
}

function IconHelp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 9a2.5 2.5 0 014.6 1.3c0 1.7-2.6 2-2.6 3.7" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 17h.01" />
    </svg>
  );
}

/** Destello (chispa de IA, 4 puntas) — logo/identidad del rediseño. */
function Spark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" {...props}>
      <path d="M50,18 C53,40 60,47 82,50 C60,53 53,60 50,82 C47,60 40,53 18,50 C40,47 47,40 50,18 Z" />
    </svg>
  );
}

function IconBlock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M5.6 5.6l12.8 12.8" />
    </svg>
  );
}

function IconMore(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 8.25a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM12 13.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zM12 18.75a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
    </svg>
  );
}

function IconChevronDown(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconBack(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
    </svg>
  );
}

function IconGuest(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function IconSend(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M3.478 2.404a.75.75 0 00-.926.941l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0022.445-8.662a.75.75 0 000-1.5A60.517 60.517 0 003.478 2.404z" />
    </svg>
  );
}

/** Lucide Check (entrega pendiente). */
function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 6L9 17l-5-5" />
    </svg>
  );
}

/** Doble check estilo WhatsApp: dos trazos desfasados horizontalmente. */
function IconCheckCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 14l5 5 10-11" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 14l5 5 10-11" />
    </svg>
  );
}

function IconImage(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
      />
    </svg>
  );
}

function IconWhatsApp(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.123 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  );
}

function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function IconBuilding(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 21h19.5m-18-18v18m10.5-18v18m6-13.5V21M6.75 6.75h.75m-.75 3h.75m-.75 3h.75m3-6h.75m-.75 3h.75m-.75 3h.75M6.75 21v-3.375c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21M3 3h12m-.75 4.5H21m-3.75 3.75h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008zm0 3h.008v.008h-.008v-.008z" />
    </svg>
  );
}

function IconGlobe(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 18c-3.183 0-6.22-.62-9-1.745M16.5 6.5a16.023 16.023 0 00-9 0" />
    </svg>
  );
}

function IconCalendar(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5a2.25 2.25 0 002.25-2.25m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5a2.25 2.25 0 012.25 2.25v7.5" />
    </svg>
  );
}

function IconNote(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V16.5a9 9 0 00-9-9z" />
    </svg>
  );
}

function IconMic(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18.75a6 6 0 006-6v-1.5m-6 7.5a6 6 0 01-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 01-3-3v-6a3 3 0 116 0v6a3 3 0 01-3 3z"
      />
    </svg>
  );
}

function IconTag(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function IconPhone(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
    </svg>
  );
}

function IconSparkles(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 3.37a3.75 3.75 0 002.576 2.576l3.38.813a.75.75 0 010 1.442l-3.38.813a3.75 3.75 0 00-2.576 2.576l-.813 3.37a.75.75 0 01-1.442 0l-.813-3.37a3.75 3.75 0 00-2.576-2.576l-3.38-.813a.75.75 0 010-1.442l3.38-.813a3.75 3.75 0 002.576-2.576l.813-3.37a.75.75 0 01.544-.721zm-4.5 12a.75.75 0 01.721.544l.415 1.725a1.5 1.5 0 001.031 1.031l1.725.415a.75.75 0 010 1.442l-1.725.415a1.5 1.5 0 00-1.031 1.031l-.415 1.725a.75.75 0 01-1.442 0l-.415-1.725a1.5 1.5 0 00-1.031-1.031l-1.725-.415a.75.75 0 010-1.442l1.725-.415a1.5 1.5 0 001.031-1.031l.415-1.725a.75.75 0 01.544-.721z" clipRule="evenodd" />
    </svg>
  );
}

function IconUserCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function getMessageAgeMs(message: Message): number | null {
  const raw = message.sentAtIso;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

function shouldAutoLoadMedia(message: Message): boolean {
  const createdMs = getMessageAgeMs(message);
  if (createdMs == null) return true;
  return Date.now() - createdMs < LAZY_MEDIA_AUTO_LOAD_MS;
}

/**
 * Caché en memoria de signed URLs, compartida entre todas las instancias de
 * `useLazySignedMediaUrl`, indexada por `storagePath`. Evita re-pedir al endpoint
 * una URL ya firmada y vigente al re-seleccionar conversaciones dentro de la misma
 * sesión. Vive solo en memoria de la página (se pierde al refrescar).
 */
const signedUrlCache = new Map<string, { url: string; expiresAt: number }>();
/** TTL cliente conservador: el server firma a 1h; cacheamos ~55 min para nunca servir una URL a punto de expirar. */
const SIGNED_URL_CLIENT_TTL_MS = 55 * 60 * 1000;

async function fetchSignedMediaUrl(message: Message, signal?: AbortSignal): Promise<string> {
  if (!message.mediaStoragePath) {
    throw new Error("missing storage path");
  }

  const cacheKey = message.mediaStoragePath;
  const cached = signedUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.url;
  }

  const params = new URLSearchParams();
  params.set("path", message.mediaStoragePath);
  if (message.mediaBucket) params.set("bucket", message.mediaBucket);

  const response = await fetch(`/api/media/signed-url?${params.toString()}`, { signal });
  if (!response.ok) {
    throw new Error(`signed-url ${response.status}`);
  }

  const payload = (await response.json()) as { signedUrl?: string };
  if (!payload.signedUrl) {
    throw new Error("signed-url vacío");
  }

  signedUrlCache.set(cacheKey, {
    url: payload.signedUrl,
    expiresAt: Date.now() + SIGNED_URL_CLIENT_TTL_MS,
  });

  return payload.signedUrl;
}

type MediaLoadPhase = "deferred" | "loading" | "loaded" | "error";

function resolveInitialMediaPhase(message: Message): MediaLoadPhase {
  if (message.mediaUrl) return "loaded";
  if (!message.mediaStoragePath) return "error";
  return shouldAutoLoadMedia(message) ? "loading" : "deferred";
}

function useLazySignedMediaUrl(message: Message) {
  const [signedUrl, setSignedUrl] = useState<string | null>(message.mediaUrl ?? null);
  const [phase, setPhase] = useState<MediaLoadPhase>(() => resolveInitialMediaPhase(message));
  const abortRef = useRef<AbortController | null>(null);

  const requestLoad = useCallback(async () => {
    if (message.mediaUrl) {
      setSignedUrl(message.mediaUrl);
      setPhase("loaded");
      return;
    }

    if (!message.mediaStoragePath) {
      setSignedUrl(null);
      setPhase("error");
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("loading");
    setSignedUrl(null);

    try {
      const url = await fetchSignedMediaUrl(message, controller.signal);
      if (controller.signal.aborted) return;
      setSignedUrl(url);
      setPhase("loaded");
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setSignedUrl(null);
      setPhase("error");
    }
  }, [message]);

  useEffect(() => {
    if (message.mediaUrl || !message.mediaStoragePath || !shouldAutoLoadMedia(message)) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    void (async () => {
      try {
        const url = await fetchSignedMediaUrl(message, controller.signal);
        if (controller.signal.aborted) return;
        setSignedUrl(url);
        setPhase("loaded");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setSignedUrl(null);
        setPhase("error");
      }
    })();

    return () => {
      controller.abort();
    };
  }, [
    message.id,
    message.mediaUrl,
    message.mediaStoragePath,
    message.mediaBucket,
    message.sentAtIso,
    message,
  ]);

  return { signedUrl, phase, requestLoad };
}

function LazyImagePlaceholder({
  label,
  onLoad,
}: {
  label: string;
  onLoad: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onLoad}
      className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#c8a97e]/60 bg-[#f8f6f2] px-4 text-[#6b665e] shadow-sm transition hover:border-[#c8a97e] hover:bg-[#f1ece4]"
    >
      <IconImage className="h-8 w-8 opacity-70" aria-hidden />
      <span className="text-sm font-medium text-[#1f1f1c]">{label}</span>
    </button>
  );
}

function LazyMediaLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] px-4 text-[#6b665e]">
      <Spinner className="h-6 w-6 animate-spin opacity-70" />
      <span className="text-sm">{label}</span>
    </div>
  );
}

function LazyMediaErrorState({
  label,
  onRetry,
}: {
  label: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 text-rose-900">
      <p className="text-center text-sm">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-[12px] font-semibold text-rose-900 shadow-sm transition hover:bg-rose-100"
      >
        Reintentar
      </button>
    </div>
  );
}

/**
 * Avatar cuadrado redondeado (Dirección D). Muestra el emoji inicial del nombre real de
 * WhatsApp si lo trae; si no, las iniciales. Color cálido plano derivado del `seed`.
 * `ring` añade un halo rojo de atención.
 */
function Avatar({
  name,
  seed,
  size = 42,
  ring = false,
}: {
  name: string;
  seed: string;
  size?: number;
  ring?: boolean;
}) {
  const { bg, fg } = avatarFlatColors(seed);
  const { emoji } = splitLeadingEmoji(name);
  return (
    <div
      aria-hidden
      className="grotesk grid shrink-0 place-items-center"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.34),
        background: bg,
        color: fg,
        fontWeight: 700,
        fontSize: emoji ? Math.round(size * 0.5) : Math.round(size * 0.36),
        lineHeight: 1,
        boxShadow: ring ? "0 0 0 2px var(--panel), 0 0 0 4px var(--red)" : "none",
      }}
    >
      {emoji ?? initials(name)}
    </div>
  );
}

/** Chip de acción rápida del pie del hilo (Dirección D). `primary` = rojo sólido. */
function ActionChip({
  icon: Ic,
  label,
  primary = false,
  busy = false,
  onClick,
  disabled = false,
}: {
  icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  label: string;
  primary?: boolean;
  busy?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const iconColor = primary ? "#fff" : hover ? "var(--red-deep)" : "var(--ink-2)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="grotesk inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
      style={
        primary
          ? {
              padding: "8px 13px",
              border: "none",
              borderRadius: 999,
              background: hover ? "var(--red-deep)" : "var(--red)",
              color: "#fff",
              fontSize: 12,
              fontWeight: 700,
              boxShadow: "var(--shadow)",
              transition: "background .12s, transform .1s",
              transform: hover ? "translateY(-1px)" : "none",
            }
          : {
              padding: "8px 12px",
              border: `1px solid ${hover ? "var(--red)" : "var(--line)"}`,
              borderRadius: 999,
              background: hover ? "var(--red-soft)" : "var(--panel)",
              color: hover ? "var(--red-deep)" : "var(--ink)",
              fontSize: 12,
              fontWeight: 600,
              transition: "background .12s, border-color .12s, color .12s, transform .1s",
              transform: hover ? "translateY(-1px)" : "none",
            }
      }
    >
      {busy ? (
        <Spinner className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Ic className="h-3.5 w-3.5 shrink-0" style={{ color: iconColor }} aria-hidden />
      )}
      {label}
    </button>
  );
}

/** Acción con atajo del panel cockpit (Dirección D): icono + badge de atajo + etiqueta. */
function CmdAction({
  icon: Ic,
  label,
  hint,
  busy = false,
  onClick,
  disabled = false,
}: {
  icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  label: string;
  hint: string;
  busy?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const iconColor = hover ? "var(--red-deep)" : "var(--ink-2)";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="flex flex-col items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        padding: "12px 13px",
        borderRadius: 11,
        border: `1px solid ${hover ? "var(--red)" : "var(--line)"}`,
        background: hover ? "var(--red-soft)" : "var(--panel-2)",
        color: hover ? "var(--red-deep)" : "var(--ink)",
        transition: "background .12s, border-color .12s, color .12s",
      }}
    >
      <div className="flex w-full items-center justify-between">
        {busy ? (
          <Spinner className={`h-4 w-4 animate-spin ${hover ? "text-[var(--red-deep)]" : "text-[var(--ink-2)]"}`} />
        ) : (
          <Ic className="h-[17px] w-[17px]" style={{ color: iconColor }} aria-hidden />
        )}
        <span
          className="ibx-mono"
          style={{
            fontSize: 10,
            color: "var(--ink-3)",
            border: "1px solid var(--line)",
            borderRadius: 5,
            padding: "1px 5px",
          }}
        >
          {hint}
        </span>
      </div>
      <span className="grotesk" style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25 }}>
        {label}
      </span>
    </button>
  );
}

function PrivateWhatsAppImage({
  message,
}: {
  message: Message;
}) {
  const { signedUrl, phase, requestLoad } = useLazySignedMediaUrl(message);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen]);

  if (phase === "deferred") {
    return <LazyImagePlaceholder label="Cargar imagen" onLoad={() => void requestLoad()} />;
  }

  if (phase === "loading") {
    return <LazyMediaLoadingState label="Cargando imagen..." />;
  }

  if (phase === "error" || !signedUrl) {
    return (
      <LazyMediaErrorState
        label="No se pudo cargar la imagen"
        onRetry={() => void requestLoad()}
      />
    );
  }

  const alt = message.body || "Imagen enviada por WhatsApp";

  return (
    <>
      <img
        src={signedUrl}
        alt={alt}
        title="Abrir imagen"
        onClick={() => setIsOpen(true)}
        className="max-w-[260px] max-h-80 cursor-pointer rounded-xl border border-black/10 object-cover hover:opacity-90"
      />
      {isOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsOpen(false)}
        >
          <button
            type="button"
            className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1.5 text-sm font-semibold text-black shadow"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(false);
            }}
            aria-label="Cerrar imagen"
          >
            ✕
          </button>

          <div className="flex max-h-[95vh] max-w-[95vw] flex-col items-center gap-3">
            <img
              src={signedUrl}
              alt={alt}
              className="max-h-[90vh] max-w-[95vw] rounded-xl object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
            {message.body ? (
              <p
                className="max-w-[95vw] whitespace-pre-wrap break-words rounded-lg bg-black/40 px-3 py-2 text-center text-sm text-white"
                onClick={(e) => e.stopPropagation()}
              >
                {message.body}
              </p>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}

function PrivateWhatsAppDocument({
  message,
}: {
  message: Message;
}) {
  const { signedUrl, phase, requestLoad } = useLazySignedMediaUrl(message);

  const filename = message.mediaFilename || "Documento.pdf";
  const caption = message.body || message.mediaCaption || "";

  return (
    <div className="flex max-w-full flex-col gap-2">
      <div className="flex max-w-full items-center gap-3 rounded-xl border border-[#e7dfd4] bg-white/70 p-2.5 shadow-sm ring-1 ring-black/[0.03]">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-[10px] font-bold text-rose-700">
          PDF
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[#1f1f1c]">{filename}</p>
          <p className="mt-0.5 text-[11px] text-[#6b665e]">Documento PDF</p>
        </div>
        {phase === "loaded" && signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noreferrer"
            className="shrink-0 rounded-lg border border-[#c5d4e0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#1f1f1c] shadow-sm transition hover:bg-[#f1ece4]"
          >
            Abrir PDF
          </a>
        ) : phase === "deferred" ? (
          <button
            type="button"
            onClick={() => void requestLoad()}
            className="shrink-0 rounded-lg border border-[#c5d4e0] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#1f1f1c] shadow-sm transition hover:bg-[#f1ece4]"
          >
            Cargar documento
          </button>
        ) : phase === "loading" ? (
          <span className="shrink-0 text-[11px] text-[#6b665e]">Cargando...</span>
        ) : (
          <button
            type="button"
            onClick={() => void requestLoad()}
            className="shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-900 shadow-sm transition hover:bg-rose-100"
          >
            Reintentar
          </button>
        )}
      </div>
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
    </div>
  );
}

function MessageBubble({
  m,
  guestName,
  guestSeed,
}: {
  m: Message;
  guestName: string;
  guestSeed: string;
}) {
  const isUser = m.sender === "user";
  const isAi = m.sender === "ai";
  const isAgent = m.sender === "agent";

  const isHandoffCause = messageNeedsHumanAlert(m as unknown as Record<string, unknown>);

  const isTranscribedVoice =
    isUser && typeof m.format === "string" && m.format.trim().toLowerCase() === "audio";
  const hasImageSource = Boolean(m.mediaUrl || m.mediaStoragePath);
  const isDocument = isMessageDocument(m);
  const timeLabel = formatMessageDisplayTime(m as unknown as Record<string, unknown>) || m.sentAt;
  const isOutboundHotel = !isUser;
  const deliveryStatus = m.status ?? "confirmed";

  // Estética Dirección D: agente = rojo sólido; IA = rojo suave con borde + destello; huésped = panel.
  const bubbleStyle: React.CSSProperties = isUser
    ? {
        background: "var(--panel-2)",
        color: "var(--ink)",
        borderRadius: "5px 16px 16px 16px",
        ...(isHandoffCause ? { boxShadow: "inset 3px 0 0 0 var(--red)" } : null),
      }
    : isAi
      ? {
          background: "var(--red-soft)",
          color: "var(--ink)",
          border: "1.5px solid color-mix(in srgb, var(--red) 35%, transparent)",
          borderRadius: "16px 16px 5px 16px",
          ...(isHandoffCause ? { boxShadow: "inset -3px 0 0 0 var(--red)" } : null),
        }
      : {
          background: "var(--red)",
          color: "#fff",
          borderRadius: "16px 16px 5px 16px",
        };
  const onRed = isAgent;
  const metaColor = onRed ? "rgba(255,255,255,.8)" : "var(--ink-3)";

  return (
    <div
      className="flex w-full min-w-0 items-end gap-2"
      style={{ flexDirection: isUser ? "row" : "row-reverse" }}
    >
      <div className="shrink-0 self-end">
        {isUser ? (
          <Avatar name={guestName} seed={guestSeed} size={30} />
        ) : (
          <div
            className="grid place-items-center"
            style={{
              width: 30,
              height: 30,
              borderRadius: 10,
              background: isAi ? "var(--red-soft)" : "var(--red)",
              border: isAi ? "1.5px solid var(--red)" : "none",
            }}
          >
            {isAi ? (
              <Spark className="h-4 w-4" style={{ color: "var(--red)" }} aria-hidden />
            ) : (
              <IconUserCircle className="h-4 w-4" style={{ color: "#fff" }} aria-hidden />
            )}
          </div>
        )}
      </div>
      <div
        className={`flex min-w-0 flex-col ${isUser ? "items-start" : "items-end"} max-w-[min(92%,26rem)] sm:max-w-[min(86%,34rem)] lg:max-w-[min(82%,46rem)]`}
      >
        {!isUser && (
          <span
            className="grotesk"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: isAi ? "var(--red)" : "var(--ink-2)",
              margin: "0 5px 3px",
            }}
          >
            {isAi ? "FerrarIA · IA" : "Tú · agente"}
          </span>
        )}
        <div
          className="flex w-fit min-w-0 max-w-full flex-col gap-0.5 break-words px-3.5 py-2 text-[14px] [overflow-wrap:anywhere]"
          style={{ lineHeight: 1.45, ...bubbleStyle }}
        >
          {isHandoffCause && (
            <p
              className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[10px] font-semibold leading-tight"
              style={{ color: onRed ? "#fff" : "var(--red)" }}
            >
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5"
                style={{
                  background: onRed ? "rgba(255,255,255,.18)" : "var(--red-soft)",
                  border: onRed ? "1px solid rgba(255,255,255,.3)" : "1px solid var(--red)",
                }}
              >
                <span aria-hidden>⚠️</span>
                <span>Solicitó agente humano</span>
              </span>
            </p>
          )}
          {isTranscribedVoice && (
            <p className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[10px] font-medium leading-tight" style={{ color: "var(--ink-2)" }}>
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
                style={{ background: "var(--panel)", border: "1px solid var(--line)" }}
              >
                <IconMic className="h-2.5 w-2.5 shrink-0 opacity-85" aria-hidden />
                <span>Mensaje de voz transcrito</span>
              </span>
            </p>
          )}
          {isDocument ? (
            <PrivateWhatsAppDocument key={m.id} message={m} />
          ) : m.messageType === "image" && hasImageSource ? (
            <div className="flex max-w-full flex-col gap-2">
              <PrivateWhatsAppImage key={m.id} message={m} />
              {m.body ? <p className="mt-2 whitespace-pre-wrap break-words">{m.body}</p> : null}
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words">{m.body}</p>
          )}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <time className="ibx-mono min-w-0 shrink text-[10px] tabular-nums" style={{ color: metaColor }}>
              {timeLabel}
            </time>
            {isOutboundHotel &&
              (deliveryStatus === "pending" ? (
                <IconCheck className="h-3.5 w-3.5 shrink-0" style={{ color: metaColor }} aria-label="Enviado" />
              ) : (
                <IconCheckCheck className="h-3.5 w-[18px] shrink-0" style={{ color: metaColor }} aria-label="Entregado" />
              ))}
            {isAi && m.aiMeta && (
              <span className="ibx-mono max-w-full break-words text-[10px] tabular-nums" style={{ color: "var(--ink-3)" }}>
                {m.aiMeta.latencyMs} ms · {m.aiMeta.tokens} tok
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function InboxApp() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(() => readStoredActiveHotelId());
  const {
    conversations,
    setConversations,
    loading,
    error,
    refetch,
    markConversationRead,
    urgentHandoffBannerVisible,
    dismissUrgentHandoffBanner,
    realtimeUiStatus,
    realtimeErrorDetail,
    availableHotels,
    activeHotelId: resolvedActiveHotelId,
  } = useConversations({ activeConversationId: selectedId, activeHotelId });
  const { followups: followupTimers, removeFollowup } = useFollowupTimers();

  const conversationHotelId = activeHotelId ?? resolvedActiveHotelId;

  const cancelFollowup = useCallback(
    async (conversationId: string, quoteRequestId: string, stage: string) => {
      // Remoción optimista: el círculo desaparece al instante.
      removeFollowup(conversationId);
      try {
        const params = new URLSearchParams({ hotelId: conversationHotelId ?? "" });
        const res = await fetch(`/api/followups/cancel?${params}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId, quoteRequestId, stage }),
        });
        if (!res.ok) {
          console.error("[cancelFollowup] respuesta no ok", res.status);
        }
      } catch (e) {
        console.error("[cancelFollowup] error de red", e);
      }
    },
    [conversationHotelId, removeFollowup]
  );
  useInboxConversationMessages(
    selectedId,
    conversationHotelId,
    setConversations
  );

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [draft, setDraft] = useState("");
  const [mobileTab, setMobileTab] = useState<"list" | "chat">("list");
  const [guestOpen, setGuestOpen] = useState(false);
  const [sendWarning, setSendWarning] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resolvingRequest, setResolvingRequest] = useState(false);
  const [pendingAction, setPendingAction] = useState<null | "human" | "ai" | "complete" | "reopen">(
    null
  );
  const [globalActionsOpen, setGlobalActionsOpen] = useState(false);
  const [hotelSelectOpen, setHotelSelectOpen] = useState(false);
  const [startConversationOpen, setStartConversationOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [moderationDialogAction, setModerationDialogAction] = useState<"block" | "unblock" | null>(
    null
  );
  const [moderationInProgress, setModerationInProgress] = useState(false);
  const [templateToast, setTemplateToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
  const globalActionsRef = useRef<HTMLDivElement>(null);
  const hotelSelectRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  // ── Columnas redimensionables con el mouse (solo escritorio ≥1024px) ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const [leftWidth, setLeftWidth] = useState(344);
  const [rightWidth, setRightWidth] = useState(312);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const startColumnResize = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault();
      const onMove = (ev: MouseEvent) => {
        const rect = bodyRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (side === "left") {
          setLeftWidth(Math.min(560, Math.max(260, ev.clientX - rect.left)));
        } else {
          setRightWidth(Math.min(520, Math.max(240, rect.right - ev.clientX)));
        }
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      };
      document.body.style.userSelect = "none";
      document.body.style.cursor = "col-resize";
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    []
  );

  const resizeComposer = useCallback(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(
      Math.max(el.scrollHeight, COMPOSER_MIN_HEIGHT_PX),
      COMPOSER_MAX_HEIGHT_PX
    );
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposer();
  }, [draft, resizeComposer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const conversationId = new URLSearchParams(window.location.search).get("conversationId")?.trim();
    if (conversationId) setRequestedConversationId(conversationId);
  }, []);

  // Sincroniza el hotel activo en memoria con el que resuelve el server. Cubre el
  // arranque (activeHotelId === null) y la auto-recuperación: si el hook descartó
  // un hotelId stale (403) y reintentó, resolvedActiveHotelId trae el hotel correcto
  // y aquí lo adoptamos sin reload, dejando estado y storage coherentes.
  useEffect(() => {
    if (resolvedActiveHotelId && resolvedActiveHotelId !== activeHotelId) {
      setActiveHotelId(resolvedActiveHotelId);
      writeStoredActiveHotelId(resolvedActiveHotelId);
    }
  }, [resolvedActiveHotelId, activeHotelId]);

  useEffect(() => {
    setActionError(null);
    setModerationDialogAction(null);
  }, [selectedId]);

  useEffect(() => {
    if (!globalActionsOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!globalActionsRef.current?.contains(target)) {
        setGlobalActionsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [globalActionsOpen]);

  useEffect(() => {
    if (!hotelSelectOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!hotelSelectRef.current?.contains(target)) {
        setHotelSelectOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    return () => document.removeEventListener("mousedown", closeOnOutsideClick);
  }, [hotelSelectOpen]);

  useEffect(() => {
    if (!templateToast) return;

    const timeout = window.setTimeout(() => setTemplateToast(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [templateToast]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  useEffect(() => {
    if (conversations.length === 0) return;
    setSelectedId((id) => {
      if (requestedConversationId && conversations.some((c) => c.id === requestedConversationId)) {
        return requestedConversationId;
      }
      if (id && conversations.some((c) => c.id === id)) return id;
      return conversations[0]!.id;
    });
  }, [conversations, requestedConversationId]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const replyBlockedByMeta = useMemo(
    () => (selected ? isReplyBlockedByMetaPolicy(selected.messages) : false),
    [selected]
  );

  const filterCounts = useMemo(() => {
    const all = conversations.length;
    const unread = conversations.filter((c) => c.unreadCount > 0).length;
    const ai_active = conversations.filter((c) => c.operationalStatus === "ai_active").length;
    const requires_attention = conversations.filter((c) => c.operationalStatus === "requires_attention").length;
    const closed = conversations.filter((c) => c.operationalStatus === "closed").length;
    return { all, unread, ai_active, requires_attention, closed };
  }, [conversations]);

  const filtered = useMemo(() => {
    let list = conversations;

    if (statusFilter === "unread") {
      list = list.filter((c) => c.unreadCount > 0);
    } else if (statusFilter === "ai_active") {
      list = list.filter((c) => c.operationalStatus === "ai_active");
    } else if (statusFilter === "requires_attention") {
      list = list.filter((c) => c.operationalStatus === "requires_attention");
    } else if (statusFilter === "closed") {
      list = list.filter((c) => c.operationalStatus === "closed");
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (c) =>
          c.guest.name.toLowerCase().includes(q) ||
          c.guestPhone.toLowerCase().includes(q) ||
          c.lastMessagePreview.toLowerCase().includes(q) ||
          c.guest.property.toLowerCase().includes(q)
      );
    }

    return sortConversationsByActivity(list);
  }, [conversations, query, statusFilter]);

  const scrollToBottom = useCallback(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, []);

  useLayoutEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [selectedId, selected?.messages.length]);

  useEffect(() => {
    const t = setTimeout(() => scrollToBottom(), 100);
    return () => clearTimeout(t);
  }, [selected?.messages.length, scrollToBottom]);

  useEffect(() => {
    if (!selectedId) return;
    const current = conversations.find((c) => c.id === selectedId);
    if (!current || current.unreadCount <= 0) return;
    void markConversationRead(selectedId);
  }, [conversations, selectedId, markConversationRead]);

  const clearSelectedFile = useCallback(() => {
    setSelectedFile(null);
    setFilePreviewUrl(null);
    setFileError(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    clearSelectedFile();
  }, [selectedId, clearSelectedFile]);

  const handleFileSelection = (file: File | null) => {
    setFileError(null);
    if (!file) return;

    const isImage = ALLOWED_IMAGE_TYPES.has(file.type);
    const isPdf = file.type === PDF_MIME_TYPE;
    if (!isImage && !isPdf) {
      setFileError("Solo puedes adjuntar imágenes JPG, PNG, WebP o PDF.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (isImage && file.size > MAX_IMAGE_BYTES) {
      setFileError("La imagen no puede superar 5 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (isPdf && file.size > MAX_PDF_BYTES) {
      setFileError("El PDF no puede superar 10 MB.");
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setSelectedFile(file);
    setFilePreviewUrl(isPdf ? null : URL.createObjectURL(file));
  };

  const handleComposerPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;

    event.preventDefault();

    const extension =
      file.type === "image/jpeg" ? "jpg" : file.type === "image/webp" ? "webp" : "png";
    const pastedFile = new File(
      [file],
      `pasted-image-${Date.now()}.${extension}`,
      { type: file.type || "image/png" }
    );

    handleFileSelection(pastedFile);
  };

  const sendMessage = async () => {
    const text = draft.trim();
    if ((!text && !selectedFile) || !selectedId || sendingMedia) return;
    const selectedConv = conversations.find((c) => c.id === selectedId);
    if (selectedConv?.operationalStatus === "closed") return;
    if (isReplyBlockedByMetaPolicy(selectedConv?.messages ?? [])) return;

    if (selectedFile) {
      const selectedFileIsPdf = isPdfFile(selectedFile);
      const clientTempId = crypto.randomUUID();
      const pendingSentAtIso = new Date().toISOString();
      const pendingMessageType = selectedFileIsPdf ? "document" : "image";
      const optimisticMediaMessage: Message = {
        id: `local-media-${Date.now()}`,
        clientTempId,
        status: "pending",
        body: text,
        sentAt: formatMessageDetailTime(pendingSentAtIso),
        sentAtIso: pendingSentAtIso,
        sender: "agent",
        messageType: pendingMessageType,
        mediaUrl: selectedFileIsPdf ? null : filePreviewUrl,
        mediaMimeType: selectedFile.type,
        mediaCaption: text || null,
        mediaFilename: selectedFile.name,
      };

      setSendingMedia(true);
      setSendWarning(null);
      setFileError(null);
      setActionError(null);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                messages: appendConversationMessages(c.messages, optimisticMediaMessage),
                lastMessagePreview:
                  text || (selectedFileIsPdf ? `📄 ${selectedFile.name}` : "📷 Imagen"),
                lastMessageAt: optimisticMediaMessage.sentAt,
                lastActivityIso: pendingSentAtIso,
                unreadCount: 0,
                controlMode: "human",
                needsHuman: true,
                aiActive: false,
                dbStatus: "human_control",
                operationalStatus:
                  c.operationalStatus === "closed" ? "closed" : "requires_attention",
              }
            : c
        )
      );

      try {
        const formData = new FormData();
        formData.set("conversationId", selectedConv!.id);
        formData.set("to", normalizePhoneDigits(selectedConv!.guestPhone));
        if (text) formData.set("caption", text);
        formData.set("hotelId", activeHotelId ?? "");
        formData.set("clientTempId", clientTempId);
        formData.set("file", selectedFile);

        const res = await fetch("/api/send-whatsapp-media", {
          method: "POST",
          body: formData,
        });
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          message?: {
            id?: string | number;
            created_at?: string;
            media_storage_path?: string | null;
            media_bucket?: string | null;
            media_mime_type?: string | null;
            media_caption?: string | null;
            media_filename?: string | null;
            media_meta_id?: string | null;
            meta_media_id?: string | null;
            message_type?: string | null;
          };
          mediaStoragePath?: string;
          mediaBucket?: string;
          mediaFilename?: string;
          whatsappType?: "image" | "document";
        };

        if (!res.ok) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === selectedId
                ? {
                    ...c,
                    messages: c.messages.filter((m) => m.clientTempId !== clientTempId),
                  }
                : c
            )
          );
          setFileError(j.error ?? "No se pudo enviar el archivo por WhatsApp.");
          return;
        }

        const sentAtIso = j.message?.created_at ?? pendingSentAtIso;
        const messageType = j.message?.message_type ?? j.whatsappType ?? pendingMessageType;
        const confirmedMediaMessage: Message = {
          ...optimisticMediaMessage,
          id: String(j.message?.id ?? optimisticMediaMessage.id),
          status: "confirmed",
          sentAt: formatMessageDetailTime(sentAtIso),
          sentAtIso,
          messageType,
          mediaStoragePath: j.message?.media_storage_path ?? j.mediaStoragePath ?? null,
          mediaBucket: j.message?.media_bucket ?? j.mediaBucket ?? null,
          mediaCaption: j.message?.media_caption ?? (text || null),
          mediaFilename: j.message?.media_filename ?? j.mediaFilename ?? selectedFile.name,
          metaMediaId: j.message?.media_meta_id ?? j.message?.meta_media_id ?? null,
        };

        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  messages: upsertConversationMessage(c.messages, confirmedMediaMessage),
                  lastMessagePreview: text || (selectedFileIsPdf ? `📄 ${selectedFile.name}` : "📷 Imagen"),
                  lastMessageAt: confirmedMediaMessage.sentAt,
                  lastActivityIso: sentAtIso,
                }
              : c
          )
        );

        setDraft("");
        clearSelectedFile();
        void refetch({ silent: true });
      } catch {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  messages: c.messages.filter((m) => m.clientTempId !== clientTempId),
                }
              : c
          )
        );
        setFileError("Error de red al enviar el archivo.");
      } finally {
        setSendingMedia(false);
      }
      return;
    }

    const clientTempId = crypto.randomUUID();
    const newMsg: Message = {
      id: `local-${Date.now()}`,
      clientTempId,
      status: "pending",
      body: text,
      sentAt: formatMessageDetailTime(new Date().toISOString()),
      sentAtIso: new Date().toISOString(),
      sender: "agent",
    };
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              messages: appendConversationMessages(c.messages, newMsg),
              lastMessagePreview: text.length > 80 ? `${text.slice(0, 77)}…` : text,
              lastMessageAt: newMsg.sentAt,
              lastActivityIso: new Date().toISOString(),
              unreadCount: 0,
              controlMode: "human",
              needsHuman: true,
              aiActive: false,
              dbStatus: "human_control",
              operationalStatus:
                c.operationalStatus === "closed" ? "closed" : "requires_attention",
            }
          : c
      )
    );
    setDraft("");
    setSendWarning(null);
    setActionError(null);

    try {
      const res = await fetch("/api/send-human-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          guestPhone: normalizePhoneDigits(selectedConv!.guestPhone),
          message: text,
          conversationId: selectedConv!.id,
          hotelId: activeHotelId,
          clientTempId,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; skipped?: boolean };
      if (!res.ok) {
        if (j.skipped) {
          setSendWarning(
            "N8N_SEND_MESSAGE_WEBHOOK_URL no está definida: el mensaje solo se muestra en la UI hasta que configures el webhook."
          );
        } else {
          setSendWarning(j.error ?? "No se pudo notificar a n8n");
        }
      }
    } catch {
      setSendWarning("Error de red al enviar a n8n");
    } finally {
      void refetch({ silent: true });
    }
  };

  const takeHumanControl = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv) return;
    if (pendingAction) return;
    setActionError(null);
    setPendingAction("human");
    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "human_control" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(j.error ?? "No se pudo actualizar la conversación");
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                controlMode: "human",
                needsHuman: true,
                aiActive: false,
                dbStatus: "human_control",
                operationalStatus: "requires_attention",
              }
            : c
        )
      );
      await refetch({ silent: true });
    } catch {
      setActionError("Error de red al actualizar la conversación");
    } finally {
      setPendingAction(null);
    }
  };

  const reactivateAi = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv || conv.operationalStatus === "closed") return;
    if (pendingAction) return;
    setActionError(null);
    setPendingAction("ai");
    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "reactivate_ai" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(j.error ?? "No se pudo reactivar la IA");
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                controlMode: "ai",
                needsHuman: false,
                aiActive: true,
                dbStatus: "open",
                operationalStatus: "ai_active",
              }
            : c
        )
      );
      await refetch({ silent: true });
    } catch {
      setActionError("Error de red al reactivar la IA");
    } finally {
      setPendingAction(null);
    }
  };

  const reopenConversation = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv || conv.operationalStatus !== "closed") return;
    if (pendingAction) return;
    setActionError(null);
    setPendingAction("reopen");

    const nextOperational: OperationalStatus =
      conv.needsHuman || !conv.aiActive ? "requires_attention" : "ai_active";
    const nextControl: ControlMode = nextOperational === "ai_active" ? "ai" : "human";

    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId
          ? {
              ...c,
              dbStatus: "open",
              operationalStatus: nextOperational,
              controlMode: nextControl,
            }
          : c
      )
    );

    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "reopen" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId
              ? {
                  ...c,
                  dbStatus: conv.dbStatus,
                  operationalStatus: "closed",
                  controlMode: conv.controlMode,
                }
              : c
          )
        );
        setActionError(j.error ?? "No se pudo reactivar la conversación");
        return;
      }
      await refetch({ silent: true });
    } catch {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                dbStatus: conv.dbStatus,
                operationalStatus: "closed",
                controlMode: conv.controlMode,
              }
            : c
        )
      );
      setActionError("Error de red al reactivar la conversación");
    } finally {
      setPendingAction(null);
    }
  };

  const markCompleted = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv) return;
    if (pendingAction) return;
    setActionError(null);
    setPendingAction("complete");
    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "completed" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setActionError(j.error ?? "No se pudo marcar como completada");
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                operationalStatus: "closed",
                unreadCount: 0,
                dbStatus: "completed",
                needsHuman: false,
                aiActive: true,
                controlMode: "ai",
                request: null,
              }
            : c
        )
      );
      await refetch({ silent: true });
    } catch {
      setActionError("Error de red al completar la conversación");
    } finally {
      setPendingAction(null);
    }
  };

  const applyConversationModeration = async (action: "block" | "unblock") => {
    if (!selectedId || !selected) return;
    if (action === "block" && selected.blocked) return;
    if (action === "unblock" && !selected.blocked) return;

    const hotelId = (activeHotelId ?? resolvedActiveHotelId)?.trim();
    if (!hotelId) {
      setActionError(
        action === "block"
          ? "Selecciona un hotel antes de bloquear la conversación."
          : "Selecciona un hotel antes de desbloquear la conversación."
      );
      return;
    }

    setModerationInProgress(true);
    setActionError(null);
    try {
      const params = new URLSearchParams({ hotelId });
      const res = await fetch(`/api/conversations/${selectedId}/${action}?${params}`, {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        error?: string;
        conversation?: { blocked?: boolean; blocked_at?: string | null };
      };
      if (!res.ok) {
        setActionError(
          j.error ??
            (action === "block"
              ? "No se pudo bloquear la conversación"
              : "No se pudo desbloquear la conversación")
        );
        return;
      }

      const isBlocked = action === "block";
      const blockedAt = isBlocked
        ? (j.conversation?.blocked_at ?? new Date().toISOString())
        : null;
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId
            ? {
                ...c,
                blocked: isBlocked,
                blockedAt,
              }
            : c
        )
      );
      setModerationDialogAction(null);
    } catch {
      setActionError(
        action === "block"
          ? "Error de red al bloquear la conversación"
          : "Error de red al desbloquear la conversación"
      );
    } finally {
      setModerationInProgress(false);
    }
  };

  const resolveRequest = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv || conv.request !== "pending") return;
    setActionError(null);
    setResolvingRequest(true);

    setConversations((prev) =>
      prev.map((c) => (c.id === selectedId ? { ...c, request: null } : c))
    );

    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "resolve_request" }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, request: "pending" } : c))
        );
        setActionError(j.error ?? "No se pudo marcar el asunto como resuelto");
        return;
      }
      await refetch({ silent: true });
    } catch {
      setConversations((prev) =>
        prev.map((c) => (c.id === selectedId ? { ...c, request: "pending" } : c))
      );
      setActionError("Error de red al marcar el asunto como resuelto");
    } finally {
      setResolvingRequest(false);
    }
  };

  const openChat = (id: string) => {
    setSelectedId(id);
    setMobileTab("chat");
    void markConversationRead(id);
  };

  const filterTabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: filterCounts.all },
    { id: "unread", label: "Sin leer", count: filterCounts.unread },
    { id: "requires_attention", label: "Atención", count: filterCounts.requires_attention },
    { id: "closed", label: "Hechas", count: filterCounts.closed },
  ];

  const conversationClosed = selected?.operationalStatus === "closed";
  const inputDisabled = Boolean(conversationClosed || replyBlockedByMeta);
  const selectedFileIsPdf = isPdfFile(selectedFile);
  const selectedFileSizeLabel = selectedFile ? formatFileSize(selectedFile.size) : "";

  if (loading && conversations.length === 0) {
    return <InboxLoadingSkeleton />;
  }

  return (
    <div
      className="ibx flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-full flex-col overflow-x-hidden supports-[height:100dvh]:min-h-[100dvh]"
      style={{ background: "var(--bg)", color: "var(--ink)" }}
    >
      {urgentHandoffBannerVisible && (
        <div
          className="fixed right-4 top-4 z-[300] flex max-w-[min(100vw-2rem,20rem)] items-start gap-3 rounded-xl px-4 py-3 text-[13px] font-semibold leading-snug"
          style={{ border: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)", boxShadow: "var(--shadow-lg)" }}
          role="status"
        >
          <span className="min-w-0 flex-1">🚨 Huésped requiere atención humana</span>
          <button
            type="button"
            onClick={dismissUrgentHandoffBanner}
            className="shrink-0 rounded-lg p-1 transition hover:bg-[var(--panel)]/40"
            style={{ color: "var(--red-deep)" }}
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      )}
      {templateToast && (
        <div
          className="fixed right-4 top-4 z-[320] max-w-[min(100vw-2rem,22rem)] rounded-xl px-4 py-3 text-[13px] font-semibold leading-snug"
          style={
            templateToast.type === "success"
              ? { border: "1px solid var(--live)", background: "var(--live-soft)", color: "var(--live)", boxShadow: "var(--shadow-lg)" }
              : { border: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)", boxShadow: "var(--shadow-lg)" }
          }
          role={templateToast.type === "success" ? "status" : "alert"}
        >
          {templateToast.message}
        </div>
      )}
      <header
        className={`flex h-[56px] shrink-0 items-center gap-3 px-4 sm:gap-5 lg:h-[62px] lg:px-[22px] ${mobileTab === "chat" ? "max-lg:hidden" : ""}`}
        style={{
          background: "linear-gradient(100deg, var(--red-deep) 0%, var(--red) 62%, #fb5142 100%)",
          borderBottom: "1px solid var(--red-deep)",
          boxShadow: "0 1px 8px rgba(196,43,32,.25)",
        }}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <BrandHeaderMark size="sm" />
          <span
            className="grotesk hidden truncate sm:inline"
            style={{ fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em", color: "#fff" }}
          >
            Ferrar<span style={{ color: "rgba(255,255,255,.82)" }}>IA</span>
          </span>
        </div>
        <InboxHeaderTabs hotelId={conversationHotelId} onRed />
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <span
            className="grotesk inline-flex items-center gap-1.5 truncate"
            style={{
              padding: "6px 13px",
              borderRadius: 999,
              fontSize: 12.5,
              fontWeight: 600,
              background: "rgba(255,255,255,.18)",
              color: "#fff",
              border: "1px solid rgba(255,255,255,.28)",
            }}
            title={`Supabase Realtime: public.${CONVERSATIONS_TABLE}, public.${WUBBY_TABLE}${realtimeErrorDetail ? ` · ${realtimeErrorDetail}` : ""}`}
          >
            <Dot
              color={
                realtimeUiStatus === "connected"
                  ? "#7cf0b0"
                  : realtimeUiStatus === "error"
                    ? "#fff"
                    : "#ffe08a"
              }
            />
            {realtimeUiStatus === "connected"
              ? "Conectado"
              : realtimeUiStatus === "error"
                ? "Error"
                : "Esperando"}
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="grotesk inline-flex items-center gap-1.5 transition-colors hover:bg-white/15"
            style={{
              padding: "7px 12px",
              borderRadius: 8,
              border: "none",
              background: "transparent",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
            }}
          >
            <IconHelp className="h-4 w-4" />
            <span className="hidden sm:inline">Ayuda</span>
          </button>
          <LogoutButton onRed />
        </div>
      </header>

      {error && (
        <div
          className="shrink-0 px-4 py-2 text-center text-[13px]"
          style={{ borderBottom: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)" }}
        >
          {error}
        </div>
      )}

      {actionError && (
        <div
          className="shrink-0 px-4 py-2 text-center text-[13px]"
          style={{ borderBottom: "1px solid color-mix(in srgb, var(--gold) 45%, transparent)", background: "color-mix(in srgb, var(--gold) 12%, transparent)", color: "var(--ink)" }}
        >
          {actionError}
          <button
            type="button"
            className="ml-2 underline underline-offset-2"
            onClick={() => setActionError(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      <div ref={bodyRef} className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <aside
          className={`${
            mobileTab === "list" ? "flex" : "hidden"
          } h-full w-full min-h-0 min-w-0 flex-col lg:flex lg:h-auto lg:shrink-0`}
          style={{
            background: "var(--panel)",
            borderRight: "1px solid var(--line)",
            ...(isDesktop ? { width: leftWidth, flex: "0 0 auto" } : null),
          }}
        >
          <div className="shrink-0 px-5 pb-3.5 pt-[18px]">
            <div className="mb-3.5 flex items-center gap-2.5">
              <h2
                className="grotesk"
                style={{
                  margin: 0,
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: "0.13em",
                  textTransform: "uppercase",
                  color: "var(--ink-2)",
                }}
              >
                Cola operativa
              </h2>
              <span className="ibx-mono ml-auto" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--ink-3)" }}>
                {filtered.length}/{conversations.length}
              </span>
              <div ref={globalActionsRef} className="relative">
                <button
                  type="button"
                  onClick={() => setGlobalActionsOpen((open) => !open)}
                  className="d-act flex h-8 w-8 items-center justify-center"
                  style={{ borderRadius: 9, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-2)" }}
                  aria-label="Abrir acciones"
                  aria-haspopup="menu"
                  aria-expanded={globalActionsOpen}
                >
                  <IconMore className="h-4 w-4" aria-hidden />
                </button>
                {globalActionsOpen && (
                  <div
                    className="absolute right-0 top-[calc(100%+0.5rem)] z-[230] w-56 overflow-hidden"
                    style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow-lg)" }}
                    role="menu"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setGlobalActionsOpen(false);
                        setStartConversationOpen(true);
                      }}
                      className="d-soft grotesk flex w-full items-center px-3.5 py-2.5 text-left"
                      style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}
                      role="menuitem"
                    >
                      Comenzar conversación
                    </button>
                  </div>
                )}
              </div>
            </div>
            <label className="relative mb-3.5 block">
              <IconSearch
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--ink-3)" }}
              />
              <input
                type="search"
                placeholder="Buscar huésped o mensaje…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full outline-none"
                style={{
                  padding: "11px 14px 11px 38px",
                  borderRadius: 11,
                  border: "1px solid var(--line)",
                  background: "var(--panel-3)",
                  color: "var(--ink)",
                  fontSize: 13.5,
                }}
              />
            </label>

            <div className="flex flex-nowrap gap-1.5">
              {filterTabs.map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className="grotesk d-chip inline-flex items-center gap-1"
                    style={{
                      padding: "4px 8px",
                      borderRadius: 999,
                      border: "none",
                      fontSize: 11.5,
                      fontWeight: 600,
                      whiteSpace: "nowrap",
                      background: active ? "var(--ink)" : "var(--panel-2)",
                      color: active ? "var(--panel)" : "var(--ink-2)",
                    }}
                  >
                    {tab.label}
                    <span className="ibx-mono" style={{ fontSize: 10, fontWeight: 700, opacity: active ? 0.8 : 0.6 }}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>

            {availableHotels.length >= 2 && (() => {
              const selectedHotelId = activeHotelId ?? resolvedActiveHotelId ?? "";
              const selectedHotel = availableHotels.find((hotel) => hotel.id === selectedHotelId);
              return (
                <div className="mt-3.5">
                  <div ref={hotelSelectRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setHotelSelectOpen((open) => !open)}
                      className="d-act flex w-full cursor-pointer items-center gap-2.5 outline-none"
                      style={{
                        padding: "10px 13px",
                        borderRadius: 11,
                        border: "1px solid var(--line)",
                        background: "var(--panel-2)",
                        color: "var(--ink)",
                        fontSize: 13.5,
                        fontWeight: 600,
                      }}
                      aria-haspopup="listbox"
                      aria-expanded={hotelSelectOpen}
                      aria-label="Hotel activo"
                    >
                      <span style={{ fontSize: 15 }} aria-hidden>🏨</span>
                      <span className="truncate">{selectedHotel?.name ?? "Seleccionar hotel"}</span>
                      <IconChevronDown
                        className={`ml-auto h-4 w-4 shrink-0 transition-transform ${hotelSelectOpen ? "rotate-180" : ""}`}
                        style={{ color: "var(--ink-3)" }}
                        aria-hidden
                      />
                    </button>
                    {hotelSelectOpen && (
                      <div
                        className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-[230] overflow-hidden"
                        style={{ borderRadius: 12, border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow-lg)" }}
                        role="listbox"
                        aria-label="Hotel activo"
                      >
                        {availableHotels.map((hotel) => {
                          const isSelected = hotel.id === selectedHotelId;
                          return (
                            <button
                              key={hotel.id}
                              type="button"
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                setActiveHotelId(hotel.id);
                                writeStoredActiveHotelId(hotel.id);
                                setSelectedId("");
                                setHotelSelectOpen(false);
                              }}
                              className="d-soft flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
                              style={{
                                fontSize: 13,
                                background: isSelected ? "var(--panel-2)" : "transparent",
                                fontWeight: isSelected ? 600 : 400,
                                color: "var(--ink)",
                              }}
                            >
                              <span className="truncate">{hotel.name}</span>
                              {isSelected && <IconCheck className="h-4 w-4 shrink-0" style={{ color: "var(--red)" }} aria-hidden />}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

          </div>

          <div
            className="ibx-scroll min-h-0 flex-1 overflow-y-auto"
            style={{ borderTop: "1px solid var(--line)" }}
          >
            {loading ? (
              <InboxListSkeleton />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>No hay conversaciones</p>
                <p className="max-w-[240px] text-[13px] leading-relaxed" style={{ color: "var(--ink-3)" }}>
                  Ajusta filtros o búsqueda.
                </p>
              </div>
            ) : (
              filtered.map((c) => {
                const active = c.id === selectedId;
                const op = operationalConfig[c.operationalStatus];
                const hasUnread = c.unreadCount > 0;
                const unreadLabel = c.unreadCount > 99 ? "99+" : String(c.unreadCount);
                const isPending = c.request === "pending";
                const showAttentionBar = isPending || c.operationalStatus === "requires_attention";
                const propertyLabel = c.guest.property.split("—")[0]?.trim();
                const showProperty =
                  propertyLabel &&
                  !["sin propiedad indicada", "true", "false"].includes(propertyLabel.toLowerCase());
                const followupTimer = followupTimers.get(c.id);
                const { emoji, rest } = splitLeadingEmoji(c.guest.name);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openChat(c.id)}
                    className={`d-row relative flex w-full text-left ${active ? "sel" : ""}`}
                    style={{
                      gap: 13,
                      padding: "15px 20px 15px 22px",
                      borderBottom: "1px solid var(--line-2)",
                      boxShadow: active ? "var(--shadow-sm)" : "none",
                    }}
                  >
                    {showAttentionBar && (
                      <span
                        aria-hidden
                        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--red)" }}
                      />
                    )}
                    <Avatar name={c.guest.name} seed={c.guest.id} size={42} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="grotesk truncate"
                          style={{
                            fontWeight: 600,
                            fontSize: 14.5,
                            letterSpacing: "-0.01em",
                            color: "var(--ink)",
                          }}
                        >
                          {(emoji ? emoji + " " : "") + rest}
                        </span>
                        {c.blocked && <BlockedBadge className="shrink-0" />}
                        <span className="ibx-mono ml-auto shrink-0" style={{ fontSize: 11, color: "var(--ink-3)" }}>
                          {c.lastMessageAt}
                        </span>
                      </div>
                      <p
                        className="truncate"
                        style={{
                          margin: "4px 0 8px",
                          fontSize: 13,
                          color: hasUnread ? "var(--ink)" : "var(--ink-2)",
                          fontWeight: hasUnread ? 600 : 400,
                        }}
                      >
                        {c.lastMessagePreview}
                      </p>
                      <div className="flex items-center gap-2">
                        <StatusToken kind={op.kind} pending={isPending} />
                        {c.operationalStatus !== "ai_active" && !isPending && (
                          <span
                            className="grotesk shrink-0"
                            style={{
                              fontSize: 10.5,
                              fontWeight: 600,
                              padding: "2px 7px",
                              borderRadius: 6,
                              background: "var(--panel-2)",
                              color: "var(--ink-2)",
                            }}
                          >
                            {c.controlMode === "ai" ? "Modo IA" : "Humano"}
                          </span>
                        )}
                        {showProperty && (
                          <span className="truncate" style={{ fontSize: 11, color: "var(--ink-3)" }} title={propertyLabel}>
                            {propertyLabel}
                          </span>
                        )}
                        <span className="ml-auto flex shrink-0 items-center gap-1.5">
                          {followupTimer && (
                            <FollowupTimer
                              quoteCreatedAt={followupTimer.quoteCreatedAt}
                              onCancel={() =>
                                cancelFollowup(c.id, followupTimer.quoteRequestId, followupTimer.stage)
                              }
                            />
                          )}
                          {hasUnread && (
                            <span
                              className="ibx-mono flex h-[18px] min-w-[18px] items-center justify-center px-1"
                              style={{ borderRadius: 999, background: "var(--red)", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}
                              aria-label={`${c.unreadCount} mensajes sin leer`}
                              title={`${c.unreadCount} mensajes sin leer`}
                            >
                              {unreadLabel}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho de la lista"
          onMouseDown={startColumnResize("left")}
          className="group hidden w-1 shrink-0 cursor-col-resize items-stretch lg:flex"
          title="Arrastra para ajustar el ancho"
        >
          <span className="block h-full w-px bg-[var(--line)] transition-colors group-hover:w-1 group-hover:bg-[var(--red)]" />
        </div>

        <section
          className={`${
            mobileTab === "chat" ? "flex" : "hidden"
          } min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden lg:flex`}
          style={{ background: "var(--bg)" }}
        >
          {selected ? (
            <>
              <div
                className="flex min-h-[56px] shrink-0 items-center gap-3 px-2 py-2 sm:gap-3.5 sm:px-[26px] lg:py-3.5"
                style={{ background: "var(--panel)", borderBottom: "1px solid var(--line)" }}
              >
                <button
                  type="button"
                  onClick={() => setMobileTab("list")}
                  className="d-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl lg:hidden"
                  style={{ color: "var(--ink-3)" }}
                  aria-label="Volver a conversaciones"
                >
                  <IconBack className="h-5 w-5" />
                </button>
                <Avatar name={selected.guest.name} seed={selected.guest.id} size={44} ring />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="grotesk truncate" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--ink)" }}>
                      {selected.guest.name}
                    </h2>
                    {selected.blocked && <BlockedBadge />}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {selected.operationalStatus === "requires_attention" ? (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--red)" }}>
                        <Dot color="var(--red)" />
                        Requiere atención humana
                      </span>
                    ) : selected.operationalStatus === "ai_active" ? (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--live)" }}>
                        <Dot color="var(--live)" />
                        IA activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink-3)" }}>
                        <Dot color="var(--ink-3)" />
                        Resuelto
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--ink-3)" }}>
                      <IconWhatsApp className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--live)" }} aria-hidden />
                      <span className="truncate">WhatsApp</span>
                    </span>
                    {selected.blocked && selected.blockedAt && (
                      <span style={{ fontSize: 11, color: "var(--ink-3)" }}>
                        {formatBlockedAtColombia(selected.blockedAt)}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setModerationDialogAction(selected.blocked ? "unblock" : "block")
                  }
                  className="d-soft grotesk inline-flex h-9 shrink-0 items-center gap-1.5 px-2.5"
                  style={{ borderRadius: 999, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-3)", fontSize: 11.5, fontWeight: 600 }}
                  title={selected.blocked ? "Desbloquear conversación" : "Bloquear conversación"}
                >
                  <IconBlock className="h-4 w-4" />
                  <span className="hidden sm:inline">{selected.blocked ? "Desbloquear" : "Bloquear"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setGuestOpen(true)}
                  className="d-soft grotesk flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 lg:hidden"
                  style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-2)" }}
                >
                  <IconGuest className="h-4 w-4" />
                  Ficha
                </button>
              </div>

              {conversationClosed && (
                <div
                  className="shrink-0 px-4 py-2 text-center text-[12px]"
                  style={{ background: "var(--panel-2)", borderBottom: "1px solid var(--line)", color: "var(--ink-2)" }}
                >
                  Conversación cerrada · reabre desde la ficha si necesitas seguir el hilo
                </div>
              )}

              <div
                className="ibx-scroll min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 lg:px-6"
                style={{ background: "var(--bg)" }}
              >
                <div className="w-full min-w-0 space-y-2.5">
                  <p className="break-words px-0.5 text-[10px] font-medium uppercase tracking-widest [overflow-wrap:anywhere] lg:text-center" style={{ color: "var(--ink-3)" }}>
                    Historial desde Supabase · IA vs humano es heurístico sin columna dedicada
                  </p>
                  {selected.messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      m={m}
                      guestName={selected.guest.name}
                      guestSeed={selected.guest.id}
                    />
                  ))}
                  <div ref={scrollEndRef} className="h-px w-full shrink-0" aria-hidden />
                </div>
              </div>

              <div className="relative z-20 w-full min-w-0 max-w-full shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-[26px] sm:pb-5">
                {(() => {
                  const isPendingRequest = selected.request === "pending";
                  const actionsBusy = pendingAction !== null || resolvingRequest;
                  return (
                    <div className="ibx-scroll flex gap-2 overflow-x-auto" style={{ padding: "10px 2px" }}>
                      {conversationClosed ? (
                        <ActionChip
                          icon={IconCheck}
                          label="Reactivar conversación"
                          primary
                          busy={pendingAction === "reopen"}
                          onClick={() => void reopenConversation()}
                          disabled={actionsBusy}
                        />
                      ) : (
                        <>
                          {isPendingRequest && (
                            <ActionChip
                              icon={IconCheck}
                              label="Asunto resuelto"
                              primary
                              busy={resolvingRequest}
                              onClick={() => void resolveRequest()}
                              disabled={actionsBusy}
                            />
                          )}
                          <ActionChip
                            icon={IconUserCircle}
                            label="Tomar control humano"
                            busy={pendingAction === "human"}
                            onClick={() => void takeHumanControl()}
                            disabled={actionsBusy}
                          />
                          <ActionChip
                            icon={IconSparkles}
                            label="Reactivar IA"
                            busy={pendingAction === "ai"}
                            onClick={() => void reactivateAi()}
                            disabled={actionsBusy}
                          />
                          <ActionChip
                            icon={IconCheck}
                            label="Marcar como completado"
                            busy={pendingAction === "complete"}
                            onClick={() => void markCompleted()}
                            disabled={actionsBusy}
                          />
                        </>
                      )}
                    </div>
                  );
                })()}
                <div className="w-full">
                {sendWarning && (
                  <p
                    className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg px-3 py-2 text-[12px] [overflow-wrap:anywhere]"
                    style={{ border: "1px solid color-mix(in srgb, var(--gold) 40%, transparent)", background: "color-mix(in srgb, var(--gold) 12%, transparent)", color: "var(--ink)" }}
                  >
                    {sendWarning}
                  </p>
                )}
                {fileError && (
                  <p
                    className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg px-3 py-2 text-[12px] [overflow-wrap:anywhere]"
                    style={{ border: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)" }}
                  >
                    {fileError}
                  </p>
                )}
                {selectedFile && (
                  <div
                    className="mb-3 flex max-w-full items-center gap-3 rounded-2xl p-2.5"
                    style={{ border: "1px solid var(--line)", background: "var(--panel-2)", boxShadow: "var(--shadow-sm)" }}
                  >
                    {selectedFileIsPdf || !filePreviewUrl ? (
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold"
                        style={{ border: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)" }}
                      >
                        PDF
                      </div>
                    ) : (
                      <img
                        src={filePreviewUrl}
                        alt={`Vista previa de ${selectedFile.name}`}
                        className="h-14 w-14 shrink-0 rounded-xl border border-black/10 object-cover"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-semibold" style={{ color: "var(--ink)" }}>
                        {selectedFile.name}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--ink-2)" }}>
                        {selectedFileIsPdf ? "PDF adjunto" : "Imagen adjunta"} · {selectedFileSizeLabel}
                      </p>
                      {draft.trim() && (
                        <p className="mt-1 line-clamp-1 text-[12px]" style={{ color: "var(--ink-2)" }}>
                          Caption: {draft.trim()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      disabled={sendingMedia}
                      className="d-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-2)" }}
                      aria-label="Quitar archivo"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div
                  className={`flex w-full min-w-0 max-w-full items-center gap-2 ${inputDisabled ? "opacity-[0.55]" : ""} transition-opacity`}
                  style={{ padding: "5px 6px 5px 14px", borderRadius: 999, background: "var(--panel)", border: "1px solid var(--line)", boxShadow: "var(--shadow)" }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    className="hidden"
                    onChange={(e) => handleFileSelection(e.target.files?.[0] ?? null)}
                    disabled={inputDisabled || sendingMedia}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={inputDisabled || sendingMedia}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--panel-2)] disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: "transparent", color: "var(--ink-3)" }}
                    aria-label="Adjuntar archivo"
                    title="Adjuntar archivo"
                  >
                    <IconImage className="h-[18px] w-[18px]" />
                  </button>
                  <textarea
                    ref={composerRef}
                    rows={1}
                    enterKeyHint="send"
                    inputMode="text"
                    autoComplete="off"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onPaste={handleComposerPaste}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void sendMessage();
                      }
                    }}
                    disabled={inputDisabled || sendingMedia}
                    placeholder={
                      conversationClosed
                        ? "Conversación completada"
                        : replyBlockedByMeta
                          ? "No puedes responder (política Meta / ventana 24 h)"
                          : selectedFile
                            ? selectedFileIsPdf
                              ? "Caption opcional para el documento…"
                              : "Caption opcional para la imagen…"
                          : "Escribe como agente humano…"
                    }
                    className="min-h-[2.25rem] min-w-0 flex-1 resize-none touch-manipulation border-none bg-transparent py-2 text-[15px] leading-snug outline-none placeholder:text-[var(--ink-3)] disabled:cursor-not-allowed lg:text-[14px]"
                    style={{ color: "var(--ink)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={(!draft.trim() && !selectedFile) || inputDisabled || sendingMedia}
                    className="d-prim flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: "var(--red)", color: "#fff", border: "none" }}
                    aria-label="Enviar"
                  >
                    {sendingMedia ? (
                      <Spinner className="h-[18px] w-[18px] animate-spin" />
                    ) : (
                      <IconSend className="h-[18px] w-[18px]" />
                    )}
                  </button>
                </div>
                {replyBlockedByMeta && (
                  <p className="mt-2.5 w-full min-w-0 text-[12px] leading-relaxed [overflow-wrap:anywhere]" style={{ color: "var(--ink-2)" }}>
                    Han pasado más de 24 horas desde el último mensaje del huésped, o no hay mensajes
                    suyos. No puedes responder por política de Meta.
                  </p>
                )}
                </div>
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--ink-2)" }}>Selecciona una conversación</p>
              <p className="max-w-xs text-[13px]" style={{ color: "var(--ink-3)" }}>Cola unificada con estados IA y prioridad.</p>
            </div>
          )}
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho del panel"
          onMouseDown={startColumnResize("right")}
          className="group hidden w-1 shrink-0 cursor-col-resize items-stretch lg:flex"
          title="Arrastra para ajustar el ancho"
        >
          <span className="block h-full w-px bg-[var(--line)] transition-colors group-hover:w-1 group-hover:bg-[var(--red)]" />
        </div>

        <aside
          className="hidden h-full min-h-0 shrink-0 flex-col lg:flex"
          style={{
            background: "var(--panel)",
            borderLeft: "1px solid var(--line)",
            ...(isDesktop ? { width: rightWidth } : { width: 312 }),
          }}
        >
          {selected && (
            <GuestPanelContent
              conversation={selected}
              onTakeHuman={takeHumanControl}
              onReactivateAi={reactivateAi}
              onComplete={markCompleted}
              onResolveRequest={resolveRequest}
              onReopen={reopenConversation}
              resolvingRequest={resolvingRequest}
              pendingAction={pendingAction}
            />
          )}
        </aside>
      </div>

      {guestOpen && selected && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            type="button"
            className="absolute inset-0 bg-[#1f1f1c]/30 backdrop-blur-sm"
            aria-label="Cerrar"
            onClick={() => setGuestOpen(false)}
          />
          <div
            className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col shadow-2xl"
            style={{ borderLeft: "1px solid var(--line)", background: "var(--panel)" }}
          >
            <div
              className="flex h-14 shrink-0 items-center justify-between px-4"
              style={{ borderBottom: "1px solid var(--line)", background: "var(--panel)" }}
            >
              <span className="grotesk text-[15px] font-bold" style={{ color: "var(--ink)" }}>Ficha operativa</span>
              <button
                type="button"
                onClick={() => setGuestOpen(false)}
                className="d-soft flex h-10 w-10 items-center justify-center rounded-xl"
                style={{ color: "var(--ink-2)" }}
                aria-label="Cerrar panel"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="ibx-scroll min-h-0 flex-1 overflow-y-auto">
              <GuestPanelContent
                conversation={selected}
                onTakeHuman={takeHumanControl}
                onReactivateAi={reactivateAi}
                onComplete={markCompleted}
                onResolveRequest={resolveRequest}
                onReopen={reopenConversation}
                resolvingRequest={resolvingRequest}
                pendingAction={pendingAction}
              />
            </div>
          </div>
        </div>
      )}
      {moderationDialogAction && selected && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="moderation-dialog-title"
          onClick={() => !moderationInProgress && setModerationDialogAction(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="moderation-dialog-title" className="grotesk text-[15px] font-bold" style={{ color: "var(--ink)" }}>
              {moderationDialogAction === "block" ? "Bloquear conversación" : "Desbloquear conversación"}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
              {moderationDialogAction === "block" ? (
                <>
                  ¿Bloquear a {selected.guest.name || selected.guestPhone}? Esta acción se puede revertir
                  desde el inbox o Supabase.
                </>
              ) : (
                <>¿Desbloquear a {selected.guest.name || selected.guestPhone}?</>
              )}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={moderationInProgress}
                onClick={() => setModerationDialogAction(null)}
                className="d-soft grotesk rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
                style={{ border: "1px solid var(--line)", color: "var(--ink-2)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={moderationInProgress}
                onClick={() => void applyConversationModeration(moderationDialogAction)}
                className="d-prim grotesk rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--red)", border: "none" }}
              >
                {moderationInProgress
                  ? moderationDialogAction === "block"
                    ? "Bloqueando…"
                    : "Desbloqueando…"
                  : moderationDialogAction === "block"
                    ? "Bloquear"
                    : "Desbloquear"}
              </button>
            </div>
          </div>
        </div>
      )}
      <StartConversationModal
        open={startConversationOpen}
        activeHotelId={conversationHotelId}
        onClose={() => setStartConversationOpen(false)}
        onSuccess={() =>
          setTemplateToast({ type: "success", message: "Plantilla enviada correctamente" })
        }
        onError={() =>
          setTemplateToast({
            type: "error",
            message: "No se pudo enviar la plantilla. Intenta nuevamente.",
          })
        }
      />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />
    </div>
  );
}

function formatActivityIso(iso: string) {
  try {
    return new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
  } catch {
    return "—";
  }
}

type SummaryFetchResult =
  | { kind: "ok"; text: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

async function fetchConversationSummaryFromApi(conversationId: string): Promise<SummaryFetchResult> {
  const summaryRes = await fetch(
    `/api/conversation-summary?conversation_id=${encodeURIComponent(conversationId)}`,
    { credentials: "include", cache: "no-store" }
  );
  const summaryPayload = (await summaryRes.json()) as {
    data?: { summary: string | null } | null;
    supabaseError?: { message: string; code?: string; details?: string; hint?: string } | null;
    error?: string;
  };

  if (summaryRes.status === 401) {
    return { kind: "error", message: "Sesión no válida. Vuelve a iniciar sesión." };
  }
  if (summaryRes.status === 400) {
    return { kind: "error", message: summaryPayload.error ?? "Parámetros no válidos." };
  }
  if (summaryRes.status === 500) {
    return { kind: "error", message: summaryPayload.error ?? "Error al leer el resumen." };
  }
  if (summaryPayload.supabaseError) {
    return {
      kind: "error",
      message: "No se pudo cargar el resumen: " + summaryPayload.supabaseError.message,
    };
  }
  const row = summaryPayload.data;
  if (!row || typeof row.summary !== "string" || !row.summary.trim()) {
    return { kind: "empty" };
  }
  return { kind: "ok", text: row.summary.trim() };
}

/** Fila de datos en mono (clave izquierda gris, valor derecha) del panel cockpit. */
function MonoRow({ k, v, accent }: { k: string; v: string; accent?: string }) {
  return (
    <div
      className="ibx-mono flex justify-between gap-3"
      style={{ padding: "8px 0", fontSize: 12, borderBottom: "1px solid var(--line-2)" }}
    >
      <span style={{ color: "var(--ink-3)" }}>{k}</span>
      <span className="text-right" style={{ color: accent ?? "var(--ink)", fontWeight: 500 }}>
        {v}
      </span>
    </div>
  );
}

/** Etiqueta de sección del cockpit (mono, uppercase, tracking ancho). */
function CockpitLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="ibx-mono"
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--ink-3)" }}
    >
      {children}
    </span>
  );
}

function GuestPanelContent({
  conversation,
  onTakeHuman,
  onReactivateAi,
  onComplete,
  onResolveRequest,
  onReopen,
  resolvingRequest,
  pendingAction,
}: {
  conversation: Conversation;
  onTakeHuman: () => void;
  onReactivateAi: () => void;
  onComplete: () => void;
  onResolveRequest: () => void;
  onReopen: () => void;
  resolvingRequest: boolean;
  pendingAction: null | "human" | "ai" | "complete" | "reopen";
}) {
  const { guest } = conversation;
  const iaEstado =
    conversation.aiActive && conversation.controlMode === "ai" ? "Activa" : "En pausa";
  const hasTags = guest.tags.length > 0;
  const notesAreDefault = guest.internalNotes.startsWith("Sin notas");
  const isPendingRequest = conversation.request === "pending";
  const isClosed = conversation.operationalStatus === "closed";
  const actionsBusy = pendingAction !== null || resolvingRequest;
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryLoadMode, setSummaryLoadMode] = useState<"initial" | "regenerate">("initial");
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [summaryText, setSummaryText] = useState<string | null>(null);
  const [summaryDbEmpty, setSummaryDbEmpty] = useState(false);
  const summaryPanelGenRef = useRef(0);

  const applySummaryResult = useCallback((r: SummaryFetchResult) => {
    if (r.kind === "ok") {
      setSummaryText(r.text);
      setSummaryDbEmpty(false);
      setSummaryError(null);
    } else if (r.kind === "empty") {
      setSummaryText(null);
      setSummaryDbEmpty(true);
      setSummaryError(null);
    } else {
      setSummaryText(null);
      setSummaryDbEmpty(false);
      setSummaryError(r.message);
    }
  }, []);

  useEffect(() => {
    const cid = conversation.id;
    const gen = ++summaryPanelGenRef.current;

    setSummaryLoading(true);
    setSummaryLoadMode("initial");
    setSummaryError(null);
    setSummaryText(null);
    setSummaryDbEmpty(false);

    void (async () => {
      const result = await fetchConversationSummaryFromApi(cid);
      if (gen !== summaryPanelGenRef.current) {
        return;
      }
      applySummaryResult(result);
      setSummaryLoading(false);
    })();
  }, [conversation.id, applySummaryResult]);

  const createChatSummary = useCallback(async () => {
    const gen = ++summaryPanelGenRef.current;
    setSummaryLoading(true);
    setSummaryLoadMode("regenerate");
    setSummaryError(null);
    setSummaryText(null);
    setSummaryDbEmpty(false);
    try {
      try {
        const res = await fetch("/api/create-conversation-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversation_id: conversation.id }),
        });
        if (gen !== summaryPanelGenRef.current) {
          return;
        }
        if (res.status === 401) {
          if (gen === summaryPanelGenRef.current) {
            setSummaryError("Sesión no válida. Vuelve a iniciar sesión.");
          }
          return;
        }
        if (res.status === 400) {
          const data = (await res.json()) as { error?: string };
          if (gen === summaryPanelGenRef.current) {
            setSummaryError(data.error ?? "Solicitud no válida.");
          }
          return;
        }
      } catch {
        // El webhook vía API puede fallar; seguimos y leemos Supabase
      }

      if (gen !== summaryPanelGenRef.current) {
        return;
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, 2000);
      });

      if (gen !== summaryPanelGenRef.current) {
        return;
      }

      console.log(
        "[conversation summary] conversation_id (UUID activo, antes del fetch):",
        conversation.id
      );

      const result = await fetchConversationSummaryFromApi(conversation.id);
      console.log("[conversation summary] resultado tras generar:", result);
      if (gen !== summaryPanelGenRef.current) {
        return;
      }
      applySummaryResult(result);
    } catch (e) {
      if (gen === summaryPanelGenRef.current) {
        setSummaryError(
          e instanceof Error
            ? e.message
            : "Error inesperado. Comprueba la conexión e inténtalo de nuevo."
        );
      }
    } finally {
      if (gen === summaryPanelGenRef.current) {
        setSummaryLoading(false);
      }
    }
  }, [conversation.id, applySummaryResult]);

  return (
    <div className="flex h-full flex-col px-4 pb-4" style={{ background: "var(--panel)" }}>
      {/* Cabecera */}
      <div className="flex shrink-0 items-center gap-3 pb-4 pt-[18px]" style={{ borderBottom: "1px solid var(--line)" }}>
        <Avatar name={guest.name} seed={guest.id} size={50} />
        <div className="min-w-0">
          <div className="grotesk truncate" style={{ fontSize: 16, fontWeight: 700, color: "var(--ink)" }}>
            {guest.name}
          </div>
          <div className="ibx-mono mt-0.5 truncate" style={{ fontSize: 11, color: "var(--ink-3)" }}>
            {guest.phone}
          </div>
        </div>
      </div>

      {/* Acciones */}
      <div className="shrink-0 py-4" style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="mb-3">
          <CockpitLabel>Acciones</CockpitLabel>
        </div>
        {isClosed ? (
          <button
            type="button"
            onClick={onReopen}
            disabled={actionsBusy}
            aria-busy={pendingAction === "reopen"}
            className="d-prim grotesk flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
            style={{ padding: 12, borderRadius: 11, border: "none", background: "var(--red)", color: "#fff", fontSize: 14, fontWeight: 700 }}
          >
            {pendingAction === "reopen" ? (
              <>
                <Spinner className="h-4 w-4 animate-spin" />
                Reactivando…
              </>
            ) : (
              <>
                <IconCheck className="h-[17px] w-[17px]" style={{ color: "#fff" }} aria-hidden />
                Reactivar conversación
              </>
            )}
          </button>
        ) : (
          <>
            {isPendingRequest && (
              <button
                type="button"
                onClick={onResolveRequest}
                disabled={actionsBusy}
                aria-busy={resolvingRequest}
                className="d-prim grotesk mb-2.5 flex w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ padding: 12, borderRadius: 11, border: "none", background: "var(--red)", color: "#fff", fontSize: 14, fontWeight: 700 }}
              >
                {resolvingRequest ? (
                  <>
                    <Spinner className="h-4 w-4 animate-spin" />
                    Resolviendo…
                  </>
                ) : (
                  <>
                    <IconCheck className="h-[17px] w-[17px]" style={{ color: "#fff" }} aria-hidden />
                    Asunto resuelto
                  </>
                )}
              </button>
            )}
            <div className="grid grid-cols-2 gap-2">
              <CmdAction
                icon={IconUserCircle}
                label="Tomar control humano"
                hint="⌘H"
                busy={pendingAction === "human"}
                onClick={onTakeHuman}
                disabled={actionsBusy}
              />
              <CmdAction
                icon={IconSparkles}
                label="Reactivar IA"
                hint="⌘R"
                busy={pendingAction === "ai"}
                onClick={onReactivateAi}
                disabled={actionsBusy}
              />
              <CmdAction
                icon={IconCheck}
                label="Marcar como completado"
                hint="⌘D"
                busy={pendingAction === "complete"}
                onClick={onComplete}
                disabled={actionsBusy}
              />
              <CmdAction
                icon={IconSparkles}
                label="Crear resumen del chat"
                hint="⌘S"
                busy={summaryLoading}
                onClick={() => void createChatSummary()}
                disabled={summaryLoading}
              />
            </div>
          </>
        )}
      </div>

      <div className="ibx-scroll min-h-0 flex-1 overflow-y-auto">
        {/* Resumen del chat */}
        <div className="py-4" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="mb-3 flex items-center">
            <CockpitLabel>Resumen del chat</CockpitLabel>
            <button
              type="button"
              onClick={() => void createChatSummary()}
              disabled={summaryLoading}
              className="d-act grotesk ml-auto inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ padding: "4px 9px", border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--red)", borderRadius: 7, fontSize: 11.5, fontWeight: 700 }}
            >
              <Spark className="h-3 w-3" style={{ color: "var(--red)" }} aria-hidden />
              Generar
            </button>
          </div>
          {summaryLoading && (
            <div
              className="flex items-center gap-2.5 rounded-xl px-3 py-3 text-[13px]"
              style={{ border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-2)" }}
              role="status"
              aria-live="polite"
            >
              <Spinner className="h-4 w-4 shrink-0 animate-spin text-[var(--red)]" />
              <span>
                {summaryLoadMode === "initial"
                  ? "Cargando resumen…"
                  : "Generando resumen, espera un momento…"}
              </span>
            </div>
          )}
          {!summaryLoading && summaryError && (
            <div
              className="rounded-xl px-3 py-2.5 text-[13px] leading-relaxed"
              style={{ border: "1px solid var(--red)", background: "var(--red-soft)", color: "var(--red-deep)" }}
              role="alert"
            >
              {summaryError}
            </div>
          )}
          {!summaryLoading && !summaryError && summaryText && (
            <div className="min-w-0 rounded-lg p-3" style={{ background: "var(--panel-2)", border: "1px solid var(--line)" }}>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed" style={{ color: "var(--ink)" }}>
                {summaryText}
              </p>
            </div>
          )}
          {!summaryLoading && !summaryError && summaryDbEmpty && (
            <p className="ibx-mono text-[12px]" style={{ color: "var(--ink-3)" }}>Sin resumen aún.</p>
          )}
        </div>

        {/* Datos */}
        <div className="py-4">
          <div className="mb-2">
            <CockpitLabel>Datos</CockpitLabel>
          </div>
          <MonoRow k="Teléfono" v={guest.phone} />
          <MonoRow k="Canal" v="WhatsApp" />
          <MonoRow k="Estado IA" v={iaEstado} />
          <MonoRow k="Última actividad" v={formatActivityIso(conversation.lastActivityIso)} />
          <MonoRow k="Mensajes (cargados)" v={String(conversation.messages.length)} />
          <MonoRow k="Needs Human (BD)" v={conversation.needsHuman ? "Sí" : "No"} />
          <MonoRow
            k="Request (BD)"
            v={conversation.request ?? "—"}
            accent={isPendingRequest ? "var(--red)" : undefined}
          />
          <MonoRow k="IA activa (BD)" v={conversation.aiActive ? "Sí" : "No"} />
          <MonoRow k="Estado (BD)" v={conversation.dbStatus ?? "—"} />
          <MonoRow k="Bloqueado" v={conversation.blocked ? "Sí" : "No"} />
          {conversation.blockedAt && (
            <MonoRow k="blocked_at" v={formatActivityIso(conversation.blockedAt)} />
          )}
        </div>

        {/* Cotización / propiedad */}
        <div className="py-4" style={{ borderTop: "1px solid var(--line)" }}>
          <div className="mb-2 flex items-center gap-2">
            <IconBuilding className="h-4 w-4" style={{ color: "var(--ink-3)" }} aria-hidden />
            <CockpitLabel>Cotización / propiedad</CockpitLabel>
          </div>
          <p className="text-[14px] font-medium leading-snug" style={{ color: "var(--ink)" }}>{guest.property}</p>
        </div>

        {!notesAreDefault && (
          <div className="py-4" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="mb-2 flex items-center gap-2">
              <IconNote className="h-4 w-4" style={{ color: "var(--gold)" }} aria-hidden />
              <CockpitLabel>Notas (tabla / handoff)</CockpitLabel>
            </div>
            <p
              className="rounded-lg p-3 text-[13px] leading-relaxed"
              style={{ background: "color-mix(in srgb, var(--gold) 10%, transparent)", color: "var(--ink)" }}
            >
              {guest.internalNotes}
            </p>
          </div>
        )}

        {hasTags && (
          <div className="py-4" style={{ borderTop: "1px solid var(--line)" }}>
            <div className="mb-3 flex items-center gap-2">
              <IconTag className="h-4 w-4" style={{ color: "var(--ink-3)" }} aria-hidden />
              <CockpitLabel>Etiquetas</CockpitLabel>
            </div>
            <div className="flex flex-wrap gap-2">
              {guest.tags.map((tag) => (
                <span
                  key={tag}
                  className="grotesk"
                  style={{ padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--panel-2)", color: "var(--ink-2)" }}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2 py-4" style={{ borderTop: "1px solid var(--line)" }}>
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(guest.phone)}
            className="d-act grotesk flex flex-1 items-center justify-center gap-2"
            style={{ padding: "10px", borderRadius: 11, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink)", fontSize: 12, fontWeight: 600 }}
          >
            <IconPhone className="h-4 w-4" />
            Copiar teléfono
          </button>
        </div>

        <p className="ibx-mono pb-2 text-center text-[10px]" style={{ color: "var(--ink-3)" }}>FerrarIA · Supabase + n8n</p>
      </div>
    </div>
  );
}
