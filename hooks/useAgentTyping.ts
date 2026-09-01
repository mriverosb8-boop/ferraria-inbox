"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

/**
 * Canal de Broadcast por hotel. El engine publica en `typing:${hotel_id}`, así
 * que un hotel nunca ve el "escribiendo" de otro aunque las policies de
 * `realtime.messages` sigan abiertas: el aislamiento está en el nombre del
 * canal, igual que el resto de la bandeja lo tiene en el `hotel_id` del query.
 */
const TYPING_CHANNEL_PREFIX = "typing:";
const TYPING_EVENT = "agent_typing";

/**
 * Failsafe. El engine promete un `stop` por cada `start`, pero si se cae a
 * mitad de turno, o el navegador pierde el socket justo en ese paquete, el
 * indicador se quedaría prendido para siempre y la recepcionista esperaría una
 * respuesta que nunca va a llegar. A los 30 s se apaga solo.
 */
const TYPING_TTL_MS = 30_000;

/** Cada cuánto se barren los vencidos. Un segundo es imperceptible en pantalla. */
const PURGE_INTERVAL_MS = 1_000;

/**
 * Solo dígitos. El engine manda `guest_phone` pelado (sin `+`) y la bandeja
 * guarda el número con `+`: los dos lados se comparan normalizados o no se
 * cruzan nunca.
 */
function toDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

type AgentTypingBroadcast = {
  hotel_id?: unknown;
  guest_phone?: unknown;
  state?: unknown;
  ts?: unknown;
};

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) return false;
  for (const key of a) {
    if (!b.has(key)) return false;
  }
  return true;
}

export type UseAgentTypingResult = {
  /** `true` mientras el agente esté escribiéndole a ese teléfono. */
  isTyping: (guestPhone: string | null | undefined) => boolean;
};

/**
 * Indicador "el agente está escribiendo…" alimentado por Supabase Realtime
 * Broadcast. No toca la base: es señal efímera, no hay fila que consultar ni
 * historial que reconstruir. Si el evento se pierde no pasa nada — el mensaje
 * real llega igual por el canal de `postgres_changes` de la bandeja.
 */
