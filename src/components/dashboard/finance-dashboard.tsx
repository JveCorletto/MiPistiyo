import type { ReactNode } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowUpRight,
  Banknote,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  CreditCard,
  History,
  Landmark,
  PiggyBank,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";

export type DashboardStats = {
  income: number;
  expense: number;
  balance: number;
  cash_available: number;
  credit_debt: number;
  loan_debt: number;
  net_worth: number;
};

export type MonthBar = {
  key: string;
  label: string;
  income: number;
  expense: number;
};

export type ExpenseCategory = {
  id: string;
  name: string;
  spent: number;
  color: string | null;
};

export type BalanceItem = {
  id: string;
  name: string;
  balance: number;
  kind?: string;
  limit?: number;
};

export type BudgetProgress = {
  name: string;
  budget: number;
  spent: number;
  overall: boolean;
};

export type ActivityItem = {
  id: string;
  date: string;
  createdAt: string;
  title: string;
  detail: string;
  amount: number;
  direction: "income" | "expense" | "neutral";
  kind: string;
  historical: boolean;
  reversed: boolean;
};

export type FinanceDashboardData = {
  month: string;
  monthLabel: string;
  prevMonth: string;
  nextMonth: string;
  currentMonth: string;
  stats: DashboardStats;
  months: MonthBar[];
  categories: ExpenseCategory[];
  accounts: BalanceItem[];
  cards: BalanceItem[];
  loans: BalanceItem[];
  budgets: BudgetProgress[];
  activity: ActivityItem[];
};

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

function shortDate(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat("es-SV", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }).format(date);
}

