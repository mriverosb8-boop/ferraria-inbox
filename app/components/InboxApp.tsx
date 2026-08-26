"use client";

import type { ClipboardEvent, SVGProps } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { avatarFlatColors, initials, splitLeadingEmoji } from "@/lib/avatar";
import {
  applyConversationRowPatch,
  formatMessageDetailTime,
  formatMessageDisplayTime,
  getConversationDisplayActivityMs,
  getMessageDisplayDate,
  isMediaWithoutFile,
  isWaLidIdentifier,
  messageNeedsHumanAlert,
  normalizeGuestIdentityKey,
  resolveMediaKind,
} from "@/lib/chat-utils";
import type { MediaKind } from "@/lib/chat-utils";
import { appendConversationMessages } from "@/lib/message-limits";
import { upsertConversationMessage } from "@/lib/message-upsert";
import type {
  ControlMode,
  Conversation,
  Message,
  MessageDeliveryReceipt,
  OperationalStatus,
} from "@/lib/inbox-types";
import {
  GUEST_NAME_MAX_LENGTH,
  type ConversationDbRow,
} from "@/lib/conversation-schema";
import { resolveDeliveryFailureReason } from "@/lib/delivery-failure-copy";
import {
  COLOMBIA_TIME_ZONE,
  isReplyBlockedByMetaPolicy,
  parseWhatsappInstant,
} from "@/lib/meta-window";
import { resolveDeliveryTick } from "@/lib/delivery-status";
import { STAFF_CONTACT_TEMPLATE_NAME } from "@/lib/staff-contacts";
import { sendWhatsappTemplate } from "@/lib/send-whatsapp-template";
import { tiempoTranscurrido } from "@/lib/service-tickets";
import { normalizeColombianWhatsappNumber } from "@/lib/whatsapp-templates";
import { useConversations } from "@/hooks/useConversations";
import { useFollowupTimers } from "@/hooks/useFollowupTimers";
import { useInboxConversationMessages } from "@/hooks/useInboxConversationMessages";
import { useInboxSearch } from "@/hooks/useInboxSearch";
import { useMessageDeliveryReceipts } from "@/hooks/useMessageDeliveryReceipts";
import { FollowupTimer } from "./FollowupTimer";
import { InboxListSkeleton, InboxLoadingSkeleton, InboxThreadSkeleton } from "./InboxLoadingSkeleton";
import { AppShell } from "./AppShell";
import { VISTA_PARAM, VISTA_STAFF, type InboxView } from "./AppSidebar";
import { Spinner } from "./Spinner";
import { readStoredActiveHotelId, writeStoredActiveHotelId } from "@/lib/active-hotel-storage";
import { StartConversationModal } from "./StartConversationModal";
import { WhatsappText, stripWhatsappMarkup } from "./WhatsappText";
import { StaffContactsModal } from "./StaffContactsModal";

type StatusFilter = "all" | "unread" | "ai_active" | "requires_attention" | "closed";

/**
 * Respuesta de `PATCH /api/inbox`. `conversation` es la fila POST-update de
 * `conversations`: es la que sustituye al refetch de bandeja completa que antes
 * seguía a cada acción. Opcional a propósito, para tolerar un servidor anterior
 * a este cambio (o desplegado a mitad): sin fila, el estado local optimista
 * queda como está y Realtime reconcilia.
 */
type InboxPatchResponse = {
  error?: string;
  conversation?: ConversationDbRow | null;
};

/** Imágenes/PDFs más recientes que esto cargan signed-url al abrir; el resto espera clic del usuario. */
const LAZY_MEDIA_AUTO_LOAD_MS = 24 * 60 * 60 * 1000;
/** Composer humano: altura mínima (1 línea) y máxima (~6 líneas) antes de scroll interno. */
/**
 * Espera antes de repescar los acuses de Meta tras enviar. El webhook de status
 * llega en segundos, no al instante; 6 s cubre el caso normal sin montar un
 * polling por algo que casi siempre sale bien.
 */
const DELIVERY_STATUS_REFETCH_MS = 6000;

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

/**
 * Marca de "esta conversación es con personal del hotel, no con un huésped"
 * (`conversations.guest_phone` presente en `staff_contacts`).
 *
 * Gris (spec 5.3), no de color: vive dentro de la vista Staff, donde el hecho de
 * que sea personal ya está dicho por todo lo demás, y una pastilla de color al
 * lado del nombre competiría con el rojo del botón principal del encabezado.
 * Tokens en `globals.css`, así que sigue al tema oscuro.
 */
function StaffBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${className}`}
      style={{
        background: "var(--bg-app)",
        color: "var(--text-secondary)",
        boxShadow: "inset 0 0 0 1px var(--border-soft)",
      }}
    >
      Staff
    </span>
  );
}

/**
 * Cargo del contacto de staff cuando no hay ninguno que mostrar (spec 5.2).
 *
 * Hoy es SIEMPRE este texto: `GET /api/inbox` solo cruza teléfonos contra
 * `staff_contacts` para marcar `isStaff` y no trae la columna `role`, y ese
 * endpoint es zona congelada. El cargo sí existe en la base y se edita desde
 * "Contactos"; el día que la bandeja lo embarque, esta constante pasa a ser el
 * fallback de los contactos que lo tengan vacío.
 *
 * Va en gris y sin ícono a propósito: es una ausencia, no un problema. Pintarla
 * en rojo o con un signo de admiración mandaría a recepción a arreglar algo que
 * no está roto.
 */
const STAFF_ROLE_FALLBACK = "Sin cargo";

function formatBlockedAtColombia(iso: string): string {
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIME_ZONE,
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(parseWhatsappInstant(iso) ?? new Date(0));
  const day = parts.find((p) => p.type === "day")?.value ?? "";
  const month = (parts.find((p) => p.type === "month")?.value ?? "").replace(/\.$/, "");
  const hour = parts.find((p) => p.type === "hour")?.value ?? "";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "";
  return `Bloqueado el ${day} de ${month}, ${hour}:${minute}`;
}

function isPdfFile(file: File | null): boolean {
  return file?.type === PDF_MIME_TYPE;
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

/**
 * Orden de la vista Huéspedes: primero lo que el triage escaló y nadie tomó;
 * dentro de cada grupo, la actividad de siempre.
 *
 * Por qué prioridad de orden y NO una pestaña nueva:
 *
 * - Estas conversaciones YA están en la pestaña "Atención": llegan con
 *   `needs_human` en true, que `mapOperationalFromConversationRow` traduce a
 *   `requires_attention`. Una pestaña más no las haría aparecer, solo
 *   duplicaría las mismas filas en un quinto chip.
 * - El problema no es que falten, es que están SEPULTADAS: la lista ordena por
 *   última actividad y estas llevan horas sin ninguna, así que se hunden justo
 *   por lo que las hace urgentes. Subirlas ataca la causa.
 * - Una pestaña hay que ir a buscarla. En recepción nadie va a mirar un chip
 *   nuevo si no sabe que existe; arriba de la lista se ven sin buscar nada, en
 *   "Todas" y también dentro de "Atención" y "Sin leer".
 *
 * Se aplica solo acá y no dentro de `sortConversationsByActivity`, que también
 * ordena la vista Staff: ahí la IA no interviene y este criterio no significa
 * nada.
 *
 * El empate entre dos escaladas lo rompe la actividad, no `triageEscalatedAt`:
 * entre dos huéspedes esperando, primero el que habló hace menos.
 */
function sortGuestConversations(list: Conversation[]): Conversation[] {
  return [...list].sort((a, b) => {
    const aEscalated = a.triageEscalatedAt ? 1 : 0;
    const bEscalated = b.triageEscalatedAt ? 1 : 0;
    if (aEscalated !== bEscalated) return bEscalated - aEscalated;
    return getConversationDisplayActivityMs(b) - getConversationDisplayActivityMs(a);
  });
}

/**
 * Ventana de 24 h de Meta para la conversación seleccionada.
 *
 * La lógica vive en `lib/meta-window.ts`; acá solo se le pasan las dos fuentes
 * del último entrante y se queda con la más reciente:
 *
 * - `lastGuestMessageAt`, copia de `conversations.last_guest_message_at`.
 * - el hilo cargado, con el mismo criterio de entrante que pinta las burbujas.
 *
 * Antes se leía SOLO la columna, y eso bloqueaba el composer cuando la fila de
 * `Wubby_Whatsapp` llegaba con `conversation_id` en NULL: el trigger dejaba la
 * columna vacía y el inbox lo interpretaba como "el huésped nunca escribió",
 * aunque el hilo mostrara el mensaje recién llegado.
 *
 * Llamadores (únicos, ambos en este archivo): `replyBlockedByMeta`, que habilita
 * el composer, y `sendMessage`.
 */
function isConversationReplyBlocked(conversation: Conversation | null | undefined): boolean {
  if (!conversation) return false;
  return isReplyBlockedByMetaPolicy({
    lastGuestMessageAt: conversation.lastGuestMessageAt,
    messages: conversation.messages,
  });
}

/** Estado visible de la conversación en la cola (una sola etiqueta clara). */
type StatusVariant = "pending" | "attention" | "human" | "ia" | "done";

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

/*
 * Acá vivía `StatusToken`, la pastilla de estado de tres renglones. Se fue con
 * la última fila que la pintaba: Huéspedes usa `GuestStatusPrefix` (spec 4.3) y
 * Staff ya no muestra estado ninguno, porque el semáforo describe el ciclo de
 * vida del agente y en un hilo con el personal el agente no interviene.
 */

/** Glifo, palabra y color de cada estado en el prefijo del preview (spec 4.3). */
const GUEST_STATUS_PREFIX: Record<StatusVariant, { glyph: string; label: string; color: string }> = {
  pending: { glyph: "●", label: "Pendiente", color: "var(--accent)" },
  attention: { glyph: "●", label: "Atención", color: "var(--accent)" },
  human: { glyph: "●", label: "Humano", color: "var(--gold)" },
  ia: { glyph: "✦", label: "IA activa", color: "var(--live)" },
  done: { glyph: "✓", label: "Hecha", color: "var(--text-secondary)" },
};

/**
 * Prefijo de estado de la fila de Huéspedes: va pegado al preview del último
 * mensaje, en la misma línea, y reemplaza a la pastilla `StatusToken` que antes
 * ocupaba un renglón entero de la fila.
 *
 * Lleva la palabra al lado del glifo a propósito. El spec del rediseño pide el
 * símbolo (● / ✦ / ✓), pero recepción trabaja en tablets sin hover: un glifo
 * suelto dejaría el estado escondido detrás de un `title` que nadie puede abrir
 * con el dedo. El símbolo sirve para escanear la lista de un vistazo; la palabra
 * es la que lo hace legible sin aprenderse la leyenda.
 */
function GuestStatusPrefix({ variant }: { variant: StatusVariant }) {
  const { glyph, label, color } = GUEST_STATUS_PREFIX[variant];
  return (
    <span
      className="grotesk inline-flex shrink-0 items-center gap-1"
      style={{ fontSize: 11.5, fontWeight: 700, color, letterSpacing: "0.01em" }}
    >
      <span aria-hidden style={{ fontSize: variant === "ia" || variant === "done" ? 11 : 8, lineHeight: 1 }}>
        {glyph}
      </span>
      {label}
    </span>
  );
}

/**
 * Aviso de que la IA volvió SOLA a una conversación (barrido del engine tras
 * ~2 h sin actividad humana), para que no parezca que el agente se metió por su
 * cuenta en una conversación que la recepcionista creía suya.
 *
 * La vigencia (24 h) la resuelve `readAutoReactivatedAt` al mapear la fila:
 * acá no se lee el reloj. Desaparece en cuanto alguien toma control o reactiva
 * a mano, porque eso cambia el origen a "manual".
 */
function AutoReactivatedBadge() {
  return (
    <span
      className="grotesk inline-flex shrink-0 items-center"
      style={{
        padding: "3px 8px",
        borderRadius: 999,
        fontSize: 10.5,
        fontWeight: 700,
        color: "var(--text-secondary)",
        background: "var(--border-soft)",
      }}
      title="Nadie atendió a tiempo: el engine devolvió la IA automáticamente"
    >
      Volvió sola
    </span>
  );
}

/**
 * El triage del engine detectó que este huésped lleva horas esperando algo que
 * solo una persona resuelve (factura, confirmación de reserva, pago,
 * cancelación) y nadie lo tomó.
 *
 * Por qué tiene que gritar más que el resto: una conversación así llega acá con
 * `needs_human` en true, y eso hace que `mapOperationalFromConversationRow` le
 * ponga `controlMode: "human"`. Resultado: la fila muestra la pastilla DORADA
 * "Humano", que significa "alguien la está atendiendo" — exactamente lo
 * contrario de lo que pasa. Este distintivo existe para desmentirla.
 *
 * Rojo sólido en mayúsculas con halo. No choca con la pastilla de al lado
 * (dorada) y pesa más que "Volvió sola" (gris) y "Bloqueado" (gris). El rojo de
 * `StatusToken` ("Pendiente" / "Atención") no se ve nunca junto a este, porque
 * en esos dos casos la fila no es dorada.
 *
 * La vigencia NO se resuelve acá ni con el reloj: `readTriageEscalatedAt` ya
 * decidió al mapear la fila, y por eso desaparece solo en cuanto alguien toma
 * la conversación, responde o la cierra.
 */
function TriageEscalatedBadge() {
  return (
    <span
      className="grotesk inline-flex shrink-0 items-center gap-1.5"
      style={{
        padding: "3px 9px 3px 7px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#fff",
        background: "var(--accent)",
        boxShadow: "0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent)",
      }}
      title="Lleva horas esperando algo que solo una persona resuelve y nadie la tomó"
    >
      <Dot size={6} color="rgba(255,255,255,.85)" />
      Sin atender
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

/** Redactar nuevo mensaje / comenzar conversación (lápiz sobre recuadro). */
function IconCompose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 15v3.75A2.25 2.25 0 0116.75 21H5.25A2.25 2.25 0 013 18.75V7.25A2.25 2.25 0 015.25 5H9" />
    </svg>
  );
}

/** Contactos del personal del hotel (dos siluetas). */
function IconStaff(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.5v-1a3.5 3.5 0 00-3.5-3.5h-4A3.5 3.5 0 004 18.5v1" />
      <circle cx="9.5" cy="8" r="3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M20 19.5v-1a3.5 3.5 0 00-2.6-3.4M15.5 5.2a3 3 0 010 5.6" />
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

/** Reloj: la petición de envío sigue en vuelo, nadie ha confirmado nada. */
function IconClock(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 7v5l3 2" />
    </svg>
  );
}

/** Lucide Check: salió, pero nadie confirmó que llegara. */
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

/** Cruz en círculo: el mensaje NO llegó al huésped (acuse `failed` de Meta). */
function IconCircleX(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <circle cx="12" cy="12" r="9" />
      <path strokeLinecap="round" d="M15 9l-6 6M9 9l6 6" />
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

function IconPaperclip(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13"
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

function IconRefresh(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.99v4.99" />
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

function IconUserCircle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
    </svg>
  );
}

function IconPencil(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zM19.5 8.25L15.75 4.5" />
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
      className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--border-soft)]"
      style={{ borderColor: "color-mix(in srgb, var(--accent) 45%, var(--border-soft))", background: "var(--bg-app)", color: "var(--text-secondary)" }}
    >
      <IconImage className="h-8 w-8 opacity-70" aria-hidden />
      <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{label}</span>
    </button>
  );
}

function LazyMediaLoadingState({ label }: { label: string }) {
  return (
    <div className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl px-4" style={{ border: "1px solid var(--border-soft)", background: "var(--bg-app)", color: "var(--text-secondary)" }}>
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
    <div className="flex h-48 w-[260px] max-w-full flex-col items-center justify-center gap-2 rounded-xl border border-[var(--accent)] bg-[var(--red-soft)] px-4 text-[var(--accent)]">
      <p className="text-center text-sm">{label}</p>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-lg border border-[var(--accent)] bg-[var(--bg-card)] px-3 py-1.5 text-[12px] font-semibold text-[var(--accent)] shadow-sm transition hover:bg-[var(--bg-app)]"
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
        boxShadow: ring ? "0 0 0 2px var(--bg-card), 0 0 0 4px var(--accent)" : "none",
      }}
    >
      {emoji ?? initials(name)}
    </div>
  );
}

/** Tono de color por acción para distinguir cada botón (Dirección D). */
type ActionTone = "human" | "ai" | "complete" | "summary" | "neutral";

const ACTION_TONES: Record<ActionTone, { base: string; soft: string; deep: string; border: string }> = {
  // Tomar control humano → ámbar/dorado de marca.
  human: { base: "var(--gold)", soft: "var(--gold-soft)", deep: "#8a5f1e", border: "var(--gold)" },
  // Reactivar IA → verde (mismo color que el estado "IA activa").
  ai: { base: "var(--live)", soft: "var(--live-soft)", deep: "#17784b", border: "var(--live)" },
  // Marcar como completado → gris neutro (mismo color que "Resuelto").
  complete: { base: "var(--text-secondary)", soft: "var(--border-soft)", deep: "var(--text-primary)", border: "var(--text-secondary)" },
  // Crear resumen → rojo de marca.
  summary: { base: "var(--accent)", soft: "var(--red-soft)", deep: "var(--accent)", border: "var(--accent)" },
  neutral: { base: "var(--text-secondary)", soft: "var(--bg-app)", deep: "var(--accent)", border: "var(--accent)" },
};

/** Acción con atajo del panel cockpit (Dirección D): icono + badge de atajo + etiqueta. */
function CmdAction({
  icon: Ic,
  label,
  hint,
  busy = false,
  onClick,
  disabled = false,
  tone = "neutral",
}: {
  icon: (props: SVGProps<SVGSVGElement>) => React.JSX.Element;
  label: string;
  hint: string;
  busy?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  tone?: ActionTone;
}) {
  const [hover, setHover] = useState(false);
  const t = ACTION_TONES[tone];
  const iconColor = hover ? t.deep : t.base;
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
        border: `1px solid ${hover ? t.border : `color-mix(in srgb, ${t.base} 25%, var(--border-soft))`}`,
        background: hover ? t.soft : "var(--bg-app)",
        color: hover ? t.deep : "var(--text-primary)",
        transition: "background .12s, border-color .12s, color .12s",
      }}
    >
      <div className="flex w-full items-center justify-between">
        {busy ? (
          <Spinner className="h-4 w-4 animate-spin" style={{ color: iconColor }} />
        ) : (
          <Ic className="h-[17px] w-[17px]" style={{ color: iconColor }} aria-hidden />
        )}
        <span
          className="ibx-mono"
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            border: "1px solid var(--border-soft)",
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
  const [imgFailed, setImgFailed] = useState(false);

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

  // Si el archivo no es realmente una imagen decodificable, caemos a tarjeta de archivo
  // en vez de mostrar el ícono roto.
  if (imgFailed) {
    return <PrivateWhatsAppFile message={message} kind="file" showCaption={false} />;
  }

  const alt = message.body || "Imagen enviada por WhatsApp";

  return (
    <>
      <img
        src={signedUrl}
        alt={alt}
        title="Abrir imagen"
        onClick={() => setIsOpen(true)}
        onError={() => setImgFailed(true)}
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

/** Badge corto (3–4 letras) desde la extensión del filename o, si no hay, desde el mime. */
function fileBadgeLabel(mime: string | null | undefined, filename: string | null | undefined): string {
  const ext = filename?.trim().split(".").pop()?.toUpperCase();
  if (ext && ext !== filename?.trim().toUpperCase() && ext.length <= 4) return ext;
  const m = mime?.trim().toLowerCase() ?? "";
  if (m === "application/pdf") return "PDF";
  if (m.includes("wordprocessingml")) return "DOCX";
  if (m.includes("msword")) return "DOC";
  if (m.includes("spreadsheetml")) return "XLSX";
  if (m.includes("ms-excel")) return "XLS";
  if (m.includes("presentationml")) return "PPTX";
  if (m.includes("ms-powerpoint")) return "PPT";
  if (m.includes("csv")) return "CSV";
  if (m.startsWith("text/")) return "TXT";
  return "FILE";
}

/**
 * Nombre legible del tipo, título de la tarjeta cuando `media_filename` es null
 * (todo lo anterior al 30 jul 2026, y las imágenes/stickers, que nunca lo traen).
 *
 * NO caer aquí al basename de `media_storage_path`: el engine nombra el objeto
 * con el id de Meta, así que el basename de un documento entrante es
 * `wamid.HBgMNTczMTcyNzEyNDE2FQIAEhgW…_.pdf` — ~70 caracteres opacos que se
 * truncan en la tarjeta y no dicen nada. Los salientes antiguos son
 * `<epoch>-<uuid>.pdf`, igual de inútiles. "Documento PDF" informa más.
 */
function fileFriendlyName(mime: string | null | undefined, kind: MediaKind): string {
  const m = mime?.trim().toLowerCase() ?? "";
  if (kind === "pdf") return "Documento PDF";
  if (m.includes("word") || m.includes("msword")) return "Documento Word";
  if (m.includes("sheet") || m.includes("excel")) return "Hoja de cálculo";
  if (m.includes("presentation") || m.includes("powerpoint")) return "Presentación";
  if (m.startsWith("text/")) return "Documento de texto";
  if (kind === "document") return "Documento";
  return "Archivo adjunto";
}

const FILE_TONES: Record<"pdf" | "document" | "file", { badge: string; text: string; border: string }> = {
  pdf: { badge: "bg-[var(--red-soft)]", text: "text-[var(--accent)]", border: "border-[var(--accent)]/30" },
  document: { badge: "bg-sky-50", text: "text-sky-700", border: "border-sky-200" },
  file: { badge: "bg-stone-100", text: "text-stone-600", border: "border-stone-300" },
};

/**
 * Tarjeta descargable para cualquier archivo no reproducible (pdf, doc/docx, xls/xlsx,
 * ppt/pptx, txt/csv o desconocido). El signed URL abre en pestaña nueva; el navegador
 * decide inline vs descarga según el mime.
 *
 * `media_filename` trae el nombre original crudo (espacios y tildes intactos) y solo
 * lo pueblan los documentos: las imágenes, videos y stickers entrantes van null, igual
 * que TODAS las filas anteriores al 30 jul 2026. Con null el título cae a un nombre
 * genérico por tipo, nunca a "null" ni a vacío.
 */
function PrivateWhatsAppFile({
  message,
  kind,
  showCaption = true,
}: {
  message: Message;
  kind: MediaKind;
  showCaption?: boolean;
}) {
  const { signedUrl, phase, requestLoad } = useLazySignedMediaUrl(message);

  const rawFilename = message.mediaFilename?.trim() || "";
  const friendly = fileFriendlyName(message.mediaMimeType, kind);
  const title = rawFilename || friendly;
  const badge = fileBadgeLabel(message.mediaMimeType, message.mediaFilename);
  const tone = FILE_TONES[kind === "pdf" ? "pdf" : kind === "document" ? "document" : "file"];
  const openLabel = kind === "pdf" ? "Abrir PDF" : "Abrir";
  const caption = message.body || message.mediaCaption || "";

  return (
    <div className="flex max-w-full flex-col gap-2">
      <div className="flex max-w-full items-center gap-3 rounded-[var(--radius-chip)] border border-[var(--border-soft)] bg-[var(--bg-card)] p-2.5 shadow-sm">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border text-[10px] font-bold ${tone.badge} ${tone.text} ${tone.border}`}
        >
          {badge}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-[var(--text-primary)]">{title}</p>
          {rawFilename ? (
            <p className="mt-0.5 text-[11px] text-[var(--text-secondary)]">{friendly}</p>
          ) : null}
        </div>
        {phase === "loaded" && signedUrl ? (
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--bg-app)]"
          >
            {openLabel}
          </a>
        ) : phase === "deferred" ? (
          <button
            type="button"
            onClick={() => void requestLoad()}
            className="shrink-0 rounded-lg border border-[var(--border-soft)] bg-[var(--bg-card)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--text-primary)] shadow-sm transition hover:bg-[var(--bg-app)]"
          >
            Cargar archivo
          </button>
        ) : phase === "loading" ? (
          <span className="shrink-0 text-[11px] text-[var(--text-secondary)]">Cargando...</span>
        ) : (
          <button
            type="button"
            onClick={() => void requestLoad()}
            className="shrink-0 rounded-lg border border-[var(--accent)] bg-[var(--red-soft)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--accent)] shadow-sm transition hover:bg-[var(--bg-app)]"
          >
            Reintentar
          </button>
        )}
      </div>
      {showCaption && caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
    </div>
  );
}

