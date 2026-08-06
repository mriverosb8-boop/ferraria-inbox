/* Service Worker de FerrarIA Inbox — Web Push. Vanilla, sin Serwist ni build step.
 *
 * CONTRATO DEL PAYLOAD PUSH (el Batch 7 debe enviar EXACTAMENTE este shape):
 *   {
 *     "title":           string,   // título de la notificación
 *     "body":            string,   // cuerpo de la notificación
 *     "conversation_id": string,   // conversación a abrir/enfocar al hacer click
 *     "hotel_id":        string,   // hotel dueño de la conversación
 *     "type":            string    // "handoff" | "staff" | "reservation" (OPCIONAL)
 *   }
 *
 * El deep-link usa el parámetro ya soportado por el inbox: /?conversationId=<conversation_id>
 */

/* Presentación por tipo de evento. El tipo SOLO afecta cómo se ve la
 * notificación; nunca a quién le llega ni a dónde lleva el click.
 *
 * "handoff" (escalamiento) es el caso urgente y queda EXACTAMENTE como estaba
 * antes de existir el campo `type`: mismo ícono, sin prefijo y con el mismo
 * `tag`. Por eso también es el default cuando el tipo falta o es desconocido —
 * un emisor viejo que no manda `type` sigue viéndose igual que siempre.
 *
 * El prefijo en el título existe porque iOS ignora el `icon` de la
 * notificación: ahí el emoji es lo único que distingue un tipo de otro.
 */
const PRESENTACION = {
  handoff: {
    icon: "/icons/icon-192.png",
    prefijoTitulo: "",
    tagPrefijo: "conv",
  },
  staff: {
    icon: "/icons/push-staff.png",
    prefijoTitulo: "👤 ",
    tagPrefijo: "staff-conv",
  },
  reservation: {
    icon: "/icons/push-reserva.png",
    prefijoTitulo: "✅ ",
    tagPrefijo: "reserva-conv",
  },
};

const TIPO_POR_DEFECTO = "handoff";

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

  const rawTitle = typeof payload.title === "string" && payload.title ? payload.title : "FerrarIA Inbox";
  const body = typeof payload.body === "string" ? payload.body : "";
  const conversationId = payload.conversation_id ?? null;
  const hotelId = payload.hotel_id ?? null;

  // Tipo desconocido o ausente → escalamiento, el comportamiento de siempre.
  const tipo = Object.prototype.hasOwnProperty.call(PRESENTACION, payload.type)
    ? payload.type
    : TIPO_POR_DEFECTO;
  const estilo = PRESENTACION[tipo];

  const options = {
    body,
    icon: estilo.icon,
    // El badge es la identidad de la app en la barra de estado (Android lo pinta
    // monocromo igual), así que no cambia por tipo.
    badge: "/icons/icon-192.png",
    // Colapsa notificaciones de la misma conversación en una sola, PERO solo
    // dentro del mismo tipo: una reserva confirmada no debe tapar un
    // escalamiento sin leer de esa misma conversación.
    tag: conversationId ? `${estilo.tagPrefijo}-${conversationId}` : undefined,
    data: { conversation_id: conversationId, hotel_id: hotelId, type: tipo },
  };

  event.waitUntil(
    self.registration.showNotification(`${estilo.prefijoTitulo}${rawTitle}`, options)
  );
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
