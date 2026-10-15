
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");

  // Evitamos redirecciones hacia dominios externos.
  const origin = request.nextUrl.origin;

  if (!code) {
    return NextResponse.redirect(
      new URL("/?error=oauth_missing_code", origin)
    );
  }

  const supabase = await createClient();

  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    console.error("OAuth callback error:", error.message);

    return NextResponse.redirect(
      new URL("/?error=oauth_callback", origin)
    );
  }

  return NextResponse.redirect(new URL("/", origin));
}