/* Service Worker de FerrarIA Inbox — Web Push. Vanilla, sin Serwist ni build step.
 *
 * CONTRATO DEL PAYLOAD PUSH (el Batch 7 debe enviar EXACTAMENTE este shape):
 *   {
 *     "title":           string,   // título de la notificación
 *     "body":            string,   // cuerpo de la notificación
 *     "conversation_id": string,   // conversación a abrir/enfocar al hacer click
 *     "hotel_id":        string    // hotel dueño de la conversación
 *   }
 *
 * El deep-link usa el parámetro ya soportado por el inbox: /?conversationId=<conversation_id>
 */

self.addEventListener("install", () => {
  // Activa esta versión de inmediato, sin esperar a que se cierren las pestañas.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Toma control de las pestañas abiertas ya mismo.
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = typeof payload.title === "string" && payload.title ? payload.title : "FerrarIA Inbox";
  const body = typeof payload.body === "string" ? payload.body : "";
  const conversationId = payload.conversation_id ?? null;
  const hotelId = payload.hotel_id ?? null;

  const options = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // Colapsa notificaciones de la misma conversación en una sola.
    tag: conversationId ? `conv-${conversationId}` : undefined,
    data: { conversation_id: conversationId, hotel_id: hotelId },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const conversationId = data.conversation_id;
  const targetPath = conversationId
    ? `/?conversationId=${encodeURIComponent(conversationId)}`
    : "/";
  const targetUrl = new URL(targetPath, self.location.origin).href;

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      // Si ya hay una pestaña del inbox abierta: enfócala y navégala a la conversación.
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Algunos navegadores restringen navigate(); el focus ya ocurrió.
            }
          }
          return;
        }
      }

      // Si no hay ninguna, abre una nueva ya en la conversación.
      await self.clients.openWindow(targetUrl);
    })()
  );
});
