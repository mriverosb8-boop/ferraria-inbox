export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "ferraria-theme";

/** Evento interno para que los toggles reaccionen a un cambio de tema. */
export const THEME_CHANGE_EVENT = "ferraria-theme-change";

/** Lee el tema guardado por el usuario (o null si nunca eligió). */
export function getStoredTheme(): Theme | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === "dark" || value === "light" ? value : null;
  } catch {
    return null;
  }
}

/** Tema efectivo actual según la clase aplicada en <html>. */
export function getActiveTheme(): Theme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Aplica el tema al <html> (clase `dark`) sin persistir. */
export function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

/** Persiste y aplica el tema elegido por el usuario. */
export function setTheme(theme: Theme) {
  applyTheme(theme);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* almacenamiento no disponible: el tema igual queda aplicado en memoria */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
  }
}

/**
 * Snippet que corre antes del primer paint (inyectado en <head>) para evitar
 * el flash: aplica el tema guardado o, si no hay, la preferencia del sistema.
 */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t==='dark'||(!t&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark')}else{document.documentElement.classList.remove('dark')}}catch(e){}`;
