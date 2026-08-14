/**
 * Rutas de la app en un solo lugar.
 *
 * Existe porque `/solicitudes` lo nombran tres capas que no se importan entre sí
 * (el middleware para el redirect, el service worker para el deep-link del push
 * y la página en sí). Un string suelto en cada una es una ruta que se rompe en
 * silencio el día que cambie.
 *
 * OJO: `public/sw.js` es JS plano sin build step y NO puede importar de acá.
 * Su copia del valor está marcada con un comentario que apunta a este archivo.
 */

/** Bandeja de conversaciones (Huéspedes y Staff). */
export const INBOX_PATH = "/";

/** Cotizaciones y reservas. */
export const RESERVAS_PATH = "/reservas";

/** Tickets de servicio. Única vista del rol `operativo`. */
export const SOLICITUDES_PATH = "/solicitudes";

export const LOGIN_PATH = "/login";
