import { LoginForm } from "./login-form";

/** Página síncrona: el `?next=` se lee en el cliente para evitar bloqueos con searchParams/async en Next 16. */
export default function LoginPage() {
  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center px-4 py-12" style={{ background: "var(--bg-app)" }}>
      <LoginForm />
      <p className="mt-6 text-[12px]" style={{ color: "var(--ink-3)" }}>
        FerrarIA · Recepción con IA
      </p>
    </div>
  );
}