/**
 * Abre un adjunto en una pestaña nueva con UN solo clic.
 *
 * La pestaña se abre DENTRO del gesto del usuario y recién después se le pone la
 * URL firmada: si se abriera al volver del `await`, el navegador la trataría
 * como popup y la bloquearía sin decir nada.
 *
 * Reusa `fetchSignedMediaUrl`, la misma cadena (y la misma caché en memoria) que
 * usan las tarjetas del hilo: no pide nada nuevo al servidor.
 */
function useOpenAttachment(message: Message) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const open = useCallback(() => {
    if (busy) return;

    const direct = message.mediaUrl?.trim();
    if (direct) {
      window.open(direct, "_blank", "noopener,noreferrer");
      return;
    }

    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;

    setBusy(true);
    setFailed(false);
    void (async () => {
      try {
        const url = await fetchSignedMediaUrl(message);
        if (tab) {
          tab.location.href = url;
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
      } catch {
        tab?.close();
        setFailed(true);
      } finally {
        setBusy(false);
      }
    })();
  }, [busy, message]);

  return { open, busy, failed };
}

/**
 * PDF de un hilo de staff: chip, no burbuja de texto (spec 5.4).
 * "📄 nombre.pdf · Documento PDF", y el chip entero abre el archivo.
 *
 * El personal se pasa planillas, facturas y remisiones todo el día: una tarjeta
 * alta por cada una empuja la conversación fuera de la pantalla justo cuando lo
 * que se busca es el archivo de hace tres mensajes.
 */
