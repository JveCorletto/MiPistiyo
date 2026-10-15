import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { GoogleLoginButton } from "@/components/auth/google-login-button";

async function AuthContent() {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && profile) {
      redirect("/dashboard");
    }
  }

  return (
    <div className="rounded-xl border border-slate-700 bg-slate-900 p-8">
      <div className="space-y-4">
        <p className="text-slate-300">
          {user
            ? "No se pudo verificar tu acceso a MiPistiyo."
            : "Inicia sesión para administrar tus finanzas."}
        </p>

        {!user && <GoogleLoginButton />}

        {user && (
          <p className="text-sm text-amber-400">
            Tu cuenta no tiene un perfil financiero autorizado.
          </p>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 text-white">
      <div className="w-full max-w-md space-y-6 text-center">
        <div>
          <h1 className="text-4xl font-bold">
            MiPistiyo
          </h1>

          <p className="mt-3 text-slate-400">
            Tu pisto, bajo control.
          </p>
        </div>

        <Suspense
          fallback={
            <div className="rounded-xl border border-slate-700 bg-slate-900 p-8">
              <p className="text-slate-400">
                Cargando sesión...
              </p>
            </div>
          }
        >
          <AuthContent />
        </Suspense>
      </div>
    </main>
  );
}