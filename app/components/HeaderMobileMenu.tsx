"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Estilo compartido de las filas del menú hamburguesa (móvil). */
export const HEADER_MENU_ROW_CLASS =
  "ibx-press grotesk flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] font-semibold text-[var(--ink-2)] hover:bg-[var(--bg-app)] disabled:opacity-50";

function IconMenu({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className={className} aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5M3.75 17.25h16.5" />
    </svg>
  );
}

/**
 * Menú hamburguesa solo-móvil (`sm:hidden`) para las barras rojas: agrupa las
 * acciones secundarias y libera el header en pantallas angostas. En desktop el
 * componente entero es `display:none` — las acciones siguen sueltas en su fila
 * `hidden sm:flex`. Cierra al elegir una opción (click que burbujea), al tocar
 * fuera o con Escape. Estado con `useState`, sin storage.
 */
export function HeaderMobileMenu({
  children,
  onRed = false,
}: {
  children: ReactNode;
  onRed?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative sm:hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
          onRed ? "text-white hover:bg-white/15" : "text-[var(--ink-2)] hover:bg-[var(--bg-app)]"
        }`}
        aria-label="Menú"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <IconMenu className="h-5 w-5" />
      </button>
      {open && (
        <div
          role="menu"
          onClick={() => setOpen(false)}
          className="absolute right-0 top-[calc(100%+0.5rem)] z-[240] w-60 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--bg-card)] py-1 shadow-[var(--shadow-lg)]"
        >
          {children}
        </div>
      )}
    </div>
  );
}
