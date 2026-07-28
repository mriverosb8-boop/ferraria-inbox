import { BrandHeaderMark } from "./BrandHeaderMark";
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
    <div style={{ color: "var(--ink-2)" }}>
      <div
        className="flex items-center justify-center gap-2 px-4 py-4"
        style={{ borderBottom: "1px solid var(--line)", background: "color-mix(in srgb, var(--panel) 50%, transparent)" }}
      >
        <Spinner className="h-4 w-4 animate-spin" style={{ color: "var(--red)" }} />
        <p className="text-sm font-medium">Cargando conversaciones…</p>
      </div>

      <div className="divide-y" style={{ borderColor: "var(--line-2)" }}>
        {SKELETON_ITEMS.map((item, index) => (
          <div key={index} className="flex items-start gap-3.5 px-4 py-3.5" style={{ borderColor: "var(--line-2)" }}>
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-full" style={{ background: "var(--panel-3)" }} />
            <div className="min-w-0 flex-1 space-y-2 pt-1">
              <div className={`h-3.5 max-w-full animate-pulse rounded ${item.nameWidth}`} style={{ background: "var(--panel-3)" }} />
              <div className={`h-3 max-w-full animate-pulse rounded ${item.previewWidth}`} style={{ background: "var(--line-2)" }} />
            </div>
            <div className="flex min-w-[44px] shrink-0 flex-col items-end gap-2 pt-1">
              <div className="h-2.5 w-9 animate-pulse rounded" style={{ background: "var(--line-2)" }} />
              <div className="h-4 w-4 animate-pulse rounded-full" style={{ background: "var(--panel-3)" }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const THREAD_SKELETON_BUBBLES = [
  { side: "left", width: "w-[58%]", height: "h-14" },
  { side: "right", width: "w-[42%]", height: "h-10" },
  { side: "left", width: "w-[70%]", height: "h-16" },
  { side: "right", width: "w-[50%]", height: "h-12" },
  { side: "left", width: "w-[38%]", height: "h-10" },
  { side: "right", width: "w-[62%]", height: "h-14" },
] as const;

/** Burbujas placeholder del hilo mientras se carga el historial autoritativo
 * desde `/api/inbox/messages`. Evita pintar el array provisional que viene
 * embebido en `/api/inbox`. */
export function InboxThreadSkeleton() {
  return (
    <div className="w-full min-w-0 space-y-2.5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Cargando historial de la conversación…</span>
      {THREAD_SKELETON_BUBBLES.map((bubble, index) => (
        <div
          key={index}
          className={`flex w-full ${bubble.side === "right" ? "justify-end" : "justify-start"}`}
        >
          <div
            className={`max-w-full animate-pulse rounded-2xl ${bubble.width} ${bubble.height}`}
            style={{ background: bubble.side === "right" ? "var(--panel-3)" : "var(--line-2)" }}
          />
        </div>
      ))}
    </div>
  );
}

/** Carga full-screen (montaje inicial): la tarjeta envuelve a InboxListSkeleton
 * con la cabecera de marca FerrarIA (identidad roja del rediseño). */
export function InboxLoadingSkeleton() {
  return (
    <div
      className="flex h-[100dvh] flex-col items-center justify-center px-4 supports-[height:100dvh]:min-h-[100dvh]"
      style={{ background: "var(--bg)", color: "var(--ink-2)" }}
    >
      <div
        className="w-full max-w-[min(100%,28rem)] overflow-hidden rounded-2xl"
        style={{ border: "1px solid var(--line)", background: "var(--panel-2)", boxShadow: "var(--shadow-lg)" }}
      >
        <div
          className="flex items-center gap-3 px-5 py-4"
          style={{
            background: "linear-gradient(100deg, var(--red-deep) 0%, var(--red) 62%, #fb5142 100%)",
            boxShadow: "0 1px 8px rgba(196,43,32,.25)",
          }}
        >
          <BrandHeaderMark size="sm" />
          <div className="min-w-0">
            <div className="grotesk truncate text-[16px] font-bold tracking-tight text-white">
              Ferrar<span style={{ color: "rgba(255,255,255,.82)" }}>IA</span>
            </div>
            <p className="truncate text-[11px] leading-tight text-white/80">Preparando tu inbox…</p>
          </div>
        </div>
        <InboxListSkeleton />
      </div>
    </div>
  );
}
