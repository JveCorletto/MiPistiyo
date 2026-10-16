import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Download, Search, X } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { CreateMovementModal } from "@/components/movements/create-movement-modal";
import { HistoryManager } from "@/components/movements/history-manager";
import { buildReversalImpacts, findPotentialDuplicates, type LedgerSnapshot } from "@/lib/movements/duplicates";
import { DatePicker } from "@/components/ui/date-picker";
import {
  HISTORY_PAGE_SIZE, historyQuery, historyTypes, historyUrl,
  parseHistoryFilters, type HistoryRow,
} from "@/lib/movements/history";

type SearchParams = Record<string, string | string[] | undefined>;
const field = "w-full min-w-0 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 outline-none focus:border-emerald-500";

async function MovementsContent({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await connection();
  const filters = parseHistoryFilters(await searchParams);
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return <p role="alert" className="rounded-lg bg-red-500/10 p-4 text-red-300">Tu sesión ha expirado.</p>;
  }

  const [categoriesResult, accountsResult, cardsResult, loansResult, historyResult, duplicatePoolResult] = await Promise.all([
    supabase.from("categories").select("id,name,kind,is_active").eq("user_id", user.id).order("name"),
    supabase.from("accounts").select("id,name,kind,is_active").eq("user_id", user.id).order("name"),
    supabase.from("cards").select("id,name,kind,is_active,last_four").eq("user_id", user.id).order("name"),
    supabase.from("loans").select("id,name,is_active").eq("user_id", user.id).order("name"),
    historyQuery(supabase, user.id, filters)
      .range((filters.page - 1) * HISTORY_PAGE_SIZE, filters.page * HISTORY_PAGE_SIZE - 1),
    supabase.from("v_movement_history")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_reversed", false)
      .order("created_at", { ascending: false })
      .limit(1000),
  ]);

  const error = categoriesResult.error ?? accountsResult.error ?? cardsResult.error
    ?? loansResult.error ?? historyResult.error ?? duplicatePoolResult.error;
  if (error) return (
    <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
      No se pudo cargar el historial: {error.message}
    </p>
  );

  const categories = categoriesResult.data ?? [];
  const accounts = accountsResult.data ?? [];
  const cards = cardsResult.data ?? [];
  const loans = loansResult.data ?? [];
  const movements = (historyResult.data ?? []) as HistoryRow[];
  const total = historyResult.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  // Advertencias orientativas; nunca anulan automáticamente.
  // Se comparan hasta las 1000 operaciones vigentes más recientes.
  const duplicateMatches = findPotentialDuplicates((duplicatePoolResult.data ?? []) as HistoryRow[]);
  const operationIds = movements.filter(row => row.origin === "OPERATION" && !row.is_reversed).map(row => row.id);
  const ledgerResult = operationIds.length
    ? await supabase.from("ledger_entries")
        .select("operation_id,account_id,card_id,loan_id,delta")
        .eq("user_id", user.id).in("operation_id", operationIds)
    : { data: [] as LedgerSnapshot[], error: null };
  if (ledgerResult.error) return (
    <p role="alert" className="rounded-lg bg-red-500/10 p-4 text-red-300">
      No se pudieron consultar los impactos contables: {ledgerResult.error.message}
    </p>
  );
  const names = {
    accounts: Object.fromEntries(accounts.map(a => [a.id, a.name])),
    cards: Object.fromEntries(cards.map(c => [c.id, c.name])),
    loans: Object.fromEntries(loans.map(l => [l.id, l.name])),
  };
  const reversalImpacts = buildReversalImpacts(
    (ledgerResult.data ?? []) as LedgerSnapshot[], names,
  );

  return <div className="space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-white">Movimientos</h1>
        <p className="mt-2 text-slate-400">Historial, filtros, detalles y anulaciones con trazabilidad.</p>
      </div>
      <CreateMovementModal
        categories={categories.filter((row) => row.is_active)}
        accounts={accounts.filter((row) => row.is_active)}
        cards={cards.filter((row) => row.is_active)}
      />
    </header>

    <section aria-label="Filtros de movimientos" className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 sm:p-5">
      <form method="GET" action="/dashboard/movimientos" className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block space-y-1.5 sm:col-span-2 xl:col-span-2">
            <span className="text-xs font-medium text-slate-300">Buscar por descripción, categoría o cuenta</span>
            <div className="relative"><Search size={16} aria-hidden className="absolute left-3 top-3 text-slate-500" />
              <input className={`${field} pl-9`} type="search" name="q" maxLength={100}
                defaultValue={filters.q} placeholder="Ej. universidad, Selectos, internet..." />
            </div>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Tipo</span>
            <select name="kind" defaultValue={filters.kind} className={field}>
              {historyTypes.map(([key, name]) => <option key={key} value={key}>{name}</option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Origen del registro</span>
            <select name="origin" defaultValue={filters.origin} className={field}>
              <option value="">Todos</option><option value="OPERATION">Contabilizados</option>
              <option value="HISTORICAL">Históricos incluidos en apertura</option>
            </select>
          </label>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-xs font-medium text-slate-300">Desde</span>
            <DatePicker
              name="from"
              defaultValue={filters.from}
              allowEmpty
              placeholder="Cualquier fecha"
              ariaLabel="Filtrar desde la fecha"
            />
          </div>
          <div className="min-w-0 space-y-1.5">
            <span className="block text-xs font-medium text-slate-300">Hasta</span>
            <DatePicker
              name="to"
              defaultValue={filters.to}
              allowEmpty
              placeholder="Cualquier fecha"
              ariaLabel="Filtrar hasta la fecha"
            />
          </div>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Categoría</span>
            <select name="category" defaultValue={filters.category} className={field}>
              <option value="">Todas las categorías</option>
              {categories.map((item) => <option key={item.id} value={item.id}>
                {item.name}{item.is_active ? "" : " (archivada)"}
              </option>)}
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Cuenta / tarjeta / préstamo</span>
            <select name="source" defaultValue={filters.source} className={field}>
              <option value="">Todos los instrumentos</option>
              <optgroup label="Cuentas">
                {accounts.map((item) => <option key={item.id} value={`account:${item.id}`}>{item.name}</option>)}
              </optgroup>
              <optgroup label="Tarjetas">
                {cards.map((item) => <option key={item.id} value={`card:${item.id}`}>{item.name}</option>)}
              </optgroup>
              <optgroup label="Préstamos">
                {loans.map((item) => <option key={item.id} value={`loan:${item.id}`}>{item.name}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-slate-300">Estado</span>
            <select name="status" defaultValue={filters.status} className={field}>
              <option value="">Todos los estados</option>
              <option value="ACTIVE">Vigentes</option><option value="REVERSED">Anulados</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400">
            Aplicar filtros
          </button>
          <Link href="/dashboard/movimientos" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
            <X size={15} /> Limpiar
          </Link>
          <a href={historyUrl(filters, undefined, true)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800">
            <Download size={15} /> Exportar CSV
          </a>
        </div>
      </form>
    </section>

    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 className="text-lg font-semibold text-white">Historial unificado</h2>
          <p className="mt-1 text-xs text-slate-400">
            {total.toLocaleString("es-SV")} {total === 1 ? "operación encontrada" : "operaciones encontradas"}
            {total > 0 ? ` · Página ${filters.page} de ${totalPages}` : ""}
          </p>
        </div>
        <p className="text-xs text-slate-500">Ordenado por fecha efectiva (más reciente primero)</p>
      </div>
      <HistoryManager items={movements} duplicateMatches={duplicateMatches} reversalImpacts={reversalImpacts} categories={categories} />
      {totalPages > 1 && <nav aria-label="Paginación del historial" className="flex items-center justify-between gap-3 pt-2">
        {filters.page > 1 ? <Link href={historyUrl(filters, filters.page - 1)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">← Anterior</Link>
          : <span className="rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-600">← Anterior</span>}
        <span className="text-sm text-slate-400">{filters.page} / {totalPages}</span>
        {filters.page < totalPages ? <Link href={historyUrl(filters, filters.page + 1)} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Siguiente →</Link>
          : <span className="rounded-lg border border-slate-800 px-4 py-2 text-sm text-slate-600">Siguiente →</span>}
      </nav>}
    </section>
  </div>;
}

export default function MovementsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  return <Suspense fallback={<p className="p-6 text-slate-400">Cargando historial...</p>}>
    <MovementsContent searchParams={searchParams} />
  </Suspense>;
}
