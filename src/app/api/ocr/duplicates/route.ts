import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { extractBankReference } from "@/lib/movements/duplicates";

/** Advertencia previa a registrar un comprobante OCR.
 * No crea operaciones ni cancela automáticamente movimientos.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: "Sesión caducada" }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
  }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const reference = String(input.reference ?? "").trim().toUpperCase();
  if (!/^[A-Z0-9-]{5,36}$/.test(reference)) {
    return NextResponse.json({ matches: [] }, { headers: { "Cache-Control": "no-store" } });
  }

  // Solo lectura autorizada: la vista protege RLS y filtramos además por usuario.
  const { data, error } = await supabase.from("v_movement_history")
    .select("id,kind,effective_on,amount,description")
    .eq("user_id", user.id)
    .eq("is_reversed", false)
    .ilike("description", `%${reference}%`)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: "No se pudo comprobar la referencia" }, { status: 503 });
  // Evita coincidencias parciales: «Ref. 123456» no es «Ref. 1234567».
  const matches = (data ?? []).filter(row => extractBankReference(row.description) === reference)
    .slice(0, 5).map(row => ({
      id: row.id,
      kind: row.kind,
      date: row.effective_on,
      amount: Number(row.amount),
    }));
  return NextResponse.json({ matches }, { headers: { "Cache-Control": "no-store" } });
}
