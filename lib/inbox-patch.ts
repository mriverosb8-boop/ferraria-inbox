export function buildReactivateAiFields(now: string) {
  return {
    needs_human: false,
    ai_active: true,
    unread_count: 0,
    last_read_at: now,
  };
}
