"use client";

import { useEffect, useState } from "react";

type FollowupTimerProps = {
  quoteCreatedAt: string;
  onCancel?: () => void;
};

const PREPARATION_MINUTES = 10;
const FOLLOWUP_WINDOW_MINUTES = 30;
const TICK_MS = 30 * 1000;
const SIZE = 20;
const STROKE_WIDTH = 2.5;
const RADIUS = (SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clampProgress(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function CancelOverlay({ onCancel }: { onCancel: () => void }) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label="Cancelar seguimiento"
      title="Cancelar seguimiento"
      onClick={(e) => {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.stopPropagation();
          e.preventDefault();
          onCancel();
        }
      }}
      className="absolute inset-0 hidden h-5 w-5 items-center justify-center rounded-full bg-stone-800/80 text-white group-hover:flex"
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path
          d="M1 1 L9 9 M9 1 L1 9"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function FollowupTimer({ quoteCreatedAt, onCancel }: FollowupTimerProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, TICK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  const quoteMs = new Date(quoteCreatedAt).getTime();
  if (!Number.isFinite(quoteMs)) return null;

  const ageMin = (now - quoteMs) / 60000;
  if (ageMin >= FOLLOWUP_WINDOW_MINUTES) return null;

  if (ageMin >= PREPARATION_MINUTES) {
    return (
      <span className="group relative inline-flex h-5 w-5 shrink-0">
        <span
          aria-label="Seguimiento por enviar"
          title="Seguimiento por enviar"
          className="h-5 w-5 rounded-full bg-amber-600 shadow-sm ring-2 ring-amber-100 animate-pulse"
        />
        {onCancel && <CancelOverlay onCancel={onCancel} />}
      </span>
    );
  }

  const progress = clampProgress(ageMin / PREPARATION_MINUTES);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <span className="group relative inline-flex h-5 w-5 shrink-0">
      <svg
        aria-label="Seguimiento en preparación"
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-5 w-5 shrink-0 -rotate-90"
      >
        <title>Seguimiento en preparación</title>
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#eee7dc"
          strokeWidth={STROKE_WIDTH}
        />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke="#c8a97e"
          strokeLinecap="round"
          strokeWidth={STROKE_WIDTH}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
      {onCancel && <CancelOverlay onCancel={onCancel} />}
    </span>
  );
}