function StaffPdfChip({ message }: { message: Message }) {
  const { open, busy, failed } = useOpenAttachment(message);
  const filename = message.mediaFilename?.trim() || "Documento PDF";
  const caption = message.body || message.mediaCaption || "";

  return (
    <div className="flex min-w-0 max-w-full flex-col gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="flex min-w-0 max-w-full items-center gap-2 text-left transition-opacity hover:opacity-75 disabled:cursor-wait disabled:opacity-60"
      >
        <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
          📄
        </span>
        <span
          className="min-w-0 truncate text-[13.5px] font-semibold"
          style={{ color: "var(--text-primary)" }}
        >
          {filename}
        </span>
        <span className="shrink-0 text-[12px]" style={{ color: "var(--text-secondary)" }}>
          · {busy ? "Abriendo…" : "Documento PDF"}
        </span>
      </button>
      {failed && (
        <span className="text-[11px] font-medium" style={{ color: "var(--accent)" }}>
          No se pudo abrir el documento. Intenta de nuevo.
        </span>
      )}
      {caption ? (
        <p className="whitespace-pre-wrap break-words text-[13.5px]" style={{ color: "var(--text-primary)" }}>
          {caption}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Media sin archivo: la fila trae mime o filename pero ni `media_storage_path`
 * ni `media_url`. El adjunto superó el tope de 20 MB o el upload a Storage
 * falló, así que NO hay nada que firmar — de ahí que no se monte
 * `useLazySignedMediaUrl` ni se ofrezca abrir o reintentar: no es un fallo de
 * carga transitorio, el archivo no existe.
 *
 * Aplica a los tres tipos por igual (imagen, video, documento): sin archivo, el
 * mime solo serviría para prometer algo que no se puede entregar.
 */
function UnavailableMediaCard({ message }: { message: Message }) {
  const filename = message.mediaFilename?.trim() || "";
  const caption = message.body || message.mediaCaption || "";

  return (
    <div className="flex max-w-full flex-col gap-2">
      <div
        className="flex max-w-full items-center gap-3 rounded-xl p-2.5"
        style={{ border: "1px dashed var(--border-soft)", background: "var(--bg-app)" }}
      >
        <div
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg"
          style={{ background: "var(--border-soft)", color: "var(--text-secondary)" }}
        >
          <IconPaperclip className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
            Archivo no disponible (no se pudo procesar)
          </p>
          {filename ? (
            <p className="mt-0.5 truncate text-[11px]" style={{ color: "var(--text-secondary)" }}>
              {filename}
            </p>
          ) : null}
        </div>
      </div>
      {caption ? <p className="whitespace-pre-wrap break-words">{caption}</p> : null}
    </div>
  );
}

function PrivateWhatsAppVideo({ message }: { message: Message }) {
  const { signedUrl, phase, requestLoad } = useLazySignedMediaUrl(message);

  if (phase === "deferred") {
    return <LazyImagePlaceholder label="Cargar video" onLoad={() => void requestLoad()} />;
  }
  if (phase === "loading") {
    return <LazyMediaLoadingState label="Cargando video..." />;
  }
  if (phase === "error" || !signedUrl) {
    return <LazyMediaErrorState label="No se pudo cargar el video" onRetry={() => void requestLoad()} />;
  }

  return (
    <video
      src={signedUrl}
      controls
      className="max-h-80 max-w-[300px] rounded-xl border border-black/10"
    />
  );
}

function PrivateWhatsAppAudio({ message }: { message: Message }) {
  const { signedUrl, phase, requestLoad } = useLazySignedMediaUrl(message);

  if (phase === "deferred") {
    return <LazyImagePlaceholder label="Cargar audio" onLoad={() => void requestLoad()} />;
  }
  if (phase === "loading") {
    return <LazyMediaLoadingState label="Cargando audio..." />;
  }
  if (phase === "error" || !signedUrl) {
    return <LazyMediaErrorState label="No se pudo cargar el audio" onRetry={() => void requestLoad()} />;
  }

  return <audio src={signedUrl} controls className="w-[260px] max-w-full" />;
}

/** Texto que escribe el engine cuando el huésped RETIRA una reacción ya enviada. */
const REACTION_REMOVED_BODY = "[reacción eliminada]";

/**
 * Fila de reacción: `format='reaction'` y `reaction_to_wamid` apuntando al
 * mensaje reaccionado. Las dos condiciones, no una: las ~100 filas de reacción
 * anteriores a la columna traen `format='reaction'` con `reaction_to_wamid`
 * null, y sin target no hay burbuja sobre la que pintar el badge.
 */
function isReactionRow(m: Message): boolean {
  return m.format?.trim().toLowerCase() === "reaction" && Boolean(m.reactionToWamid?.trim());
}

/**
 * `true` si `candidate` es posterior a `current`. Los `id` de `Wubby_Whatsapp`
 * son bigint crecientes, así que el mayor es la última reacción que escribió el
 * huésped — más fiable que `created_at`, que tiene colisiones reales.
 */
function isNewerReaction(candidate: Message, current: Message): boolean {
  const a = Number(candidate.id);
  const b = Number(current.id);
  // Ids no numéricos (optimistas locales) no ordenan: gana el que ya estaba.
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a > b;
}

type ThreadView = {
  /** Mensajes que SÍ son burbuja, en el orden recibido. */
  bubbles: Message[];
  /** id del mensaje objetivo → emoji de la reacción vigente. */
  reactionByMessageId: Map<string, string>;
};

/**
 * Saca las filas de reacción del flujo de burbujas y las resuelve contra el
 * mensaje cuyo `wamid` coinciden, al estilo WhatsApp.
 *
 * Dos pasadas y un Map por `wamid`, NO un `find()` por burbuja: el hilo llega
 * hasta `MESSAGES_LIMIT` mensajes y la resolución sería cuadrática.
 *
 * Reglas:
 * - Varias reacciones al mismo mensaje son filas distintas; gana la de id mayor.
 * - Si la vigente es `'[reacción eliminada]'`, el huésped la retiró: no hay badge.
 * - Una reacción que NO resuelve target (mensaje histórico sin `wamid`) se queda
 *   como burbuja de texto normal. Ocultarla perdería información real.
 */
function buildThreadView(messages: Message[]): ThreadView {
  const messageIdByWamid = new Map<string, string>();
  for (const m of messages) {
    const wamid = m.wamid?.trim();
    if (wamid) messageIdByWamid.set(wamid, m.id);
  }

  const bubbles: Message[] = [];
  const winnerByTargetId = new Map<string, Message>();

  for (const m of messages) {
    const targetId = isReactionRow(m)
      ? messageIdByWamid.get(m.reactionToWamid!.trim())
      : undefined;

    if (!targetId) {
      bubbles.push(m);
      continue;
    }

    const current = winnerByTargetId.get(targetId);
    if (!current || isNewerReaction(m, current)) {
      winnerByTargetId.set(targetId, m);
    }
  }

  const reactionByMessageId = new Map<string, string>();
  for (const [targetId, reaction] of winnerByTargetId) {
    const emoji = reaction.body.trim();
    if (!emoji || emoji === REACTION_REMOVED_BODY) continue;
    reactionByMessageId.set(targetId, emoji);
  }

  return { bubbles, reactionByMessageId };
}

/**
 * Sticker entrante de WhatsApp: mime `image/webp` y `message` exactamente
 * `'[sticker]'`, la firma que escribe el engine al subirlos a Storage.
 *
 * Existe solo para tapar un dato mentiroso: el engine escribía
 * `cause_request='yes'` en las filas de sticker pese a que un sticker NO escala
 * a humano — `conversations.needs_human` se queda en `false`—, así que la
 * burbuja anunciaba "Solicitó agente humano" por un emoji. Desde el 30 jul 2026
 * los stickers ya no escalan, pero las filas históricas conservan el `yes`, y
 * esta supresión es lo que las cubre. El arreglo de raíz va en el engine, fuera
 * de este repo.
 *
 * Se filtra AQUÍ y no en `messageNeedsHumanAlert` a propósito: esa regla la
 * comparten el banner, la notificación de escritorio y las demás burbujas.
 */
function isWhatsappSticker(m: Message): boolean {
  return (
    m.mediaMimeType?.trim().toLowerCase() === "image/webp" && m.body.trim() === "[sticker]"
  );
}

/**
 * Texto del tooltip del chip "No entregado". Duplica la línea secundaria a
 * propósito: si el motivo se corta visualmente, el `title` lo muestra completo.
 */
function describeDeliveryFailure(failure: MessageDeliveryReceipt): string {
  const reason = resolveDeliveryFailureReason(failure);
  return reason ? `No entregado — ${reason}` : "No entregado";
}

/**
 * Día calendario del mensaje en hora Colombia, en formato `AAAA-MM-DD`.
 *
 * La zona va fija a propósito, igual que en `lib/chat-utils`: si se dejara la
 * del navegador, el mismo mensaje cambiaría de día para quien abra la bandeja
 * desde fuera del país y las píldoras de fecha partirían el hilo por donde no
 * es. `""` significa "sin fecha utilizable": esos mensajes no abren día nuevo.
 */
function messageDayKey(m: Message): string {
  const date = getMessageDisplayDate(m as unknown as Record<string, unknown>);
  const ms = date.getTime();
  if (Number.isNaN(ms) || ms === 0) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Texto de la píldora: "Hoy", "Ayer" o la fecha larga en español. */
function formatDayPillLabel(m: Message): string {
  const date = getMessageDisplayDate(m as unknown as Record<string, unknown>);
  const key = messageDayKey(m);
  if (!key) return "";

  const now = new Date();
  const todayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (key === todayKey) return "Hoy";

  const yesterdayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: COLOMBIA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now.getTime() - 24 * 60 * 60 * 1000));
  if (key === yesterdayKey) return "Ayer";

  const sameYear = key.slice(0, 4) === todayKey.slice(0, 4);
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(sameYear ? null : { year: "numeric" }),
  }).format(date);
}

/**
 * Hora del mensaje para la burbuja, solo `HH:mm`. El día ya lo dice la píldora
 * de arriba, así que repetirlo en cada burbuja era ruido. Si la fila no trae
 * fecha utilizable se cae a lo que venga en `sentAt`, igual que antes.
 */
function formatBubbleClock(m: Message): string {
  const date = getMessageDisplayDate(m as unknown as Record<string, unknown>);
  const ms = date.getTime();
  if (Number.isNaN(ms) || ms === 0) {
    return formatMessageDisplayTime(m as unknown as Record<string, unknown>) || m.sentAt;
  }
  return new Intl.DateTimeFormat("es-CO", {
    timeZone: COLOMBIA_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Píldora de fecha centrada que separa los días del hilo (spec 4.4). */
function DayPill({ label }: { label: string }) {
  return (
    <div className="flex w-full justify-center py-1.5">
      <span
        className="ibx-mono inline-flex items-center rounded-full px-3 py-1"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-soft)",
          color: "var(--text-secondary)",
          fontSize: 10.5,
          letterSpacing: "0.04em",
          textTransform: "uppercase",
        }}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * Evento de sistema del hilo: centrado y en gris, sin avatar ni burbuja, para
 * que no se confunda con algo que dijo una persona o el agente (spec 4.4).
 */
function SystemEvent({ label }: { label: string }) {
  return (
    <div className="flex w-full justify-center px-3 py-1.5">
      <span
        className="inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-center text-[11.5px] leading-snug"
        style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)", color: "var(--text-secondary)" }}
      >
        <IconCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 break-words [overflow-wrap:anywhere]">{label}</span>
      </span>
    </div>
  );
}

/**
 * Menú "…" del encabezado del chat (spec 5.3). Guarda las acciones secundarias
 * para que arriba quede a la vista solo la principal ("✓ Completado").
 *
 * Cada entrada es texto, no un ícono suelto: recepción trabaja en tablets, donde
 * no hay hover que revele lo que significa un dibujo. Se cierra al elegir, al
 * tocar afuera y con Escape.
 */
function HeaderMenu({
  items,
  label = "Más acciones",
}: {
  items: { key: string; label: string; onSelect: () => void; danger?: boolean }[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (items.length === 0) return null;

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="d-soft grotesk flex h-9 w-9 items-center justify-center"
        style={{
          borderRadius: 999,
          border: "1px solid var(--border-soft)",
          background: "var(--bg-card)",
          color: "var(--text-secondary)",
          fontSize: 17,
          fontWeight: 700,
          lineHeight: 1,
        }}
      >
        <span aria-hidden style={{ marginTop: -6 }}>
          …
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1.5 min-w-[190px] overflow-hidden p-1"
          style={{
            borderRadius: "var(--radius-card)",
            border: "1px solid var(--border-soft)",
            background: "var(--bg-card)",
            boxShadow: "var(--shadow-lg)",
          }}
        >
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className="d-soft grotesk flex w-full items-center px-3 py-2 text-left"
              style={{
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                color: item.danger ? "var(--accent)" : "var(--text-primary)",
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MessageBubble({
  m,
  guestName,
  guestSeed,
  reaction,
  deliveryReceipt,
  staff = false,
}: {
  m: Message;
  guestName: string;
  guestSeed: string;
  /** Hilo con el personal del hotel: cambia cómo se pintan los PDFs (spec 5.4). */
  staff?: boolean;
  /** Emoji de la reacción vigente sobre ESTA burbuja; ver `buildThreadView`. */
  reaction?: string;
  /**
   * Acuse de entrega de Meta para ESTA burbuja, cruzado por `wamid`. Solo puede
   * existir en salientes con `wamid`: los históricos y los de los hoteles que
   * envían por n8n nunca lo traen, y esos se quedan en ✓.
   */
  deliveryReceipt?: MessageDeliveryReceipt;
}) {
  const isUser = m.sender === "user";
  const isAi = m.sender === "ai";
  const isAgent = m.sender === "agent";

  const [translationOpen, setTranslationOpen] = useState(false);
  /**
   * Texto que de verdad le llegó al huésped, solo cuando el engine tradujo la
   * respuesta (`Wubby_Whatsapp.message_translated`). La burbuja sigue mostrando
   * el español; esto es un desplegable informativo, sin ninguna acción.
   *
   * Se acota a lo SALIENTE: el huésped escribe en su idioma y su burbuja nunca
   * es "lo que le enviamos", así que un valor ahí sería un dato mal atribuido.
   */
  const translatedBody = !isUser && m.translatedBody ? m.translatedBody : null;

  // Ver `isWhatsappSticker`: `cause_request` miente en las filas de sticker, así
  // que ni la etiqueta ni el borde rojo salen de ellas.
  const isHandoffCause =
    messageNeedsHumanAlert(m as unknown as Record<string, unknown>) && !isWhatsappSticker(m);

  const isTranscribedVoice =
    isUser && typeof m.format === "string" && m.format.trim().toLowerCase() === "audio";
  const hasMediaSource = Boolean(m.mediaUrl || m.mediaStoragePath);
  const mediaKind = resolveMediaKind(m.mediaMimeType);
  const timeLabel = formatBubbleClock(m);
  const isOutboundHotel = !isUser;
  const deliveryStatus = m.status ?? "confirmed";
  // El optimista de un PDF recién adjuntado tiene filename y mime pero todavía
  // no path (lo devuelve la route al confirmar): quedaría marcado como "no
  // disponible" durante el envío. Solo se juzga lo ya confirmado en DB.
  const missingFile = deliveryStatus !== "pending" && isMediaWithoutFile(m);

  /*
    En Staff un PDF no se pinta como mensaje sino como chip (spec 5.4), así que
    la burbuja pierde el color de quien habla y queda neutra: un chip de archivo
    sobre el rojo de "Tú · agente" se leería como una alerta. La hora, el acuse
    de entrega y la etiqueta de autor siguen abajo, que es lo que hace falta para
    saber quién mandó el archivo y si llegó.
  */
  const staffPdfChip = staff && mediaKind === "pdf" && hasMediaSource && !missingFile;

  /*
    Spec 4.4 y 2.3/2.5: huésped = card blanca a la izquierda, agente (IA) =
    crema amarillento con su borde a la derecha, respuesta humana = roja sólida
    con texto blanco. Radio 14 en todas, con la esquina del lado del avatar
    achicada para que se lea de un vistazo de qué lado viene el mensaje.
  */
  const bubbleStyle: React.CSSProperties = staffPdfChip
    ? {
        background: "var(--bg-card)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-soft)",
        borderRadius: "var(--radius-chip)",
        boxShadow: "var(--shadow-sm)",
      }
    : isUser
    ? {
        background: "var(--bubble-guest)",
        color: "var(--text-primary)",
        border: "1px solid var(--border-soft)",
        borderRadius: "4px var(--radius-bubble) var(--radius-bubble) var(--radius-bubble)",
        boxShadow: "var(--shadow-sm)",
        ...(isHandoffCause ? { boxShadow: "inset 3px 0 0 0 var(--accent)" } : null),
      }
    : isAi
      ? {
          background: "var(--bubble-ai)",
          color: "var(--text-primary)",
          border: "1px solid var(--bubble-ai-border)",
          borderRadius: "var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble)",
          ...(isHandoffCause ? { boxShadow: "inset -3px 0 0 0 var(--accent)" } : null),
        }
      : {
          // Burbuja de respuesta humana: terracota del spec (§2.2).
          background: "var(--accent)",
          color: "#fff",
          border: "1px solid var(--accent)",
          borderRadius: "var(--radius-bubble) var(--radius-bubble) 4px var(--radius-bubble)",
        };
  const onRed = isAgent && !staffPdfChip;
  const metaColor = onRed ? "rgba(255,255,255,.8)" : "var(--text-secondary)";

  // Qué tick va al lado de la hora. El acuse de Meta manda; sin acuse queda en
  // ✓ ("salió"), nunca en ✓✓. Ver `resolveDeliveryTick`.
  const deliveryTick = resolveDeliveryTick(deliveryStatus, deliveryReceipt);
  const failedReceipt = deliveryTick === "failed" ? deliveryReceipt : undefined;
  // Motivo legible del fallo; `null` si Meta no mandó código conocido ni título.
  // Se calcula acá para que el chip y la línea de abajo no puedan contradecirse.
  const deliveryFailureReason = failedReceipt
    ? resolveDeliveryFailureReason(failedReceipt)
    : null;

  return (
    <div
      className="flex w-full min-w-0 items-end gap-2"
      style={{
        flexDirection: isUser ? "row" : "row-reverse",
        // El badge cuelga por debajo del borde: sin este hueco se solaparía con
        // la burbuja siguiente (el contenedor del hilo solo separa 10px).
        ...(reaction ? { marginBottom: 10 } : null),
      }}
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
              borderRadius: "var(--radius-chip)",
              background: isAi ? "var(--bubble-ai)" : "var(--accent)",
              border: isAi ? "1px solid var(--bubble-ai-border)" : "none",
            }}
          >
            {isAi ? (
              <Spark className="h-4 w-4" style={{ color: "var(--gold)" }} aria-hidden />
            ) : (
              <IconUserCircle className="h-4 w-4" style={{ color: "#fff" }} aria-hidden />
            )}
          </div>
        )}
      </div>
      <div
        className={`flex min-w-0 flex-col ${isUser ? "items-start" : "items-end"} max-w-[min(92%,26rem)] sm:max-w-[min(86%,34rem)] lg:max-w-[min(82%,46rem)]`}
      >
        {/* Quién habla, en texto y no solo por el color de la burbuja: recepción
            trabaja en tablets y el color no siempre alcanza para distinguir una
            respuesta del agente de una que escribió una persona. */}
        {!isUser && (
          <span
            className="grotesk inline-flex items-center gap-1"
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.02em",
              color: isAi ? "var(--gold)" : "var(--text-secondary)",
              margin: "0 5px 3px",
            }}
          >
            {isAi ? (
              <Spark className="h-2.5 w-2.5 shrink-0" aria-hidden />
            ) : (
              <IconUserCircle className="h-3 w-3 shrink-0" aria-hidden />
            )}
            {isAi ? "FerrarIA" : "Tú · agente"}
          </span>
        )}
        <div
          className="relative flex w-fit min-w-0 max-w-full flex-col gap-0.5 break-words px-3.5 py-2 text-[15.5px] [overflow-wrap:anywhere]"
          style={{ lineHeight: 1.45, ...bubbleStyle }}
        >
          {reaction ? (
            <span
              // Lado interior de la burbuja en ambos casos: esquiva la muesca de
              // 5px, que en las salientes está justo abajo a la derecha.
              className="absolute -bottom-3 z-10 inline-flex items-center rounded-full px-1.5 py-0.5 text-[13px] leading-none shadow-sm"
              style={{
                ...(isUser ? { right: 10 } : { left: 10 }),
                background: "var(--bg-card)",
                border: "1px solid var(--border-soft)",
              }}
              title="Reacción"
            >
              {reaction}
            </span>
          ) : null}
          {isHandoffCause && (
            <p
              className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[10px] font-semibold leading-tight"
              style={{ color: onRed ? "#fff" : "var(--accent)" }}
            >
              <span
                className="inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5"
                style={{
                  background: onRed ? "rgba(255,255,255,.18)" : "var(--red-soft)",
                  border: onRed ? "1px solid rgba(255,255,255,.3)" : "1px solid var(--accent)",
                }}
              >
                <span aria-hidden>⚠️</span>
                <span>Solicitó agente humano</span>
              </span>
            </p>
          )}
          {isTranscribedVoice && (
            <p className="mb-0.5 flex max-w-full items-center gap-1 self-stretch text-[10px] font-medium leading-tight" style={{ color: "var(--text-secondary)" }}>
              <span
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
                style={{ background: "var(--bg-card)", border: "1px solid var(--border-soft)" }}
              >
                <IconMic className="h-2.5 w-2.5 shrink-0 opacity-85" aria-hidden />
                <span>Mensaje de voz transcrito</span>
              </span>
            </p>
          )}
          {missingFile ? (
            <UnavailableMediaCard message={m} />
          ) : staffPdfChip ? (
            <StaffPdfChip message={m} />
          ) : hasMediaSource ? (
            mediaKind === "image" ? (
              <div className="flex max-w-full flex-col gap-2">
                <PrivateWhatsAppImage key={m.id} message={m} />
                {m.body ? (
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    <WhatsappText text={m.body} />
                  </p>
                ) : null}
              </div>
            ) : mediaKind === "video" ? (
              <div className="flex max-w-full flex-col gap-2">
                <PrivateWhatsAppVideo key={m.id} message={m} />
                {m.body ? (
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    <WhatsappText text={m.body} />
                  </p>
                ) : null}
              </div>
            ) : mediaKind === "audio" ? (
              <div className="flex max-w-full flex-col gap-2">
                <PrivateWhatsAppAudio key={m.id} message={m} />
                {m.body ? (
                  <p className="mt-2 whitespace-pre-wrap break-words">
                    <WhatsappText text={m.body} />
                  </p>
                ) : null}
              </div>
            ) : (
              <PrivateWhatsAppFile key={m.id} message={m} kind={mediaKind} />
            )
          ) : (
            <p className="whitespace-pre-wrap break-words">
              <WhatsappText text={m.body} />
            </p>
          )}
          {translatedBody ? (
            <div className="mt-1 flex max-w-full flex-col gap-1">
              <button
                type="button"
                onClick={() => setTranslationOpen((v) => !v)}
                aria-expanded={translationOpen}
                aria-controls={`translated-${m.id}`}
                className="inline-flex w-fit max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-tight transition-opacity hover:opacity-80"
                style={{
                  background: onRed ? "rgba(255,255,255,.18)" : "var(--bg-card)",
                  border: onRed ? "1px solid rgba(255,255,255,.3)" : "1px solid var(--border-soft)",
                  color: onRed ? "#fff" : "var(--text-secondary)",
                }}
                title="Al huésped le llegó esta respuesta en su idioma"
              >
                <IconGlobe className="h-2.5 w-2.5 shrink-0 opacity-85" aria-hidden />
                <span>{translationOpen ? "Ocultar traducción" : "Enviado traducido"}</span>
              </button>
              {translationOpen ? (
                <div
                  id={`translated-${m.id}`}
                  className="max-w-full rounded-lg px-2 py-1.5"
                  style={{
                    background: onRed ? "rgba(255,255,255,.14)" : "var(--bg-card)",
                    border: onRed ? "1px solid rgba(255,255,255,.28)" : "1px solid var(--border-soft)",
                  }}
                >
                  <p
                    className="grotesk mb-0.5 text-[9.5px] font-bold uppercase leading-tight"
                    style={{ letterSpacing: "0.04em", color: onRed ? "rgba(255,255,255,.85)" : "var(--text-secondary)" }}
                  >
                    Texto enviado al huésped
                  </p>
                  {/* `dir="auto"` deja que el navegador acomode idiomas de derecha
                      a izquierda (árabe, hebreo) sin voltear el resto de la burbuja. */}
                  <p dir="auto" className="whitespace-pre-wrap break-words text-[14px]">
                    <WhatsappText text={translatedBody} />
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <time className="ibx-mono min-w-0 shrink text-[10px] tabular-nums" style={{ color: metaColor }}>
              {timeLabel}
            </time>
            {isOutboundHotel &&
              // Regla dura: el doble check SOLO sale con acuse de Meta. Antes el
              // ✓✓ se pintaba por defecto y solo significaba "la fila está en la
              // base", así que recepción daba por entregado lo que quizá nunca
              // llegó. Sin acuse ahora queda en ✓ ("salió"). Ver `resolveDeliveryTick`.
              (failedReceipt ? (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight"
                  style={{
                    // Sobre la burbuja roja del agente el rojo no contrasta:
                    // ahí el chip va en blanco, igual que el badge de handoff.
                    background: onRed ? "rgba(255,255,255,.18)" : "var(--red-soft)",
                    border: onRed ? "1px solid rgba(255,255,255,.3)" : "1px solid var(--accent)",
                    color: onRed ? "#fff" : "var(--accent)",
                  }}
                  title={describeDeliveryFailure(failedReceipt)}
                >
                  <IconCircleX className="h-3 w-3 shrink-0" aria-hidden />
                  <span>No entregado</span>
                </span>
              ) : deliveryTick === "pending" ? (
                <IconClock className="h-3 w-3 shrink-0" style={{ color: metaColor }} aria-label="Enviando" />
              ) : deliveryTick === "sent" ? (
                <IconCheck className="h-3.5 w-3.5 shrink-0" style={{ color: metaColor }} aria-label="Enviado" />
              ) : (
                <IconCheckCheck
                  className="h-3.5 w-[18px] shrink-0"
                  // Azul solo en `read`, la misma convención de WhatsApp que
                  // recepción ya trae aprendida: no hay que explicarle nada.
                  // Sobre la burbuja roja el azul no contrasta, así que ahí el
                  // "leído" se marca con blanco pleno contra el blanco atenuado
                  // de `delivered`.
                  style={{
                    color:
                      deliveryTick === "read"
                        ? onRed
                          ? "#fff"
                          : "var(--blue-read)"
                        : metaColor,
                  }}
                  aria-label={deliveryTick === "read" ? "Leído por el huésped" : "Entregado"}
                />
              ))}
            {isAi && m.aiMeta && (
              <span className="ibx-mono max-w-full break-words text-[10px] tabular-nums" style={{ color: "var(--text-secondary)" }}>
                {m.aiMeta.latencyMs} ms · {m.aiMeta.tokens} tok
              </span>
            )}
          </div>
          {/*
            Motivo del fallo en texto plano bajo el chip. Va SIEMPRE visible y no
            en el tooltip porque recepción atiende de afán y muchas veces desde
            tablet, donde el `title` del navegador no existe: un motivo que hay
            que descubrir pasando el mouse es un motivo que nadie lee.

            Solo aparece en burbujas ya fallidas, que son raras, así que el costo
            de layout es acotado. Si Meta no dio ni código conocido ni título, no
            se pinta nada y el chip queda solo.
          */}
          {isOutboundHotel && deliveryFailureReason ? (
            <p
              className="mt-0.5 max-w-full break-words text-[10.5px] font-medium"
              style={{
                lineHeight: 1.35,
                color: onRed ? "rgba(255,255,255,.85)" : "var(--accent)",
              }}
            >
              {deliveryFailureReason}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default function InboxApp() {
  const [selectedId, setSelectedId] = useState<string>("");
  const [requestedConversationId, setRequestedConversationId] = useState<string | null>(null);
  /**
   * Llegó un `?conversationId=` que NO está en la lista cargada. Lo emite el
   * service worker de las push (`public/sw.js`), así que el id puede ser de otro
   * hotel o —cuando `GET /api/inbox` pase a acotarse con un `.limit()`— de una
   * conversación fuera de la ventana traída.
   *
   * Bloquea la autoselección: mientras esté en `true` el panel queda vacío con
   * un aviso, en vez de abrir una conversación que no es la que se pidió.
   */
  const [deepLinkMissing, setDeepLinkMissing] = useState(false);
  const [activeHotelId, setActiveHotelId] = useState<string | null>(() => readStoredActiveHotelId());
  const {
    conversations: rawConversations,
    setConversations,
    total: totalConversations,
    loading,
    error,
    refetch,
    markConversationRead,
    urgentHandoffBannerVisible,
    dismissUrgentHandoffBanner,
    realtimeUiStatus,
    availableHotels,
    activeHotelId: resolvedActiveHotelId,
    engineEnabled,
  } = useConversations({ activeConversationId: selectedId, activeHotelId });
  const { followups: followupTimers, removeFollowup } = useFollowupTimers();

  /**
   * ÚNICO punto donde se decide si una conversación cuenta como staff.
   *
   * El guard que impide que la IA le conteste al personal vive en el engine, así
   * que un hotel todavía en n8n (`engine_enabled = false`) no lo tiene: si una
   * recepcionista de ahí registrara un contacto, la IA le seguiría respondiendo
   * y la feature parecería rota. Para esos hoteles el staff no existe en la UI.
   *
   * Se apaga acá, en la fuente, y NO con un `engineEnabled &&` repartido por
   * cada condicional de más abajo: así la vista Huéspedes, los chips, la
   * pastilla del encabezado, el panel de gestión y el botón de fuera de ventana
   * caen solos al camino de huésped, sin veinte lugares que puedan quedar
   * desalineados. Lo único que además se apaga a mano es el TAB Staff del
   * header, porque no cuelga de `isStaff`: con la lista vacía se pintaría igual
   * y ofrecería registrar contactos que la IA de n8n va a ignorar.
   *
   * Con el flag prendido devuelve el MISMO array (misma identidad): cero copias
   * y cero re-renders extra en el camino normal.
   *
   * Es gate de UI, no de seguridad: `/api/staff-contacts/**` sigue igual.
   */
  const conversations = useMemo(() => {
    if (engineEnabled) return rawConversations;
    return rawConversations.map((c) => (c.isStaff ? { ...c, isStaff: false } : c));
  }, [rawConversations, engineEnabled]);

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

  /**
   * Aplica la fila que devolvió el servidor con el MISMO handler que usa
   * Realtime (`applyConversationRowPatch`), en vez de recargar `/api/inbox`.
   *
   * El handler hace `...existing`, así que preserva `messages` y
   * `messagesLoaded`: es seguro aplicarlo sobre la conversación con el hilo
   * abierto, que es justo lo que el refetch no garantizaba (de ahí la lógica de
   * `keepLocal` en `useConversations`).
   *
   * Réplica exacta de `handleConversationEvent` en `useInboxRealtime`: si la
   * conversación no está en memoria no hace nada — no es un caso a reconciliar,
   * acabamos de actuar sobre ella.
   */
  const applyServerConversationRow = useCallback(
    (row: ConversationDbRow | null | undefined) => {
      if (!row?.id) return;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.id === row.id);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = applyConversationRowPatch(next[idx]!, row);
        return next;
      });
    },
    [setConversations]
  );

  const { messagesError } = useInboxConversationMessages(
    selectedId,
    conversationHotelId,
    setConversations
  );

  /**
   * Acuses de entrega de Meta para el hilo abierto, indexados por `wamid`. Es
   * la ÚNICA fuente que sabe de verdad si un mensaje le llegó al huésped: sin
   * esto los ticks solo reflejan que la fila quedó guardada en la base.
   */
  const { deliveryReceipts, refetchDeliveryReceipts } = useMessageDeliveryReceipts(
    selectedId,
    conversationHotelId
  );
  const deliveryRefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [query, setQuery] = useState("");
  /**
   * Búsqueda server-side. Alcanza las ~515 conversaciones que quedan fuera del
   * tope de 300 y que el filtro en memoria no podía ver. Mezcla sus resultados
   * por id en `conversations` (ver `useInboxSearch`).
   */
  const search = useInboxSearch({
    query,
    activeHotelId: conversationHotelId,
    activeConversationId: selectedId,
    setConversations,
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [draft, setDraft] = useState("");
  const [mobileTab, setMobileTab] = useState<"list" | "chat">("list");
  const [refreshing, setRefreshing] = useState(false);
  const handleRefresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    try {
      // `refetch` siempre hace fetch real a /api/inbox (cache: "no-store"); resuelve
      // rápido y el spinner parpadearía imperceptible. Garantizamos ~700ms de estado
      // visible para que el usuario tenga certeza de que la cola se recargó.
      await Promise.all([
        refetch({ silent: true }),
        new Promise((resolve) => setTimeout(resolve, 700)),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [refetch, refreshing]);
  const [guestOpen, setGuestOpen] = useState(false);
  /**
   * Panel derecho en escritorio. La X de la ficha lo pliega para dejarle todo el
   * ancho al hilo; el botón "Ficha" de la cabecera del chat lo vuelve a abrir.
   * En pantallas angostas el panel ya vive en el cajón (`guestOpen`).
   */
  const [detailsOpen, setDetailsOpen] = useState(true);
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
  const [hotelSelectOpen, setHotelSelectOpen] = useState(false);
  const [startConversationOpen, setStartConversationOpen] = useState(false);
  /**
   * Teléfono con el que abre el modal de "Comenzar conversación". Vacío cuando
   * se abre desde el encabezado (flujo de siempre); con el número del hilo
   * cuando se abre desde el botón de fuera de ventana de 24 h.
   */
  const [startConversationPhone, setStartConversationPhone] = useState("");
  const [sendingStaffTemplate, setSendingStaffTemplate] = useState(false);
  const [staffContactsOpen, setStaffContactsOpen] = useState(false);
  /**
   * Vista de la bandeja: "Huéspedes" (la de siempre) o "Staff". Sigue siendo un
   * cambio de lista en la misma pantalla y NO una ruta —una ruta nueva
   * duplicaría toda la bandeja—, pero se refleja en `?vista=staff` para que el
   * sidebar pueda llevar a Staff desde Reservas o Tickets, donde la bandeja ni
   * siquiera está montada.
   */
  const router = useRouter();
  const searchParams = useSearchParams();
  const vistaParam = searchParams.get(VISTA_PARAM);
  const [inboxView, setInboxView] = useState<InboxView>(
    vistaParam === VISTA_STAFF ? "staff" : "guests"
  );

  // La URL manda: si cambia (sidebar desde otra pantalla, atrás del navegador,
  // link pegado), la vista la sigue.
  useEffect(() => {
    const desired: InboxView = vistaParam === VISTA_STAFF ? "staff" : "guests";
    setInboxView((prev) => (prev === desired ? prev : desired));
  }, [vistaParam]);

  /**
   * Cambio de vista desde adentro (el sidebar con la bandeja ya montada). Se
   * usa `replace` y no `push` para no llenar el historial: alternar Huéspedes y
   * Staff no es navegar, y el botón de atrás tiene que sacarte de la bandeja.
   */
  const changeInboxView = useCallback(
    (view: InboxView) => {
      setInboxView(view);
      const params = new URLSearchParams(searchParams.toString());
      if (view === "staff") params.set(VISTA_PARAM, VISTA_STAFF);
      else params.delete(VISTA_PARAM);
      const qs = params.toString();
      router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    },
    [router, searchParams]
  );
  const [moderationDialogAction, setModerationDialogAction] = useState<"block" | "unblock" | null>(
    null
  );
  const [moderationInProgress, setModerationInProgress] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [templateToast, setTemplateToast] = useState<{
    type: "success" | "error";
    message: string;
  } | null>(null);
  const scrollEndRef = useRef<HTMLDivElement>(null);
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

  // Sincroniza el hotel activo en memoria con el que resuelve el server, pero SOLO
  // cuando la selección en memoria no es válida: arranque (activeHotelId === null) o
  // un hotelId stale que el usuario actual ya no tiene permitido (auto-recuperación
  // tras 403). Si el activeHotelId actual sigue estando en availableHotels es una
  // elección legítima del usuario: NO la pisamos aunque el server todavía responda
  // con el hotel anterior (su respuesta llega un tick después del cambio). Eso evita
  // el flicker "abre el hotel nuevo y vuelve al viejo".
  useEffect(() => {
    if (!resolvedActiveHotelId || resolvedActiveHotelId === activeHotelId) return;
    const activeStillValid =
      activeHotelId != null && availableHotels.some((h) => h.id === activeHotelId);
    if (!activeStillValid) {
      setActiveHotelId(resolvedActiveHotelId);
      writeStoredActiveHotelId(resolvedActiveHotelId);
    }
  }, [resolvedActiveHotelId, activeHotelId, availableHotels]);

  useEffect(() => {
    setActionError(null);
    setModerationDialogAction(null);
    setEditingName(false);
    setNameError(null);
  }, [selectedId]);

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

    // Los errores viven más: suelen traer una instrucción (p. ej. "falta la
    // plantilla, avísale a soporte") y 3,5 s no alcanzan para leerla.
    const ms = templateToast.type === "error" ? 6500 : 3500;
    const timeout = window.setTimeout(() => setTemplateToast(null), ms);
    return () => window.clearTimeout(timeout);
  }, [templateToast]);

  useEffect(() => {
    return () => {
      if (filePreviewUrl) {
        URL.revokeObjectURL(filePreviewUrl);
      }
    };
  }, [filePreviewUrl]);

  // Autoselección, pero NUNCA mientras la lista en memoria y el hotel activo son
  // de tenants distintos. Al elegir otro hotel, el picker hace `setSelectedId("")`
  // y `conversations` sigue siendo la del hotel anterior durante un tick: sin esta
  // guarda el efecto deshacía el reset y reelegía una conversación ajena, de donde
  // salía el `GET /api/inbox/messages?conversationId=<hotel A>&hotelId=<hotel B>`
  // → 404 (la route solo devuelve 404 cuando el par id/hotel no empareja).
  // `resolvedActiveHotelId` converge a `activeHotelId` por el efecto de sincronía
  // de más arriba, así que la guarda como mucho retrasa la selección un render.
  useEffect(() => {
    if (activeHotelId !== resolvedActiveHotelId) return;
    if (conversations.length === 0) return;

    if (requestedConversationId) {
      const found = conversations.some((c) => c.id === requestedConversationId);
      // Se consume una sola vez. Si el id siguiera vigente, cada cambio de
      // `conversations` —Realtime, refetch— volvería a imponerlo y el asesor no
      // podría abrir ninguna otra conversación.
      setRequestedConversationId(null);
      setDeepLinkMissing(!found);
      // Pedido explícito y ausente: NO se cae a otra conversación. Antes esto
      // devolvía `conversations[0]`, así que una push del huésped X abría el
      // chat del huésped Y sin ningún aviso y el asesor podía responderle a la
      // persona equivocada. Ahora el panel queda vacío y `deepLinkMissing`
      // explica por qué.
      setSelectedId(found ? requestedConversationId : "");
      return;
    }

    // Deep link no encontrado: sin autoselección. Abrir la primera es
    // exactamente el fallback que este arreglo elimina. Se levanta cuando el
    // asesor elige desde la lista (`openChat`) o cambia de hotel.
    if (deepLinkMissing) return;

    setSelectedId((id) => {
      if (id && conversations.some((c) => c.id === id)) return id;
      // La bandeja arranca SIEMPRE en Huéspedes, así que autoseleccionar una
      // conversación de staff abriría un panel de personal cuya fila no está en
      // la lista visible. Se prefiere el primer huésped; si el hotel solo tiene
      // staff se cae a la primera, que es mejor que un panel vacío.
      const firstGuest = conversations.find((c) => !c.isStaff);
      return (firstGuest ?? conversations[0]!).id;
    });
  }, [
    conversations,
    requestedConversationId,
    activeHotelId,
    resolvedActiveHotelId,
    deepLinkMissing,
  ]);

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId]
  );

  const replyBlockedByMeta = useMemo(() => isConversationReplyBlocked(selected), [selected]);

  /** Teléfono del hilo abierto en dígitos, listo para enviar plantillas. */
  const selectedPhoneDigits = useMemo(
    () => (selected ? normalizeColombianWhatsappNumber(selected.guestPhone ?? "") : ""),
    [selected]
  );

  /** Único punto de apertura del modal: decide con qué teléfono arranca. */
  const openStartConversation = useCallback((prefillPhone = "") => {
    setStartConversationPhone(prefillPhone);
    setStartConversationOpen(true);
  }, []);

  /**
   * Fuera de la ventana de 24 h contra un contacto de STAFF: manda DIRECTO la
   * plantilla fija `STAFF_CONTACT_TEMPLATE_NAME`, sin selector ni variables.
   *
   * Reusa la misma cadena de envío que el modal
   * (`sendWhatsappTemplate` → `/api/send-whatsapp-template` → engine): acá no se
   * duplica nada de la lógica de envío, solo se saltea la elección de plantilla.
   */
  const sendStaffContactTemplate = useCallback(async () => {
    const hotelId = conversationHotelId?.trim();
    if (!hotelId || !selectedPhoneDigits || sendingStaffTemplate) return;

    setSendingStaffTemplate(true);
    try {
      await sendWhatsappTemplate({
        to: selectedPhoneDigits,
        templateName: STAFF_CONTACT_TEMPLATE_NAME,
        activeHotelId: hotelId,
      });
      setTemplateToast({ type: "success", message: "Mensaje enviado al staff" });
    } catch (e) {
      const raw = e instanceof Error ? e.message : "";
      // El fallo más probable con diferencia: al hotel le falta la fila de la
      // plantilla en `message_templates`. El route responde "Plantilla no válida
      // para este hotel", que no le dice a la recepcionista qué hacer.
      const message = /plantilla no v/i.test(raw)
        ? `Este hotel no tiene configurada la plantilla "${STAFF_CONTACT_TEMPLATE_NAME}". Avísale a soporte.`
        : raw.trim() || "No se pudo contactar al staff. Intenta de nuevo.";
      setTemplateToast({ type: "error", message });
    } finally {
      setSendingStaffTemplate(false);
    }
  }, [conversationHotelId, selectedPhoneDigits, sendingStaffTemplate]);

  /**
   * Reacciones resueltas a badge. Se deriva del array de mensajes ya en estado,
   * que es también donde Realtime deja los que llegan en vivo (`handleWubbyInsert`
   * → `upsertConversationMessage`): una reacción recibida por el canal se aplica
   * sola, sin tocar los handlers.
   */
  const { bubbles: threadBubbles, reactionByMessageId } = useMemo(
    () => buildThreadView(selected?.messages ?? []),
    [selected?.messages]
  );

  /**
   * Gate del hilo: mientras la conversación seleccionada no tenga historial
   * autoritativo se muestra skeleton en lugar de pintar el array provisional
   * que vino embebido en `GET /api/inbox`. Al depender solo de un dato de
   * render (`messagesLoaded`) cubre ya el primer frame tras el clic, sin
   * esperar al efecto del hook.
   *
   * A propósito NO mira `loadingMessages`: al volver a una conversación ya
   * cargada el hook relanza el fetch, pero el hilo en memoria sigue siendo
   * autoritativo y taparlo con skeleton escondería datos que ya están.
   *
   * Si el fetch falla se degrada a mostrar lo que haya en memoria en vez de
   * dejar un skeleton permanente.
   */
  const threadLoading = !!selected && !messagesError && !selected.messagesLoaded;

  /**
   * Denominador de "COLA OPERATIVA". Es el total del hotel, no el largo del
   * array: `GET /api/inbox` trae las 300 más recientes por actividad más el set
   * protegido, así que `conversations.length` diría 301/301 —"ves todo"— con
   * 495 conversaciones sin cargar.
   *
   * Fallback a `conversations.length` mientras el total no llegó: es el
   * comportamiento anterior, el único número que sí tenemos, y nunca queda por
   * debajo del numerador. Un 0 se leería como hotel vacío y `undefined` pintaría
   * "301/undefined".
   */
  const queueTotal = totalConversations ?? conversations.length;

  /**
   * Los chips describen LA VISTA DE HUÉSPEDES, así que excluyen dos cosas: lo
   * que inyectó la búsqueda y las conversaciones de staff.
   *
   * Sin lo primero, escribir en el buscador movía los conteos: 16 resultados
   * con 2 `closed` subían "Hechas" en 2 sin que nadie cerrara nada, y al vaciar
   * el input volvían a bajar. Sin lo segundo, los chips contarían filas que la
   * vista Huéspedes ya no pinta —el staff vive en su propia vista—, y un
   * "Sin leer 3" con dos filas visibles se lee como un bug.
   *
   * Siguen siendo cotas inferiores —se cargan 300 de 815—, que es lo que ya
   * eran. La diferencia es que ahora no se mueven solos. El conteo exacto exige
   * los totales por filtro desde el servidor, que sigue pendiente.
   */
  const filterCounts = useMemo(() => {
    const base = conversations.filter((c) => !c.isStaff && !search.injectedIds.has(c.id));
    const all = base.length;
    const unread = base.filter((c) => c.unreadCount > 0).length;
    const ai_active = base.filter((c) => c.operationalStatus === "ai_active").length;
    const requires_attention = base.filter((c) => c.operationalStatus === "requires_attention").length;
    const closed = base.filter((c) => c.operationalStatus === "closed").length;
    return { all, unread, ai_active, requires_attention, closed };
  }, [conversations, search.injectedIds]);

  /**
   * La bandeja acotada SOLO por búsqueda. De acá cuelga `guestConversations`
   * (que además pasa por los chips) y nada más: la vista Staff se arma directo
   * de `conversations` porque la búsqueda ya no la alcanza.
   */
  const searchScoped = useMemo(() => {
    // Con búsqueda server-side la lista es exactamente la que resolvió el RPC.
    // El criterio local (nombre YA resuelto a teléfono cuando falta, preview del
    // último mensaje, `property`) no coincide con el del servidor (nombre y
    // teléfono con acentos plegados), así que re-filtrar acá mostraría 3 de los
    // 20 que vinieron.
    if (search.active) {
      return conversations.filter((c) => search.resultIds.has(c.id));
    }

    // Filtro de texto local SOLO cuando no hay búsqueda server-side, o sea con
    // términos de 1 carácter, por debajo del mínimo que exige el RPC.
    const q = query.trim().toLowerCase();
    if (!q) return conversations;

    return conversations.filter(
      (c) =>
        c.guest.name.toLowerCase().includes(q) ||
        c.guestPhone.toLowerCase().includes(q) ||
        c.lastMessagePreview.toLowerCase().includes(q) ||
        c.guest.property.toLowerCase().includes(q)
    );
  }, [conversations, query, search.active, search.resultIds]);

  /**
   * Sección "Huéspedes": la bandeja de siempre menos el staff. Mismo orden,
   * mismos chips, mismo comportamiento de búsqueda.
   */
  const guestConversations = useMemo(() => {
    let list = searchScoped.filter((c) => !c.isStaff);

    if (statusFilter === "unread") {
      list = list.filter((c) => c.unreadCount > 0);
    } else if (statusFilter === "ai_active") {
      list = list.filter((c) => c.operationalStatus === "ai_active");
    } else if (statusFilter === "requires_attention") {
      list = list.filter((c) => c.operationalStatus === "requires_attention");
    } else if (statusFilter === "closed") {
      list = list.filter((c) => c.operationalStatus === "closed");
    }

    return sortGuestConversations(list);
  }, [searchScoped, statusFilter]);

  /**
   * Vista "Staff". A propósito NO pasa por los chips de estado ni por la
   * búsqueda:
   *
   * - Los chips ("IA activa", "Atención", "Hechas") describen el ciclo de vida
   *   de un huésped y en un hilo con el personal no significan nada. Si se
   *   sub-filtrara, poner "Hechas" escondería a la camarera que acaba de
   *   escribir sin ninguna razón visible.
   * - El buscador es de la vista Huéspedes y ya no devuelve staff. Son decenas
   *   de contactos, se ven todos de un scroll; filtrarlos con un término que se
   *   escribió en la otra vista sería una lista vacía sin explicación.
   */
  const staffConversations = useMemo(
    () => sortConversationsByActivity(conversations.filter((c) => c.isStaff)),
    [conversations]
  );

  /**
   * Contador del tab Staff del header. Es lo único que puede traer a alguien a
   * la otra vista, así que cuenta conversaciones —no mensajes—: es el número de
   * hilos del personal que están esperando respuesta.
   */
  const staffUnreadConversations = useMemo(
    () => staffConversations.filter((c) => c.unreadCount > 0).length,
    [staffConversations]
  );

  /**
   * Vista realmente pintada. Se deriva en vez de guardarse para que el gate por
   * engine no pueda quedar en un estado imposible: si el asesor está en Staff y
   * cambia a un hotel que todavía corre en n8n, el tab desaparece del header y
   * la bandeja vuelve sola a Huéspedes en el mismo render, sin un `useEffect`
   * que corrija después (que es un frame con una lista de staff vacía y sin tab
   * por el que volver).
   */
  const activeInboxView: InboxView = engineEnabled ? inboxView : "guests";
  const staffViewActive = activeInboxView === "staff";

  /**
   * La búsqueda encontró algo, pero todo lo encontrado es personal y por eso la
   * vista Huéspedes queda vacía. Solo sirve para elegir el texto del vacío.
   */
  const searchOnlyMatchedStaff = useMemo(
    () => searchScoped.length > 0 && searchScoped.every((c) => c.isStaff),
    [searchScoped]
  );

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

  /**
   * Repesca los acuses de Meta un rato después de enviar. El webhook de status
   * no es inmediato —un `failed` como 131026 tarda segundos— así que pedirlo al
   * instante no traería nada; se espera y se pide UNA vez.
   *
   * Es best-effort: si el acuse llega más tarde, se verá al reabrir la
   * conversación. No se monta un polling por algo que en la práctica es raro.
   */
  const scheduleDeliveryReceiptsRefetch = useCallback(() => {
    if (deliveryRefetchTimerRef.current) {
      clearTimeout(deliveryRefetchTimerRef.current);
    }
    deliveryRefetchTimerRef.current = setTimeout(() => {
      deliveryRefetchTimerRef.current = null;
      refetchDeliveryReceipts();
    }, DELIVERY_STATUS_REFETCH_MS);
  }, [refetchDeliveryReceipts]);

  // Cambiar de conversación (o desmontar) cancela el refetch pendiente: si no,
  // dispararía contra el hilo que ya no está abierto.
  useEffect(() => {
    return () => {
      if (deliveryRefetchTimerRef.current) {
        clearTimeout(deliveryRefetchTimerRef.current);
        deliveryRefetchTimerRef.current = null;
      }
    };
  }, [selectedId]);

  const sendMessage = async () => {
    const text = draft.trim();
    if ((!text && !selectedFile) || !selectedId || sendingMedia) return;
    const selectedConv = conversations.find((c) => c.id === selectedId);
    if (selectedConv?.operationalStatus === "closed") return;
    if (isConversationReplyBlocked(selectedConv)) return;

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
        // LID-aware, igual que el camino de texto: un identificador de Meta
        // viaja crudo al engine; un teléfono sigue yendo en dígitos. Con
        // `normalizePhoneDigits` un LID quedaba destrozado y el adjunto no
        // llegaba.
        formData.set("to", normalizeGuestIdentityKey(selectedConv!.guestPhone));
        if (text) formData.set("caption", text);
        formData.set("hotelId", activeHotelId ?? "");
        formData.set("clientTempId", clientTempId);
        formData.set("file", selectedFile);

        const res = await fetch("/api/send-whatsapp-media", {
          method: "POST",
          body: formData,
        });
        // La route ya no inserta la fila ni toca `conversations`: reenvía al
        // engine, que es quien inserta en `Wubby_Whatsapp` y mueve el reloj de
        // control humano. Por eso no devuelve `message` ni `conversation`.
        const j = (await res.json().catch(() => ({}))) as {
          error?: string;
          skipped?: boolean;
          /** Id de Meta del mensaje, tal como lo devolvió el engine. */
          whatsappMessageId?: string | null;
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
          setFileError(
            j.skipped
              ? "El envío de archivos no está configurado: faltan ENGINE_HUMAN_MEDIA_URL / INBOX_SHARED_SECRET."
              : j.error ?? "No se pudo enviar el archivo por WhatsApp."
          );
          return;
        }

        const sentAtIso = pendingSentAtIso;
        const messageType = j.whatsappType ?? pendingMessageType;
        const confirmedMediaMessage: Message = {
          ...optimisticMediaMessage,
          status: "confirmed",
          sentAt: formatMessageDetailTime(sentAtIso),
          sentAtIso,
          messageType,
          // La route sí conoce estos datos (subió el archivo ella misma), así que
          // la burbuja se pinta sin esperar a Realtime. Cuando llegue la fila que
          // insertó el engine, `upsertConversationMessage` la reemplaza por
          // `clientTempId`.
          mediaStoragePath: j.mediaStoragePath ?? null,
          mediaBucket: j.mediaBucket ?? null,
          mediaCaption: text || null,
          mediaFilename: j.mediaFilename ?? selectedFile.name,
          // Sin esto la burbuja recién enviada no tendría con qué cruzarse
          // contra `message_statuses` hasta el siguiente refetch del hilo.
          wamid: j.whatsappMessageId ?? null,
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
        // Sin refetch, igual que el camino de texto: la route ya no escribe en la
        // base, así que no puede devolver la fila de `conversations`. El estado
        // de control humano lo mueve el engine y llega por Realtime; acá basta
        // con el optimista local que ya se aplicó arriba. Refrescar acá
        // recargaría la bandeja entera en cada archivo enviado.
        scheduleDeliveryReceiptsRefetch();
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
          // LID-aware: un identificador de Meta viaja crudo al engine; un
          // teléfono sigue yendo en dígitos, igual que siempre.
          guestPhone: normalizeGuestIdentityKey(selectedConv!.guestPhone),
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
            "ENGINE_HUMAN_REPLY_URL / INBOX_SHARED_SECRET no están definidas: el mensaje solo se muestra en la UI hasta que configures el engine."
          );
        } else {
          setSendWarning(j.error ?? "No se pudo notificar al engine");
        }
      }
      // Meta puede aceptar el mensaje y rechazarlo después (131026 "Message
      // Undeliverable"): la burbuja queda en ✓ y solo el acuse posterior la
      // mueve a ✓✓ o la marca como no entregada.
      scheduleDeliveryReceiptsRefetch();
    } catch {
      setSendWarning("Error de red al enviar al engine");
    }
    // Sin refetch. Este endpoint NO escribe en la base: reenvía a
    // ferraria-engine, que es quien inserta el mensaje y mueve `conversations`,
    // así que no puede devolver la fila y el sitio se queda con optimista local
    // + Realtime. El refetch además estaba en un `finally`, o sea que recargaba
    // la bandeja entera incluso cuando el POST había fallado — y desde que
    // `/api/inbox` dejó de traer historial tampoco podía confirmar la burbuja:
    // `useConversations` conserva los mensajes locales frente a un array vacío.
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
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
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
      applyServerConversationRow(j.conversation);
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
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
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
                // El servidor también pone `unread_count: 0` en esta acción
                // (`buildReactivateAiFields`); sin esto el contador parpadeaba
                // hasta que llegaba la fila.
                unreadCount: 0,
                operationalStatus: "ai_active",
              }
            : c
        )
      );
      applyServerConversationRow(j.conversation);
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

    // Réplica del orden de precedencia de `mapOperationalFromConversationRow`
    // para el row que va a escribir el servidor (`status: "open"`): `blocked`
    // gana sobre `needs_human` / `ai_active`, y con la IA activa el control
    // sigue siendo suyo aunque la conversación esté bloqueada. Sin la rama
    // `blocked` el optimista mostraba `ai_active` y la fila del servidor lo
    // corregía a `requires_attention` un tick después.
    const nextOperational: OperationalStatus =
      conv.blocked || conv.needsHuman || !conv.aiActive ? "requires_attention" : "ai_active";
    const nextControl: ControlMode = conv.blocked
      ? conv.aiActive
        ? "ai"
        : "human"
      : nextOperational === "ai_active"
        ? "ai"
        : "human";

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
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
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
      applyServerConversationRow(j.conversation);
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
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
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
                // `mapOperationalFromConversationRow` devuelve SIEMPRE "human"
                // para `status: "completed"`, sin mirar `ai_active`. El "ai"
                // que había acá discrepaba de la fila que devuelve el servidor.
                controlMode: "human",
                request: null,
              }
            : c
        )
      );
      applyServerConversationRow(j.conversation);
    } catch {
      setActionError("Error de red al completar la conversación");
    } finally {
      setPendingAction(null);
    }
  };

  const startEditingName = () => {
    if (!selected) return;
    setNameDraft(selected.guest.name === selected.guestPhone ? "" : selected.guest.name);
    setNameError(null);
    setEditingName(true);
  };

  const cancelEditingName = () => {
    setEditingName(false);
    setNameError(null);
  };

  const renameGuest = async () => {
    if (!selectedId) return;
    const conv = conversations.find((c) => c.id === selectedId);
    if (!conv) return;
    if (savingName) return;

    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameError("El nombre no puede estar vacío");
      return;
    }
    if (nextName.length > GUEST_NAME_MAX_LENGTH) {
      setNameError(`Máximo ${GUEST_NAME_MAX_LENGTH} caracteres`);
      return;
    }
    if (nextName === conv.guest.name) {
      cancelEditingName();
      return;
    }

    const previousName = conv.guest.name;
    setSavingName(true);
    setNameError(null);
    // Optimista: el nombre cambia al instante en lista y cabecera.
    setConversations((prev) =>
      prev.map((c) =>
        c.id === selectedId ? { ...c, guest: { ...c.guest, name: nextName } } : c
      )
    );

    try {
      const res = await fetch("/api/inbox", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conv.id, action: "rename", guestName: nextName }),
      });
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
      if (!res.ok) {
        setConversations((prev) =>
          prev.map((c) =>
            c.id === selectedId ? { ...c, guest: { ...c.guest, name: previousName } } : c
          )
        );
        setNameError(j.error ?? "No se pudo actualizar el nombre");
        return;
      }
      setEditingName(false);
      // La fila trae el nombre ya normalizado por `displayGuestName` dentro de
      // `applyConversationRowPatch` (fallback al teléfono si quedó vacío).
      applyServerConversationRow(j.conversation);
    } catch {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === selectedId ? { ...c, guest: { ...c.guest, name: previousName } } : c
        )
      );
      setNameError("Error de red al actualizar el nombre");
    } finally {
      setSavingName(false);
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
      const j = (await res.json().catch(() => ({}))) as InboxPatchResponse;
      if (!res.ok) {
        setConversations((prev) =>
          prev.map((c) => (c.id === selectedId ? { ...c, request: "pending" } : c))
        );
        setActionError(j.error ?? "No se pudo marcar el asunto como resuelto");
        return;
      }
      applyServerConversationRow(j.conversation);
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
    // El asesor eligió a mano: el aviso del deep link ya no aplica y la
    // autoselección vuelve a estar habilitada.
    setDeepLinkMissing(false);
    setSelectedId(id);
    setMobileTab("chat");
    void markConversationRead(id);
  };

  /**
   * Fila de la vista Staff (spec 5.2): "Nombre · Cargo" arriba y el preview del
   * último mensaje debajo. Card blanca con borde rojo cuando está seleccionada,
   * igual que Huéspedes, para que las dos bandejas se lean como la misma app.
   *
   * Sin semáforo de estado y sin la barra roja del costado: "Pendiente",
   * "Atención", "Humano" e "IA activa" describen el ciclo de vida del agente, y
   * acá el agente no interviene. Los campos que los alimentan (`request`,
   * `controlMode`, `operationalStatus`) sí vienen poblados en la base —por datos
   * históricos y porque responder desde la bandeja marca control humano—, pero
   * no significan nada en un hilo con el personal. El guard es de render: el
   * dato no se toca.
   */
  const renderStaffRow = (c: Conversation) => {
    const active = c.id === selectedId;
    const hasUnread = c.unreadCount > 0;
    const unreadLabel = c.unreadCount > 99 ? "99+" : String(c.unreadCount);
    const { emoji, rest } = splitLeadingEmoji(c.guest.name);
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => openChat(c.id)}
        aria-current={active ? "true" : undefined}
        className="d-row flex w-full text-left"
        style={{
          gap: 12,
          padding: "12px 13px",
          borderRadius: "var(--radius-card)",
          border: `1.5px solid ${active ? "var(--accent)" : "transparent"}`,
          // Solo la seleccionada fija fondo: sin `background` inline, el hover
          // de `.d-row` sigue funcionando en las demás.
          ...(active ? { background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" } : null),
        }}
      >
        <Avatar name={c.guest.name} seed={c.guest.id} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className="grotesk shrink truncate"
              style={{
                fontWeight: 700,
                fontSize: 14.5,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
              }}
            >
              {(emoji ? emoji + " " : "") + rest}
            </span>
            <span aria-hidden className="shrink-0" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              ·
            </span>
            <span className="min-w-0 truncate" style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>
              {STAFF_ROLE_FALLBACK}
            </span>
            {c.blocked && <BlockedBadge className="shrink-0" />}
            <span className="ibx-mono ml-auto shrink-0" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {c.lastMessageAt}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <p
              className="min-w-0 flex-1 truncate"
              style={{
                margin: 0,
                fontSize: 13,
                color: hasUnread ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: hasUnread ? 600 : 400,
              }}
            >
              {stripWhatsappMarkup(c.lastMessagePreview)}
            </p>
            {hasUnread && (
              <span
                className="ibx-mono flex h-[18px] min-w-[18px] shrink-0 items-center justify-center px-1"
                style={{ borderRadius: 999, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}
                aria-label={`${c.unreadCount} mensajes sin leer`}
              >
                {unreadLabel}
              </span>
            )}
          </div>
        </div>
      </button>
    );
  };

  /**
   * Fila de la vista Huéspedes (rediseño, spec 4.3). Está separada de
   * `renderStaffRow` porque las dos vistas muestran cosas distintas en el mismo
   * lugar: acá el estado del agente, allá el cargo de la persona. Comparten la
   * card (mismo padding, mismo borde rojo al seleccionar) y nada más.
   *
   * Dos renglones: el estado es el prefijo del preview, la fila seleccionada se
   * convierte en una card blanca con borde rojo sobre el crema, y la barra roja
   * de la izquierda desapareció porque el punto rojo del prefijo dice lo mismo.
   *
   * No se pierde ningún dato: lo que antes vivía en el tercer renglón
   * (temporizador de seguimiento, "Volvió sola", triage, propiedad) sigue ahí,
   * pero solo se pinta cuando existe, que es la minoría de las filas.
   */
  const renderGuestRow = (c: Conversation) => {
    const active = c.id === selectedId;
    const hasUnread = c.unreadCount > 0;
    const unreadLabel = c.unreadCount > 99 ? "99+" : String(c.unreadCount);
    const isPending = c.request === "pending";
    const isHumanHandled = c.controlMode === "human" && c.operationalStatus !== "closed";
    const statusVariant: StatusVariant = isPending
      ? "pending"
      : c.operationalStatus === "closed"
        ? "done"
        : isHumanHandled
          ? "human"
          : c.operationalStatus === "requires_attention"
            ? "attention"
            : "ia";
    const propertyLabel = c.guest.property.split("—")[0]?.trim();
    const showProperty =
      propertyLabel &&
      !["sin propiedad indicada", "true", "false"].includes(propertyLabel.toLowerCase());
    const followupTimer = followupTimers.get(c.id);
    const showAutoReactivated =
      statusVariant === "ia" && c.autoReactivatedAt !== null && c.autoReactivatedAt !== undefined;
    const showTriage = c.triageEscalatedAt !== null && c.triageEscalatedAt !== undefined;
    const hasExtras = Boolean(followupTimer || showAutoReactivated || showTriage || showProperty);
    const { emoji, rest } = splitLeadingEmoji(c.guest.name);
    return (
      <button
        key={c.id}
        type="button"
        onClick={() => openChat(c.id)}
        aria-current={active ? "true" : undefined}
        className="d-row flex w-full text-left"
        style={{
          gap: 12,
          padding: "12px 13px",
          borderRadius: "var(--radius-card)",
          // Borde del item seleccionado: terracota del spec (§2.2).
          border: `1.5px solid ${active ? "var(--accent)" : "transparent"}`,
          // Solo la seleccionada fija fondo: sin `background` inline, el hover
          // de `.d-row` sigue funcionando en las demás (el inline le gana a la
          // regla de hover, no al revés).
          ...(active ? { background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" } : null),
        }}
      >
        <Avatar name={c.guest.name} seed={c.guest.id} size={42} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span
              className="grotesk truncate"
              style={{
                fontWeight: 700,
                fontSize: 14.5,
                letterSpacing: "-0.01em",
                color: "var(--text-primary)",
              }}
            >
              {(emoji ? emoji + " " : "") + rest}
            </span>
            {c.blocked && <BlockedBadge className="shrink-0" />}
            <span className="ibx-mono ml-auto shrink-0" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              {c.lastMessageAt}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <GuestStatusPrefix variant={statusVariant} />
            <span aria-hidden style={{ fontSize: 11, color: "var(--text-secondary)" }}>
              ·
            </span>
            <p
              className="min-w-0 flex-1 truncate"
              style={{
                margin: 0,
                fontSize: 13,
                color: hasUnread ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: hasUnread ? 600 : 400,
              }}
            >
              {stripWhatsappMarkup(c.lastMessagePreview)}
            </p>
            {hasUnread && (
              <span
                className="ibx-mono flex h-[18px] min-w-[18px] shrink-0 items-center justify-center px-1"
                style={{ borderRadius: 999, background: "var(--accent)", color: "#fff", fontSize: 10, fontWeight: 700, lineHeight: 1 }}
                aria-label={`${c.unreadCount} mensajes sin leer`}
              >
                {unreadLabel}
              </span>
            )}
          </div>
          {hasExtras && (
            <div className="mt-2 flex items-center gap-2">
              {showAutoReactivated && <AutoReactivatedBadge />}
              {showTriage && <TriageEscalatedBadge />}
              {showProperty && (
                <span className="truncate" style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                  {propertyLabel}
                </span>
              )}
              {followupTimer && (
                <span className="ml-auto flex shrink-0 items-center">
                  <FollowupTimer
                    quoteCreatedAt={followupTimer.quoteCreatedAt}
                    onCancel={() => cancelFollowup(c.id, followupTimer.quoteRequestId, followupTimer.stage)}
                  />
                </span>
              )}
            </div>
          )}
        </div>
      </button>
    );
  };

  const filterTabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: "all", label: "Todas", count: filterCounts.all },
    { id: "unread", label: "Sin leer", count: filterCounts.unread },
    { id: "requires_attention", label: "Atención", count: filterCounts.requires_attention },
    { id: "closed", label: "Hechas", count: filterCounts.closed },
  ];

  const selectedIsStaff = Boolean(selected?.isStaff);
  /**
   * "Cerrada" describe el ciclo de vida de un HUÉSPED: la IA resolvió o alguien
   * marcó completado. En un hilo con el personal no significa nada.
   *
   * Y hay una razón dura además de la conceptual: en staff se ocultan "cerrar"
   * y "reabrir", así que una conversación que hubiera quedado cerrada de antes
   * dejaría el compositor bloqueado PARA SIEMPRE, sin ningún botón que lo
   * suelte. Ignorar el cierre en staff cierra ese callejón sin salida.
   */
  const conversationClosed = selected?.operationalStatus === "closed" && !selectedIsStaff;
  const inputDisabled = Boolean(conversationClosed || replyBlockedByMeta);
  const selectedFileIsPdf = isPdfFile(selectedFile);
  const selectedFileSizeLabel = selectedFile ? formatFileSize(selectedFile.size) : "";

  /**
   * Selector de hotel activo. Se pinta en dos sitios distintos según la vista:
   * en Huéspedes ocupa su propio renglón debajo de los chips, y en Staff entra
   * en la misma fila que las acciones. Con un solo hotel no se pinta en ningún
   * lado. Solo cambia la caja: la lista desplegable es la misma, y por eso
   * `hotelSelectRef` puede seguir siendo uno —nunca hay dos en pantalla.
   */
  const renderHotelSelector = (variant: "bloque" | "en-fila") => {
    if (availableHotels.length < 2) return null;
    const enFila = variant === "en-fila";
    const selectedHotelId = activeHotelId ?? resolvedActiveHotelId ?? "";
    const selectedHotel = availableHotels.find((hotel) => hotel.id === selectedHotelId);
    return (
      <div className={enFila ? "min-w-[142px] flex-1" : "mt-3.5"}>
        <div ref={hotelSelectRef} className="relative">
          <button
            type="button"
            onClick={() => setHotelSelectOpen((open) => !open)}
            className="d-act flex w-full cursor-pointer items-center gap-2 outline-none"
            style={{
              padding: enFila ? "6px 10px" : "10px 13px",
              // Las dos listas van sobre crema, así que el selector va en
              // blanco para despegarse del fondo.
              borderRadius: enFila ? 11 : 12,
              border: "1px solid var(--border-soft)",
              background: "var(--bg-card)",
              color: "var(--text-primary)",
              fontSize: enFila ? 12 : 13.5,
              fontWeight: 600,
            }}
            aria-haspopup="listbox"
            aria-expanded={hotelSelectOpen}
            aria-label="Hotel activo"
          >
            <span style={{ fontSize: enFila ? 13 : 15 }} aria-hidden>🏨</span>
            <span className="truncate">{selectedHotel?.name ?? "Seleccionar hotel"}</span>
            <IconChevronDown
              className={`ml-auto h-4 w-4 shrink-0 transition-transform ${hotelSelectOpen ? "rotate-180" : ""}`}
              style={{ color: "var(--text-secondary)" }}
              aria-hidden
            />
          </button>
          {hotelSelectOpen && (
            <div
              className="absolute left-0 right-0 top-[calc(100%+0.375rem)] z-[230] overflow-hidden"
              style={{ borderRadius: 12, border: "1px solid var(--border-soft)", background: "var(--bg-card)", boxShadow: "var(--shadow-lg)" }}
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
                      // El aviso hablaba de la lista del hotel
                      // anterior: en el nuevo vuelve a autoseleccionar.
                      setDeepLinkMissing(false);
                      setHotelSelectOpen(false);
                    }}
                    className="d-soft flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left"
                    style={{
                      fontSize: 13,
                      background: isSelected ? "var(--bg-app)" : "transparent",
                      fontWeight: isSelected ? 600 : 400,
                      color: "var(--text-primary)",
                    }}
                  >
                    <span className="truncate">{hotel.name}</span>
                    {isSelected && <IconCheck className="h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} aria-hidden />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  if (loading && conversations.length === 0) {
    return <InboxLoadingSkeleton />;
  }

  return (
    <AppShell
      hotelId={conversationHotelId}
      inboxView={activeInboxView}
      onInboxViewChange={changeInboxView}
      staffUnreadCount={staffUnreadConversations}
      hideMobileNav={mobileTab === "chat"}
      realtimeStatus={realtimeUiStatus}
    >
    <div
      className="ibx flex h-full max-h-full min-h-0 w-full max-w-full flex-col overflow-x-hidden"
      style={{
        background: "var(--bg-app)",
        color: "var(--text-primary)",
        // Lo reservaba el encabezado rojo, que ya no está: sin esto, en la app
        // instalada la lista arranca debajo de la barra de estado del teléfono.
        paddingTop: "env(safe-area-inset-top, 0px)",
      }}
    >
      {urgentHandoffBannerVisible && (
        <div
          className="fixed right-4 top-4 z-[300] flex max-w-[min(100vw-2rem,20rem)] items-start gap-3 rounded-xl px-4 py-3 text-[13px] font-semibold leading-snug"
          style={{ border: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)", boxShadow: "var(--shadow-lg)" }}
          role="status"
        >
          <span className="min-w-0 flex-1">🚨 Huésped requiere atención humana</span>
          <button
            type="button"
            onClick={dismissUrgentHandoffBanner}
            className="shrink-0 rounded-lg p-1 transition hover:bg-[var(--bg-card)]/40"
            style={{ color: "var(--accent)" }}
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
              : { border: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)", boxShadow: "var(--shadow-lg)" }
          }
          role={templateToast.type === "success" ? "status" : "alert"}
        >
          {templateToast.message}
        </div>
      )}
      {error && (
        <div
          className="shrink-0 px-4 py-2 text-center text-[13px]"
          style={{ borderBottom: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
        >
          {error}
        </div>
      )}

      {actionError && (
        <div
          className="shrink-0 px-4 py-2 text-center text-[13px]"
          style={{ borderBottom: "1px solid color-mix(in srgb, var(--gold) 45%, transparent)", background: "color-mix(in srgb, var(--gold) 12%, transparent)", color: "var(--text-primary)" }}
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
            /*
             * Crema en las dos vistas: es lo que hace que la conversación
             * seleccionada se lea como una card blanca levantada del fondo.
             */
            background: "var(--bg-app)",
            borderRight: "1px solid var(--border-soft)",
            ...(isDesktop ? { width: leftWidth, flex: "0 0 auto" } : null),
          }}
        >
          <div className="shrink-0 px-5 pb-3.5 pt-[18px]">
            <div className={`flex items-center gap-2.5 ${staffViewActive ? "mb-2" : "mb-3.5"}`}>
              {/* Mismo título en las dos vistas (spec 4.1 y 5.1): cambia la
                  palabra, no el peso ni el tamaño. */}
              <h2
                className="grotesk min-w-0 truncate"
                style={{
                  margin: 0,
                  fontSize: 17,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  color: "var(--text-primary)",
                }}
              >
                {staffViewActive ? "Staff" : "Huéspedes"}
              </h2>
              <span
                className="ibx-mono inline-flex shrink-0 items-center gap-1.5"
                style={{ fontSize: 11.5, fontWeight: 700, color: refreshing ? "var(--accent)" : "var(--text-secondary)" }}
                aria-live="polite"
                title={
                  staffViewActive
                    ? undefined
                    : `${guestConversations.length} conversaciones en pantalla de ${queueTotal} del hotel`
                }
              >
                {refreshing ? (
                  <>
                    <Spinner className="h-3 w-3 animate-spin" />
                    Actualizando…
                  </>
                ) : staffViewActive ? (
                  // Sin denominador: `queueTotal` es el total de conversaciones
                  // del hotel, así que "8/815" se leería como que faltan 807
                  // contactos del personal por cargar.
                  `${staffConversations.length}`
                ) : (
                  `${guestConversations.length}/${queueTotal}`
                )}
              </span>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing}
                className="d-act ml-auto flex h-8 w-8 shrink-0 items-center justify-center disabled:opacity-50"
                style={{
                  borderRadius: 10,
                  border: "1px solid var(--border-soft)",
                  // Blanca sobre el crema de la lista: el gris del panel no se
                  // despegaría del fondo.
                  background: "var(--bg-card)",
                  color: "var(--text-secondary)",
                }}
                aria-label="Refrescar conversaciones"
                title="Refrescar"
              >
                {refreshing ? (
                  <Spinner className="h-4 w-4 animate-spin" />
                ) : (
                  <IconRefresh className="h-4 w-4" aria-hidden />
                )}
              </button>
              {/* Acá vivía el menú "…". Su única entrada era el interruptor de
                  notificaciones, que ahora es la campana del sidebar, así que
                  el menú quedó vacío y se fue con ella. */}
              {/* Acción principal de la sección: abrir un hilo nuevo. Vive acá,
                  al lado de la lista que va a recibirlo, y por eso el botón
                  equivalente del encabezado rojo se oculta en esta vista. */}
              {!staffViewActive && (
                <button
                  type="button"
                  onClick={() => openStartConversation()}
                  className="grotesk inline-flex shrink-0 items-center rounded-[var(--radius-chip)] bg-[var(--accent)] px-3 py-2 text-[13px] font-bold text-white transition-colors hover:bg-[var(--accent-hover)]"
                  title="Comenzar una conversación nueva con un huésped"
                >
                  Nueva
                </button>
              )}
            </div>
            {/* Buscador y chips son de la vista Huéspedes. En Staff no se
                pintan por decisión explícita: son decenas de contactos, entran
                de un scroll, y los estados operativos no aplican a un hilo con
                el personal. En su lugar va la gestión de contactos, que es la
                única acción que esta vista necesita. */}
            {staffViewActive ? (
              /* Encabezado compacto: una línea de contexto y un solo renglón de
                 acciones. Antes eran cuatro bloques apilados —subtítulo largo,
                 dos botones y el selector de hotel en su propio renglón— y el
                 encabezado terminaba mucho más alto que el de Huéspedes,
                 comiéndose filas de la lista en una tablet. */
              <div>
                {/* Subtítulo del spec 5.1, literal. Lo que no se deduce de
                    ningún otro lado es la segunda frase: que el agente no
                    contesta en esta bandeja. */}
                <p className="mb-2 text-[12px] leading-snug" style={{ color: "var(--text-secondary)" }}>
                  Conversaciones con el personal del hotel. La IA no interviene acá.
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {/* "Comenzar conversación" solo existe en Staff: en Huéspedes
                      la misma acción es el botón rojo "Nueva" del encabezado. */}
                  <button
                    type="button"
                    onClick={() => openStartConversation()}
                    className="grotesk inline-flex shrink-0 items-center gap-1.5 rounded-[var(--radius-chip)] bg-[var(--accent)] px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-[var(--accent-hover)]"
                  >
                    <IconCompose className="h-4 w-4 shrink-0" aria-hidden />
                    Comenzar conversación
                  </button>
                  <button
                    type="button"
                    onClick={() => setStaffContactsOpen(true)}
                    className="grotesk d-act inline-flex shrink-0 items-center gap-1 px-2.5 py-1.5"
                    style={{
                      borderRadius: 9,
                      border: "1px solid var(--border-soft)",
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <IconStaff className="h-4 w-4 shrink-0" style={{ color: "var(--staff)" }} aria-hidden />
                    Contactos
                  </button>
                  {/* Con un solo hotel no se pinta y la fila queda con los dos
                      botones nomás; con varios entra acá y si el panel se
                      angosta baja a su propio renglón en vez de aplastarse. */}
                  {renderHotelSelector("en-fila")}
                </div>
              </div>
            ) : (
              <>
            <label className="relative mb-3.5 block">
              <IconSearch
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
                style={{ color: "var(--text-secondary)" }}
              />
              <input
                type="search"
                placeholder="Buscar huésped o mensaje…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="w-full outline-none"
                style={{
                  padding: "11px 14px 11px 38px",
                  borderRadius: 12,
                  border: "1px solid var(--border-soft)",
                  background: "var(--bg-card)",
                  color: "var(--text-primary)",
                  fontSize: 13.5,
                }}
              />
            </label>

            {/* Los cuatro chips van SIEMPRE en un solo renglón. Con la lista en
                su ancho por defecto entran justos; si el panel se angosta o un
                contador se va a tres cifras, la fila se desliza en horizontal en
                vez de partirse en dos. La barra de scroll se oculta —ensucia un
                renglón tan bajo— pero el arrastre con dedo o trackpad funciona
                igual, y `shrink-0` evita que los chips se aplasten. */}
            <div className="ibx-scroll-x-hidden flex flex-nowrap gap-1 overflow-x-auto">
              {filterTabs.map((tab) => {
                const active = statusFilter === tab.id;
                /*
                 * "Atención" es el único chip con color propio: es el filtro que
                 * manda a trabajar. Se pinta en rojo cuando está activo y en rojo
                 * suave cuando hay algo esperando. En cero se apaga y queda como
                 * los demás — un chip rojo permanente sin nada pendiente entrena
                 * a ignorar el rojo justo cuando sí importa.
                 */
                const isAttention = tab.id === "requires_attention";
                const attentionIdle = isAttention && !active && tab.count > 0;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setStatusFilter(tab.id)}
                    aria-pressed={active}
                    className="grotesk d-chip inline-flex shrink-0 items-center gap-1"
                    style={{
                      padding: "6px 9px",
                      borderRadius: "var(--radius-chip)",
                      border: "1px solid transparent",
                      fontSize: 11.5,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                      background: active
                        ? isAttention
                          ? "var(--accent)"
                          : "var(--text-primary)"
                        : attentionIdle
                          ? "var(--red-soft)"
                          : "var(--bg-card)",
                      borderColor: active
                        ? "transparent"
                        : attentionIdle
                          ? "color-mix(in srgb, var(--accent) 35%, transparent)"
                          : "var(--border-soft)",
                      color: active
                        ? isAttention
                          ? "#fff"
                          : "var(--bg-card)"
                        : attentionIdle
                          ? "var(--accent)"
                          : "var(--text-secondary)",
                    }}
                  >
                    {tab.label}
                    <span className="ibx-mono" style={{ fontSize: 10, fontWeight: 700, opacity: active ? 0.85 : 0.7 }}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
              </>
            )}

            {/* En Staff el selector ya viaja dentro de la fila de acciones. */}
            {!staffViewActive && renderHotelSelector("bloque")}

          </div>

          <div
            className={`ibx-scroll min-h-0 flex-1 overflow-y-auto transition-opacity duration-200 ${refreshing ? "pointer-events-none opacity-50" : "opacity-100"}`}
            style={{ borderTop: "1px solid var(--border-soft)" }}
            aria-busy={refreshing}
          >
            {loading ? (
              /* Fondo blanco durante la carga: los bloques del skeleton están
                 pintados con los grises del panel claro y sobre el crema de
                 Huéspedes desaparecerían. Mientras carga no hay ninguna card
                 que necesite el crema detrás. */
              <div style={{ background: "var(--bg-card)" }}>
                <InboxListSkeleton />
              </div>
            ) : (
              <>
            {staffViewActive ? (
              /* ───────── Vista Staff ─────────
                 Filas propias (`renderStaffRow`, spec 5.2), sin encabezado
                 dentro de la lista: el de arriba ya dice dónde estás. */
              staffConversations.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
                  <IconStaff className="h-7 w-7" style={{ color: "var(--staff)" }} aria-hidden />
                  <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                    Todavía no hay conversaciones con el personal
                  </p>
                  <p className="max-w-[250px] text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                    Registra a recepción, camareras o mantenimiento como contactos y sus
                    mensajes llegan acá, sin que la IA les conteste.
                  </p>
                  {/* El vacío tiene que ofrecer la acción: es la puerta para
                      cargar el primer contacto y sin ella la vista sería un
                      callejón sin salida. */}
                  <button
                    type="button"
                    onClick={() => setStaffContactsOpen(true)}
                    className="d-act grotesk mt-1 px-3.5 py-2"
                    style={{
                      borderRadius: 9,
                      border: "1px solid var(--border-soft)",
                      background: "var(--bg-card)",
                      color: "var(--text-primary)",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    + Agregar contacto
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-1 px-2.5 py-2.5">
                  {staffConversations.map(renderStaffRow)}
                </div>
              )
            ) : (
              <>
            {search.status === "searching" ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <Spinner className="h-5 w-5 animate-spin" style={{ color: "var(--text-secondary)" }} />
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Buscando «{search.term}»…
                </p>
              </div>
            ) : search.status === "error" ? (
              /* Separado de "sin resultados" a propósito: un fallo de red pintado
                 como ausencia le hace concluir al asesor que el huésped no existe. */
              <div className="flex flex-col items-center justify-center gap-2.5 px-6 py-16 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--accent)" }}>
                  No se pudo buscar
                </p>
                <p className="max-w-[240px] text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {search.error ?? "Revisa la conexión e intenta de nuevo."}
                </p>
                <button
                  type="button"
                  onClick={search.retry}
                  className="d-act grotesk mt-1 px-3.5 py-2"
                  style={{
                    borderRadius: 9,
                    border: "1px solid var(--border-soft)",
                    background: "var(--bg-app)",
                    color: "var(--text-primary)",
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  Reintentar
                </button>
              </div>
            ) : search.status === "empty" ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                  Sin resultados para «{search.term}»
                </p>
                <p className="max-w-[240px] text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  Buscamos por nombre y teléfono en todo el hotel, no solo en lo cargado.
                </p>
              </div>
            ) : guestConversations.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
                <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>No hay conversaciones</p>
                <p className="max-w-[250px] text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {/* Sin este caso, buscar a la camarera devolvía "no pasan el
                      filtro de estado" y el asesor concluía que no existe: la
                      búsqueda SÍ la encontró, pero esta vista no muestra staff. */}
                  {search.status === "results" && searchOnlyMatchedStaff
                    ? "Lo que coincide es del personal del hotel. Míralo en la pestaña Staff."
                    : search.status === "results"
                      ? "Los resultados no pasan el filtro de estado activo."
                      : "Ajusta filtros o búsqueda."}
                </p>
              </div>
            ) : (
              <>
                {search.status === "results" && search.atLimit && (
                  /* El RPC capa los resultados. Sin este aviso, "50 resultados"
                     se lee como "solo existen 50", que es la misma clase de
                     recorte silencioso que este lote vino a cerrar. */
                  <p
                    className="px-5 py-2.5 text-[12px] leading-relaxed"
                    style={{ color: "var(--text-secondary)", borderBottom: "1px solid var(--border-soft)" }}
                  >
                    Mostrando los resultados más recientes. Si no está el que buscás, afiná el
                    término.
                  </p>
                )}
                <div className="flex flex-col gap-1 px-2.5 py-2.5">
                  {guestConversations.map(renderGuestRow)}
                </div>
              </>
            )}
              </>
            )}{/* fin de la vista Huéspedes */}
              </>
            )}{/* fin del estado de carga */}
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
          <span className="block h-full w-px bg-[var(--border-soft)] transition-colors group-hover:w-1 group-hover:bg-[var(--accent)]" />
        </div>

        <section
          className={`${
            mobileTab === "chat" ? "flex" : "hidden"
          } min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden lg:flex`}
          style={{ background: "var(--bg-app)" }}
        >
          {selected ? (
            <>
              <div
                className="flex min-h-[56px] shrink-0 items-center gap-3 px-2 py-2 sm:gap-3.5 sm:px-[26px] lg:py-3.5"
                style={{ background: "var(--bg-card)", borderBottom: "1px solid var(--border-soft)" }}
              >
                <button
                  type="button"
                  onClick={() => setMobileTab("list")}
                  className="d-soft flex h-10 w-10 shrink-0 items-center justify-center rounded-xl lg:hidden"
                  style={{ color: "var(--text-secondary)" }}
                  aria-label="Volver a conversaciones"
                >
                  <IconBack className="h-5 w-5" />
                </button>
                <Avatar name={selected.guest.name} seed={selected.guest.id} size={44} ring />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {editingName ? (
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-1.5">
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(e) => setNameDraft(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                void renameGuest();
                              } else if (e.key === "Escape") {
                                e.preventDefault();
                                cancelEditingName();
                              }
                            }}
                            maxLength={GUEST_NAME_MAX_LENGTH}
                            disabled={savingName}
                            placeholder="Nombre del huésped"
                            className="grotesk min-w-0 flex-1 rounded-lg px-2 py-1 outline-none disabled:opacity-60"
                            style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", background: "var(--bg-app)", border: "1px solid var(--accent)" }}
                            aria-label="Editar nombre del huésped"
                          />
                          <button
                            type="button"
                            onClick={() => void renameGuest()}
                            disabled={savingName}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
                            style={{ background: "var(--accent)", color: "#fff" }}
                            aria-label="Guardar nombre"
                            title="Guardar"
                          >
                            {savingName ? (
                              <Spinner className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <IconCheck className="h-4 w-4" />
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingName}
                            disabled={savingName}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
                            style={{ background: "var(--bg-app)", color: "var(--text-secondary)", border: "1px solid var(--border-soft)" }}
                            aria-label="Cancelar edición"
                            title="Cancelar"
                          >
                            <IconClose className="h-4 w-4" />
                          </button>
                        </div>
                        {nameError && (
                          <span style={{ fontSize: 11, color: "var(--accent)" }}>{nameError}</span>
                        )}
                      </div>
                    ) : (
                      <>
                        <h2 className="grotesk min-w-0 flex-1 truncate" style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.01em", color: "var(--text-primary)" }}>
                          {selected.guest.name}
                        </h2>
                        {/* En Staff renombrar vive en el menú "…" (spec 5.3):
                            arriba queda solo el nombre, la pastilla y la acción
                            principal. */}
                        {!selectedIsStaff && (
                          <button
                            type="button"
                            onClick={startEditingName}
                            className="d-soft flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                            style={{ color: "var(--text-secondary)" }}
                            aria-label="Editar nombre del huésped"
                            title="Editar nombre"
                          >
                            <IconPencil className="h-4 w-4" />
                          </button>
                        )}
                        {/* Que la recepcionista sepa con quién habla antes de escribir. */}
                        {selected.isStaff && <StaffBadge />}
                        {selected.blocked && <BlockedBadge />}
                      </>
                    )}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {/* En staff el semáforo de siempre mentiría: "IA activa" en
                        el encabezado y "la IA no interviene" tres centímetros
                        más abajo se contradicen. Va un estado neutro. */}
                    {selectedIsStaff ? (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--staff)" }}>
                        <Dot color="var(--staff)" />
                        Sin gestión de IA
                      </span>
                    ) : selected.operationalStatus === "requires_attention" ? (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)" }}>
                        <Dot color="var(--accent)" />
                        Requiere atención humana
                      </span>
                    ) : selected.operationalStatus === "ai_active" ? (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--live)" }}>
                        <Dot color="var(--live)" />
                        IA activa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
                        <Dot color="var(--text-secondary)" />
                        Resuelto
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      <IconWhatsApp className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--live)" }} aria-hidden />
                      <span className="truncate">WhatsApp</span>
                    </span>
                    {selected.blocked && selected.blockedAt && (
                      <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>
                        {formatBlockedAtColombia(selected.blockedAt)}
                      </span>
                    )}
                  </div>
                </div>
                {selectedIsStaff ? (
                  /* Encabezado de Staff (spec 5.3): la acción principal a la
                     vista y el resto detrás del "…".
                     "Completado" no bloquea nada acá: `conversationClosed`
                     ignora el cierre en staff a propósito, así que el compositor
                     sigue habilitado y el hilo se puede seguir usando. */
                  <>
                    <button
                      type="button"
                      onClick={() => void markCompleted()}
                      disabled={pendingAction !== null}
                      aria-busy={pendingAction === "complete"}
                      className="d-prim grotesk inline-flex h-9 shrink-0 items-center gap-1.5 px-3 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ borderRadius: 999, border: "none", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 700 }}
                    >
                      {pendingAction === "complete" ? (
                        <>
                          <Spinner className="h-4 w-4 animate-spin" />
                          Completando…
                        </>
                      ) : (
                        <>
                          <IconCheck className="h-4 w-4" aria-hidden />
                          Completado
                        </>
                      )}
                    </button>
                    <HeaderMenu
                      items={[
                        {
                          key: "rename",
                          label: "Editar nombre",
                          onSelect: startEditingName,
                        },
                        {
                          key: "ficha",
                          label: "Ver ficha del contacto",
                          onSelect: () => {
                            setGuestOpen(true);
                            setDetailsOpen(true);
                          },
                        },
                      ]}
                    />
                  </>
                ) : (
                  <>
                    {/* Bloquear es moderación de huésped: contra el propio
                        personal del hotel no tiene sentido y es un clic
                        peligroso al alcance de la mano. En staff se oculta acá y
                        vive al final de la ficha (spec 5.5), donde hay que ir a
                        buscarlo. */}
                    <button
                      type="button"
                      onClick={() =>
                        setModerationDialogAction(selected.blocked ? "unblock" : "block")
                      }
                      className="d-soft grotesk inline-flex h-9 shrink-0 items-center gap-1.5 px-2.5"
                      style={{ borderRadius: 999, border: "1px solid var(--border-soft)", background: "var(--bg-card)", color: "var(--text-secondary)", fontSize: 11.5, fontWeight: 600 }}
                      title={selected.blocked ? "Desbloquear conversación" : "Bloquear conversación"}
                    >
                      <IconBlock className="h-4 w-4" />
                      <span className="hidden sm:inline">{selected.blocked ? "Desbloquear" : "Bloquear"}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setGuestOpen(true);
                        setDetailsOpen(true);
                      }}
                      className={`d-soft grotesk flex h-10 shrink-0 items-center gap-2 rounded-xl px-3 ${detailsOpen ? "lg:hidden" : ""}`}
                      style={{ fontSize: 12, fontWeight: 600, color: "var(--text-secondary)" }}
                    >
                      <IconGuest className="h-4 w-4" />
                      Ficha
                    </button>
                  </>
                )}
              </div>

              <div
                className="ibx-scroll min-h-0 w-full min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 py-3 sm:px-5 lg:px-6"
                style={{ background: "var(--bg-app)" }}
              >
                <div className="w-full min-w-0 space-y-2.5">
                  {threadLoading ? (
                    <InboxThreadSkeleton />
                  ) : (
                    (() => {
                      /*
                        Las píldoras de fecha se intercalan acá y no dentro de
                        `MessageBubble` porque separan DOS burbujas: la burbuja
                        sola no sabe cuál vino antes. `lastDayKey` arranca vacío,
                        así que la primera con fecha utilizable siempre abre día.
                      */
                      let lastDayKey = "";
                      return threadBubbles.map((m) => {
                        const dayKey = messageDayKey(m);
                        const opensDay = Boolean(dayKey) && dayKey !== lastDayKey;
                        if (opensDay) lastDayKey = dayKey;
                        return (
                          <div key={m.id} className="w-full min-w-0 space-y-2.5">
                            {opensDay && <DayPill label={formatDayPillLabel(m)} />}
                            <MessageBubble
                              m={m}
                              guestName={selected.guest.name}
                              guestSeed={selected.guest.id}
                              staff={selectedIsStaff}
                              reaction={reactionByMessageId.get(m.id)}
                              deliveryReceipt={
                                m.wamid ? deliveryReceipts.get(m.wamid) : undefined
                              }
                            />
                          </div>
                        );
                      });
                    })()
                  )}
                  {/* Cierre de la conversación: es un hecho del hilo, no una
                      barra de sistema pegada al encabezado, así que va al final
                      del historial como evento centrado (spec 4.4). */}
                  {conversationClosed && !threadLoading && (
                    <SystemEvent label="Conversación cerrada · reábrela desde la ficha si necesitas seguir el hilo" />
                  )}
                  <div ref={scrollEndRef} className="h-px w-full shrink-0" aria-hidden />
                </div>
              </div>

              <div className="relative z-20 w-full min-w-0 max-w-full shrink-0 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-[26px] sm:pb-5">
                {/* Encima del composer NO va ninguna botonera (spec 4.5): esas
                    acciones —tomar control, reactivar la IA, completar, reabrir,
                    resolver el asunto— viven todas en la ficha de la derecha, que
                    se abre con el botón "Ficha" del encabezado del chat. Acá solo
                    va el aviso de que la IA está respondiendo. */}
                <div className="w-full">
                {sendWarning && (
                  <p
                    className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg px-3 py-2 text-[12px] [overflow-wrap:anywhere]"
                    style={{ border: "1px solid color-mix(in srgb, var(--gold) 40%, transparent)", background: "color-mix(in srgb, var(--gold) 12%, transparent)", color: "var(--text-primary)" }}
                  >
                    {sendWarning}
                  </p>
                )}
                {fileError && (
                  <p
                    className="mb-3 w-full min-w-0 max-w-full break-words rounded-lg px-3 py-2 text-[12px] [overflow-wrap:anywhere]"
                    style={{ border: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
                  >
                    {fileError}
                  </p>
                )}
                {selectedFile && (
                  <div
                    className="mb-3 flex max-w-full items-center gap-3 rounded-[var(--radius-card)] p-2.5"
                    style={{ border: "1px solid var(--border-soft)", background: "var(--bg-card)", boxShadow: "var(--shadow-sm)" }}
                  >
                    {selectedFileIsPdf || !filePreviewUrl ? (
                      <div
                        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold"
                        style={{ border: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
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
                      <p className="truncate text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>
                        {selectedFile.name}
                      </p>
                      <p className="mt-0.5 text-[11px]" style={{ color: "var(--text-secondary)" }}>
                        {selectedFileIsPdf ? "PDF adjunto" : "Imagen adjunta"} · {selectedFileSizeLabel}
                      </p>
                      {draft.trim() && (
                        <p className="mt-1 line-clamp-1 text-[12px]" style={{ color: "var(--text-secondary)" }}>
                          Caption: {draft.trim()}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={clearSelectedFile}
                      disabled={sendingMedia}
                      className="d-soft flex h-8 w-8 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ border: "1px solid var(--border-soft)", background: "var(--bg-card)", color: "var(--text-secondary)" }}
                      aria-label="Quitar archivo"
                    >
                      ×
                    </button>
                  </div>
                )}
                {/*
                  Aviso de que el agente sigue al mando (spec 4.5). Solo sale
                  cuando la IA está de verdad respondiendo esta conversación:
                  ni en staff (ahí nunca interviene), ni con la conversación
                  cerrada, ni fuera de la ventana de 24 h, donde el composer ya
                  está bloqueado y la línea sería una promesa falsa.
                */}
                {!selectedIsStaff &&
                  !inputDisabled &&
                  selected.operationalStatus === "ai_active" &&
                  selected.controlMode === "ai" && (
                    <p
                      className="mb-2 flex w-full min-w-0 items-start gap-1.5 px-1 text-[11.5px] leading-snug [overflow-wrap:anywhere]"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      <Spark className="mt-[1px] h-3 w-3 shrink-0" style={{ color: "var(--gold)" }} aria-hidden />
                      <span>
                        La IA está respondiendo · si escribes, tomas el control de la conversación
                      </span>
                    </p>
                  )}
                <div
                  className={`flex w-full min-w-0 max-w-full items-center gap-2 ${inputDisabled ? "opacity-[0.55]" : ""} transition-opacity`}
                  style={{ padding: "5px 6px 5px 14px", borderRadius: 999, background: "var(--bg-card)", border: "1px solid var(--border-soft)", boxShadow: "var(--shadow)" }}
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
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-[var(--bg-app)] disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: "transparent", color: "var(--text-secondary)" }}
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
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
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
                          : "Escribe para responder como humano…"
                    }
                    className="min-h-[2.25rem] min-w-0 flex-1 resize-none touch-manipulation border-none bg-transparent py-2 text-[15px] leading-snug outline-none placeholder:text-[var(--text-secondary)] disabled:cursor-not-allowed lg:text-[14px]"
                    style={{ color: "var(--text-primary)" }}
                  />
                  <button
                    type="button"
                    onClick={() => void sendMessage()}
                    disabled={(!draft.trim() && !selectedFile) || inputDisabled || sendingMedia}
                    className="d-prim flex h-9 w-9 shrink-0 items-center justify-center rounded-full disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: "var(--accent)", color: "#fff", border: "none" }}
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
                  <div className="mt-2.5 w-full min-w-0">
                    <p className="text-[12px] leading-relaxed [overflow-wrap:anywhere]" style={{ color: "var(--text-primary)" }}>
                      Han pasado más de 24 horas desde el último mensaje{" "}
                      {selected.isStaff ? "del contacto" : "del huésped"}, o no hay mensajes suyos.
                      No puedes responder por política de Meta.
                    </p>
                    {/*
                      Salida del callejón sin salida: la ventana solo se reabre con
                      una plantilla aprobada.
                      · Staff  → plantilla fija, un clic, sin elegir nada.
                      · Huésped → el modal de siempre, con el número ya puesto.
                      Sin teléfono utilizable no hay a dónde enviar: no se pinta nada.
                    */}
                    {selectedPhoneDigits &&
                      (selected.isStaff ? (
                        <button
                          type="button"
                          onClick={() => void sendStaffContactTemplate()}
                          disabled={sendingStaffTemplate || !conversationHotelId}
                          aria-busy={sendingStaffTemplate}
                          className="grotesk mt-2.5 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold text-white shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ background: "var(--staff)" }}
                        >
                          {sendingStaffTemplate && <Spinner className="h-4 w-4 animate-spin" />}
                          {sendingStaffTemplate ? "Enviando…" : "Contactar staff"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openStartConversation(selectedPhoneDigits)}
                          className="grotesk mt-2.5 inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-[13px] font-semibold shadow-sm transition hover:bg-[var(--border-soft)]"
                          style={{
                            border: "1px solid var(--border-soft)",
                            background: "var(--bg-card)",
                            color: "var(--text-secondary)",
                          }}
                        >
                          <IconCompose className="h-4 w-4" />
                          Enviar plantilla para reabrir
                        </button>
                      ))}
                  </div>
                )}
                </div>
              </div>
            </>
          ) : deepLinkMissing ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                Esa conversación no está en esta vista
              </p>
              <p className="max-w-xs text-[13px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                Puede ser de otro hotel. No abrimos otra en su lugar para no mostrarte el chat
                equivocado: selecciona una de la lista o cambia de hotel.
              </p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>Selecciona una conversación</p>
              <p className="max-w-xs text-[13px]" style={{ color: "var(--text-secondary)" }}>Cola unificada con estados IA y prioridad.</p>
            </div>
          )}
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Ajustar ancho del panel"
          onMouseDown={startColumnResize("right")}
          className={`group w-1 shrink-0 cursor-col-resize items-stretch ${detailsOpen ? "hidden lg:flex" : "hidden"}`}
          title="Arrastra para ajustar el ancho"
        >
          <span className="block h-full w-px bg-[var(--border-soft)] transition-colors group-hover:w-1 group-hover:bg-[var(--accent)]" />
        </div>

        <aside
          className={`h-full min-h-0 shrink-0 flex-col ${detailsOpen ? "hidden lg:flex" : "hidden"}`}
          style={{
            background: "var(--bg-app)",
            borderLeft: "1px solid var(--border-soft)",
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
              onClosePanel={() => setDetailsOpen(false)}
              onBlockContact={() =>
                setModerationDialogAction(selected.blocked ? "unblock" : "block")
              }
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
            style={{ borderLeft: "1px solid var(--border-soft)", background: "var(--bg-app)" }}
          >
            {/* Sin cabecera propia: la X de la card de contacto es la que cierra. */}
            <GuestPanelContent
              conversation={selected}
              onTakeHuman={takeHumanControl}
              onReactivateAi={reactivateAi}
              onComplete={markCompleted}
              onResolveRequest={resolveRequest}
              onReopen={reopenConversation}
              onClosePanel={() => setGuestOpen(false)}
              onBlockContact={() =>
                setModerationDialogAction(selected.blocked ? "unblock" : "block")
              }
              resolvingRequest={resolvingRequest}
              pendingAction={pendingAction}
            />
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
            style={{ border: "1px solid var(--border-soft)", background: "var(--bg-card)", boxShadow: "var(--shadow-lg)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="moderation-dialog-title" className="grotesk text-[15px] font-bold" style={{ color: "var(--text-primary)" }}>
              {moderationDialogAction === "block" ? "Bloquear conversación" : "Desbloquear conversación"}
            </h3>
            <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
              {moderationDialogAction === "block" ? (
                <>
                  ¿Bloquear a {selected.guest.name || selected.guestPhone}? Esta acción se puede revertir
                  desde el inbox cuando quieras.
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
                style={{ border: "1px solid var(--border-soft)", color: "var(--text-secondary)" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={moderationInProgress}
                onClick={() => void applyConversationModeration(moderationDialogAction)}
                className="d-prim grotesk rounded-lg px-3 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                style={{ background: "var(--accent)", border: "none" }}
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
        initialPhone={startConversationPhone}
        onClose={() => setStartConversationOpen(false)}
        onSuccess={() =>
          setTemplateToast({ type: "success", message: "Plantilla enviada correctamente" })
        }
        onError={(message) =>
          setTemplateToast({
            type: "error",
            message: message ?? "No se pudo enviar la plantilla. Intenta nuevamente.",
          })
        }
      />
      {/* Ayuda, feedback y novedades cuelgan del menú del avatar en el sidebar:
          son de la sesión, no de la conversación abierta. */}
      <StaffContactsModal
        open={staffContactsOpen}
        activeHotelId={conversationHotelId}
        onClose={() => setStaffContactsOpen(false)}
      />
    </div>
    </AppShell>
  );
}

/**
 * Fecha del panel de datos, SIEMPRE en hora Bogotá.
 *
 * Sin `timeZone` explícito, `Intl` pinta en la zona del navegador: una
 * recepcionista en UTC+2 veía "19:26" sobre un mensaje de las 12:26 en Bogotá y
 * lo reportaba como dato equivocado. La operación es colombiana; la hora que se
 * muestra también.
 */
function formatActivityIso(iso: string) {
  const date = parseWhatsappInstant(iso);
  if (!date) return "—";
  try {
    return new Intl.DateTimeFormat("es-CO", {
      timeZone: COLOMBIA_TIME_ZONE,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
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
      style={{ padding: "8px 0", fontSize: 12, borderBottom: "1px solid var(--border-soft)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>{k}</span>
      <span className="text-right" style={{ color: accent ?? "var(--text-primary)", fontWeight: 500 }}>
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
      style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-secondary)" }}
    >
      {children}
    </span>
  );
}

/**
 * Card blanca del panel derecho. El panel va sobre el crema (`--bg`) y cada
 * bloque se levanta como card, igual que la lista de huéspedes.
 */
function PanelCard({
  children,
  className = "",
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <div
      className={`min-w-0 ${padded ? "p-3.5" : ""} ${className}`}
      style={{
        borderRadius: "var(--radius-card)",
        background: "var(--bg-card)",
        border: "1px solid var(--border-soft)",
        boxShadow: "var(--shadow-sm)",
      }}
    >
      {children}
    </div>
  );
}

/**
 * Interruptor de FerrarIA. No decide nada por su cuenta: encendido llama a
 * "reactivar IA" y apagado a "tomar control humano", las mismas dos acciones
 * que ya existían como botones.
 */
function AiToggleSwitch({
  on,
  busy,
  disabled,
  onToggle,
}: {
  on: boolean;
  busy: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Poner a FerrarIA en pausa" : "Reactivar a FerrarIA"}
      aria-busy={busy}
      disabled={disabled}
      onClick={onToggle}
      className="relative inline-flex shrink-0 items-center transition disabled:cursor-not-allowed disabled:opacity-50"
      style={{
        width: 44,
        height: 25,
        borderRadius: 999,
        background: on ? "var(--live)" : "var(--border-soft)",
        border: `1px solid ${on ? "var(--live)" : "var(--border-soft)"}`,
      }}
    >
      <span
        className="block transition-transform"
        style={{
          width: 19,
          height: 19,
          borderRadius: 999,
          background: "#fff",
          boxShadow: "var(--shadow-sm)",
          transform: `translateX(${on ? 21 : 2}px)`,
        }}
      />
    </button>
  );
}

/**
 * "hace N minutos" de la última respuesta del agente en el hilo cargado.
 *
 * Se deriva en cliente de los mensajes que ya están en memoria: la respuesta de
 * `/api/inbox` no trae el dato y esa ruta no acepta campos nuevos. Devuelve
 * `null` cuando el hilo aún no tiene ninguna respuesta del agente cargada, y en
 * ese caso el subtexto simplemente no menciona la última respuesta.
 */
function lastAiReplyAgo(messages: Message[]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m.sender !== "ai") continue;
    return tiempoTranscurrido(m.sentAtIso ?? m.sentAt);
  }
  return null;
}

/**
 * Un PDF de la sección "Archivos recientes" de la ficha de staff (spec 5.5).
 * "Abrir" firma la URL y abre la pestaña con un solo clic.
 */
function PanelFileRow({ message }: { message: Message }) {
  const { open, busy, failed } = useOpenAttachment(message);
  const filename = message.mediaFilename?.trim() || "Documento PDF";

  return (
    <div
      className="flex items-center gap-2.5 py-2"
      style={{ borderBottom: "1px solid var(--border-soft)" }}
    >
      <span aria-hidden style={{ fontSize: 15, lineHeight: 1 }}>
        📄
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-semibold" style={{ color: "var(--text-primary)" }}>
          {filename}
        </p>
        <p
          className="mt-0.5 text-[11px]"
          style={{ color: failed ? "var(--accent)" : "var(--text-secondary)" }}
        >
          {failed ? "No se pudo abrir. Intenta de nuevo." : "Documento PDF"}
        </p>
      </div>
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className="d-act grotesk shrink-0 px-2.5 py-1.5 disabled:cursor-wait disabled:opacity-60"
        style={{
          borderRadius: 9,
          border: "1px solid var(--border-soft)",
          background: "var(--bg-app)",
          color: "var(--text-primary)",
          fontSize: 11.5,
          fontWeight: 700,
        }}
      >
        {busy ? "Abriendo…" : "Abrir"}
      </button>
    </div>
  );
}

function GuestPanelContent({
  conversation,
  onTakeHuman,
  onReactivateAi,
  onComplete,
  onResolveRequest,
  onReopen,
  onClosePanel,
  onBlockContact,
  resolvingRequest,
  pendingAction,
}: {
  conversation: Conversation;
  onTakeHuman: () => void;
  onReactivateAi: () => void;
  onComplete: () => void;
  onResolveRequest: () => void;
  onReopen: () => void;
  onClosePanel: () => void;
  /** Abre el diálogo de bloqueo. En staff es la última acción de la ficha. */
  onBlockContact: () => void;
  resolvingRequest: boolean;
  pendingAction: null | "human" | "ai" | "complete" | "reopen";
}) {
  const { guest } = conversation;
  /**
   * En la ficha de un contacto de staff no van ni "Acciones" (todas son gestión
   * huésped/IA) ni "Resumen del chat" (es la IA leyendo el hilo, lo mismo que
   * acá no interviene). Los datos crudos de abajo sí se quedan: son lectura y
   * sirven para depurar.
   */
  const isStaff = Boolean(conversation.isStaff);
  const iaEstado = isStaff
    ? "No aplica (staff)"
    : conversation.aiActive && conversation.controlMode === "ai"
      ? "Activa"
      : "En pausa";
  const hasTags = guest.tags.length > 0;
  const notesAreDefault = guest.internalNotes.startsWith("Sin notas");
  const isPendingRequest = conversation.request === "pending";
  const isClosed = conversation.operationalStatus === "closed";
  const actionsBusy = pendingAction !== null || resolvingRequest;
  const aiOn = conversation.aiActive && conversation.controlMode === "ai";
  const aiAgo = lastAiReplyAgo(conversation.messages);
  /**
   * PDFs del hilo, del más nuevo al más viejo (spec 5.5). Sale de los mensajes
   * que ya están en memoria: no se consulta nada nuevo. Se listan todos, sin
   * tope: un "los 5 más recientes" callado haría creer que no hay más.
   */
  const staffPdfs = useMemo(() => {
    if (!isStaff) return [] as Message[];
    return conversation.messages
      .filter(
        (m) =>
          resolveMediaKind(m.mediaMimeType) === "pdf" &&
          Boolean(m.mediaUrl || m.mediaStoragePath)
      )
      .reverse();
  }, [conversation.messages, isStaff]);
  /** El detalle crudo arranca plegado: es depuración, no operación diaria. */
  const [techOpen, setTechOpen] = useState(false);
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

    // En staff el bloque de resumen no se pinta: pedirlo sería una llamada al
    // engine por cada hilo del personal que alguien abre, para nada.
    if (isStaff) {
      setSummaryLoading(false);
      return;
    }

    void (async () => {
      const result = await fetchConversationSummaryFromApi(cid);
      if (gen !== summaryPanelGenRef.current) {
        return;
      }
      applySummaryResult(result);
      setSummaryLoading(false);
    })();
  }, [conversation.id, applySummaryResult, isStaff]);

  const createChatSummary = useCallback(async () => {
    const gen = ++summaryPanelGenRef.current;
    setSummaryLoading(true);
    setSummaryLoadMode("regenerate");
    setSummaryError(null);
    setSummaryText(null);
    setSummaryDbEmpty(false);
    try {
      let engineSummary: string | null = null;

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
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
          summary?: string | null;
        };
        if (res.status === 400) {
          if (gen === summaryPanelGenRef.current) {
            setSummaryError(data.error ?? "Solicitud no válida.");
          }
          return;
        }
        if (typeof data.summary === "string" && data.summary.trim()) {
          engineSummary = data.summary.trim();
        }
      } catch {
        // El engine vía API puede fallar; seguimos y leemos Supabase
      }

      if (gen !== summaryPanelGenRef.current) {
        return;
      }

      // El engine devuelve el resumen en el body: sin espera ni segundo GET.
      if (engineSummary) {
        applySummaryResult({ kind: "ok", text: engineSummary });
        return;
      }

      // Sin resumen síncrono (rollback a n8n): esperamos a que el worker
      // escriba la fila y la leemos desde Supabase.
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 2000);
      });

      if (gen !== summaryPanelGenRef.current) {
        return;
      }

      const result = await fetchConversationSummaryFromApi(conversation.id);
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
    <div className="ibx-scroll flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3" style={{ background: "var(--bg-app)" }}>
      {/* 1 · Card de contacto */}
      <PanelCard className="flex shrink-0 items-center gap-3">
        <Avatar name={guest.name} seed={guest.id} size={44} />
        <div className="min-w-0 flex-1">
          <div className="grotesk truncate" style={{ fontSize: 15.5, fontWeight: 700, color: "var(--text-primary)" }}>
            {guest.name}
          </div>
          <div className="ibx-mono mt-0.5 truncate" style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
            {guest.phone}
          </div>
        </div>
        <button
          type="button"
          onClick={onClosePanel}
          className="d-soft flex h-8 w-8 shrink-0 items-center justify-center"
          style={{ borderRadius: "var(--radius-chip)", color: "var(--text-secondary)" }}
          aria-label="Cerrar la ficha"
        >
          <IconClose className="h-[18px] w-[18px]" />
        </button>
      </PanelCard>

      {/* 2 · Card de FerrarIA */}
      {isStaff ? (
        <PanelCard className="flex shrink-0 items-center gap-2">
          <IconStaff className="h-4 w-4 shrink-0" style={{ color: "var(--staff)" }} aria-hidden />
          <span className="text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            Conversación de staff — el agente no interviene
          </span>
        </PanelCard>
      ) : (
        <PanelCard className="shrink-0">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="grotesk flex items-center gap-2" style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)" }}>
                <Dot color={aiOn ? "var(--live)" : "var(--text-secondary)"} />
                {aiOn ? "IA activa" : "IA en pausa"}
              </div>
              <span
                className="ibx-mono mt-1.5 inline-block"
                style={{ fontSize: 10, color: "var(--text-secondary)", border: "1px solid var(--border-soft)", borderRadius: 5, padding: "1px 5px" }}
              >
                {aiOn ? "⌘H para tomar el control" : "⌘R para reactivarla"}
              </span>
            </div>
            <AiToggleSwitch
              on={aiOn}
              busy={pendingAction === "ai" || pendingAction === "human"}
              disabled={actionsBusy}
              onToggle={aiOn ? onTakeHuman : onReactivateAi}
            />
          </div>
          <p className="mt-2 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
            {aiOn ? "FerrarIA responde automáticamente" : "FerrarIA está en pausa: las respuestas las escribes tú"}
            {aiAgo ? ` · última respuesta ${aiAgo}` : ""}
          </p>
        </PanelCard>
      )}

      {/* Acciones */}
      {!isStaff && (
      <PanelCard className="shrink-0">
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
            style={{ padding: 12, borderRadius: 11, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700 }}
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
                style={{ padding: 12, borderRadius: 11, border: "none", background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 700 }}
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
            {/* Control humano / IA vive arriba en el interruptor; el resumen,
                en su propia sección. Acá quedan las acciones de cierre. */}
            <div className="grid grid-cols-1 gap-2">
              <CmdAction
                icon={IconCheck}
                label="Marcar como completado"
                hint="⌘D"
                tone="complete"
                busy={pendingAction === "complete"}
                onClick={onComplete}
                disabled={actionsBusy}
              />
            </div>
          </>
        )}
      </PanelCard>
      )}

      {/* 3 · Huésped (spec 4.6) / Contacto (spec 5.5) */}
      <PanelCard className="shrink-0">
        <div className="mb-1">
          <CockpitLabel>{isStaff ? "Contacto" : "Huésped"}</CockpitLabel>
        </div>
        <MonoRow k="Canal" v={conversation.channelLabel} />
        <MonoRow k="Hotel" v={guest.property} />
        <MonoRow k="Última actividad" v={formatActivityIso(conversation.lastActivityIso)} />
      </PanelCard>

      {/* Archivos recientes — solo en staff (spec 5.5 §3). El personal se pasa
          planillas y remisiones, y buscarlas scrolleando el hilo es lo que hace
          que terminen reenviándose por tercera vez. */}
      {isStaff && (
        <PanelCard className="shrink-0">
          <div className="mb-1">
            <CockpitLabel>Archivos recientes</CockpitLabel>
          </div>
          {staffPdfs.length === 0 ? (
            <p className="pt-1.5 text-[12.5px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>
              Todavía no hay documentos en esta conversación.
            </p>
          ) : (
            staffPdfs.map((m) => <PanelFileRow key={m.id} message={m} />)
          )}
        </PanelCard>
      )}

      {/* 4 · Resumen */}
      {!isStaff && (
        <PanelCard className="shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <CockpitLabel>Resumen</CockpitLabel>
            <button
              type="button"
              onClick={() => void createChatSummary()}
              disabled={summaryLoading}
              className="d-act grotesk ml-auto inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-60"
              style={{ padding: "5px 10px", border: "1px solid var(--border-soft)", background: "var(--bg-app)", color: "var(--accent)", borderRadius: "var(--radius-chip)", fontSize: 11.5, fontWeight: 700 }}
            >
              <Spark className="h-3 w-3" style={{ color: "var(--accent)" }} aria-hidden />
              Generar resumen
              <span
                className="ibx-mono"
                style={{ fontSize: 10, color: "var(--text-secondary)", border: "1px solid var(--border-soft)", borderRadius: 5, padding: "1px 5px" }}
              >
                ⌘S
              </span>
            </button>
          </div>
          {summaryLoading && (
            <div
              className="flex items-center gap-2.5 rounded-xl px-3 py-3 text-[13px]"
              style={{ border: "1px solid var(--border-soft)", background: "var(--bg-app)", color: "var(--text-secondary)" }}
              role="status"
              aria-live="polite"
            >
              <Spinner className="h-4 w-4 shrink-0 animate-spin text-[var(--accent)]" />
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
              style={{ border: "1px solid var(--accent)", background: "var(--red-soft)", color: "var(--accent)" }}
              role="alert"
            >
              {summaryError}
            </div>
          )}
          {!summaryLoading && !summaryError && summaryText && (
            <div className="min-w-0 rounded-lg p-3" style={{ background: "var(--bg-app)", border: "1px solid var(--border-soft)" }}>
              <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed" style={{ color: "var(--text-primary)" }}>
                {summaryText}
              </p>
            </div>
          )}
          {!summaryLoading && !summaryError && summaryDbEmpty && (
            <p className="ibx-mono text-[12px]" style={{ color: "var(--text-secondary)" }}>Sin resumen aún.</p>
          )}
        </PanelCard>
      )}

      {!notesAreDefault && (
        <PanelCard className="shrink-0">
          <div className="mb-2 flex items-center gap-2">
            <IconNote className="h-4 w-4" style={{ color: "var(--gold)" }} aria-hidden />
            <CockpitLabel>Notas (tabla / handoff)</CockpitLabel>
          </div>
          <p
            className="rounded-lg p-3 text-[13px] leading-relaxed"
            style={{ background: "color-mix(in srgb, var(--gold) 10%, transparent)", color: "var(--text-primary)" }}
          >
            {guest.internalNotes}
          </p>
        </PanelCard>
      )}

      {hasTags && (
        <PanelCard className="shrink-0">
          <div className="mb-3 flex items-center gap-2">
            <IconTag className="h-4 w-4" style={{ color: "var(--text-secondary)" }} aria-hidden />
            <CockpitLabel>Etiquetas</CockpitLabel>
          </div>
          <div className="flex flex-wrap gap-2">
            {guest.tags.map((tag) => (
              <span
                key={tag}
                className="grotesk"
                style={{ padding: "5px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "var(--bg-app)", color: "var(--text-secondary)" }}
              >
                {tag}
              </span>
            ))}
          </div>
        </PanelCard>
      )}

      {/* 5 · Datos técnicos, plegado por defecto */}
      <PanelCard className="shrink-0" padded={false}>
        <button
          type="button"
          onClick={() => setTechOpen((v) => !v)}
          aria-expanded={techOpen}
          className="d-soft flex w-full items-center gap-2 p-3.5 text-left"
          style={{ borderRadius: "var(--radius-card)" }}
        >
          <CockpitLabel>Datos técnicos</CockpitLabel>
          <IconChevronDown
            className="ml-auto h-4 w-4 shrink-0 transition-transform"
            style={{ color: "var(--text-secondary)", transform: techOpen ? "rotate(180deg)" : "none" }}
            aria-hidden
          />
        </button>
        {techOpen && (
          <div className="px-3.5 pb-3.5">
            <MonoRow
              k={isWaLidIdentifier(guest.phone) ? "ID de WhatsApp" : "Teléfono"}
              v={guest.phone}
            />
            <MonoRow k="Estado IA" v={iaEstado} />
            <MonoRow k="Mensajes (cargados)" v={String(conversation.messages.length)} />
            <MonoRow k="Needs Human (BD)" v={conversation.needsHuman ? "Sí" : "No"} />
            <MonoRow
              k="Request (BD)"
              v={conversation.request ?? "—"}
              accent={isPendingRequest ? "var(--accent)" : undefined}
            />
            <MonoRow k="IA activa (BD)" v={conversation.aiActive ? "Sí" : "No"} />
            <MonoRow k="Estado (BD)" v={conversation.dbStatus ?? "—"} />
            <MonoRow k="Bloqueado" v={conversation.blocked ? "Sí" : "No"} />
            {conversation.blockedAt && (
              <MonoRow k="blocked_at" v={formatActivityIso(conversation.blockedAt)} />
            )}
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(guest.phone)}
              className="d-act grotesk mt-3 flex w-full items-center justify-center gap-2"
              style={{ padding: "10px", borderRadius: 11, border: "1px solid var(--border-soft)", background: "var(--bg-app)", color: "var(--text-primary)", fontSize: 12, fontWeight: 600 }}
            >
              <IconPhone className="h-4 w-4" />
              {isWaLidIdentifier(guest.phone) ? "Copiar ID" : "Copiar teléfono"}
            </button>
          </div>
        )}
      </PanelCard>

      {/* Último de la ficha de staff (spec 5.5 §4). Va como link rojo y no como
          botón: bloquear al propio personal del hotel es una decisión rara, y
          hay que ir hasta el final del panel para encontrarla. Abre el mismo
          diálogo de confirmación que en Huéspedes. */}
      {isStaff && (
        <button
          type="button"
          onClick={onBlockContact}
          className="grotesk shrink-0 self-center px-2 py-1 underline underline-offset-2 transition-opacity hover:opacity-75"
          style={{ background: "none", border: "none", color: "var(--accent)", fontSize: 12.5, fontWeight: 600 }}
        >
          {conversation.blocked ? "Desbloquear contacto" : "Bloquear contacto"}
        </button>
      )}

      <p className="ibx-mono shrink-0 pb-1 text-center text-[10px]" style={{ color: "var(--text-secondary)" }}>FerrarIA · Inbox</p>
    </div>
  );
}
