"use client";

import type { ReactNode } from "react";
import { AppSidebar, type AppSidebarProps } from "./AppSidebar";

export type AppShellProps = AppSidebarProps & {
  children: ReactNode;
};

/**
 * Marco de la app: el sidebar terracota a la izquierda y la pantalla al lado.
 *
 * Lo usan las tres pantallas de trabajo (bandeja, reservas y tickets). El login
 * NO lo usa: ahí todavía no hay usuario ni hotel activo, así que ninguna entrada
 * de navegación tendría a dónde llevar.
 *
 * Los hijos ocupan `h-full` en vez de `100dvh`: bajo `lg` el sidebar se vuelve
 * barra inferior fija y el marco les reserva ese alto con un padding, para que
 * la barra no le quede encima al composer ni a la última tarjeta de la lista.
 */
export function AppShell({ children, hideMobileNav = false, ...sidebarProps }: AppShellProps) {
  return (
    <div
      className="flex h-[100dvh] max-h-[100dvh] w-full max-w-full overflow-hidden"
      style={{ background: "var(--bg-app)", color: "var(--text-primary)" }}
    >
      <AppSidebar {...sidebarProps} hideMobileNav={hideMobileNav} />
      <div
        className={`flex min-h-0 min-w-0 flex-1 flex-col ${
          hideMobileNav ? "" : "max-lg:pb-[calc(62px+env(safe-area-inset-bottom,0px))]"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
