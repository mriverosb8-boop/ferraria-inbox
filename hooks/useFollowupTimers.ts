"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type FollowupRow = {
  conversation_id: string;
  quote_created_at: string;
  stage: string;
};

export type FollowupTimerEntry = {
  quoteCreatedAt: string;
  stage: string;
};

const FOLLOWUP_REFRESH_MS = 60 * 1000;

function buildFollowupMap(rows: FollowupRow[] | null): Map<string, FollowupTimerEntry> {
  const next = new Map<string, FollowupTimerEntry>();

  for (const row of rows ?? []) {
    if (!row.conversation_id || !row.quote_created_at) continue;
    next.set(row.conversation_id, {
      quoteCreatedAt: row.quote_created_at,
      stage: row.stage,
    });
  }

  return next;
}

export function useFollowupTimers(): Map<string, FollowupTimerEntry> {
  const [followups, setFollowups] = useState<Map<string, FollowupTimerEntry>>(() => new Map());

  useEffect(() => {
    let cancelled = false;

    async function loadFollowups() {
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("get_pending_followups");

        if (error) {
          console.warn("[useFollowupTimers] RPC get_pending_followups falló", error);
          if (!cancelled) setFollowups(new Map());
          return;
        }

        if (!cancelled) {
          setFollowups(buildFollowupMap((data ?? []) as FollowupRow[]));
        }
      } catch (e) {
        console.warn("[useFollowupTimers] No se pudieron cargar follow-ups", e);
        if (!cancelled) setFollowups(new Map());
      }
    }

    void loadFollowups();
    const intervalId = window.setInterval(() => {
      void loadFollowups();
    }, FOLLOWUP_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return followups;
}
