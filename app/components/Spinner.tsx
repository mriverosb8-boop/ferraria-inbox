import type { CSSProperties } from "react";

/** Spinner circular reutilizable. `className` controla tamaño/color y debe incluir `animate-spin`. */
export function Spinner({
  className = "h-4 w-4 animate-spin",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
