/**
 * Placeholder de Solicitudes (tickets de servicio).
 *
 * Existe SOLO para que el redirect del middleware tenga a dónde llegar: un
 * `operativo` entra al inbox y cae acá, y sin esta página vería un 404. La
 * pantalla real (lista de `service_tickets`, filtros por área y estado) llega en
 * la Tanda C2 y reemplaza este archivo entero.
 */
export default function SolicitudesPage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="grotesk text-2xl font-bold text-[var(--ink)]">Solicitudes</h1>
      <p className="max-w-sm text-[15px] text-[var(--ink-2)]">
        Acá vas a ver las solicitudes de servicio de tu área. Estamos terminando esta pantalla.
      </p>
    </main>
  );
}
