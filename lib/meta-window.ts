import type { Message } from "@/lib/inbox-types";

/** Zona única de la operación. Colombia no tiene horario de verano: UTC-5 fijo. */
export const COLOMBIA_TIME_ZONE = "America/Bogota";

/** Offset fijo de Bogotá en minutos respecto a UTC (UTC-5, sin DST nunca). */
const COLOMBIA_UTC_OFFSET_MINUTES = -300;

/** Ventana de escritura libre de Meta desde el último entrante del huésped. */
export const META_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * ¿El texto trae zona horaria propia? `Z`, `+HH:MM`, `-HHMM`, `+HH`.
 *
 * El `-` solo cuenta como offset si va DESPUÉS de la parte de hora; si no,
 * los guiones de la fecha (`2026-08-07`) darían un falso positivo. Por eso se
 * mira únicamente la cola del texto, a partir del primer `:` de la hora.
 */
function hasExplicitOffset(raw: string): boolean {
  const timeStart = raw.indexOf(":");
  const tail = timeStart >= 0 ? raw.slice(timeStart) : raw;
  return /(?:z|[+-]\d{2}:?\d{2}|[+-]\d{2}$)/i.test(tail);
}

/**
 * Instante real (epoch ms, UTC) de un timestamp de la plataforma.
 *
 * Existe porque conviven DOS formatos y confundirlos corre la aritmética horas:
 *
 * - `Wubby_Whatsapp.created_at` es `timestamp` SIN zona, persistido en hora
 *   Bogotá (`2026-08-07 12:26:53` o `2026-08-07T12:26:53`). `new Date()` sobre
 *   un texto así lo interpreta en la zona DEL NAVEGADOR: para una recepcionista
 *   en UTC+2 el mismo mensaje se corre 7 horas y la ventana de 24 h le da un
 *   resultado distinto que en Bogotá. Acá se fuerza `America/Bogota` explícito.
 * - `conversations.last_guest_message_at` es `timestamptz` y llega con offset:
 *   ese se respeta tal cual, reinterpretarlo sería el error inverso.
 *
 * Devuelve `null` —nunca `NaN`— si no se puede leer, para que quien llame
 * decida qué hacer con la ausencia de dato en vez de arrastrar un número roto.
 */
export function parseWhatsappInstantMs(raw: string | null | undefined): number | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return null;

  if (hasExplicitOffset(value)) {
    const ms = new Date(value.replace(" ", "T")).getTime();
    return Number.isNaN(ms) ? null : ms;
  }

  const parts = value.replace(" ", "T").match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,6}))?$/
  );
  if (!parts) {
    // Formato inesperado: se prefiere "no sé" antes que dejar que el navegador
    // improvise una zona.
    return null;
  }

  const [, y, mo, d, h, mi, s, frac] = parts;
  const millis = frac ? Number(frac.padEnd(3, "0").slice(0, 3)) : 0;
  const asIfUtc = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(s ?? "0"),
    millis
  );
  if (Number.isNaN(asIfUtc)) return null;

  // El texto son las 12:26 EN BOGOTÁ. Tratado como UTC daría 12:26Z, que es
  // 5 horas ANTES del instante real, así que se resta el offset (-300) para
  // devolverlo a UTC: 12:26Z - (-300 min) = 17:26Z. Correcto.
  return asIfUtc - COLOMBIA_UTC_OFFSET_MINUTES * 60_000;
}

/** Igual que `parseWhatsappInstantMs`, pero en `Date` para los formateadores. */
export function parseWhatsappInstant(raw: string | null | undefined): Date | null {
  const ms = parseWhatsappInstantMs(raw);
  return ms === null ? null : new Date(ms);
}

/**
 * Último mensaje ENTRANTE del huésped dentro de un hilo ya cargado.
 *
 * Entrante = `sender === "user"`, la misma clasificación que ya calculó
 * `buildMessageFromWubbyRow` a partir de sender/recipient. No se filtra por
 * texto ni por formato a propósito: un PDF sin `message` (media pura) abre la
 * ventana igual que un "hola", y filtrar por texto fue justo lo que dejó a una
 * huésped sin respuesta.
 *
 * No asume que el array venga ordenado: se queda con el máximo.
 */
export function findLastInboundInstantMs(messages: readonly Message[] | undefined): number | null {
  if (!messages || messages.length === 0) return null;

  let latest: number | null = null;
  for (const m of messages) {
    if (m.sender !== "user") continue;
    const ms = parseWhatsappInstantMs(m.sentAtIso);
    if (ms === null) continue;
    if (latest === null || ms > latest) latest = ms;
  }
  return latest;
}

export type MetaWindowSource = {
  /** `conversations.last_guest_message_at` (timestamptz, mantenida por trigger). */
  lastGuestMessageAt?: string | null;
  /** Hilo cargado de la conversación seleccionada, si lo hay. */
  messages?: readonly Message[];
};

/**
 * Instante del último entrante, combinando las DOS fuentes y quedándose con la
 * más reciente.
 *
 * Por qué el máximo y no una sola fuente:
 *
 * - La columna se cae cuando la fila de `Wubby_Whatsapp` llega con
 *   `conversation_id` en NULL: el trigger no tiene a qué conversación pegarle
 *   la fecha y la deja vacía. El inbox leía ese vacío como "el huésped nunca
 *   escribió" y bloqueaba el composer con un mensaje recién llegado.
 * - El hilo tampoco alcanza solo: puede venir truncado por el tope de filas, o
 *   simplemente no estar cargado todavía.
 *
 * Tomar el máximo hace que cada fuente rescate a la otra y, sobre todo, que
 * ninguna pueda ADELANTAR el reloj de la otra hacia atrás: nada de lo que se
 * agregue acá puede cerrar una ventana que la columna decía abierta.
 */
export function resolveLastGuestInstantMs(source: MetaWindowSource): number | null {
  const fromColumn = parseWhatsappInstantMs(source.lastGuestMessageAt);
  const fromThread = findLastInboundInstantMs(source.messages);

  if (fromColumn === null) return fromThread;
  if (fromThread === null) return fromColumn;
  return Math.max(fromColumn, fromThread);
}

/**
 * ¿Está bloqueada la respuesta libre por la ventana de 24 h de Meta?
 *
 * `true` también cuando no hay ningún entrante conocido: sin mensaje del
 * huésped no hay ventana que abrir. Es un estado ESPERADO, no un error.
 *
 * `now` es inyectable solo para los tests; en producción siempre `Date.now()`,
 * que ya es un instante absoluto y no depende de la zona del navegador.
 */
export function isReplyBlockedByMetaPolicy(
  source: MetaWindowSource,
  now: number = Date.now()
): boolean {
  const lastInbound = resolveLastGuestInstantMs(source);
  if (lastInbound === null) return true;
  return now - lastInbound > META_REPLY_WINDOW_MS;
}
