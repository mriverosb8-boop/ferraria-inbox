import { Spinner } from "./Spinner";

const SKELETON_ITEMS = [
  { nameWidth: "w-28", previewWidth: "w-52" },
  { nameWidth: "w-36", previewWidth: "w-64" },
  { nameWidth: "w-24", previewWidth: "w-56" },
  { nameWidth: "w-32", previewWidth: "w-60" },
  { nameWidth: "w-40", previewWidth: "w-48" },
  { nameWidth: "w-28", previewWidth: "w-64" },
  { nameWidth: "w-36", previewWidth: "w-52" },
];

/** Spinner + filas skeleton, sin contenedor full-screen: pensado para embeber
 * dentro del panel de la lista (cambio de hotel) manteniendo header/dropdown. */
export function InboxListSkeleton() {
  return (
    <div className="text-[#6b665e]">
      <div className="flex items-center justify-center gap-2 border-b border-[#e7dfd4] bg-white/50 px-4 py-4">
        <Spinner className="h-4 w-4 animate-spin opacity-70" />
        <p className="text-sm font-medium">Cargando conversaciones…</p>
      </div>

      <div className="divide-y divide-[#ebe5dc]">
        {SKELETON_ITEMS.map((item, index) => (
          <div key={index} className="flex items-start gap-3.5 px-4 py-3.5">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full bg-[#e7dfd4]" />
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              <div className={`h-3.5 max-w-full animate-pulse rounded bg-[#e7dfd4] ${item.nameWidth}`} />
              <div className={`h-3 max-w-full animate-pulse rounded bg-[#ece6dc] ${item.previewWidth}`} />
            </div>
            <div className="flex min-w-[44px] shrink-0 flex-col items-end gap-2 pt-1">
              <div className="h-2.5 w-9 animate-pulse rounded bg-[#ece6dc]" />
              <div className="h-4 w-4 animate-pulse rounded-full bg-[#e7dfd4]" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Carga full-screen (montaje inicial): la tarjeta envuelve a InboxListSkeleton. */
export function InboxLoadingSkeleton() {
  return (
    <div className="flex h-[100dvh] flex-col items-center justify-center bg-[#f7f4ee] px-4 text-[#6b665e] supports-[height:100dvh]:min-h-[100dvh]">
      <div className="w-full max-w-[min(100%,28rem)] overflow-hidden rounded-2xl border border-[#e7dfd4] bg-[#f8f6f2] shadow-sm ring-1 ring-black/[0.02]">
        <InboxListSkeleton />
      </div>
    </div>
  );
}
