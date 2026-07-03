"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * Sección de "Actualizaciones" (changelog) del inbox — 100% frontend.
 * Para publicar una novedad, agrega una entrada al inicio de CHANGELOG_ENTRIES.
 * El badge de novedades aparece solo hasta que el agente abre el panel.
 */

type ChangelogTipo = "nuevo" | "mejora" | "arreglo";

type ChangelogEntry = {
  /** Fecha en formato ISO (YYYY-MM-DD). */
  fecha: string;
  titulo: string;
  descripcion: string;
  tipo: ChangelogTipo;
};

// La entrada más reciente va primero. Edita este arreglo para publicar novedades.
const CHANGELOG_ENTRIES: ChangelogEntry[] = [
  {
    fecha: "2026-07-03",
    titulo: "Rediseño del inbox",
    tipo: "mejora",
    descripcion:
      "Renovamos el inbox para que sea más claro, rápido y cómodo de usar al atender a tus huéspedes.",
  },
];

const TIPO_BADGE: Record<ChangelogTipo, { label: string; border: string; bg: string; color: string }> = {
  nuevo: {
    label: "Nuevo",
    border: "var(--gold)",
    bg: "var(--gold-soft)",
    color: "var(--gold)",
  },
  mejora: {
    label: "Mejora",
    border: "var(--red)",
    bg: "var(--red-soft)",
    color: "var(--red-deep)",
  },
  arreglo: {
    label: "Arreglo",
    border: "var(--line)",
    bg: "var(--panel-3)",
    color: "var(--ink-2)",
  },
};

const STORAGE_KEY = "ferraria-inbox:changelog-visto";

/** Firma de la novedad más reciente; si cambia, vuelve a aparecer el badge. */
function latestSignature(): string {
  const first = CHANGELOG_ENTRIES[0];
  return first ? `${first.fecha}|${first.titulo}` : "";
}

// Store externo mínimo para leer/escribir la firma vista en localStorage sin
// setState en effects (evita el mismatch de hidratación y el warning de React).
const seenListeners = new Set<() => void>();

function subscribeSeen(callback: () => void): () => void {
  seenListeners.add(callback);
  window.addEventListener("storage", callback);
  return () => {
    seenListeners.delete(callback);
    window.removeEventListener("storage", callback);
  };
}

function readSeen(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return latestSignature(); // Sin storage: no molestamos con el badge.
  }
}

function markSeen(signature: string) {
  try {
    window.localStorage.setItem(STORAGE_KEY, signature);
  } catch {
    /* sin storage: no pasa nada */
  }
  seenListeners.forEach((listener) => listener());
}

function formatFecha(iso: string): string {
  try {
    // Se fija el mediodía UTC para evitar corrimientos de día por zona horaria.
    return new Intl.DateTimeFormat("es-CO", { dateStyle: "long" }).format(
      new Date(`${iso}T12:00:00Z`)
    );
  } catch {
    return iso;
  }
}

/** Chispa dorada (identidad de novedades). */
function SparkMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 100 100" fill="currentColor" {...props}>
      <path d="M50,18 C53,40 60,47 82,50 C60,53 53,60 50,82 C47,60 40,53 18,50 C40,47 47,40 50,18 Z" />
    </svg>
  );
}

/**
 * Botón de "Novedades" para el header + su modal. Autocontenido: maneja su
 * propio estado de apertura y el badge de no-leído (localStorage).
 */
export function ChangelogButton({ onRed = false }: { onRed?: boolean }) {
  const [open, setOpen] = useState(false);
  const signature = useMemo(() => latestSignature(), []);
  // En el servidor devolvemos la firma actual → sin badge hasta hidratar.
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => signature);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const hasUnseen = seen !== signature;

  const handleOpen = () => {
    setOpen(true);
    markSeen(signature);
  };

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className={`grotesk relative inline-flex items-center gap-1.5 transition-colors ${
          onRed ? "hover:bg-white/15" : "hover:bg-[var(--panel-3)]"
        }`}
        style={
          onRed
            ? { padding: "7px 12px", borderRadius: 8, border: "none", background: "transparent", color: "#fff", fontSize: 13, fontWeight: 600 }
            : { padding: "7px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink-2)", fontSize: 13, fontWeight: 600 }
        }
        aria-label="Ver actualizaciones"
      >
        <SparkMark className="h-4 w-4" style={{ color: onRed ? "#ffe08a" : "var(--gold)" }} aria-hidden />
        <span className="hidden sm:inline">Novedades</span>
        {hasUnseen && (
          <span
            className="absolute right-1 top-1 h-2 w-2 rounded-full"
            style={{
              background: onRed ? "#ffe08a" : "var(--gold)",
              boxShadow: onRed ? "0 0 0 2px var(--red)" : "0 0 0 2px var(--panel)",
            }}
            aria-hidden
          />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-[280]" role="dialog" aria-modal="true" aria-labelledby="changelog-title">
          <button
            type="button"
            className="absolute inset-0 backdrop-blur-sm"
            style={{ background: "color-mix(in srgb, var(--ink) 35%, transparent)" }}
            aria-label="Cerrar actualizaciones"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute left-1/2 top-1/2 flex max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),30rem)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-3xl"
            style={{ border: "1px solid var(--line)", background: "var(--panel)", boxShadow: "var(--shadow-lg)" }}
          >
            <div
              className="flex items-start justify-between gap-3 px-5 py-4"
              style={{ background: "linear-gradient(100deg, var(--red-deep) 0%, var(--red) 62%, #fb5142 100%)" }}
            >
              <div>
                <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-white/80">
                  <SparkMark className="h-3 w-3" style={{ color: "#ffe08a" }} aria-hidden />
                  FerrarIA
                </p>
                <h2 id="changelog-title" className="grotesk mt-1 text-lg font-bold tracking-tight text-white">
                  Actualizaciones
                </h2>
                <p className="mt-1 text-[13px] leading-relaxed text-white/85">
                  Lo nuevo que fuimos mejorando en tu inbox.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Cerrar"
                className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/15 hover:text-white"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="h-4.5 w-4.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 overflow-y-auto px-5 py-5 scrollbar-app">
              <ol className="space-y-4">
                {CHANGELOG_ENTRIES.map((entry) => {
                  const badge = TIPO_BADGE[entry.tipo];
                  return (
                    <li
                      key={`${entry.fecha}-${entry.titulo}`}
                      className="rounded-2xl px-4 py-3.5"
                      style={{ border: "1px solid var(--line)", background: "var(--panel-2)" }}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className="grotesk inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                          style={{ border: `1px solid ${badge.border}`, background: badge.bg, color: badge.color }}
                        >
                          {badge.label}
                        </span>
                        <span className="ml-auto text-[11.5px] font-medium" style={{ color: "var(--ink-3)" }}>
                          {formatFecha(entry.fecha)}
                        </span>
                      </div>
                      <h3 className="grotesk text-[15px] font-bold tracking-tight" style={{ color: "var(--ink)" }}>
                        {entry.titulo}
                      </h3>
                      <p className="mt-1 text-[13.5px] leading-relaxed" style={{ color: "var(--ink-2)" }}>
                        {entry.descripcion}
                      </p>
                    </li>
                  );
                })}
              </ol>
            </div>

            <div
              className="flex shrink-0 justify-end px-5 py-3"
              style={{ borderTop: "1px solid var(--line)", background: "var(--panel-2)" }}
            >
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="grotesk rounded-xl px-4 py-2 text-[13px] font-semibold shadow-sm transition hover:bg-[var(--panel-3)]"
                style={{ border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink-2)" }}
              >
                Entendido
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
