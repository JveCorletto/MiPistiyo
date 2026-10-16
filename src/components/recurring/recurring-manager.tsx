"use client";

import { useActionState, useCallback, useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { DatePicker } from "@/components/ui/date-picker";
import { useRouter } from "next/navigation";
import {
  AlertCircle, ArrowDownLeft, ArrowUpRight, CalendarClock, CheckCircle2,
  Clock, CreditCard, Edit3, History, Landmark, Pause, Play, Plus,
  RefreshCw, SkipForward, SquareCheckBig, StopCircle, X,
} from "lucide-react";
import {
  changeRecurringStatus, confirmOccurrence, generateUpcoming,
  saveRecurring, skipOccurrence, type RecurringActionState,
} from "@/app/(private)/dashboard/recurrentes/actions";

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
export type RuleStatus = "ACTIVE" | "PAUSED" | "ENDED";
export type CategoryOption = { id: string; name: string; kind: "INCOME" | "EXPENSE"; is_active: boolean };
export type SourceOption = { id: string; name: string; type: "ACCOUNT" | "CARD"; active: boolean };
export type RecurringRule = {
  id: string; name: string; kind: "INCOME" | "EXPENSE";
  category_id: string; amount: number;
  account_id: string | null; card_id: string | null;
  frequency: Frequency; anchor_day: number | null; next_on: string;
  status: RuleStatus; notes: string | null;
  category_name: string; source_name: string;
};
export type RecurringOccurrence = {
  id: string; recurring_id: string; scheduled_on: string;
  status: "PENDING" | "CONFIRMED" | "SKIPPED";
  rule: RecurringRule;
};
export type DebtReminder = {
  id: string; kind: "CARD" | "LOAN"; name: string;
  due_on: string; amount: number | null; href: string;
};

type Props = {
  today: string;
  horizon: string;
  generationError: string | null;
  rules: RecurringRule[];
  pending: RecurringOccurrence[];
  recent: RecurringOccurrence[];
  categories: CategoryOption[];
  sources: SourceOption[];
  reminders: DebtReminder[];
};

type Dialog = { type: "CREATE" } | { type: "EDIT"; rule: RecurringRule };
const initialState: RecurringActionState = { error: null, success: null };
const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const frequencyLabel: Record<Frequency, string> = {
  DAILY: "Diario", WEEKLY: "Semanal", MONTHLY: "Mensual", YEARLY: "Anual",
};
const statusLabel: Record<RuleStatus, string> = {
  ACTIVE: "Activa", PAUSED: "Pausada", ENDED: "Finalizada",
};
const fieldClass = "mt-1 w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30";
const btnPrimary = "inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60";
const btnSecondary = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 hover:border-slate-500 hover:bg-slate-800 disabled:opacity-50";
const panel = "rounded-2xl border border-slate-800 bg-slate-900/85 p-4 sm:p-5";

function dateLabel(ymd: string) {
  const date = new Date(`${ymd}T12:00:00.000Z`);
  return new Intl.DateTimeFormat("es-SV", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }).format(date);
}
function dateDiff(today: string, ymd: string) {
  return Math.round((new Date(`${ymd}T00:00:00Z`).getTime() - new Date(`${today}T00:00:00Z`).getTime()) / 86400000);
}
function MiniStatus({ error, success }: RecurringActionState) {
  if (!error && !success) return null;
  return <p role={error ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ${error
    ? "border border-rose-500/30 bg-rose-500/10 text-rose-300"
    : "border border-emerald-500/20 bg-emerald-500/10 text-emerald-300"}`}>
    {error ?? success}
  </p>;
}
function SubmitButton({ children, variant = "primary", disabled = false }: {
  children: ReactNode; variant?: "primary" | "secondary" | "danger"; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  const cls = variant === "primary" ? btnPrimary : variant === "danger"
    ? "inline-flex items-center justify-center gap-2 rounded-xl bg-rose-500/15 px-3 py-2 text-sm font-semibold text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
    : btnSecondary;
  return <button type="submit" disabled={pending || disabled} className={cls}>
    {pending ? "Procesando..." : children}
  </button>;
}
function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-5"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title}
      className="max-h-[92vh] w-full max-w-xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-white">{title}</h2>
        <button type="button" aria-label="Cerrar" onClick={onClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={19} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function RuleForm({ dialog, categories, sources, today, firstPendingOn, onSaved }: {
  dialog: Dialog; categories: CategoryOption[]; sources: SourceOption[];
  today: string; firstPendingOn: string | null; onSaved: (message: string) => void;
}) {
  const isEdit = dialog.type === "EDIT";
  const rule = dialog.type === "EDIT" ? dialog.rule : null;
  const [state, formAction] = useActionState(saveRecurring, initialState);
  const [kind, setKind] = useState<"EXPENSE" | "INCOME">(rule?.kind ?? "EXPENSE");
  const [sourceType, setSourceType] = useState<"ACCOUNT" | "CARD">(rule?.card_id ? "CARD" : "ACCOUNT");
  const [sourceId, setSourceId] = useState(rule?.card_id ?? rule?.account_id ?? "");
  const [categoryId, setCategoryId] = useState(rule?.category_id ?? "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "MONTHLY");
  const [editSchedule, setEditSchedule] = useState(false);
  useEffect(() => { if (state.success) onSaved(state.success); }, [state.success, onSaved]);

  const availableCategories = categories.filter((item) => item.kind === kind && item.is_active);
  const availableSources = sources.filter((item) => item.active && item.type === sourceType);

  return <form action={formAction} className="space-y-4">
    <input type="hidden" name="rule_id" value={rule?.id ?? ""} />
    {isEdit ? <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">
      Podés editar el nombre, importe y notas. También podés corregir la fecha o frecuencia.
      Al reprogramar, solo se reemplazan vencimientos <strong>pendientes</strong>; los confirmados y omitidos no se modifican.
    </div> : <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3 text-sm text-slate-300">
      Programar no descuenta dinero. Confirmar cada vencimiento sí registra un movimiento real.
    </div>}
    {!isEdit && <>
      <input type="hidden" name="kind" value={kind}/>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={() => { setKind("EXPENSE"); setCategoryId(""); }}
          className={`rounded-xl border px-3 py-2 text-sm font-medium ${kind === "EXPENSE" ? "border-rose-500/50 bg-rose-500/10 text-rose-200" : "border-slate-700 text-slate-400"}`}>
          <ArrowUpRight size={15} className="mr-1 inline"/> Gasto
        </button>
        <button type="button" onClick={() => { setKind("INCOME"); setCategoryId(""); setSourceType("ACCOUNT"); setSourceId(""); }}
          className={`rounded-xl border px-3 py-2 text-sm font-medium ${kind === "INCOME" ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" : "border-slate-700 text-slate-400"}`}>
          <ArrowDownLeft size={15} className="mr-1 inline"/> Ingreso
        </button>
      </div>
    </>}
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="block text-sm text-slate-300">Nombre
        <input className={fieldClass} type="text" name="name" required maxLength={120} placeholder="Ej.: Internet de casa" defaultValue={rule?.name ?? ""} />
      </label>
      <label className="block text-sm text-slate-300">Importe (USD)
        <input className={fieldClass} type="number" name="amount" min="0.01" max="999999999999.99" step="0.01" required placeholder="25.00" defaultValue={rule?.amount ?? ""} />
      </label>
    </div>
    {!isEdit && <>
      <label className="block text-sm text-slate-300">Categoría
        <select className={fieldClass} name="category_id" required value={categoryId} onChange={(event) => setCategoryId(event.target.value)}>
          <option value="">Seleccioná una categoría</option>
          {availableCategories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </label>
      <input type="hidden" name="source_type" value={sourceType} />
      <div>
        <span className="text-sm text-slate-300">Origen del movimiento</span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button type="button" onClick={() => { setSourceType("ACCOUNT"); setSourceId(""); }}
            className={`rounded-xl border px-3 py-2 text-sm ${sourceType === "ACCOUNT" ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-400"}`}>
            Cuenta
          </button>
          <button type="button" disabled={kind === "INCOME"} onClick={() => { setSourceType("CARD"); setSourceId(""); }}
            className={`rounded-xl border px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40 ${sourceType === "CARD" ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-slate-700 text-slate-400"}`}>
            Tarjeta
          </button>
        </div>
        <select className={fieldClass} name="source_id" value={sourceId} required onChange={(event) => setSourceId(event.target.value)}>
          <option value="">Seleccioná {sourceType === "ACCOUNT" ? "una cuenta" : "una tarjeta"}</option>
          {availableSources.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
      </div>
    </>} 
    {isEdit && <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-200">
      <input type="checkbox" checked={editSchedule} onChange={(event) => setEditSchedule(event.target.checked)}
        className="h-4 w-4 accent-emerald-500"/>
      Cambiar fecha o frecuencia de la recurrencia
    </label>}
    {isEdit && <input type="hidden" name="reschedule" value={editSchedule ? "true" : "false"}/>}
    {(!isEdit || editSchedule) && <div className="space-y-2">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-sm text-slate-300">Frecuencia
          <select className={fieldClass} name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value as Frequency)}>
            {Object.entries(frequencyLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <div className="min-w-0 text-sm text-slate-300">
          <span className="block mb-1">{isEdit ? "Nueva fecha de vencimiento" : "Primer vencimiento"}</span>
          <DatePicker name="next_on" defaultValue={isEdit ? (firstPendingOn ?? rule?.next_on ?? today) : today}/>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-slate-500">
        En pagos mensuales o anuales, el día seleccionado será la referencia; si un mes no lo tiene, se utiliza su último día.
        {isEdit ? " Al guardar se reemplazarán los vencimientos pendientes anteriores. Esto no cobra ni devuelve dinero." : ""}
      </p>
    </div>}

    <label className="block text-sm text-slate-300">Notas opcionales
      <textarea className={`${fieldClass} min-h-20 resize-y`} name="notes" maxLength={1000} rows={2} placeholder="Detalles del pago..." defaultValue={rule?.notes ?? ""}/>
    </label>
    <MiniStatus {...state}/>
    <div className="flex justify-end pt-1"><SubmitButton>{isEdit ? "Guardar cambios" : "Crear recurrencia"}</SubmitButton></div>
  </form>;
}

function RuleStatusForm({ rule, onCompleted }: { rule: RecurringRule; onCompleted: (message: string) => void }) {
  const [state, formAction] = useActionState(changeRecurringStatus, initialState);
  useEffect(() => { if (state.success) onCompleted(state.success); }, [state.success, onCompleted]);
  if (rule.status === "ENDED") return null;
  return <form action={formAction} className="flex flex-wrap items-center gap-2">
    <input type="hidden" name="rule_id" value={rule.id}/>
    <button type="submit" name="status" value={rule.status === "ACTIVE" ? "PAUSED" : "ACTIVE"}
      className={btnSecondary} title={rule.status === "ACTIVE" ? "Pausar" : "Reanudar"}>
      {rule.status === "ACTIVE" ? <Pause size={15}/> : <Play size={15}/>}
      {rule.status === "ACTIVE" ? "Pausar" : "Reanudar"}
    </button>
    <button type="submit" name="status" value="ENDED" className={btnSecondary}
      onClick={(event) => { if (!window.confirm("¿Finalizar esta recurrencia? No se podrá reactivar. Los pendientes existentes no se eliminarán.")) event.preventDefault(); }}>
      <StopCircle size={15}/> Finalizar
    </button>
    {state.error && <div className="basis-full"><MiniStatus {...state}/></div>}
  </form>;
}

function OccurrenceActions({ occurrence, today, onCompleted }: {
  occurrence: RecurringOccurrence; today: string; onCompleted: (message: string) => void;
}) {
  const [confirmed, confirmAction] = useActionState(confirmOccurrence, initialState);
  const [skipped, skipAction] = useActionState(skipOccurrence, initialState);
  useEffect(() => { if (confirmed.success) onCompleted(confirmed.success); }, [confirmed.success, onCompleted]);
  useEffect(() => { if (skipped.success) onCompleted(skipped.success); }, [skipped.success, onCompleted]);
  const ready = occurrence.scheduled_on <= today && occurrence.rule.status !== "ENDED";
  return <div className="flex flex-col gap-2 sm:items-end">
    <div className="flex flex-wrap gap-2">
      {ready && <form action={confirmAction}>
        <input type="hidden" name="occurrence_id" value={occurrence.id}/>
        <SubmitButton><SquareCheckBig size={15}/> Confirmar pago</SubmitButton>
      </form>}
      <form action={skipAction}>
        <input type="hidden" name="occurrence_id" value={occurrence.id}/>
        <SubmitButton variant="secondary"><SkipForward size={15}/> Omitir</SubmitButton>
      </form>
    </div>
    {(confirmed.error || skipped.error) && <MiniStatus error={confirmed.error ?? skipped.error} success={null}/>}
  </div>;
}

function RefreshForm({ onCompleted }: { onCompleted: (message: string) => void }) {
  const [state, formAction] = useActionState(generateUpcoming, initialState);
  useEffect(() => { if (state.success) onCompleted(state.success); }, [state.success, onCompleted]);
  return <div className="flex flex-col items-start gap-2">
    <form action={formAction}><SubmitButton variant="secondary"><RefreshCw size={15}/> Actualizar pendientes</SubmitButton></form>
    {state.error && <MiniStatus {...state}/>}
  </div>;
}

export function RecurringManager({ today, horizon, generationError, rules, pending, recent, categories, sources, reminders }: Props) {
  const router = useRouter();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | RuleStatus>("ALL");
  const onCompleted = useCallback((text: string) => { setMessage(text); setDialog(null); router.refresh(); }, [router]);
  const active = rules.filter((row) => row.status === "ACTIVE").length;
  const overdue = pending.filter((item) => item.scheduled_on < today).length;
  const dueNow = pending.filter((item) => item.scheduled_on <= today);
  const totalDue = dueNow.filter((item) => item.rule.kind === "EXPENSE")
    .reduce((sum, row) => sum + row.rule.amount, 0);
  const visibleRules = rules.filter((rule) => statusFilter === "ALL" || rule.status === statusFilter);

  return <div className="space-y-6 pb-8">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <p className="text-xs font-semibold tracking-[0.2em] text-emerald-400">MIPISTIYO</p>
        <h1 className="mt-1 text-3xl font-bold text-white">Pagos recurrentes</h1>
        <p className="mt-1 text-sm text-slate-400">Planificá gastos e ingresos periódicos sin contabilizarlos antes de tiempo.</p>
      </div>
      <button className={btnPrimary} onClick={() => setDialog({ type: "CREATE" })}>
        <Plus size={17}/> Nueva recurrencia
      </button>
    </header>

    {message && <div role="status" className="flex items-center justify-between gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3 text-sm text-emerald-200">
      <span><CheckCircle2 size={16} className="mr-2 inline"/>{message}</span>
      <button type="button" aria-label="Cerrar aviso" onClick={() => setMessage(null)}><X size={16}/></button>
    </div>}
    {generationError && <div role="alert" className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
      <AlertCircle size={18} className="mt-0.5 shrink-0"/>
      <div>No se pudieron generar todos los próximos vencimientos: {generationError}. Revisá las reglas antiguas y volvé a actualizar.</div>
    </div>}

    <div className="grid gap-3 sm:grid-cols-3">
      <Summary title="Recurrencias activas" value={String(active)} hint="Reglas configuradas" icon={<RefreshCw size={18} className="text-emerald-400"/>}/>
      <Summary title="Por atender" value={String(dueNow.length)} hint={`${overdue} vencido(s)`} icon={<Clock size={18} className="text-amber-400"/>}/>
      <Summary title="Gastos pendientes" value={money(totalDue)} hint="Vencidos o con fecha de hoy" icon={<CalendarClock size={18} className="text-rose-400"/>}/>
    </div>

    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><CalendarClock className="text-emerald-400" size={20}/> Vencimientos pendientes</h2>
          <p className="mt-1 text-xs text-slate-400">Desde vencidos hasta {dateLabel(horizon)}. Los próximos todavía no pueden confirmarse.</p>
        </div>
        <RefreshForm onCompleted={onCompleted}/>
      </div>
      {pending.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-7 text-center text-sm text-slate-400">No hay vencimientos pendientes para este período.</p>
        : <div className="space-y-3">{pending.map((item) => {
          const diff = dateDiff(today, item.scheduled_on);
          const indicator = diff < 0 ? "Vencido" : diff === 0 ? "Vence hoy" : `En ${diff} día(s)`;
          return <div key={item.id} className="flex flex-col justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4 lg:flex-row lg:items-center">
            <div className="flex items-start gap-3">
              <span className={`rounded-lg p-2 ${item.rule.kind === "EXPENSE" ? "bg-rose-500/10 text-rose-400" : "bg-emerald-500/10 text-emerald-400"}`}>
                {item.rule.kind === "EXPENSE" ? <ArrowUpRight size={19}/> : <ArrowDownLeft size={19}/>}
              </span>
              <div className="min-w-0">
                <p className="font-semibold text-white">{item.rule.name} <span className="ml-1 text-sm tabular-nums text-slate-200">{money(item.rule.amount)}</span></p>
                <p className="mt-1 text-xs text-slate-400">{item.rule.category_name} · {item.rule.source_name} · {dateLabel(item.scheduled_on)}</p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className={diff < 0 ? "text-rose-400" : diff === 0 ? "text-amber-400" : "text-slate-400"}>{indicator}</span>
                  {item.rule.status !== "ACTIVE" && <span className="rounded bg-slate-800 px-2 py-0.5 text-slate-300">Regla {statusLabel[item.rule.status].toLowerCase()}</span>}
                </div>
              </div>
            </div>
            <OccurrenceActions occurrence={item} today={today} onCompleted={onCompleted}/>
          </div>;
        })}</div>}
    </section>

    <section className={panel}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-semibold text-white">Mis recurrencias</h2>
          <p className="mt-1 text-xs text-slate-400">Pausá, reanudá, finalizá o actualizá el importe de una regla.</p></div>
        <select aria-label="Filtrar recurrencias" className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
          <option value="ALL">Todas</option><option value="ACTIVE">Activas</option><option value="PAUSED">Pausadas</option><option value="ENDED">Finalizadas</option>
        </select>
      </div>
      {visibleRules.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-7 text-center text-sm text-slate-400">No hay recurrencias para mostrar.</p>
        : <div className="grid gap-3 xl:grid-cols-2">{visibleRules.map((rule) => <article key={rule.id} className="rounded-xl border border-slate-800 bg-slate-950/45 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-white">{rule.name}</h3>
                <span className={`rounded-md px-2 py-0.5 text-xs ${rule.status === "ACTIVE" ? "bg-emerald-500/10 text-emerald-300" : rule.status === "PAUSED" ? "bg-amber-500/10 text-amber-300" : "bg-slate-800 text-slate-400"}`}>{statusLabel[rule.status]}</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">{rule.category_name} · {rule.source_name}</p>
              <p className="mt-2 text-xs text-slate-400">{frequencyLabel[rule.frequency]} · Próxima generación: {dateLabel(rule.next_on)}</p>
            </div>
            <p className={`shrink-0 text-lg font-bold tabular-nums ${rule.kind === "INCOME" ? "text-emerald-400" : "text-white"}`}>{money(rule.amount)}</p>
          </div>
          {rule.notes && <p className="mt-2 line-clamp-2 text-xs text-slate-500">{rule.notes}</p>}
          {rule.status !== "ENDED" && <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-3">
            <button onClick={() => setDialog({ type: "EDIT", rule })} className={btnSecondary}><Edit3 size={15}/> Editar</button>
            <RuleStatusForm rule={rule} onCompleted={onCompleted}/>
          </div>}
        </article>)}</div>}
    </section>

    <div className="grid gap-4 xl:grid-cols-2">
      <section className={panel}>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><Landmark size={19} className="text-amber-400"/> Vencimientos de tarjetas y préstamos</h2>
        <p className="mt-1 text-xs leading-relaxed text-slate-400">Recordatorios orientativos según el día habitual configurado. No se marcan pagados automáticamente ni representan necesariamente el estado de cuenta bancario.</p>
        {reminders.length === 0 ? <p className="mt-5 text-sm text-slate-500">No tenés fechas de pago configuradas para deudas activas.</p> :
          <div className="mt-4 space-y-2">{reminders.map((reminder) => <div key={`${reminder.kind}-${reminder.id}`} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-3">
            <span className="rounded-lg bg-slate-800 p-2 text-slate-300">{reminder.kind === "CARD" ? <CreditCard size={17}/> : <Landmark size={17}/>}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">{reminder.name}</p>
              <p className="text-xs text-slate-400">Día estimado: {dateLabel(reminder.due_on)}{reminder.amount !== null ? ` · Cuota estimada ${money(reminder.amount)}` : ""}</p>
            </div>
            <Link href={reminder.href} className="text-xs font-semibold text-emerald-400 hover:text-emerald-300">Ir a pagar →</Link>
          </div>)}</div>}
      </section>
      <section className={panel}>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white"><History size={19} className="text-sky-400"/> Recurrencias procesadas</h2>
        <p className="mt-1 text-xs text-slate-400">Últimas 20 confirmaciones y omisiones, sin duplicar operaciones.</p>
        {recent.length === 0 ? <p className="mt-5 text-sm text-slate-500">Todavía no has confirmado ni omitido vencimientos.</p> :
          <div className="mt-4 divide-y divide-slate-800">{recent.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 py-2.5">
            <div><p className="text-sm text-white">{item.rule.name}</p><p className="text-xs text-slate-500">{dateLabel(item.scheduled_on)}</p></div>
            <span className={`text-xs ${item.status === "CONFIRMED" ? "text-emerald-400" : "text-amber-400"}`}>
              {item.status === "CONFIRMED" ? "Confirmado" : "Omitido"}
            </span>
          </div>)}</div>}
      </section>
    </div>
    <div className="rounded-xl border border-slate-800 p-3 text-xs leading-relaxed text-slate-400">
      Importante: una recurrencia es solo un recordatorio hasta que la confirmás. Si ya registraste el gasto manualmente, marcá el vencimiento como <strong>Omitido</strong> para evitar duplicarlo. Al confirmar, la fecha contable será la programada. Si pagaste en otra fecha, registrá el movimiento normal con la fecha real y omití este vencimiento. Los pagos de capital de tarjetas y préstamos se realizan en sus módulos, no como gastos recurrentes.
    </div>
    {dialog && <Modal title={dialog.type === "CREATE" ? "Nueva recurrencia" : "Editar recurrencia"} onClose={() => setDialog(null)}>
      <RuleForm key={dialog.type === "CREATE" ? "new" : dialog.rule.id}
        dialog={dialog} categories={categories} sources={sources} today={today}
        firstPendingOn={dialog.type === "EDIT" ? pending.find((item) => item.recurring_id === dialog.rule.id)?.scheduled_on ?? null : null}
        onSaved={onCompleted}/>
    </Modal>}
  </div>;
}

function Summary({ title, value, hint, icon }: { title: string; value: string; hint: string; icon: ReactNode }) {
  return <div className={panel}>
    <div className="flex items-center justify-between gap-2"><span className="text-sm text-sky-300">{title}</span><span className="rounded-lg bg-slate-950/60 p-2">{icon}</span></div>
    <p className="mt-3 text-2xl font-bold tabular-nums text-white">{value}</p><p className="mt-1 text-xs text-slate-500">{hint}</p>
  </div>;
}
