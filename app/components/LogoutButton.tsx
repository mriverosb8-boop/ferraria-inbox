"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LogoutButton({ onRed = false }: { onRed?: boolean }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
    setLoading(false);
  }

  const className = onRed
    ? "rounded-lg border border-white/35 bg-white/15 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-white/25 disabled:opacity-50"
    : "rounded-lg border border-[#e7dfd4] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b665e] shadow-sm transition hover:border-stone-400 hover:bg-[#f1ece4] hover:text-[#1f1f1c] disabled:opacity-50";

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={loading}
      className={className}
    >
      {loading ? "…" : "Cerrar sesión"}
    </button>
  );
}
