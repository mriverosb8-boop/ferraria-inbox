"use client";

import { useEffect, useState } from "react";

type FollowupTimerProps = {
  quoteCreatedAt: string;
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

export function FollowupTimer({ quoteCreatedAt }: FollowupTimerProps) {
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
      <span
        aria-label="Seguimiento por enviar"
        title="Seguimiento por enviar"
        className="h-5 w-5 rounded-full bg-amber-600 shadow-sm ring-2 ring-amber-100 animate-pulse"
      />
    );
  }

  const progress = clampProgress(ageMin / PREPARATION_MINUTES);
  const dashOffset = CIRCUMFERENCE * (1 - progress);

  return (
    <svg
      aria-label="Seguimiento en preparación"
      title="Seguimiento en preparación"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      className="h-5 w-5 shrink-0 -rotate-90"
    >
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
  );
}
