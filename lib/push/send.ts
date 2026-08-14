import webpush, { WebPushError } from "web-push";
import { getSupabaseServerClient } from "@/lib/supabase-server";
import { resolvePushAudience, type PushMemberRow } from "@/lib/push/audience";

const SUBSCRIPTIONS_TABLE = "push_subscriptions";
const HOTEL_USERS_TABLE = "hotel_users";

/**
 * Categoría del evento que disparó la push. El engine la manda en `type`
 * (ver PushNotifyType en ferraria-engine). El inbox la usa SOLO para presentación:
 * ícono y estilo en el service worker. Nunca cambia a quién se le envía.
 *
 * `handoff` es el default de retrocompatibilidad: un emisor viejo que no manda
 * `type`, o un valor desconocido, se trata como escalamiento — el caso urgente.
 */
export const PUSH_TYPES = ["handoff", "staff", "reservation", "ticket"] as const;
export type PushNotificationType = (typeof PUSH_TYPES)[number];
export const DEFAULT_PUSH_TYPE: PushNotificationType = "handoff";

/** Normaliza cualquier entrada a un tipo válido. Desconocido o ausente → handoff. */
export function normalizePushType(value: unknown): PushNotificationType {
  return typeof value === "string" && (PUSH_TYPES as readonly string[]).includes(value)
    ? (value as PushNotificationType)
    : DEFAULT_PUSH_TYPE;
}

/** Shape EXACTO que consume public/sw.js (Batch 4). No cambiar sin actualizar el SW. */
export type PushPayload = {
  title: string;
  body: string;
  conversation_id: string;
  hotel_id: string;
  type: PushNotificationType;
  /**
   * Solo en `type: "ticket"`. Campos ADITIVOS: un service worker viejo los
   * ignora, cae al default `handoff` y abre la conversación. Degrada feo pero no
   * rompe, y para un operativo el middleware lo rebota a Solicitudes igual.
   */
  ticket_id?: string;
  categoria?: string;
};

export type SendResult = {
  recipients: number; // user_ids con acceso al hotel
  subscriptions: number; // filas push_subscriptions encontradas
  sent: number;
  failed: number;
  cleaned: number; // endpoints muertos borrados (404/410)
};

let vapidConfigured = false;

function configureVapid(): void {
  if (vapidConfigured) return;
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!subject || !publicKey || !privateKey) {
    throw new Error(
      "Faltan VAPID_SUBJECT, NEXT_PUBLIC_VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY"
    );
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
}

function toMemberRows(rows: readonly Record<string, unknown>[]): PushMemberRow[] {
  return rows
    .map((row) => ({
      userId: row.user_id != null ? String(row.user_id) : "",
      role: row.role != null ? String(row.role) : null,
      area: row.area != null ? String(row.area) : null,
    }))
    .filter((row) => row.userId);
}

/**
 * Usuarios que deben recibir el push para un hotel: miembros de ese hotel en
 * `hotel_users` MÁS todos los `super_admin` (acceso a todos los hoteles), ya
 * filtrados por rol y área según el tipo de evento (ver `resolvePushAudience`).
 * ROUTING POR user_id — el hotel_id de push_subscriptions es metadato, no llave.
 */
async function resolveHotelRecipientUserIds(
  supabase: ReturnType<typeof getSupabaseServerClient>,
  hotelId: string,
  payload: PushPayload
): Promise<string[]> {
  const [members, admins] = await Promise.all([
    supabase.from(HOTEL_USERS_TABLE).select("user_id, role, area").eq("hotel_id", hotelId),
    supabase.from(HOTEL_USERS_TABLE).select("user_id, role, area").eq("role", "super_admin"),
  ]);
  if (members.error) throw new Error(members.error.message);
  if (admins.error) throw new Error(admins.error.message);

  return resolvePushAudience({
    hotelMembers: toMemberRows(members.data ?? []),
    superAdmins: toMemberRows(admins.data ?? []),
    type: payload.type,
    categoria: payload.categoria ?? null,
  });
}

/** Envía el payload a las suscripciones de los usuarios que corresponden. */
export async function sendPushToHotel(
  hotelId: string,
  payload: PushPayload
): Promise<SendResult> {
  configureVapid();
  const supabase = getSupabaseServerClient();

  const userIds = await resolveHotelRecipientUserIds(supabase, hotelId, payload);
  if (userIds.length === 0) {
    return { recipients: 0, subscriptions: 0, sent: 0, failed: 0, cleaned: 0 };
  }

  const { data: subs, error } = await supabase
    .from(SUBSCRIPTIONS_TABLE)
    .select("endpoint, p256dh, auth")
    .in("user_id", userIds);
  if (error) throw new Error(error.message);

  const subscriptions = subs ?? [];
  if (subscriptions.length === 0) {
    return { recipients: userIds.length, subscriptions: 0, sent: 0, failed: 0, cleaned: 0 };
  }

  const message = JSON.stringify(payload);
  let sent = 0;
  let failed = 0;
  let cleaned = 0;

  const results = await Promise.allSettled(
    subscriptions.map((s) =>
      webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        message
      )
    )
  );

  // Limpieza de endpoints muertos (404/410). Se hace fuera del allSettled de envío.
  const deadEndpoints: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent += 1;
      return;
    }
    failed += 1;
    const reason = r.reason;
    if (reason instanceof WebPushError && (reason.statusCode === 404 || reason.statusCode === 410)) {
      deadEndpoints.push(subscriptions[i]!.endpoint);
    } else {
      console.error("[push/send] envío falló", reason);
    }
  });

  if (deadEndpoints.length > 0) {
    const { error: delError } = await supabase
      .from(SUBSCRIPTIONS_TABLE)
      .delete()
      .in("endpoint", deadEndpoints);
    if (delError) {
      console.error("[push/send] limpieza de endpoints muertos falló", delError);
    } else {
      cleaned = deadEndpoints.length;
    }
  }

  return { recipients: userIds.length, subscriptions: subscriptions.length, sent, failed, cleaned };
}
