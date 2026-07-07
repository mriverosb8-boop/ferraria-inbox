"use client";

import { useCallback, useEffect, useState } from "react";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export type PushStatus =
  | "unsupported" // el navegador no soporta push (incluye iOS en pestaña)
  | "ios-needs-install" // iOS sin instalar: hay que agregar a inicio
  | "idle" // soportado, sin suscripción, permiso por defecto
  | "denied" // permiso denegado
  | "subscribing" // en curso
  | "subscribed" // suscripción activa y guardada
  | "error";

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iP(hone|ad|od)/.test(navigator.userAgent);
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Convierte la VAPID public key (base64url) al formato que espera pushManager. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  // Respaldar con un ArrayBuffer explícito: applicationServerKey exige
  // ArrayBufferView<ArrayBuffer> (no ArrayBufferLike) en lib.dom reciente.
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Estado y acciones de la suscripción Web Push del navegador actual. */
export function usePushNotifications(activeHotelId: string | null) {
  const [status, setStatus] = useState<PushStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  // Estado inicial: soporte, permiso y si ya existe una suscripción activa.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!pushSupported()) {
        if (!cancelled) {
          setStatus(isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported");
        }
        return;
      }
      if (Notification.permission === "denied") {
        if (!cancelled) setStatus("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (!cancelled) setStatus(sub ? "subscribed" : "idle");
      } catch {
        if (!cancelled) setStatus("idle");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    setError(null);
    if (!pushSupported()) {
      setStatus(isIOS() && !isStandalone() ? "ios-needs-install" : "unsupported");
      return;
    }
    if (!VAPID_PUBLIC_KEY) {
      setError("Falta configurar NEXT_PUBLIC_VAPID_PUBLIC_KEY");
      setStatus("error");
      return;
    }
    setStatus("subscribing");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "idle");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), hotelId: activeHotelId }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "No se pudo guardar la suscripción");
        setStatus("error");
        return;
      }
      setStatus("subscribed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al activar notificaciones");
      setStatus("error");
    }
  }, [activeHotelId]);

  const disable = useCallback(async () => {
    setError(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setStatus("idle");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al desactivar notificaciones");
      setStatus("error");
    }
  }, []);

  return { status, error, enable, disable };
}
