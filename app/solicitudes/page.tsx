import { Suspense } from "react";
import { SolicitudesScreen } from "./components/SolicitudesScreen";

/**
 * Pestaña Solicitudes: los tickets de servicio (`service_tickets`) que crea el
 * agente cuando un huésped pide algo por WhatsApp.
 *
 * Es la única vista del rol `operativo` (mantenimiento, housekeeping), que no
 * puede ver conversaciones de huéspedes. El recorte por área y por hotel lo hace
 * el endpoint, no esta pantalla.
 *
 * El `Suspense` es obligatorio: `SolicitudesScreen` lee `?ticketId=` con
 * `useSearchParams` para el deep-link del push, y sin límite de suspensión eso
 * arrastra toda la ruta a render en cliente.
 */
export default function SolicitudesPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-dvh items-center justify-center bg-[var(--bg-app)] p-8 text-center">
          <p className="text-[14px] text-[var(--text-secondary)]">Cargando solicitudes...</p>
        </main>
      }
    >
      <SolicitudesScreen />
    </Suspense>
  );
}
