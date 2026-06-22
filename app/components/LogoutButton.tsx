"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { writeStoredActiveHotelId } from "@/lib/active-hotel-storage";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSignOut() {
    setLoading(true);
    // Limpia el hotel activo guardado para que el próximo usuario que inicie
    // sesión en esta pestaña no herede un hotelId que no le pertenece.
    writeStoredActiveHotelId(null);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      type="button"
      onClick={() => void handleSignOut()}
      disabled={loading}
      className="rounded-lg border border-[#e7dfd4] bg-white px-2.5 py-1 text-[11px] font-medium text-[#6b665e] shadow-sm transition hover:border-stone-400 hover:bg-[#f1ece4] hover:text-[#1f1f1c] disabled:opacity-50"
    >
      {loading ? "…" : "Cerrar sesión"}
    </button>
  );
}
