import { createClient } from "@/lib/supabase/server";

export const HISTORY_PAGE_SIZE = 25;
export const MAX_CSV_ROWS = 5000;

export const historyTypes = [
  ["", "Todos los tipos"],
  ["EXPENSE", "Gastos"],
  ["INCOME", "Ingresos"],
  ["EXTERNAL_OUT", "Transferencias externas enviadas"],
  ["EXTERNAL_IN", "Transferencias externas recibidas"],
  ["TRANSFER", "Transferencias entre mis cuentas"],
  ["CARD_PAYMENT", "Pagos a tarjetas"],
  ["LOAN_PAYMENT", "Pagos a préstamos"],
  ["LOAN_DISBURSEMENT", "Desembolsos de préstamos"],
  ["ADJUSTMENT", "Ajustes de conciliación"],
] as const;

export type HistoryRow = {
  id: string;
  user_id: string;
  origin: "OPERATION" | "HISTORICAL";
  kind: string;
  effective_on: string;
  created_at: string;
  description: string | null;
  amount: number | string | null;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  card_id: string | null;
  loan_id: string | null;
  principal: number | string | null;
  interest: number | string | null;
  fees: number | string | null;
  adjustment_delta: number | string | null;
  is_reversed: boolean;
  reversed_at: string | null;
  reversal_reason: string | null;
  category_name: string | null;
  account_name: string | null;
  to_account_name: string | null;
  card_name: string | null;
  loan_name: string | null;
  search_text: string;
};

type Params = Record<string, string | string[] | undefined>;
export type HistoryFilters = {
  q: string;
  kind: string;
  origin: string;
  status: string;
  from: string;
  to: string;
  category: string;
  source: string;
  page: number;
};

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
function isValidDate(value: string): boolean {
  if (!isoDate.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function value(params: Params, key: string) {
  const raw = params[key];
  return (typeof raw === "string" ? raw : "").trim();
}

export function parseHistoryFilters(params: Params): HistoryFilters {
  const requestedPage = Number(value(params, "page"));
  const type = value(params, "kind");
  const origin = value(params, "origin");
  const status = value(params, "status");
  const from = value(params, "from");
  const to = value(params, "to");
  const category = value(params, "category");
  const source = value(params, "source");
  const [sourceKind, sourceId] = source.split(":");

  return {
    q: value(params, "q").slice(0, 100).replace(/[%_\\]/g, ""),
    kind: historyTypes.some(([key]) => key === type) ? type : "",
    origin: ["OPERATION", "HISTORICAL"].includes(origin) ? origin : "",
    status: ["ACTIVE", "REVERSED"].includes(status) ? status : "",
    from: isValidDate(from) ? from : "",
    to: isValidDate(to) ? to : "",
    category: uuidRegex.test(category) ? category : "",
    source: ["account", "card", "loan"].includes(sourceKind) && uuidRegex.test(sourceId ?? "") ? source : "",
    page: Number.isSafeInteger(requestedPage) && requestedPage >= 1 && requestedPage <= 100000
      ? requestedPage : 1,
  };
}

export function historyUrl(filters: HistoryFilters, page?: number, exportFile = false) {
  const values = new URLSearchParams();
  for (const key of ["q", "kind", "origin", "status", "from", "to", "category", "source"] as const) {
    if (filters[key]) values.set(key, filters[key]);
  }
  if (page && page > 1 && !exportFile) values.set("page", String(page));
  const path = exportFile ? "/dashboard/movimientos/export" : "/dashboard/movimientos";
  return `${path}${values.size ? `?${values.toString()}` : ""}`;
}

export function historyQuery(client: Awaited<ReturnType<typeof createClient>>, userId: string, filters: HistoryFilters) {
  let query = client.from("v_movement_history")
    .select("*", { count: "exact" })
    .eq("user_id", userId);

  if (filters.q) query = query.ilike("search_text", `%${filters.q}%`);
  if (filters.kind) query = query.eq("kind", filters.kind);
  if (filters.origin) query = query.eq("origin", filters.origin);
  if (filters.status) query = query.eq("is_reversed", filters.status === "REVERSED");
  if (filters.from) query = query.gte("effective_on", filters.from);
  if (filters.to) query = query.lte("effective_on", filters.to);
  if (filters.category) query = query.eq("category_id", filters.category);
  if (filters.source) {
    const [sourceKind, sourceId] = filters.source.split(":");
    if (sourceKind === "account") query = query.or(`account_id.eq.${sourceId},to_account_id.eq.${sourceId}`);
    if (sourceKind === "card") query = query.eq("card_id", sourceId);
    if (sourceKind === "loan") query = query.eq("loan_id", sourceId);
  }
  return query.order("effective_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });
}
