import { Suspense } from "react";
import Image from "next/image";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/auth/actions";
import { GoogleLoginButton } from "@/components/auth/google-login-button";

type AuthSearchParams = {
  error?: string;
  error_code?: string;
  error_description?: string;
};

function getLoginError(params: AuthSearchParams): string | null {
  const { error, error_code, error_description } = params;
  if (!error && !error_code) return null;

  const description = (error_description ?? "").toLowerCase();

  if (error === "access_denied" || description.includes("no autorizad")) {
    return "No se pudo acceder con esa cuenta. Verificá que su correo esté autorizado para MiPistiyo.";
  }

  if (error === "oauth_missing_code" || error === "oauth_callback") {
    return "No se pudo completar el acceso con Google. Intentá nuevamente.";
  }

  return "No se pudo completar la autenticación. Intentá de nuevo o elegí otra cuenta.";
}

async function AuthContent({
  searchParams,
}: {
  searchParams: Promise<AuthSearchParams>;
}) {
  // Cache Components: acceso dinámico dentro de Suspense.
  await connection();

  const [params, supabase] = await Promise.all([
    searchParams,
    createClient(),
  ]);

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

  const authError = getLoginError(params);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-xl shadow-black/10 sm:p-8">
      {authError && (
        <p role="alert" className="mb-5 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-left text-sm text-amber-200">
          {authError}
        </p>
      )}

      {user ? (
        <div className="space-y-5 text-center">
          <h2 className="text-lg font-semibold text-white">No se pudo verificar tu acceso</h2>
          <p className="text-sm leading-relaxed text-slate-400">
            La cuenta actual no tiene un perfil financiero autorizado.
            Podés cerrar esta sesión y elegir otra cuenta de Google.
          </p>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition-colors hover:bg-emerald-400"
            >
              Cerrar sesión y usar otra cuenta
            </button>
          </form>
        </div>
      ) : (
        <GoogleLoginButton />
      )}
    </div>
  );
}

export default function Home({
  searchParams,
}: {
  searchParams: Promise<AuthSearchParams>;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-4 py-10 text-white">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="mx-auto w-full max-w-md">
          <h1 className="sr-only">MiPistiyo — Tu pisto, bajo control.</h1>
          <div className="rounded-2xl bg-slate-100 px-4 py-3 shadow-xl shadow-black/20">
            <Image
              src="/brand/mipistiyo-logo.png"
              alt="MiPistiyo — Tu pisto, bajo control."
              width={1400}
              height={506}
              priority
              className="h-auto w-full object-contain"
            />
          </div>
        </div>

        <Suspense
          fallback={
            <div className="rounded-xl border border-slate-800 bg-slate-900 p-8 text-slate-400">
              Cargando sesión...
            </div>
          }
        >
          <AuthContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}