export function useAgentTyping(hotelId: string | null): UseAgentTypingResult {
  /**
   * Fuente de verdad: teléfono (dígitos) -> instante en que vence. Vive en un
   * ref y no en estado porque lo escribe el callback del canal, que no se
   * vuelve a crear en cada render.
   */
  const expiresByPhoneRef = useRef<Map<string, number>>(new Map());
  /** Espejo para pintar. Solo cambia de identidad cuando cambia el conjunto. */
  const [typingPhones, setTypingPhones] = useState<ReadonlySet<string>>(() => new Set<string>());

  /** Vuelca el ref al estado, sin re-render si el conjunto quedó igual. */
  const publish = useCallback(() => {
    const next = new Set(expiresByPhoneRef.current.keys());
    setTypingPhones((prev) => (sameKeys(prev, next) ? prev : next));
  }, []);

  useEffect(() => {
    const hotel = hotelId?.trim();
    // El Map se crea una sola vez y nunca cambia de identidad, así que se
    // captura acá: el cleanup no puede leer `.current` (regla de hooks) y de
    // paso queda explícito que es el mismo Map de la suscripción.
    const expiresByPhone = expiresByPhoneRef.current;

    if (!hotel) {
      expiresByPhone.clear();
      publish();
      return;
    }

    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch (e) {
      console.warn("[agent typing] cliente no inicializado", e);
      return;
    }

    const client = supabase;
    let channel: RealtimeChannel | null = null;
    let cancelled = false;
    /** Una sola caída a canal público. Sin esto, dos errores serían un bucle. */
    let triedPublicFallback = false;

    const handleBroadcast = (raw: unknown) => {
      const payload = (raw ?? {}) as AgentTypingBroadcast;

      // El canal ya es por hotel, pero si algún día se reusa el nombre, esto
      // impide que la bandeja pinte el "escribiendo" de otro tenant.
      const payloadHotel =
        typeof payload.hotel_id === "string" ? payload.hotel_id.trim() : "";
      if (payloadHotel && payloadHotel !== hotel) return;

      const phone = toDigits(
        typeof payload.guest_phone === "string" ? payload.guest_phone : ""
      );
      if (!phone) return;

      const state = payload.state;
      if (state === "start") {
        expiresByPhone.set(phone, Date.now() + TYPING_TTL_MS);
      } else if (state === "stop") {
        expiresByPhone.delete(phone);
      } else {
        return;
      }
      publish();
    };

    const openChannel = (usePrivate: boolean): RealtimeChannel => {
      const name = `${TYPING_CHANNEL_PREFIX}${hotel}`;
      const ch = usePrivate
        ? client.channel(name, { config: { private: true } })
        : client.channel(name);

      return ch
        .on("broadcast", { event: TYPING_EVENT }, (message) => {
          handleBroadcast((message as { payload?: unknown }).payload);
        })
        .subscribe((status, err) => {
          if (status !== "CHANNEL_ERROR" && status !== "TIMED_OUT") return;

          // El motivo que devuelve el servidor no es un string estable, así que
          // no se parsea: cualquier fallo del intento privado se toma como
          // "no autorizado" y se reintenta UNA vez en público. Un segundo fallo
          // se queda quieto — sin indicador, pero sin bucle de reconexión.
          if (process.env.NODE_ENV === "development") {
            console.warn("[agent typing] suscripción fallida", status, err);
          }

          // TODO RLS bloque 8-12: canal privado.
          // Hoy no existe policy sobre `realtime.messages`, y los canales
          // privados son deny-by-default: este camino rebota siempre y la
          // bandeja termina escuchando en público. Cuando se creen las policies
          // filtrando por topic `typing:${hotel_id}`, el privado engancha solo y
          // este fallback deja de correr. El aislamiento entre hoteles mientras
          // tanto lo da el nombre del canal, no la autorización.
          if (!usePrivate || triedPublicFallback || cancelled) return;
          triedPublicFallback = true;
          void client.removeChannel(ch);
          channel = openChannel(false);
        });
    };

    /**
     * El join adjunta el access_token solo si `realtime.setAuth()` ya corrió, y
     * `createBrowserClient` resuelve la sesión de forma asíncrona. Mismo orden
     * que en `useInboxRealtime`: sesión, `setAuth`, y recién ahí `.subscribe()`.
     * Sin token no se intenta el canal privado — rebotaría seguro.
     */
    void (async () => {
      let accessToken: string | undefined;
      try {
        const {
          data: { session },
        } = await client.auth.getSession();
        accessToken = session?.access_token;
        if (accessToken) {
          await client.realtime.setAuth(accessToken);
        }
      } catch (e) {
        console.warn("[agent typing] no se pudo resolver la sesión", e);
      }

      // Sin `await` entre la guarda y la asignación: el cleanup no puede
      // colarse en el medio y dejar un canal huérfano.
      if (cancelled) return;
      channel = openChannel(Boolean(accessToken));
    })();

    return () => {
      cancelled = true;
      expiresByPhone.clear();
      if (channel) {
        try {
          void client.removeChannel(channel);
        } catch (e) {
          console.warn("[agent typing] error al limpiar canal", e);
        }
      }
    };
  }, [hotelId, publish]);

  /**
   * Barrido de vencidos. Solo hay temporizador mientras alguien esté
   * escribiendo: con la bandeja quieta no se despierta nada cada segundo.
   */
  useEffect(() => {
    if (typingPhones.size === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      let removed = false;
      for (const [phone, expiresAt] of expiresByPhoneRef.current) {
        if (expiresAt <= now) {
          expiresByPhoneRef.current.delete(phone);
          removed = true;
        }
      }
      if (removed) publish();
    }, PURGE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [typingPhones, publish]);

  const isTyping = useCallback(
    (guestPhone: string | null | undefined) => {
      const digits = toDigits(guestPhone);
      if (!digits) return false;
      return typingPhones.has(digits);
    },
    [typingPhones]
  );

  return { isTyping };
}