function Panel({
  title,
  hint,
  href,
  children,
}: {
  title: string;
  hint?: string;
  href?: string;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/75 p-4 sm:p-5">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{title}</h2>
          {hint && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        </div>
        {href && (
          <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 hover:text-emerald-300">
            Ver todo <ArrowRight size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function Metric({
  label,
  value,
  icon: Icon,
  accent = "default",
  note,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  accent?: "default" | "green" | "red" | "amber";
  note?: string;
}) {
  const classes = {
    default: "bg-slate-800 text-slate-300",
    green: "bg-emerald-500/10 text-emerald-400",
    red: "bg-rose-500/10 text-rose-400",
    amber: "bg-amber-500/10 text-amber-400",
  }[accent];
  return (
    <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium text-slate-400 sm:text-sm">{label}</p>
        <span className={`rounded-xl p-2.5 ${classes}`}><Icon size={18} /></span>
      </div>
      <p className="mt-3 break-words text-2xl font-bold tracking-tight text-white sm:text-3xl">{usd(value)}</p>
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </div>
  );
}

function BarChart({ months }: { months: MonthBar[] }) {
  const maximum = Math.max(1, ...months.flatMap((m) => [m.income, m.expense]));
  return (
    <div>
      <div className="mb-5 flex flex-wrap gap-4 text-xs text-slate-400">
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" />Ingresos</span>
        <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" />Gastos</span>
      </div>
      <div className="grid grid-cols-6 gap-2 sm:gap-4" aria-label="Comparación de ingresos y gastos de seis meses">
        {months.map((m) => (
          <div key={m.key} className="min-w-0">
            <div className="flex h-40 items-end justify-center gap-1 rounded-lg border-b border-slate-700 bg-slate-950/40 px-1 pb-0.5 sm:h-48 sm:gap-2">
              <div
                title={`${m.label}: ingresos ${usd(m.income)}`}
                role="img"
                aria-label={`${m.label}: ingresos ${usd(m.income)}`}
                className="w-4 max-w-[35%] rounded-t-sm bg-emerald-400/85 transition-all"
                style={{ height: m.income > 0 ? `${Math.max(3, (m.income / maximum) * 100)}%` : "0%" }}
              />
              <div
                title={`${m.label}: gastos ${usd(m.expense)}`}
                role="img"
                aria-label={`${m.label}: gastos ${usd(m.expense)}`}
                className="w-4 max-w-[35%] rounded-t-sm bg-rose-400/85 transition-all"
                style={{ height: m.expense > 0 ? `${Math.max(3, (m.expense / maximum) * 100)}%` : "0%" }}
              />
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400 sm:text-xs">{m.label}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-xs text-slate-500">Los importes incluyen el detalle histórico registrado para cada mes.</p>
    </div>
  );
}

function AssetList({ items, empty, kind }: { items: BalanceItem[]; empty: string; kind: "account" | "card" | "loan" }) {
  if (items.length === 0) return <p className="py-4 text-sm text-slate-500">{empty}</p>;
  return (
    <div className="divide-y divide-slate-800">
      {items.slice(0, 5).map((item) => (
        <div key={item.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-slate-200">{item.name}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {kind === "account" ? ({ CASH: "Efectivo", BANK: "Cuenta bancaria", WALLET: "Billetera" }[item.kind ?? ""] ?? "Cuenta") :
                kind === "card" && item.limit != null ? `Límite ${usd(item.limit)}` : kind === "loan" ? "Saldo pendiente" : "Deuda actual"}
            </p>
          </div>
          <span className={`shrink-0 text-sm font-semibold tabular-nums ${kind === "account" ? "text-slate-100" : "text-rose-300"}`}>{usd(item.balance)}</span>
        </div>
      ))}
      {items.length > 5 && <p className="pt-3 text-xs text-slate-500">Y {items.length - 5} más…</p>}
    </div>
  );
}

function ActivityIcon({ item }: { item: ActivityItem }) {
  if (item.historical) return <History size={17} />;
  if (item.kind === "TRANSFER") return <ArrowLeftRight size={17} />;
  if (item.kind === "CARD_PAYMENT") return <CreditCard size={17} />;
  if (item.kind === "LOAN_PAYMENT" || item.kind === "LOAN_DISBURSEMENT") return <Landmark size={17} />;
  return item.direction === "income" ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />;
}

export function FinanceDashboard({ data }: { data: FinanceDashboardData }) {
  const { stats } = data;
  const maxCategory = Math.max(1, ...data.categories.map((c) => c.spent));
  const overallBudget = data.budgets.find((b) => b.overall);
  const otherBudgets = data.budgets.filter((b) => !b.overall).slice(0, 3);
  const budgetItems = [...(overallBudget ? [overallBudget] : []), ...otherBudgets];
  const monthIncome = stats.income;
  const monthExpense = stats.expense;

  return (
    <div className="space-y-6 pb-10 text-slate-100">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">MiPistiyo</p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Resumen financiero</h1>
          <p className="mt-2 text-sm text-slate-400">Tus finanzas claras, sin duplicar gastos ni deudas.</p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900 p-1.5">
          <Link href={`/dashboard?month=${data.prevMonth}`} aria-label="Mes anterior" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><ChevronLeft size={18} /></Link>
          <span className="flex min-w-36 items-center justify-center gap-2 text-sm font-semibold capitalize"><CalendarDays size={15} className="text-emerald-400" />{data.monthLabel}</span>
          <Link href={`/dashboard?month=${data.nextMonth}`} aria-label="Mes siguiente" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white"><ChevronRight size={18} /></Link>
        </div>
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Actividad del mes seleccionado</div>
        {data.month !== data.currentMonth && <Link href="/dashboard" className="text-xs text-emerald-400 hover:text-emerald-300">Volver al mes actual</Link>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <Metric label="Ingresos del mes" value={monthIncome} icon={TrendingUp} accent="green" note="Incluye registros históricos del mes" />
        <Metric label="Gastos del mes" value={monthExpense} icon={TrendingDown} accent="red" note="Sin transferencias propias ni abonos a capital" />
        <Metric label="Balance del mes" value={stats.balance} icon={CircleDollarSign} accent={stats.balance >= 0 ? "green" : "red"} note="Ingresos menos gastos, no saldo bancario" />
      </div>

      <div className="flex items-center justify-between gap-2 pt-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Situación financiera actual</h2>
        <span className="text-xs text-slate-500">Los saldos no cambian al seleccionar otro mes</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Dinero en cuentas" value={stats.cash_available} icon={Wallet} accent="green" />
        <Metric label="Deuda en tarjetas" value={stats.credit_debt} icon={CreditCard} accent="red" />
        <Metric label="Deuda en préstamos" value={stats.loan_debt} icon={Landmark} accent="amber" />
        <Metric label="Patrimonio neto" value={stats.net_worth} icon={PiggyBank} accent={stats.net_worth >= 0 ? "green" : "red"} note="Cuentas − tarjetas − préstamos" />
      </div>

      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <Panel title="Ingresos vs. gastos" hint="Comparativa mensual · últimos seis meses hasta el mes seleccionado">
            <BarChart months={data.months} />
          </Panel>
        </div>
        <div className="xl:col-span-2">
          <Panel title="¿En qué gastaste?" hint="Principales categorías del mes" href="/dashboard/movimientos">
            {data.categories.length === 0 ? (
              <p className="py-6 text-sm text-slate-500">Todavía no hay gastos registrados para este mes.</p>
            ) : (
              <div className="space-y-4">
                {data.categories.slice(0, 6).map((category) => (
                  <div key={category.id}>
                    <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                      <span className="truncate text-slate-300">{category.name}</span>
                      <span className="shrink-0 font-semibold tabular-nums text-white">{usd(category.spent)}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                      <div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.min(100, Math.max(0, category.spent / maxCategory * 100))}%`, backgroundColor: category.color ?? undefined }} />
                    </div>
                  </div>
                ))}
                {data.categories.length > 6 && <p className="text-xs text-slate-500">+ {data.categories.length - 6} categorías adicionales</p>}
              </div>
            )}
          </Panel>
        </div>
      </div>

      {budgetItems.length > 0 && (
        <Panel title="Seguimiento de presupuestos" hint="Gasto registrado frente al límite del mes">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {budgetItems.map((item) => {
              const pct = item.budget > 0 ? (item.spent / item.budget) * 100 : 0;
              return (
                <div key={item.name} className="rounded-xl bg-slate-950/50 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate font-semibold text-slate-200">{item.name}</span>
                    <span className={pct > 100 ? "text-rose-400" : pct >= 85 ? "text-amber-400" : "text-emerald-400"}>{Math.round(pct)}%</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">{usd(item.spent)} / {usd(item.budget)}</p>
                  <div className="mt-3 h-2 rounded-full bg-slate-800">
                    <div className={`h-2 rounded-full ${pct > 100 ? "bg-rose-400" : pct >= 85 ? "bg-amber-400" : "bg-emerald-400"}`} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Cuentas" hint="Saldos disponibles actuales" href="/dashboard/cuentas">
          <AssetList items={data.accounts} empty="Todavía no tenés cuentas registradas." kind="account" />
        </Panel>
        <Panel title="Tarjetas de crédito" hint="Deuda pendiente actual" href="/dashboard/tarjetas">
          <AssetList items={data.cards} empty="No hay tarjetas de crédito registradas." kind="card" />
        </Panel>
        <Panel title="Préstamos" hint="Capital pendiente actual" href="/dashboard/prestamos">
          <AssetList items={data.loans} empty="No hay préstamos registrados." kind="loan" />
        </Panel>
      </div>

      <Panel title="Actividad reciente" hint="Operaciones recientes de todos los módulos, independientemente del mes" href="/dashboard/movimientos">
        {data.activity.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">Todavía no hay movimientos para mostrar.</div>
        ) : (
          <div className="divide-y divide-slate-800">
            {data.activity.map((item) => (
              <div key={item.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className={`shrink-0 rounded-xl p-2.5 ${item.historical ? "bg-amber-400/10 text-amber-400" : item.direction === "income" ? "bg-emerald-400/10 text-emerald-400" : item.direction === "expense" ? "bg-rose-400/10 text-rose-400" : "bg-sky-400/10 text-sky-400"}`}>
                  <ActivityIcon item={item} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className={`truncate text-sm font-medium ${item.reversed ? "text-slate-500 line-through" : "text-slate-200"}`}>{item.title}</p>
                    {item.historical && <span className="rounded-md bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400">Histórico</span>}
                    {item.reversed && <span className="rounded-md bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">Anulado</span>}
                  </div>
                  <p className="mt-1 truncate text-xs text-slate-500">{item.detail} · {shortDate(item.date)}</p>
                </div>
                <span className={`shrink-0 text-sm font-semibold tabular-nums ${item.reversed ? "text-slate-500 line-through" : item.direction === "income" ? "text-emerald-400" : item.direction === "expense" ? "text-slate-100" : "text-sky-300"}`}>
                  {item.direction === "income" ? "+" : item.direction === "expense" ? "−" : ""}{usd(item.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-5 flex flex-wrap gap-2 border-t border-slate-800 pt-4">
          <Link href="/dashboard/movimientos" className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-emerald-400"><Banknote size={15} /> Nuevo movimiento <ArrowRight size={14} /></Link>
          <Link href="/dashboard/transferencias" className="inline-flex items-center gap-2 rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"><ArrowLeftRight size={15} /> Transferencias y pagos</Link>
        </div>
      </Panel>
      <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500"><ArrowLeft size={14} className="mt-0.5 shrink-0" />Los reportes históricos reflejan únicamente las operaciones que ingresaste. Si importaste parte de un mes anterior, sus totales pueden estar incompletos. El saldo actual siempre proviene del libro mayor y los saldos de apertura.</p>
    </div>
  );
}
