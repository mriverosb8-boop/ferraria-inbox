/**
 * A quién le llega cada push. Módulo puro: sin red, sin Supabase, sin webpush.
 *
 * Está separado de `send.ts` precisamente para poder testear las reglas de
 * audiencia sin montar la base ni el transporte — es la parte donde un error no
 * se ve (una notificación que NO llega no deja rastro en la UI).
 */

/** Áreas de trabajo. Mismo vocabulario que `service_tickets.categoria`. */
export const TICKET_AREAS = ["housekeeping", "mantenimiento", "room_service", "otro"] as const;
export type TicketArea = (typeof TICKET_AREAS)[number];

/** Igual que `normalizeCategoria` del engine: desconocido o ausente → "otro". */
export function normalizeArea(raw: unknown): TicketArea {
  const value = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return (TICKET_AREAS as readonly string[]).includes(value) ? (value as TicketArea) : "otro";
}

/** Fila de `hotel_users` reducida a lo que decide la audiencia. */
export type PushMemberRow = {
  userId: string;
  role: string | null;
  area: string | null;
};

export type AudienceInput = {
  /** Miembros del hotel dueño del evento. */
  hotelMembers: readonly PushMemberRow[];
  /** `super_admin` de cualquier hotel (comportamiento histórico). */
  superAdmins: readonly PushMemberRow[];
  /** Tipo del evento. */
  type: string;
  /** Solo para `ticket`: el área que resuelve a quién le toca. */
  categoria?: string | null;
};

function isOperativo(row: PushMemberRow): boolean {
  return (row.role ?? "").trim() === "operativo";
}

/**
 * Resuelve los `user_id` que deben recibir el push.
 *
 * REGLA DE EXCLUSIÓN, NO DE INCLUSIÓN. Solo se saca a quien tenga el literal
 * `operativo`; cualquier otro rol —incluido `null`, un typo o uno que no
 * conozcamos— sigue recibiendo exactamente lo que recibía antes.
 *
 * Es deliberadamente lo contrario de la matriz de capacidades, que es lista
 * blanca estricta. El motivo es que fallan hacia lados distintos: negar acceso
 * de más muestra un error en pantalla y alguien lo reporta, pero negar una
 * notificación de más es silencioso — una recepcionista con el rol en `null`
 * dejaría de enterarse de que un huésped la está esperando y nadie se enteraría
 * hasta que el huésped se queje.
 */
export function resolvePushAudience(input: AudienceInput): string[] {
  const { hotelMembers, superAdmins, type } = input;
  const ids = new Set<string>();

  const esTicket = type === "ticket";
  const areaDelTicket = esTicket ? normalizeArea(input.categoria) : null;

  for (const row of hotelMembers) {
    if (!row.userId) continue;

    if (isOperativo(row)) {
      // Los operativos SOLO reciben tickets, y solo los de su área.
      if (esTicket && normalizeArea(row.area) === areaDelTicket) {
        ids.add(row.userId);
      }
      continue;
    }

    // Todos los demás roles del hotel: comportamiento de siempre. Para los
    // tickets también entran — recepción siempre se entera de lo que se pidió.
    ids.add(row.userId);
  }

  for (const row of superAdmins) {
    if (!row.userId) continue;
    // Un super_admin que además tuviera fila de operativo no pierde su acceso
    // global: el rol super_admin manda, igual que en resolveTenantContext.
    ids.add(row.userId);
  }

  return [...ids];
}
