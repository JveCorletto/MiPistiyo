import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return NextResponse.json({ unread: 0 }, { status: 401 });

  const refresh = await supabase.rpc("refresh_due_notifications");
  if (refresh.error) return NextResponse.json({ error: "No se pudieron actualizar los avisos" }, { status: 500 });

  const { count, error: countError } = await supabase.from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id).is("read_at", null);
  if (countError) return NextResponse.json({ error: "No se pudieron consultar los avisos" }, { status: 500 });

  return NextResponse.json({ unread: count ?? 0 }, { headers: { "Cache-Control": "no-store" } });
}