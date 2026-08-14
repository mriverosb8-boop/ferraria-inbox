/**
 * Modelo de permisos del inbox: una matriz estática por rol + un `can()`.
 *
 * Módulo puro. No toca React, ni cookies, ni Supabase: solo contesta "¿este rol
 * puede hacer X?". Resolver el rol del usuario vive en `lib/inbox-tenant.ts`.
 *
 * REGLA CENTRAL — LISTA BLANCA ESTRICTA: un rol desconocido, `null`, vacío o con
 * un typo devuelve CERO capacidades. Antes de este módulo el default era el
 * contrario (cualquier miembro de un hotel veía todo, y `role` solo servía para
 * AMPLIAR acceso vía `super_admin`). Esa inversión es el punto de la matriz: si
 * mañana alguien inserta a mano un rol `mantenimiento` en vez de `operativo`,
 * ese usuario no ve nada — en vez de verlo todo.
 */

/** Roles reconocidos. Mismo vocabulario que `hotel_users.role`. */
export const HOTEL_ROLES = ["super_admin", "manager", "recepcionista", "operativo"] as const;
export type HotelRole = (typeof HOTEL_ROLES)[number];

export type Capability =
  /**
   * Leer conversaciones y mensajes de huéspedes: las vistas Huéspedes y Staff, y
   * todo lo que cuelga de ellas (resúmenes, estados de entrega, media, bloqueo).
   *
   * Es la capacidad que define al rol `operativo`: mantenimiento y housekeeping
   * NO la tienen. La RLS ya los excluye en el navegador vía
   * `user_guest_data_hotel_ids()`, pero los route handlers corren con
   * service_role y se saltan la RLS, así que este gate es el que los frena ahí.
   */
  | "verConversacionesHuespedes"
  /**
   * Enviar mensajes al huésped (texto, media, plantillas) y leer el catálogo de
   * plantillas.
   *
   * Deliberadamente separada de `verConversacionesHuespedes`: leer un hilo y
   * escribirle a un huésped en nombre del hotel no son el mismo permiso. Hoy
   * viajan juntas en la matriz, pero tenerlas aparte permite mañana un rol de
   * solo lectura sin tocar ningún endpoint.
   */
  | "enviarMensajes"
  /** Pestaña Reservas: cotizaciones y confirmación de reservas. */
  | "verReservas"
  /** Pestaña Solicitudes: tickets de servicio (`service_tickets`). */
  | "verSolicitudes";

export type CapabilityMap = Readonly<Record<Capability, boolean>>;

const NINGUNA: CapabilityMap = {
  verConversacionesHuespedes: false,
  enviarMensajes: false,
  verReservas: false,
  verSolicitudes: false,
};

const TODAS: CapabilityMap = {
  verConversacionesHuespedes: true,
  enviarMensajes: true,
  verReservas: true,
  verSolicitudes: true,
};

/**
 * Matriz rol → capacidades.
 *
 * `super_admin`, `manager` y `recepcionista` conservan exactamente lo que ya
 * tenían (todo el inbox actual) y suman Solicitudes. El único rol recortado es
 * `operativo`, que es la razón de ser de esta tanda.
 */
const CAPACIDADES: Readonly<Record<HotelRole, CapabilityMap>> = {
  super_admin: TODAS,
  manager: TODAS,
  recepcionista: TODAS,
  operativo: {
    verConversacionesHuespedes: false,
    enviarMensajes: false,
    verReservas: false,
    verSolicitudes: true,
  },
};

/** `true` solo si el string es uno de los roles reconocidos. */
export function isHotelRole(role: unknown): role is HotelRole {
  return typeof role === "string" && (HOTEL_ROLES as readonly string[]).includes(role.trim());
}

/**
 * Capacidades de UN rol. Cualquier entrada que no sea un rol reconocido —
 * `null`, `undefined`, `""`, un typo, un objeto — devuelve cero capacidades.
 */
export function capabilitiesForRole(role: unknown): CapabilityMap {
  if (!isHotelRole(role)) return NINGUNA;
  return CAPACIDADES[role.trim() as HotelRole];
}

/** ¿El rol tiene la capacidad? Rol no reconocido → siempre `false`. */
export function can(role: unknown, capability: Capability): boolean {
  return capabilitiesForRole(role)[capability];
}

/**
 * Capacidades efectivas de un usuario a partir de TODAS sus membresías (unión).
 *
 * La unión es deliberada: alguien que sea `recepcionista` en un hotel conserva
 * las conversaciones DE ESE HOTEL aunque en otro sea `operativo`. El recorte de
 * datos no lo hace esta función sino la lista de hoteles
 * (`resolveGuestDataHotelIds` en `lib/inbox-tenant.ts`), que es lo que espeja la
 * RLS. Separar "qué puede hacer" de "sobre qué hoteles" evita el falso dilema de
 * tener que elegir entre bloquearlo de más o de menos.
 *
 * Sin membresías → cero capacidades.
 */
export function capabilitiesForRoles(roles: readonly unknown[]): CapabilityMap {
  return roles.reduce<CapabilityMap>((acc, role) => {
    const caps = capabilitiesForRole(role);
    return {
      verConversacionesHuespedes: acc.verConversacionesHuespedes || caps.verConversacionesHuespedes,
      enviarMensajes: acc.enviarMensajes || caps.enviarMensajes,
      verReservas: acc.verReservas || caps.verReservas,
      verSolicitudes: acc.verSolicitudes || caps.verSolicitudes,
    };
  }, NINGUNA);
}

/** ¿Alguna de las membresías del usuario le da la capacidad? */
export function canAny(roles: readonly unknown[], capability: Capability): boolean {
  return capabilitiesForRoles(roles)[capability];
}
