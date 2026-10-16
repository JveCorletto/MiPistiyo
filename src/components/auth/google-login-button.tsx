"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AccessMode = "login" | "register";

export function GoogleLoginButton() {
  const [mode, setMode] = useState<AccessMode>("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleAccess() {
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // Obliga a Google a ofrecer el selector, incluso si ya tiene
          // una cuenta iniciada en el navegador.
          queryParams: {
            prompt: "select_account",
          },
        },
      });

      if (oauthError) throw oauthError;
      // El SDK redirige al proveedor cuando el inicio OAuth funciona.
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo conectar con Google. Intentá nuevamente."
      );
      setLoading(false);
    }
  }

  function changeMode(nextMode: AccessMode) {
    if (loading) return;
    setMode(nextMode);
    setError(null);
  }

  return (
    <div className="space-y-5 text-left">
      <div
        className="grid grid-cols-2 gap-1 rounded-xl border border-slate-700 bg-slate-950 p-1"
        aria-label="Modo de acceso"
      >
        <button
          type="button"
          aria-pressed={mode === "login"}
          disabled={loading}
          onClick={() => changeMode("login")}
          className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:opacity-60 ${
            mode === "login"
              ? "bg-emerald-500/15 text-emerald-300"
              : "text-slate-400 hover:bg-slate-800 hover:text-white"
          }`}
        >
          Iniciar sesión
        </button>
        <button
          type="button"
          aria-pressed={mode === "register"}
          disabled={loading}
          onClick={() => changeMode("register")}
          className={`rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:opacity-60 ${
            mode === "register"
              ? "bg-emerald-500/15 text-emerald-300"
              : "text-slate-400 hover:bg-slate-800 hover:text-white"
          }`}
        >
          Crear cuenta
        </button>
      </div>

      <div className="space-y-2 text-center">
        <h2 className="text-xl font-semibold text-white">
          {mode === "login" ? "Bienvenido de nuevo" : "Empezá con MiPistiyo"}
        </h2>
        <p className="text-sm leading-relaxed text-slate-400">
          {mode === "login"
            ? "Elegí la cuenta de Google con la que querés entrar."
            : "Seleccioná una cuenta de Google autorizada para crear tu perfil financiero."}
        </p>
      </div>

      <button
        type="button"
        onClick={handleGoogleAccess}
        disabled={loading}
        className="flex w-full items-center justify-center gap-3 rounded-lg bg-white px-5 py-3 font-semibold text-slate-900 transition-colors hover:bg-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400 disabled:cursor-wait disabled:opacity-60"
      >
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.28 5.48-4.84 7.18l7.73 6C44.34 38.03 46.98 31.85 46.98 24.55z" />
          <path fill="#FBBC05" d="M10.53 28.59A14.4 14.4 0 0 1 9.75 24c0-1.59.27-3.14.78-4.59l-7.98-6.2A23.94 23.94 0 0 0 0 24c0 3.87.93 7.52 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.8l-7.73-6c-2.15 1.45-4.92 2.3-8.18 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {loading
          ? "Conectando con Google..."
          : mode === "login"
            ? "Continuar con Google"
            : "Crear cuenta con Google"}
      </button>

      {error && (
        <p role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      )}

      <p className="text-center text-xs leading-relaxed text-slate-500">
        {mode === "register"
          ? "MiPistiyo está en beta privada: el registro requiere un correo previamente autorizado. Si la cuenta ya existe, ingresarás a ella sin crear otra."
          : "Google te mostrará el selector de cuentas. Podés elegir otra cuenta o usar una diferente."}
      </p>
    </div>
  );
}
