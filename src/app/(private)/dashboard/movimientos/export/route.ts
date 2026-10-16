import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  historyQuery, MAX_CSV_ROWS, parseHistoryFilters, type HistoryRow,
} from "@/lib/movements/history";

const str = (value: unknown) => String(value ?? "");

// Evitar CSV injection al abrir descripciones ingresadas por personas en Excel.
function cell(value: unknown): string {
  let text = str(value);
  if (/^\s*[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: NextRequest) {
  const client = await createClient();
  const { data: { user }, error: authError } = await client.auth.getUser();
  if (authError || !user) return new NextResponse("Sesión requerida", { status: 401 });

  const filters = parseHistoryFilters(Object.fromEntries(request.nextUrl.searchParams));
  const first = await historyQuery(client, user.id, filters).range(0, 0);
  if (first.error) return new NextResponse(first.error.message, { status: 500 });
  const count = first.count ?? 0;
  if (count > MAX_CSV_ROWS) {
    return new NextResponse(`La selección supera ${MAX_CSV_ROWS} operaciones. Acotá el rango de fechas antes de exportar.`, {
      status: 413,
    });
  }

  const rows: HistoryRow[] = [];
  for (let offset = 0; offset < count; offset += 500) {
    const response = await historyQuery(client, user.id, filters)
      .range(offset, Math.min(count, offset + 500) - 1);
    if (response.error) return new NextResponse(response.error.message, { status: 500 });
    rows.push(...((response.data ?? []) as HistoryRow[]));
  }

  const header = ["Fecha", "Registro", "Tipo", "Histórico", "Estado", "Descripción",
    "Categoría", "Cuenta origen", "Cuenta destino", "Tarjeta", "Préstamo", "Monto USD",
    "Capital USD", "Intereses USD", "Comisiones USD", "Motivo de anulación", "ID"];
  const data = rows.map((item) => [
    item.effective_on, item.created_at, item.kind,
    item.origin === "HISTORICAL" ? "Sí" : "No", item.is_reversed ? "Anulado" : "Vigente",
    item.description, item.category_name, item.account_name, item.to_account_name,
    item.card_name, item.loan_name,
    Number(item.amount ?? 0).toFixed(2), Number(item.principal ?? 0).toFixed(2),
    Number(item.interest ?? 0).toFixed(2), Number(item.fees ?? 0).toFixed(2),
    item.reversal_reason, item.id,
  ]);
  const csv = "\uFEFF" + [header, ...data].map((line) => line.map(cell).join(",")).join("\r\n") + "\r\n";

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=MiPistiyo-movimientos.csv",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
