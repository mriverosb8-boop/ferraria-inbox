"use client";

import { useSyncExternalStore } from "react";
import { THEME_CHANGE_EVENT, setTheme, type Theme } from "@/lib/theme";
import { HEADER_MENU_ROW_CLASS } from "./HeaderMobileMenu";

function subscribeTheme(callback: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

function getThemeSnapshot(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function getThemeServerSnapshot(): Theme {
  return "light";
}

function IconSun(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <circle cx="12" cy="12" r="4" />
      <path strokeLinecap="round" d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function IconMoon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
    </svg>
  );
}

/** Botón de tema para las barras rojas (blanco translúcido, como "Ayuda"). */
export function ThemeToggle({
  className = "",
  variant = "bar",
}: {
  className?: string;
  variant?: "bar" | "menu";
}) {
  const theme = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getThemeServerSnapshot);

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");

  const isDark = theme === "dark";
  const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";

  if (variant === "menu") {
    return (
      <button type="button" onClick={toggle} className={HEADER_MENU_ROW_CLASS} role="menuitem" aria-label={label}>
        {isDark ? <IconSun className="h-4 w-4 shrink-0" /> : <IconMoon className="h-4 w-4 shrink-0" />}
        {isDark ? "Modo claro" : "Modo oscuro"}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`grotesk inline-flex items-center gap-1.5 rounded-lg px-2.5 py-[7px] text-[13px] font-semibold text-white transition-colors hover:bg-white/15 ${className}`}
      aria-label={label}
      title={label}
    >
      {isDark ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
      <span className="hidden sm:inline">{isDark ? "Claro" : "Oscuro"}</span>
    </button>
  );
}
