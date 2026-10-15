"use client";

import { useActionState, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft,
  ChevronRight, ClipboardCopy, Edit3, PiggyBank, Plus, ShieldAlert,
  Trash2, Wallet, X,
} from "lucide-react";
import {
  copyPreviousBudgets,
  deleteBudget,
  saveBudget,
  type BudgetActionState,
} from "@/app/(private)/dashboard/presupuestos/actions";

export type ExpenseCategory = {
  id: string;
  name: string;
  color: string | null;
  is_active: boolean;
};

export type BudgetItem = {
  id: string;
  category_id: string | null;
  name: string;
  color: string | null;
  amount: number;
  spent: number;
  is_active: boolean;
};

export type UnbudgetedExpense = {
  category_id: string;
  name: string;
  spent: number;
  color: string | null;
};

type Props = {
  monthStart: string;
  monthLabel: string;
  previousMonth: string;
  nextMonth: string;
  budgets: BudgetItem[];
  categories: ExpenseCategory[];
  totalSpent: number;
  unbudgeted: UnbudgetedExpense[];
  copyableCount: number;
};

type DialogMode =
  | { kind: "CREATE"; initialCategoryId?: string }
  | { kind: "EDIT"; budget: BudgetItem }
  | { kind: "DELETE"; budget: BudgetItem };

const initialState: BudgetActionState = { error: null, success: null };
const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);

const inputClass = "mt-1 block w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2.5 text-sm text-white outline-none transition-colors placeholder:text-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/40";
const labelClass = "block text-sm font-medium text-slate-300";
const buttonPrimary = "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60";
const buttonSecondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50";
const card = "rounded-2xl border border-slate-800 bg-slate-900/85 p-4 sm:p-5";

function statusFor(amount: number, spent: number) {
  const ratio = amount > 0 ? spent / amount : 0;
  if (ratio >= 1) return { label: "Límite alcanzado", color: "text-rose-400", fill: "bg-rose-500", chip: "bg-rose-500/10 text-rose-300" };
  if (ratio >= 0.8) return { label: "Cerca del límite", color: "text-amber-400", fill: "bg-amber-400", chip: "bg-amber-500/10 text-amber-300" };
  return { label: "Bajo control", color: "text-emerald-400", fill: "bg-emerald-400", chip: "bg-emerald-500/10 text-emerald-300" };
}

function Progress({ amount, spent }: { amount: number; spent: number }) {
  const percent = amount > 0 ? Math.round((spent / amount) * 100) : 0;
  const state = statusFor(amount, spent);
  return <div>
    <div className="mb-2 flex items-center justify-between gap-2 text-xs">
      <span className={state.color}>{state.label}</span>
      <span className="tabular-nums text-slate-300">{percent}% utilizado</span>
    </div>
    <div role="progressbar" aria-valuenow={Math.max(0, Math.min(percent, 100))}
      aria-valuemin={0} aria-valuemax={100} aria-label="Porcentaje de presupuesto utilizado"
      className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
      <div className={`h-full rounded-full transition-all ${state.fill}`}
        style={{ width: `${Math.max(0, Math.min(spent / amount * 100, 100))}%` }} />
    </div>
  </div>;
}

function SubmitButton({ children, danger = false }: {
  children: ReactNode;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}
    className={danger
      ? "inline-flex items-center gap-2 rounded-xl bg-rose-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-rose-400 disabled:opacity-50"
      : buttonPrimary}>
    {pending ? "Guardando..." : children}
  </button>;
}

function Modal({ title, children, onClose }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-5"
    onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title}
      className="max-h-[92vh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Cerrar ventana"
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
          <X size={20} />
        </button>
      </div>
      {children}
    </div>
  </div>;
}

function FormNotice({ state }: { state: BudgetActionState }) {
  return state.error ? <p role="alert" className="rounded-lg border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-300">
    {state.error}
  </p> : null;
}

