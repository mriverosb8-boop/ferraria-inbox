import { Suspense } from "react";
import InboxApp from "./components/InboxApp";
import { InboxLoadingSkeleton } from "./components/InboxLoadingSkeleton";

/**
 * El `Suspense` es obligatorio: `InboxApp` lee `?vista=staff` con
 * `useSearchParams` para saber si arranca en Huéspedes o en Staff, y sin límite
 * de suspensión eso arrastra toda la ruta a render en cliente.
 */
export default function Home() {
  return (
    <Suspense fallback={<InboxLoadingSkeleton />}>
      <InboxApp />
    </Suspense>
  );
}
