import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppShell } from "@/components/layout/app-shell";

async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();

  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    redirect("/");
  }

  const { data: profile, error: profileError } =
    await supabase
      .from("profiles")
      .select("id, display_name")
      .eq("user_id", user.id)
      .maybeSingle();

  if (profileError || !profile) {
    redirect("/?error=access_denied");
  }

  const displayName =
    profile.display_name ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "Usuario";

  return (
    <AppShell
      displayName={displayName}
      email={user.email ?? ""}
    >
      {children}
    </AppShell>
  );
}

export default function PrivateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-400">
          Verificando acceso...
        </div>
      }
    >
      <ProtectedLayout>{children}</ProtectedLayout>
    </Suspense>
  );
}