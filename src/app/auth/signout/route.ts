import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signOut();

  if (error) {
    return NextResponse.json(
      { error: "No se pudo cerrar la sesión." },
      { status: 500 }
    );
  }

  return NextResponse.redirect(
    new URL("/", request.url),
    { status: 303 }
  );
}