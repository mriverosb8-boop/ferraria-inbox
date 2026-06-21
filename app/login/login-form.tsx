"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function sanitizeNextPath(raw: string | null | undefined) {
  const t = raw?.trim() || "/";
  return t.startsWith("/") && !t.startsWith("//") ? t : "/";
}

/** Traduce el error crudo de Supabase Auth a un mensaje propio en español.
 *  No se expone nunca el message/details/hint crudo al usuario (hallazgo B-1). */
function mapAuthError(rawMessage: string): string {
  const msg = rawMessage.toLowerCase();
  if (msg.includes("request rate limit reached")) {
    return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
  }
  if (msg.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  return "No se pudo iniciar sesión. Revisa tus datos e intenta de nuevo.";
}

export function LoginForm() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: signError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signError) {
        setLoading(false);
        setError(mapAuthError(signError.message));
        return;
      }

      // Éxito: NO llamamos setLoading(false) a propósito. Dejamos loading=true
      // y el redirect desmonta el componente, eliminando la ventana de
      // re-disparo del submit entre setLoading(false) y la navegación.
      const params = new URLSearchParams(window.location.search);
      const next = sanitizeNextPath(params.get("next"));
      router.push(next);
      router.refresh();
    } catch {
      // La promesa rechazó (fallo de red, etc.): rehabilitamos el botón para
      // que no quede colgado en "Entrando…" para siempre.
      setLoading(false);
      setError("Error de conexión. Revisa tu internet e intenta de nuevo.");
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="w-full max-w-[380px] space-y-5 rounded-2xl border border-[#e7dfd4] bg-white p-8 shadow-[0_8px_30px_-12px_rgba(31,31,28,0.08)] ring-1 ring-black/[0.03]"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-[#1f1f1c]">Iniciar sesión</h1>
        <p className="text-[13px] text-[#6b665e]">Accede al inbox con tu cuenta de FerrarIA.</p>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-900">
          {error}
        </div>
      )}

      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">Email</span>
          <input
            name="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] px-3 py-2.5 text-[14px] text-[#1f1f1c] outline-none ring-[#c8a97e]/0 transition placeholder:text-[#9c968c] focus:border-[#c8a97e] focus:bg-white focus:ring-2 focus:ring-[#c8a97e]/25"
            placeholder="tu@email.com"
          />
        </label>
        <label className="block space-y-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6b665e]">Contraseña</span>
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-xl border border-[#e7dfd4] bg-[#f8f6f2] px-3 py-2.5 text-[14px] text-[#1f1f1c] outline-none ring-[#c8a97e]/0 transition placeholder:text-[#9c968c] focus:border-[#c8a97e] focus:bg-white focus:ring-2 focus:ring-[#c8a97e]/25"
            placeholder="••••••••"
          />
        </label>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-[#c8a97e] to-[#b89a6e] py-2.5 text-[14px] font-semibold text-white shadow-md shadow-[#c8a97e]/25 transition hover:from-[#b89a6e] hover:to-[#a88b60] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
