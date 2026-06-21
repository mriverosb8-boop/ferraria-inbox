"use client";

import type { ClipboardEvent, SVGProps } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { avatarGradientClass, initials } from "@/lib/avatar";
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
const COMPOSER_MIN_HEIGHT_PX = 48;
const COMPOSER_MAX_HEIGHT_PX = 168;
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

const operationalConfig: Record<
  OperationalStatus,
  { label: string; short: string; dot: string; chip: string; listTint: string }
> = {
  ai_active: {
    label: "IA activa",
    short: "IA",
    dot: "bg-violet-500",
    chip: "bg-violet-100 text-violet-900 ring-1 ring-violet-200/90",
    listTint: "border-violet-200/70",
  },
  requires_attention: {
    label: "Requiere atención",
    short: "Atención",
    dot: "bg-amber-600",
    chip: "bg-amber-100 text-amber-950 ring-1 ring-amber-200/90",
    listTint: "border-amber-200/70",
  },
  closed: {
    label: "Completada",
    short: "Hecho",
    dot: "bg-stone-400",
    chip: "bg-stone-200 text-stone-800 ring-1 ring-stone-300/90",
    listTint: "border-stone-300/80",
  },
};

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

function Avatar({
  name,
  seed,
  size = "md",
}: {
  name: string;
  seed: string;
  size?: "sm" | "md" | "lg";
}) {
  const grad = avatarGradientClass(seed);
  const sizeClasses = {
    sm: "h-9 w-9 text-[11px] ring-2",
    md: "h-11 w-11 text-xs ring-2",
    lg: "h-16 w-16 text-lg ring-2",
  };
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold text-white shadow-inner ring-2 ring-white ${grad} ${sizeClasses[size]}`}
      aria-hidden
    >
      {initials(name)}
    </div>
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

  const shell = isHandoffCause
    ? isUser
      ? "mr-auto rounded-2xl rounded-bl-md border border-amber-200/85 border-l-[3px] border-l-amber-500 bg-gradient-to-br from-amber-50/90 to-white text-[#1f1f1c] shadow-sm ring-1 ring-amber-100/70"
      : isAi
        ? "ml-auto rounded-2xl rounded-br-md border border-amber-200/70 border-l-[3px] border-l-amber-500 bg-gradient-to-br from-amber-50/70 to-[#ebe4dc] text-[#1f1f1c] ring-1 ring-amber-200/50 shadow-sm"
        : "ml-auto rounded-2xl rounded-br-md border border-amber-200/70 border-l-[3px] border-l-amber-500 bg-gradient-to-br from-amber-50/60 to-[#e2ebf4] text-[#1f1f1c] ring-1 ring-amber-200/45 shadow-sm"
    : isUser
      ? "mr-auto rounded-2xl rounded-bl-md border border-[#e7dfd4] bg-white text-[#1f1f1c] shadow-sm ring-1 ring-black/[0.04]"
      : isAi
        ? "ml-auto rounded-2xl rounded-br-md bg-gradient-to-br from-[#ebe4dc] to-[#e3dbd2] text-[#1f1f1c] ring-1 ring-[#d4c9bc] shadow-sm"
        : "ml-auto rounded-2xl rounded-br-md bg-gradient-to-br from-[#e4edf5] to-[#dce6f0] text-[#1f1f1c] ring-1 ring-[#c5d4e0] shadow-sm";

  const label = isAi ? "AI" : isAgent ? "Human" : "Huésped";
  const LabelIcon = isAi ? IconSparkles : isAgent ? IconUserCircle : IconGuest;
  const isTranscribedVoice =
    isUser && typeof m.format === "string" && m.format.trim().toLowerCase() === "audio";
  const hasImageSource = Boolean(m.mediaUrl || m.mediaStoragePath);
  const isDocument = isMessageDocument(m);
  const timeLabel = formatMessageDisplayTime(m as unknown as Record<string, unknown>) || m.sentAt;
  const isOutboundHotel = !isUser;
  const deliveryStatus = m.status ?? "confirmed";

  return (
    <div className={`flex w-full min-w-0 gap-2 sm:gap-2.5 ${isUser ? "justify-start" : "justify-end"}`}>
      {isUser && (
        <div className="mt-0.5 shrink-0 self-end">
          <Avatar name={guestName} seed={guestSeed} size="sm" />
        </div>
      )}
      <div
        className={`flex min-w-0 flex-col gap-1 ${isUser ? "items-start" : "items-end"} max-w-[min(88%,20rem)] sm:max-w-[min(85%,24rem)] lg:max-w-[min(75%,42rem)]`}
      >
        <span className="inline-flex max-w-full shrink-0 items-center gap-1 rounded-full border border-[#e7dfd4] bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#6b665e] shadow-sm ring-1 ring-black/[0.03]">
          <LabelIcon className="h-3 w-3 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
        </span>
        <div
          className={`w-fit max-w-full min-w-0 flex flex-col gap-1.5 break-words px-3.5 py-2.5 text-[15px] leading-snug shadow-sm [overflow-wrap:anywhere] sm:px-4 sm:text-[14px] sm:leading-relaxed lg:text-[14px] ${shell}`}
        >
          {isHandoffCause && (
            <p className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[9px] font-medium leading-tight text-amber-950/80 sm:text-[10px]">
              <span className="inline-flex max-w-full items-center gap-0.5 rounded-md border border-amber-300/55 bg-amber-100/55 px-1.5 py-0.5 ring-1 ring-amber-200/35">
                <span aria-hidden>⚠️</span>
                <span>Solicitó agente humano</span>
              </span>
            </p>
          )}
          {isTranscribedVoice && (
            <p className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[9px] font-medium leading-tight text-[#6b665e] sm:text-[10px]">
              <span className="inline-flex items-center gap-0.5 rounded-md border border-[#e7dfd4] bg-[#f8f6f2] px-1.5 py-0.5 ring-1 ring-black/[0.03]">
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
          <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:mt-2 sm:gap-x-3">
            <time className="min-w-0 shrink text-[10px] font-medium tabular-nums text-[#6b665e]">
              {timeLabel}
            </time>
            {isOutboundHotel &&
              (deliveryStatus === "pending" ? (
                <IconCheck className="h-3.5 w-3.5 shrink-0 text-[#9a9388]" aria-label="Enviado" />
              ) : (
                <IconCheckCheck className="h-3.5 w-[18px] shrink-0 text-[#9a9388]" aria-label="Entregado" />
              ))}
            {isAi && m.aiMeta && (
              <span className="max-w-full break-words text-[10px] tabular-nums text-[#6b665e]/80">
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

  useEffect(() => {
    if (resolvedActiveHotelId && activeHotelId === null) {
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
    { id: "ai_active", label: "IA activa", count: filterCounts.ai_active },
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
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 w-full max-w-full flex-col overflow-x-hidden bg-[#f7f4ee] text-[#1f1f1c] supports-[height:100dvh]:min-h-[100dvh]">
      {urgentHandoffBannerVisible && (
        <div
          className="fixed right-4 top-4 z-[300] flex max-w-[min(100vw-2rem,20rem)] items-start gap-3 rounded-xl border border-amber-400/70 bg-gradient-to-br from-amber-100 to-amber-50/95 px-4 py-3 text-[13px] font-semibold leading-snug text-amber-950 shadow-lg shadow-amber-900/10 ring-1 ring-amber-300/50"
          role="status"
        >
          <span className="min-w-0 flex-1">🚨 Huésped requiere atención humana</span>
          <button
            type="button"
            onClick={dismissUrgentHandoffBanner}
            className="shrink-0 rounded-lg p-1 text-amber-900/70 transition hover:bg-amber-200/50 hover:text-amber-950"
            aria-label="Cerrar aviso"
          >
            ×
          </button>
        </div>
      )}
      {templateToast && (
        <div
          className={`fixed right-4 top-4 z-[320] max-w-[min(100vw-2rem,22rem)] rounded-xl border px-4 py-3 text-[13px] font-semibold leading-snug shadow-lg ring-1 ${
            templateToast.type === "success"
              ? "border-emerald-300/80 bg-emerald-50 text-emerald-950 shadow-emerald-900/10 ring-emerald-200/70"
              : "border-rose-300/80 bg-rose-50 text-rose-950 shadow-rose-900/10 ring-rose-200/70"
          }`}
          role={templateToast.type === "success" ? "status" : "alert"}
        >
          {templateToast.message}
        </div>
      )}
      <header
        className={`flex h-[52px] shrink-0 items-center border-b border-[#e7dfd4] bg-white/90 px-4 shadow-[0_1px_0_rgba(31,31,28,0.04)] backdrop-blur-xl lg:h-14 lg:px-6 ${mobileTab === "chat" ? "max-lg:hidden" : ""}`}
      >
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          <BrandHeaderMark size="sm" />
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold tracking-tight text-[#1f1f1c]">FerrarIA Inbox</h1>
            <p className="truncate text-[11px] leading-tight text-[#6b665e]">Recepción · IA + agente humano</p>
          </div>
          <InboxHeaderTabs hotelId={conversationHotelId} />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={`inline-flex max-w-[min(12rem,calc(100vw-8rem))] truncate rounded-lg border px-2 py-1 text-[10px] font-semibold tabular-nums shadow-sm sm:max-w-none sm:px-2.5 sm:text-[11px] ${
              realtimeUiStatus === "connected"
                ? "border-emerald-300/90 bg-emerald-50 text-emerald-950"
                : realtimeUiStatus === "error"
                  ? "border-rose-300/90 bg-rose-50 text-rose-950"
                  : "border-amber-300/80 bg-amber-50/95 text-amber-950"
            }`}
            title={`Supabase Realtime: public.${CONVERSATIONS_TABLE}, public.${WUBBY_TABLE}${realtimeErrorDetail ? ` · ${realtimeErrorDetail}` : ""}`}
          >
            {realtimeUiStatus === "connected" && "Realtime: conectado"}
            {realtimeUiStatus === "waiting" && "Realtime: esperando eventos"}
            {realtimeUiStatus === "error" && "Realtime: error"}
          </span>
          <span className="hidden rounded-lg border border-[#e7dfd4] bg-[#f1ece4] px-2.5 py-1 text-[11px] font-medium tabular-nums text-[#6b665e] shadow-sm sm:inline-flex">
            {filterCounts.unread} sin leer
          </span>
          <button
            type="button"
            onClick={() => setHelpOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#d8bd93] bg-[#faf6ee] px-2.5 py-1 text-[11px] font-semibold text-[#8a6d3f] shadow-sm transition hover:border-[#c8a97e] hover:bg-[#f3e9d6] hover:text-[#6f562f]"
          >
            <IconHelp className="h-3.5 w-3.5" />
            Ayuda
          </button>
          <LogoutButton />
        </div>
      </header>

      {error && (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-center text-[13px] text-rose-900">
          {error}
        </div>
      )}

      {actionError && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-[13px] text-amber-950">
          {actionError}
          <button
            type="button"
            className="ml-2 underline decoration-amber-600/80 underline-offset-2"
            onClick={() => setActionError(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 overflow-x-hidden">
        <aside
          className={`${
            mobileTab === "list" ? "flex" : "hidden"
          } h-full w-full min-h-0 min-w-0 flex-col border-[#e7dfd4] bg-[#f8f6f2] lg:flex lg:h-auto lg:w-[min(100%,400px)] lg:max-w-[min(100vw,28rem)] lg:shrink-0 lg:border-r`}
        >
          <div className="shrink-0 space-y-3 border-b border-[#e7dfd4] bg-white/60 px-4 pb-4 pt-4">
            <div className="flex items-end justify-between gap-2">
              <div>
                <h2 className="text-[13px] font-semibold uppercase tracking-wider text-[#6b665e]">Cola operativa</h2>
                <p className="mt-0.5 text-[11px] text-[#9c968c]">Estado IA / prioridad</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-md border border-[#e7dfd4] bg-[#f1ece4] px-2 py-0.5 text-[11px] font-medium tabular-nums text-[#6b665e] shadow-sm">
                  {filtered.length}/{conversations.length}
                </span>
                <div ref={globalActionsRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setGlobalActionsOpen((open) => !open)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e7dfd4] bg-white text-[#6b665e] shadow-sm transition hover:bg-[#f1ece4] hover:text-[#1f1f1c]"
                    aria-label="Abrir acciones"
                    aria-haspopup="menu"
                    aria-expanded={globalActionsOpen}
                  >
                    <IconMore className="h-4 w-4" aria-hidden />
                  </button>
                  {globalActionsOpen && (
                    <div
                      className="absolute right-0 top-[calc(100%+0.5rem)] z-[230] w-56 overflow-hidden rounded-xl border border-[#e7dfd4] bg-white py-1.5 shadow-xl shadow-[#1f1f1c]/10 ring-1 ring-black/[0.04]"
                      role="menu"
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setGlobalActionsOpen(false);
                          setStartConversationOpen(true);
                        }}
                        className="flex w-full items-center px-3.5 py-2.5 text-left text-[13px] font-semibold text-[#1f1f1c] transition hover:bg-[#f8f6f2]"
                        role="menuitem"
                      >
                        Comenzar conversación
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <label className="relative block">
              <IconSearch className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9c968c]" />
              <input
                type="search"
                placeholder="Buscar huésped, mensaje o hotel…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full rounded-xl border border-[#e7dfd4] bg-white py-3 pl-11 pr-3.5 text-[14px] text-[#1f1f1c] shadow-sm placeholder:text-[#9c968c] transition focus:border-[#c8a97e] focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20"
              />
            </label>

            <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {filterTabs.map((tab) => {
                const active = statusFilter === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    className={`shrink-0 rounded-lg px-2.5 py-2 text-[11px] font-medium transition sm:px-3 sm:text-[12px] ${
                      active
                        ? "border border-[#c8a97e]/50 bg-[#f1ece4] text-[#1f1f1c] shadow-sm ring-1 ring-[#c8a97e]/25"
                        : "border border-transparent bg-white/80 text-[#6b665e] shadow-sm hover:border-[#e7dfd4] hover:bg-white"
                    }`}
                  >
                    {tab.label}
                    <span className={`ml-1 tabular-nums sm:ml-1.5 ${active ? "text-[#8a7a62]" : "text-[#9c968c]"}`}>
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
                <div>
                  <span
                    id="active-hotel-label"
                    className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-[#6b665e]"
                  >
                    Hotel activo
                  </span>
                  <div ref={hotelSelectRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setHotelSelectOpen((open) => !open)}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-xl border border-[#e7dfd4] bg-white py-2.5 pl-3.5 pr-3 text-[13px] text-[#1f1f1c] shadow-sm transition focus:border-[#c8a97e] focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20"
                      aria-haspopup="listbox"
                      aria-expanded={hotelSelectOpen}
                      aria-labelledby="active-hotel-label"
                    >
                      <span className="truncate">{selectedHotel?.name ?? "Seleccionar hotel"}</span>
                      <IconChevronDown
                        className={`h-4 w-4 shrink-0 text-[#6b665e] transition-transform ${
                          hotelSelectOpen ? "rotate-180" : ""
                        }`}
                        aria-hidden
                      />
                    </button>
                    {hotelSelectOpen && (
                      <div
                        className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-[230] overflow-hidden rounded-xl border border-[#e7dfd4] bg-white py-1.5 shadow-xl shadow-[#1f1f1c]/10 ring-1 ring-black/[0.04]"
                        role="listbox"
                        aria-labelledby="active-hotel-label"
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
                              className={`flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-[13px] transition hover:bg-[#f8f6f2] ${
                                isSelected ? "bg-[#f1ece4] font-semibold text-[#1f1f1c]" : "text-[#1f1f1c]"
                              }`}
                            >
                              <span className="truncate">{hotel.name}</span>
                              {isSelected && <IconCheck className="h-4 w-4 shrink-0 text-[#c8a97e]" aria-hidden />}
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

          <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8f6f2] scrollbar-app">
            {loading ? (
              <InboxListSkeleton />
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <p className="text-sm font-medium text-[#6b665e]">No hay conversaciones</p>
                <p className="max-w-[240px] text-[13px] leading-relaxed text-[#9c968c]">
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
                const propertyLabel = c.guest.property.split("—")[0]?.trim();
                const showProperty =
                  propertyLabel &&
                  !["sin propiedad indicada", "true", "false"].includes(propertyLabel.toLowerCase());
                const followupTimer = followupTimers.get(c.id);
                const baseClasses = active
                  ? "z-[1] bg-white shadow-[inset_3px_0_0_0_#c8a97e] ring-1 ring-inset ring-[#e7dfd4]"
                  : `hover:bg-white/70 ${op.listTint} border-l-2 border-l-transparent hover:border-l-[#e7dfd4]`;
                const pendingClasses = isPending
                  ? active
                    ? "bg-rose-50/60 shadow-[inset_3px_0_0_0_#e11d48] ring-1 ring-inset ring-rose-200"
                    : "bg-rose-50/70 border-l-2 border-l-rose-500 hover:border-l-rose-500 hover:bg-rose-50"
                  : hasUnread && !active
                    ? "bg-amber-50/80"
                    : "";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => openChat(c.id)}
                    className={`group relative flex w-full items-start gap-3.5 border-b border-[#ebe5dc] px-4 py-3.5 text-left transition ${baseClasses} ${pendingClasses}`}
                  >
                    <div className="relative shrink-0 pt-0.5">
                      <Avatar name={c.guest.name} seed={c.guest.id} size="md" />
                      {isPending && (
                        <span
                          className="absolute -right-0.5 -top-0.5 flex h-[14px] w-[14px] items-center justify-center rounded-full bg-rose-500 shadow-md ring-2 ring-white"
                          aria-label="Pendiente de atención humana"
                          title="Pendiente de atención humana"
                        >
                          <span className="h-[6px] w-[6px] rounded-full bg-white" aria-hidden />
                        </span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span
                          className={`truncate text-[15px] leading-tight ${hasUnread || isPending ? "font-semibold text-[#1f1f1c]" : "font-medium text-[#3d3a36]"}`}
                        >
                          {c.guest.name}
                        </span>
                        {c.blocked && <BlockedBadge />}
                      </div>
                      <p className="mt-0.5 line-clamp-2 text-[13px] leading-snug text-[#6b665e] group-hover:text-[#4a4742]">
                        {c.lastMessagePreview}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {isPending && (
                          <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm ring-1 ring-rose-700/40">
                            <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                            Pendiente
                          </span>
                        )}
                        <span
                          className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${op.chip}`}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${op.dot}`} aria-hidden />
                          {op.label}
                        </span>
                        {c.operationalStatus !== "ai_active" && (
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                              c.controlMode === "ai"
                                ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200/80"
                                : "bg-sky-100 text-sky-900 ring-1 ring-sky-200/80"
                            }`}
                          >
                            {c.controlMode === "ai" ? "Modo IA" : "Humano"}
                          </span>
                        )}
                        {showProperty && (
                          <span className="truncate text-[11px] text-[#9c968c]" title={propertyLabel}>
                            {propertyLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="ml-2 flex min-w-[44px] shrink-0 flex-col items-end gap-1 pr-1">
                      <span className="pt-0.5 text-[11px] tabular-nums text-[#9c968c]">{c.lastMessageAt}</span>
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
                          className="flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-white"
                          aria-label={`${c.unreadCount} mensajes sin leer`}
                          title={`${c.unreadCount} mensajes sin leer`}
                        >
                          {unreadLabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        <section
          className={`${
            mobileTab === "chat" ? "flex" : "hidden"
          } min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden bg-white lg:flex`}
        >
          {selected ? (
            <>
              <div className="flex min-h-[56px] shrink-0 items-center gap-3 border-b border-[#e7dfd4] bg-white/95 px-2 py-2 shadow-[0_1px_0_rgba(31,31,28,0.04)] backdrop-blur-md sm:gap-4 sm:px-5">
                <button
                  type="button"
                  onClick={() => setMobileTab("list")}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-[#6b665e] transition hover:bg-[#f1ece4] hover:text-[#1f1f1c] lg:hidden"
                  aria-label="Volver a conversaciones"
                >
                  <IconBack className="h-5 w-5" />
                </button>
                <div className="rounded-xl p-0.5 ring-2 ring-[#c8a97e]/40">
                  <Avatar name={selected.guest.name} seed={selected.guest.id} size="sm" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold text-[#1f1f1c]">{selected.guest.name}</h2>
                    {selected.blocked && <BlockedBadge />}
                    <span
                      className={`hidden shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide sm:inline-flex ${operationalConfig[selected.operationalStatus].chip}`}
                    >
                      {operationalConfig[selected.operationalStatus].short}
                    </span>
                    {selected.operationalStatus !== "ai_active" && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          selected.controlMode === "ai"
                            ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200/80"
                            : "bg-sky-100 text-sky-900 ring-1 ring-sky-200/80"
                        }`}
                      >
                        {selected.controlMode === "ai" ? "IA" : "Agente"}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-[#6b665e]">
                    <span className="inline-flex items-center gap-1.5">
                      <IconWhatsApp className="h-3.5 w-3.5 shrink-0 text-[#7d9a7a]" aria-hidden />
                      <span className="truncate">WhatsApp</span>
                    </span>
                    {selected.blocked && selected.blockedAt && (
                      <span className="text-[11px] text-[#9c968c]">
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
                  className="inline-flex h-9 shrink-0 items-center rounded-lg border border-[#e7dfd4] bg-white px-2.5 text-[11px] font-semibold text-[#6b665e] shadow-sm transition hover:bg-[#f1ece4]"
                >
                  {selected.blocked ? "Desbloquear" : "Bloquear"}
                </button>
                <button
                  type="button"
                  onClick={() => setGuestOpen(true)}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-[12px] font-semibold text-[#6b665e] transition hover:bg-[#f1ece4] lg:hidden"
                >
                  <IconGuest className="h-4 w-4" />
                  Ficha
                </button>
              </div>

              {conversationClosed && (
                <div className="shrink-0 border-b border-[#e7dfd4] bg-[#f1ece4] px-4 py-2 text-center text-[12px] text-[#6b665e]">
                  Conversación cerrada · reabre desde la ficha si necesitas seguir el hilo (demo)
                </div>
              )}

              <div
                className="min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 sm:py-4 lg:px-6 scrollbar-app"
                style={{
                  backgroundImage:
                    "radial-gradient(ellipse 90% 45% at 50% -15%, rgba(200,169,126,0.08), transparent), linear-gradient(180deg, #f8f6f2 0%, #ffffff 50%, #f7f4ee 100%)",
                }}
              >
                <div className="w-full min-w-0 space-y-2.5 sm:space-y-3.5 lg:space-y-4">
                  <p className="break-words px-0.5 text-[11px] font-medium uppercase tracking-widest text-[#9c968c] [overflow-wrap:anywhere] lg:text-center">
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

              <div className="relative z-20 w-full min-w-0 max-w-full shrink-0 border-t border-[#e7dfd4] bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 lg:px-6">
                {sendWarning && (
                  <p className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-950 [overflow-wrap:anywhere]">
                    {sendWarning}
                  </p>
                )}
                {fileError && (
                  <p className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[12px] text-rose-900 [overflow-wrap:anywhere]">
                    {fileError}
                  </p>
                )}
                {selectedFile && (
                  <div className="mb-3 flex max-w-full items-center gap-3 rounded-2xl border border-[#e7dfd4] bg-[#f8f6f2] p-2.5 shadow-sm ring-1 ring-black/[0.03]">
                    {selectedFileIsPdf || !filePreviewUrl ? (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-[11px] font-bold text-rose-700">
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
                      <p className="truncate text-[13px] font-semibold text-[#1f1f1c]">
                        {selectedFile.name}
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#6b665e]">
                        {selectedFileIsPdf ? "PDF adjunto" : "Imagen adjunta"} · {selectedFileSizeLabel}
                      </p>
                      {draft.trim() && (
                        <p className="mt-1 line-clamp-1 text-[12px] text-[#6b665e]">
                          Caption: {draft.trim()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      disabled={sendingMedia}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#e7dfd4] bg-white text-[#6b665e] shadow-sm transition hover:bg-[#f1ece4] hover:text-[#1f1f1c] disabled:cursor-not-allowed disabled:opacity-50"
                      aria-label="Quitar archivo"
                    >
                      ×
                    </button>
                  </div>
                )}
                <div
                  className={`flex w-full min-w-0 max-w-full items-end gap-2 sm:gap-3 ${inputDisabled ? "opacity-[0.55]" : ""} transition-opacity`}
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
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#e7dfd4] bg-[#f8f6f2] text-[#6b665e] shadow-sm transition hover:border-[#c8a97e]/60 hover:bg-white hover:text-[#1f1f1c] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Adjuntar archivo"
                    title="Adjuntar archivo"
                  >
                    <IconImage className="h-5 w-5" />
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
                          : "Responder como agente humano… (Enter para enviar)"
                    }
                    className="min-h-[3rem] min-w-0 flex-1 resize-none touch-manipulation rounded-2xl border border-[#e7dfd4] bg-[#f8f6f2] px-4 py-3 text-base leading-normal text-[#1f1f1c] shadow-sm placeholder:text-[#9c968c] transition focus:border-[#c8a97e] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#c8a97e]/20 disabled:cursor-not-allowed lg:px-5 lg:text-[14px] lg:leading-snug"
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={(!draft.trim() && !selectedFile) || inputDisabled || sendingMedia}
                    className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-[#8a9eae] to-[#6b7d8f] text-white shadow-md shadow-[#6b7d8f]/25 ring-1 ring-[#c5d4e0] transition hover:from-[#7d8fa0] hover:to-[#5f6f80] disabled:cursor-not-allowed disabled:opacity-35"
                    aria-label="Enviar"
                  >
                    {sendingMedia ? (
                      <Spinner className="h-5 w-5 animate-spin" />
                    ) : (
                      <IconSend className="h-5 w-5" />
                    )}
                  </button>
                </div>
                {replyBlockedByMeta && (
                  <p className="mt-2.5 w-full min-w-0 text-[12px] leading-relaxed text-[#6b665e] [overflow-wrap:anywhere]">
                    Han pasado más de 24 horas desde el último mensaje del huésped, o no hay mensajes
                    suyos. No puedes responder por política de Meta.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium text-[#6b665e]">Selecciona una conversación</p>
              <p className="max-w-xs text-[13px] text-[#9c968c]">Cola unificada con estados IA y prioridad.</p>
            </div>
          )}
        </section>

        <aside className="hidden h-full min-h-0 w-[min(400px,32vw)] min-w-[260px] max-w-[400px] shrink-0 flex-col border-l border-[#e7dfd4] bg-[#f8f6f2] lg:flex">
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
          <div className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col border-l border-[#e7dfd4] bg-[#f8f6f2] shadow-2xl shadow-[#1f1f1c]/10">
            <div className="flex h-14 shrink-0 items-center justify-between border-b border-[#e7dfd4] bg-white px-4">
              <span className="text-[15px] font-semibold text-[#1f1f1c]">Ficha operativa</span>
              <button
                type="button"
                onClick={() => setGuestOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#6b665e] transition hover:bg-[#f1ece4] hover:text-[#1f1f1c]"
                aria-label="Cerrar panel"
              >
                <IconClose className="h-5 w-5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-app">
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
            className="w-full max-w-sm rounded-2xl border border-[#e7dfd4] bg-white p-5 shadow-xl ring-1 ring-black/[0.06]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="moderation-dialog-title" className="text-[15px] font-semibold text-[#1f1f1c]">
              {moderationDialogAction === "block" ? "Bloquear conversación" : "Desbloquear conversación"}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed text-[#6b665e]">
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
                className="rounded-lg border border-[#e7dfd4] px-3 py-2 text-[13px] font-semibold text-[#6b665e] transition hover:bg-[#f1ece4] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={moderationInProgress}
                onClick={() => void applyConversationModeration(moderationDialogAction)}
                className="rounded-lg bg-[#4a4742] px-3 py-2 text-[13px] font-semibold text-white transition hover:bg-[#1f1f1c] disabled:opacity-50"
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

const TAG_STYLES = [
  "bg-sky-100 text-sky-900 ring-sky-200/80",
  "bg-violet-100 text-violet-900 ring-violet-200/80",
  "bg-amber-100 text-amber-950 ring-amber-200/80",
  "bg-emerald-100 text-emerald-900 ring-emerald-200/80",
  "bg-rose-100 text-rose-900 ring-rose-200/80",
  "bg-cyan-100 text-cyan-900 ring-cyan-200/80",
];

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
  const grad = avatarGradientClass(guest.id);
  const op = operationalConfig[conversation.operationalStatus];
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
    <div className="flex h-full flex-col">
      <div className={`relative shrink-0 overflow-hidden bg-gradient-to-br px-5 pb-5 pt-7 ${grad} ring-1 ring-[#e7dfd4]`}>
        <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(255,255,255,0.85),transparent)]" />
        <div className="relative flex flex-col items-center text-center">
          <div
            className={`flex h-[72px] w-[72px] items-center justify-center rounded-2xl bg-gradient-to-br text-2xl font-bold tracking-tight text-white shadow-lg ring-2 ring-white/60 ${grad}`}
          >
            {initials(guest.name)}
          </div>
          <h3 className="mt-3 text-lg font-semibold tracking-tight text-[#1f1f1c]">{guest.name}</h3>
          <p className="mt-1 font-mono text-[12px] text-[#6b665e]">{guest.phone}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${op.chip}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${op.dot}`} />
              {op.label}
            </span>
            {conversation.operationalStatus !== "ai_active" && (
              <span
                className={`rounded-lg px-2.5 py-1 text-[10px] font-bold uppercase ${
                  conversation.controlMode === "ai"
                    ? "bg-violet-100 text-violet-900 ring-1 ring-violet-200/80"
                    : "bg-sky-100 text-sky-900 ring-1 ring-sky-200/80"
                }`}
              >
                {conversation.controlMode === "ai" ? "Control IA" : "Control humano"}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-b border-[#e7dfd4] bg-white px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-[#6b665e]">Acciones rápidas</p>
        <div className="flex flex-col gap-2">
          {isClosed ? (
            <button
              type="button"
              onClick={onReopen}
              disabled={actionsBusy}
              aria-busy={pendingAction === "reopen"}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 py-2.5 text-[12px] font-semibold text-white shadow-md shadow-emerald-500/25 ring-1 ring-emerald-700/40 transition hover:from-emerald-700 hover:to-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {pendingAction === "reopen" ? (
                <>
                  <Spinner className="h-3.5 w-3.5 animate-spin" />
                  Reactivando…
                </>
              ) : (
                "Reactivar conversación"
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
                  className="group flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-500 py-2.5 text-[12px] font-semibold text-white shadow-md shadow-rose-500/25 ring-1 ring-rose-700/40 transition hover:from-rose-700 hover:to-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {resolvingRequest ? (
                    <>
                      <Spinner className="h-3.5 w-3.5 animate-spin" />
                      Resolviendo…
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />
                      Asunto resuelto
                    </>
                  )}
                </button>
              )}
              <button
                type="button"
                onClick={onTakeHuman}
                disabled={actionsBusy}
                aria-busy={pendingAction === "human"}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#c4a574] to-[#b8956a] py-2.5 text-[12px] font-semibold text-white shadow-md shadow-[#c8a97e]/25 ring-1 ring-[#b8956a]/40 transition hover:from-[#b8956a] hover:to-[#a8825c] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "human" ? (
                  <>
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                    Tomando control…
                  </>
                ) : (
                  "Tomar control humano"
                )}
              </button>
              <button
                type="button"
                onClick={onReactivateAi}
                disabled={actionsBusy}
                aria-busy={pendingAction === "ai"}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-violet-200 bg-violet-50 py-2.5 text-[12px] font-semibold text-violet-900 transition hover:bg-violet-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "ai" ? (
                  <>
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                    Reactivando IA…
                  </>
                ) : (
                  "Reactivar IA"
                )}
              </button>
              <button
                type="button"
                onClick={onComplete}
                disabled={actionsBusy}
                aria-busy={pendingAction === "complete"}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#e7dfd4] bg-[#f1ece4] py-2.5 text-[12px] font-semibold text-[#1f1f1c] transition hover:bg-[#ebe3d8] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {pendingAction === "complete" ? (
                  <>
                    <Spinner className="h-3.5 w-3.5 animate-spin" />
                    Completando…
                  </>
                ) : (
                  "Marcar como completado"
                )}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => void createChatSummary()}
            disabled={summaryLoading}
            aria-busy={summaryLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#c5d4e0] bg-gradient-to-r from-white to-[#f4f1ec] py-2.5 text-[12px] font-semibold text-[#1f1f1c] shadow-sm ring-1 ring-[#e7dfd4] transition hover:border-[#8a9eae]/50 hover:from-[#f8f6f2] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {summaryLoading ? (
              <>
                <Spinner className="h-3.5 w-3.5 shrink-0 animate-spin text-[#6b7d8f]" />
                Generando resumen…
              </>
            ) : (
              <>
                <IconSparkles className="h-3.5 w-3.5 shrink-0 text-[#6b7d8f]" aria-hidden />
                Crear resumen del chat
              </>
            )}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-5 sm:px-5 scrollbar-app">
        <section className="rounded-2xl border border-[#e7dfd4] bg-white p-4 shadow-sm ring-1 ring-black/[0.03]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
            <IconSparkles className="h-4 w-4 text-[#6b7d8f]" aria-hidden />
            Resumen del chat
          </div>
          {summaryLoading && (
            <div
              className="mt-3 flex items-center gap-2.5 rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] px-3 py-3 text-[13px] text-[#6b665e]"
              role="status"
              aria-live="polite"
            >
              <Spinner className="h-4 w-4 shrink-0 animate-spin text-[#6b7d8f]" />
              <span>
                {summaryLoadMode === "initial"
                  ? "Cargando resumen…"
                  : "Generando resumen, espera un momento…"}
              </span>
            </div>
          )}
          {!summaryLoading && summaryError && (
            <div
              className="mt-3 rounded-xl border border-rose-200 bg-rose-50/90 px-3 py-2.5 text-[13px] leading-relaxed text-rose-900"
              role="alert"
            >
              {summaryError}
            </div>
          )}
          {!summaryLoading && !summaryError && summaryText && (
            <div className="mt-3 min-w-0 rounded-lg bg-[#f8f6f2] p-3 ring-1 ring-[#e7dfd4]">
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#1f1f1c]">
                {summaryText}
              </p>
            </div>
          )}
          {!summaryLoading && !summaryError && summaryDbEmpty && (
            <p className="mt-2.5 text-[13px] leading-relaxed text-[#9c968c]">Sin resumen aún</p>
          )}
        </section>

        <section className="rounded-2xl border border-[#d4e5dc] bg-[#f4faf6] p-4 shadow-sm ring-1 ring-[#e7dfd4]/80">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#4a6b58]">
            <IconPhone className="h-4 w-4" aria-hidden />
            Datos de conversación
          </div>
          <dl className="mt-3 space-y-2.5 text-[13px] text-[#1f1f1c]">
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Teléfono</dt>
              <dd className="max-w-[55%] text-right font-mono text-[12px] text-[#3d5a4a]">{guest.phone}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Última actividad</dt>
              <dd className="text-right text-[12px]">{formatActivityIso(conversation.lastActivityIso)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Mensajes (cargados)</dt>
              <dd className="tabular-nums">{conversation.messages.length}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Needs Human (BD)</dt>
              <dd>{conversation.needsHuman ? "Sí" : "No"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Request (BD)</dt>
              <dd
                className={`text-right font-mono text-[11px] ${
                  isPendingRequest ? "font-semibold text-rose-700" : "text-[#4a4742]"
                }`}
              >
                {conversation.request ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">IA activa (BD)</dt>
              <dd>{conversation.aiActive ? "Sí" : "No"}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Estado (BD)</dt>
              <dd className="max-w-[55%] text-right font-mono text-[11px] text-[#4a4742]">
                {conversation.dbStatus ?? "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-[#6b665e]">Bloqueado</dt>
              <dd>{conversation.blocked ? "Sí" : "No"}</dd>
            </div>
            {conversation.blockedAt && (
              <div className="flex justify-between gap-2">
                <dt className="text-[#6b665e]">blocked_at</dt>
                <dd className="text-right text-[11px] text-[#9c968c]">{formatActivityIso(conversation.blockedAt)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="rounded-2xl border border-[#e7dfd4] bg-white p-4 shadow-sm ring-1 ring-black/[0.03]">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
            <IconBuilding className="h-4 w-4 text-[#7d9a7a]" aria-hidden />
            Cotización / propiedad
          </div>
          <p className="mt-2.5 text-[14px] font-medium leading-snug text-[#1f1f1c]">{guest.property}</p>
        </section>

        {!notesAreDefault && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 shadow-sm ring-1 ring-amber-100">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-amber-900/90">
              <IconNote className="h-4 w-4" aria-hidden />
              Notas (tabla / handoff)
            </div>
            <p className="mt-2.5 text-[13px] leading-relaxed text-amber-950/95">{guest.internalNotes}</p>
          </section>
        )}

        {hasTags && (
          <section className="rounded-2xl border border-[#e7dfd4] bg-white p-4 shadow-sm ring-1 ring-black/[0.03]">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">
              <IconTag className="h-4 w-4 text-violet-600/80" aria-hidden />
              Etiquetas
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {guest.tags.map((tag, i) => (
                <span
                  key={tag}
                  className={`rounded-lg px-2.5 py-1 text-[12px] font-semibold ring-1 ${TAG_STYLES[i % TAG_STYLES.length]}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="flex gap-2 pb-2">
          <button
            type="button"
            onClick={() => void navigator.clipboard?.writeText(guest.phone)}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#e7dfd4] bg-white py-2.5 text-[11px] font-semibold text-[#1f1f1c] shadow-sm transition hover:bg-[#f1ece4]"
          >
            <IconPhone className="h-4 w-4" />
            Copiar teléfono
          </button>
        </div>

        <p className="pb-2 text-center text-[10px] text-[#9c968c]">FerrarIA · Supabase + n8n</p>
      </div>
    </div>
  );
}
