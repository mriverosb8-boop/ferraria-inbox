"use client";

import type { ReservasTab } from "../lib/types";

type Props = {
  activeTab: ReservasTab;
  pendingCount: number;
  processedCount: number;
  onChange: (tab: ReservasTab) => void;
};

/**
 * Encabezado de Reservas (docs/REDESIGN.md §6.1). Es el título de la pantalla:
 * acá vive el nombre de la sección desde que se eliminó la barra roja superior.
 */
export function TabsHeader({ activeTab, pendingCount, processedCount, onChange }: Props) {
  const tabs: { id: ReservasTab; label: string; count: number }[] = [
    { id: "pendientes", label: "Pendientes", count: pendingCount },
    { id: "procesadas", label: "Procesadas", count: processedCount },
  ];

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] bg-[var(--panel)]/80 px-4 py-3">
      <div>
        <h1 className="grotesk text-[19px] font-bold tracking-tight text-[var(--ink)]">Reservas</h1>
        <p className="mt-0.5 text-[12.5px] text-[var(--ink-2)]">
          Capturadas por WhatsApp Flows, listas para subir al PMS.
        </p>
      </div>
      <div className="flex gap-1.5 rounded-xl border border-[var(--line)] bg-[var(--panel-2)] p-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onChange(tab.id)}
              className={`rounded-[10px] px-3 py-1.5 text-[12px] font-semibold transition ${
                active
                  ? "border border-transparent bg-[var(--accent)] text-white shadow-sm"
                  : "border border-transparent text-[var(--ink-2)] hover:bg-[var(--panel)]/70"
              }`}
            >
              {tab.label}
              <span className={`ml-1.5 font-mono text-[11px] ${active ? "text-white/80" : "text-[var(--ink-3)]"}`}>
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