function BudgetForm({
  monthStart, categories, budgets, initialCategoryId, editing,
  onClose, onSuccess,
}: {
  monthStart: string;
  categories: ExpenseCategory[];
  budgets: BudgetItem[];
  initialCategoryId?: string;
  editing?: BudgetItem;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(saveBudget, initialState);
  const hasOverall = budgets.some((budget) => budget.category_id === null);
  const takenIds = new Set(budgets.filter((budget) => budget.category_id !== null).map((budget) => budget.category_id));
  const availableCategories = categories.filter((category) => category.is_active && !takenIds.has(category.id));
  const [scope, setScope] = useState<"OVERALL" | "CATEGORY">(
    editing ? (editing.category_id === null ? "OVERALL" : "CATEGORY")
      : initialCategoryId || hasOverall ? "CATEGORY" : "OVERALL",
  );
  const [categoryId, setCategoryId] = useState(initialCategoryId ?? availableCategories[0]?.id ?? "");

  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);

  return <form action={action} className="space-y-4">
    <input type="hidden" name="month_start" value={monthStart} />
    {editing && <input type="hidden" name="budget_id" value={editing.id} />}
    <input type="hidden" name="scope" value={scope} />
    <input type="hidden" name="category_id" value={editing ? editing.category_id ?? "" : categoryId} />

    {editing ? <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
      <p className="text-xs text-slate-400">Estás editando</p>
      <p className="mt-1 font-semibold text-white">{editing.name}</p>
      <p className="mt-1 text-xs text-slate-500">La categoría y el mes permanecen fijos.</p>
    </div> : <>
      <fieldset className="space-y-2">
        <legend className={labelClass}>Tipo de presupuesto</legend>
        <label className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${scope === "OVERALL" ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-700"} ${hasOverall ? "opacity-50" : ""}`}>
          <input type="radio" name="scope_visual" checked={scope === "OVERALL"}
            disabled={hasOverall} onChange={() => setScope("OVERALL")} className="accent-emerald-400" />
          <span><strong className="block text-slate-100">Presupuesto general</strong>
            <span className="text-xs text-slate-400">Límite para todos los gastos del mes{hasOverall ? " · ya configurado" : ""}</span>
          </span>
        </label>
        <label className={`flex cursor-pointer gap-2 rounded-xl border p-3 text-sm ${scope === "CATEGORY" ? "border-emerald-500/60 bg-emerald-500/10" : "border-slate-700"} ${availableCategories.length === 0 ? "opacity-50" : ""}`}>
          <input type="radio" name="scope_visual" checked={scope === "CATEGORY"}
            disabled={availableCategories.length === 0} onChange={() => setScope("CATEGORY")}
            className="accent-emerald-400" />
          <span><strong className="block text-slate-100">Por categoría</strong>
            <span className="text-xs text-slate-400">Ej. alimentación, transporte o educación</span>
          </span>
        </label>
      </fieldset>
      {scope === "CATEGORY" && <label className="block">
        <span className={labelClass}>Categoría de gasto *</span>
        <select name="category_visual" className={inputClass} required value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}>
          {availableCategories.length === 0 && <option value="">Sin categorías disponibles</option>}
          {availableCategories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
      </label>}
    </>}

    <label className="block">
      <span className={labelClass}>Límite mensual (USD) *</span>
      <input autoFocus className={inputClass} type="number" inputMode="decimal"
        name="amount" min="0.01" step="0.01" max="999999999999.99"
        defaultValue={editing?.amount ?? ""} placeholder="Ej. 150.00" required />
    </label>
    <p className="rounded-lg bg-slate-800/50 p-3 text-xs leading-relaxed text-slate-300">
      Crear o editar un presupuesto <strong>no mueve dinero</strong>. El avance se calcula con los gastos
      registrados (incluidos los históricos) del mes seleccionado.
    </p>
    <FormNotice state={state} />
    <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
      <button type="button" onClick={onClose} className={buttonSecondary}>Cancelar</button>
      <SubmitButton>{editing ? "Guardar cambios" : "Crear presupuesto"}</SubmitButton>
    </div>
  </form>;
}

function DeleteForm({ budget, monthStart, onClose, onSuccess }: {
  budget: BudgetItem;
  monthStart: string;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(deleteBudget, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="budget_id" value={budget.id} />
    <input type="hidden" name="month_start" value={monthStart} />
    <p className="text-sm leading-relaxed text-slate-300">
      ¿Eliminar el presupuesto <strong className="text-white">{budget.name}</strong> de este mes?
    </p>
    <p className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-300">
      Solo se elimina el límite presupuestario. Ningún gasto, transferencia o saldo será modificado.
    </p>
    <FormNotice state={state} />
    <div className="flex justify-end gap-2">
      <button type="button" onClick={onClose} className={buttonSecondary}>Cancelar</button>
      <SubmitButton danger>Sí, eliminar</SubmitButton>
    </div>
  </form>;
}

function CopyPrevious({ monthStart, count, onSuccess }: {
  monthStart: string;
  count: number;
  onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(copyPreviousBudgets, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  if (count === 0) return null;
  return <form action={action} className="space-y-1">
    <input type="hidden" name="month_start" value={monthStart} />
    <button type="submit" className={buttonSecondary}>
      <ClipboardCopy size={16} /> Copiar mes anterior ({count})
    </button>
    {state.error && <p role="alert" className="max-w-sm text-xs text-rose-400">{state.error}</p>}
  </form>;
}

export function BudgetManager({
  monthStart, monthLabel, previousMonth, nextMonth,
  budgets, categories, totalSpent, unbudgeted, copyableCount,
}: Props) {
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const close = useCallback(() => setDialog(null), []);
  const onSuccess = useCallback((message: string) => {
    setToast(message);
    setDialog(null);
  }, []);
  const clearToast = useCallback(() => setToast(null), []);
  const overall = budgets.find((budget) => budget.category_id === null);
  const categoriesBudgets = useMemo(() => budgets
    .filter((budget) => budget.category_id !== null)
    .sort((left, right) => {
      const ratioLeft = left.amount > 0 ? left.spent / left.amount : 0;
      const ratioRight = right.amount > 0 ? right.spent / right.amount : 0;
      return ratioRight - ratioLeft || left.name.localeCompare(right.name, "es");
    }), [budgets]);
  const assigned = categoriesBudgets.reduce((sum, budget) => sum + budget.amount, 0);
  const overLimit = categoriesBudgets.filter((budget) => budget.spent >= budget.amount).length;
  const remaining = overall ? overall.amount - totalSpent : null;
  const overallSpent = overall ? overall.spent : totalSpent;
  const unusedCategories = categories.filter((category) => category.is_active && !budgets.some((budget) => budget.category_id === category.id));

  return <div className="mx-auto max-w-7xl space-y-6 pb-8">
    {toast && <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
      <span className="flex items-center gap-2"><CheckCircle2 size={18} />{toast}</span>
      <button type="button" onClick={clearToast} aria-label="Cerrar notificación"><X size={16} /></button>
    </div>}

    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-[10px] font-bold tracking-[.22em] text-emerald-400">MIPISTIYO</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-white">Presupuestos</h1>
        <p className="mt-2 text-sm text-slate-400">Planificá tus gastos y seguí tus límites mensuales.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/90 p-1">
          {previousMonth.startsWith("20") ? <Link href={`/dashboard/presupuestos?month=${previousMonth}`}
            aria-label="Mes anterior" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><ChevronLeft size={17} /></Link>
            : <span className="p-2 text-slate-700"><ChevronLeft size={17} /></span>}
          <span className="min-w-36 px-2 text-center text-sm font-semibold capitalize text-white">{monthLabel}</span>
          {nextMonth.startsWith("20") ? <Link href={`/dashboard/presupuestos?month=${nextMonth}`}
            aria-label="Mes siguiente" className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><ChevronRight size={17} /></Link>
            : <span className="p-2 text-slate-700"><ChevronRight size={17} /></span>}
        </div>
        <button type="button" onClick={() => setDialog({ kind: "CREATE" })} className={buttonPrimary}>
          <Plus size={17} /> Nuevo presupuesto
        </button>
      </div>
    </div>

    {/* Indicadores generales. No sumamos el presupuesto global con los límites por categoría. */}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className={card}>
        <div className="flex items-center justify-between text-sm text-slate-400"><span>Gasto del mes</span><Wallet size={18} className="text-rose-400" /></div>
        <p className="mt-4 text-2xl font-bold tabular-nums text-white">{money(totalSpent)}</p>
        <p className="mt-1 text-xs text-slate-500">Gastos normales + históricos</p>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between text-sm text-slate-400"><span>Límite general</span><PiggyBank size={18} className="text-emerald-400" /></div>
        <p className="mt-4 text-2xl font-bold tabular-nums text-white">{overall ? money(overall.amount) : "Sin definir"}</p>
        <p className="mt-1 text-xs text-slate-500">Independiente de los límites por categoría</p>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between text-sm text-slate-400"><span>Restante general</span><ArrowRight size={18} className="text-slate-400" /></div>
        <p className={`mt-4 text-2xl font-bold tabular-nums ${remaining !== null && remaining < 0 ? "text-rose-400" : "text-white"}`}>
          {remaining === null ? "—" : money(remaining)}
        </p>
        <p className="mt-1 text-xs text-slate-500">Negativo indica exceso del límite</p>
      </div>
      <div className={card}>
        <div className="flex items-center justify-between text-sm text-slate-400"><span>Límites por categoría</span><ShieldAlert size={18} className="text-amber-400" /></div>
        <p className="mt-4 text-2xl font-bold tabular-nums text-white">{money(assigned)}</p>
        <p className="mt-1 text-xs text-slate-500">{categoriesBudgets.length} categorías · {overLimit} en o sobre el límite</p>
      </div>
    </div>

    {overall ? <section className={card}>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Presupuesto general</h2>
          <p className="mt-1 text-sm text-slate-400">Todos los gastos del mes, independientemente de la categoría.</p>
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => setDialog({ kind: "EDIT", budget: overall })}
            aria-label="Editar presupuesto general" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><Edit3 size={17} /></button>
          <button type="button" onClick={() => setDialog({ kind: "DELETE", budget: overall })}
            aria-label="Eliminar presupuesto general" className="rounded-lg p-2 text-slate-400 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={17} /></button>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div><p className="text-xs text-slate-400">Utilizado</p><p className="text-2xl font-semibold tabular-nums text-white">{money(overallSpent)} <span className="text-sm font-normal text-slate-500">/ {money(overall.amount)}</span></p></div>
        <div className={`text-sm font-semibold ${statusFor(overall.amount, overallSpent).color}`}>
          {overall.amount >= overallSpent ? `${money(overall.amount - overallSpent)} disponibles` : `${money(overallSpent - overall.amount)} excedidos`}
        </div>
      </div>
      <Progress amount={overall.amount} spent={overallSpent} />
    </section> : <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-5">
      <div className="flex items-start gap-3"><PiggyBank className="mt-1 text-emerald-400" size={21} />
        <div><h2 className="font-semibold text-white">Configurá un presupuesto general</h2>
          <p className="mt-1 text-sm text-slate-400">Opcional: un límite para todos los gastos del mes.</p>
        </div></div>
      <button type="button" onClick={() => setDialog({ kind: "CREATE" })} className={buttonSecondary}><Plus size={16} /> Configurar</button>
    </section>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold text-white">Límites por categoría</h2>
        <p className="mt-1 text-xs text-slate-400">Los presupuestos se aplican solo al mes seleccionado.</p>
      </div>
      <CopyPrevious monthStart={monthStart} count={copyableCount} onSuccess={onSuccess} />
    </div>

    {categoriesBudgets.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-900/40 p-8 text-center">
      <PiggyBank size={30} className="mx-auto text-emerald-400" />
      <h3 className="mt-3 font-semibold text-white">Todavía no hay límites por categoría</h3>
      <p className="mt-2 text-sm text-slate-400">Podés crear límites para alimentación, transporte, educación y más.</p>
      <button type="button" onClick={() => setDialog({ kind: "CREATE" })} className={`${buttonPrimary} mt-4`}><Plus size={17} /> Crear presupuesto</button>
    </div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {categoriesBudgets.map((budget) => {
        const spent = budget.spent;
        const remainingByCategory = budget.amount - spent;
        const state = statusFor(budget.amount, spent);
        return <article key={budget.id} className={`${card} flex flex-col gap-4`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: budget.color ?? "#10b981" }} />
              <div className="min-w-0"><h3 className="truncate font-semibold text-white">{budget.name}</h3>
                {!budget.is_active && <p className="text-xs text-amber-400">Categoría archivada</p>}
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button type="button" aria-label={`Editar presupuesto de ${budget.name}`}
                onClick={() => setDialog({ kind: "EDIT", budget })}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><Edit3 size={16} /></button>
              <button type="button" aria-label={`Eliminar presupuesto de ${budget.name}`}
                onClick={() => setDialog({ kind: "DELETE", budget })}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-rose-500/10 hover:text-rose-400"><Trash2 size={16} /></button>
            </div>
          </div>
          <div><p className="text-xl font-bold tabular-nums text-white">{money(spent)} <span className="text-sm font-normal text-slate-500">/ {money(budget.amount)}</span></p>
            <p className={`mt-1 text-xs ${remainingByCategory < 0 ? "text-rose-400" : "text-slate-400"}`}>
              {remainingByCategory >= 0 ? `${money(remainingByCategory)} disponibles` : `${money(-remainingByCategory)} por encima del límite`}
            </p>
          </div>
          <div className="mt-auto"><Progress amount={budget.amount} spent={spent} /></div>
          {spent >= budget.amount && <p className={`flex items-center gap-1 rounded-lg px-2.5 py-2 text-xs ${state.chip}`}>
            <AlertCircle size={15} /> Revisá este presupuesto: alcanzó o superó el límite.
          </p>}
        </article>;
      })}
    </div>}

    {unbudgeted.length > 0 && <section className={card}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Gastos sin presupuesto</h2>
          <p className="mt-1 text-sm text-slate-400">Hubo gastos en estas categorías, pero no tienen límite propio.</p></div>
        <span className="rounded-lg bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">{unbudgeted.length} categorías</span>
      </div>
      <div className="divide-y divide-slate-800">
        {unbudgeted.map((row) => <div key={row.category_id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: row.color ?? "#64748b" }} />
            <span className="truncate text-sm text-slate-200">{row.name}</span></div>
          <div className="flex items-center gap-3"><strong className="tabular-nums text-sm text-white">{money(row.spent)}</strong>
            {unusedCategories.some((category) => category.id === row.category_id) && <button type="button" className="rounded-lg p-2 text-emerald-400 hover:bg-emerald-500/10"
              aria-label={`Crear presupuesto para ${row.name}`}
              onClick={() => setDialog({ kind: "CREATE", initialCategoryId: row.category_id })}><Plus size={17} /></button>}
          </div>
        </div>)}
      </div>
    </section>}

    <div className="flex items-start gap-2 text-xs leading-relaxed text-slate-500">
      <AlertCircle size={16} className="mt-0.5 shrink-0" />
      <p>Los gastos históricos ya incluidos en saldos iniciales participan en el mes de su fecha real, pero no alteran el dinero de tus cuentas. Si todavía no registraste todas las operaciones históricas, las cifras de esos meses serán parciales. Los presupuestos general y por categoría son límites independientes, no se suman para calcular tus gastos.</p>
    </div>
    <Link href="/dashboard" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-emerald-400"><ArrowLeft size={16} /> Volver al Dashboard <ArrowRight size={14} /></Link>

    {dialog && <Modal onClose={close} title={dialog.kind === "CREATE" ? "Nuevo presupuesto" : dialog.kind === "EDIT" ? "Editar presupuesto" : "Eliminar presupuesto"}>
      {dialog.kind === "DELETE" ? <DeleteForm budget={dialog.budget} monthStart={monthStart} onClose={close} onSuccess={onSuccess} />
        : <BudgetForm key={dialog.kind === "EDIT" ? dialog.budget.id : `create-${dialog.initialCategoryId ?? "general"}`}
          monthStart={monthStart} categories={categories} budgets={budgets}
          initialCategoryId={dialog.kind === "CREATE" ? dialog.initialCategoryId : undefined}
          editing={dialog.kind === "EDIT" ? dialog.budget : undefined}
          onClose={close} onSuccess={onSuccess} />}
    </Modal>}
  </div>;
}
