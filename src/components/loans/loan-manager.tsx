"use client";

import {
  useActionState, useCallback, useEffect, useState, type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
  Archive, ArrowDownToLine, CalendarDays, CheckCircle2, CreditCard,
  History, Landmark, Pencil, Plus, RotateCcw, X,
} from "lucide-react";
import {
  createLoan, updateLoan, toggleLoan, disburseLoan, payLoan,
  type LoanActionState,
} from "@/app/(private)/dashboard/prestamos/actions";

type Loan = {
  id: string;
  name: string;
  lender: string;
  original_amount: number;
  opening_debt: number;
  balance_mode: string;
  started_on: string;
  annual_interest_rate: number | null;
  expected_installment: number | null;
  due_day: number | null;
  is_active: boolean;
  notes: string | null;
  current_debt: number;
};

type Account = { id: string; name: string; current_balance: number };
type Category = { id: string; name: string };
type Payment = {
  id: string;
  loan_id: string;
  account_name: string;
  principal: number;
  interest: number;
  fees: number;
  effective_on: string;
  is_reversed: boolean;
};

type Props = {
  loans: Loan[];
  accounts: Account[];
  categories: Category[];
  payments: Payment[];
};

type ModalState =
  | { type: "create" }
  | { type: "edit" | "disbursement" | "payment"; loanId: string }
  | null;

const initialState: LoanActionState = { error: null, success: null };
const inputClass = "w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30";
const labelClass = "mb-1.5 block text-xs font-medium text-slate-300";
const mutedButton = "rounded-xl border border-slate-700 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40";
const greenButton = "rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50";

const money = (v: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(v);

function todaySV(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/El_Salvador",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function SubmitButton({ children }: { children: ReactNode }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={greenButton}>
    {pending ? "Guardando..." : children}
  </button>;
}

function FormError({ message }: { message: string | null }) {
  return message ? <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{message}</p> : null;
}

function Modal({ title, subtitle, children, onClose }: {
  title: string; subtitle?: string; children: ReactNode; onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-5" onMouseDown={(e) => {
    if (e.currentTarget === e.target) onClose();
  }}>
    <div role="dialog" aria-modal="true" aria-label={title}
      className="max-h-[92vh] w-full max-w-xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">{title}</h2>
          {subtitle && <p className="mt-1 text-sm text-slate-400">{subtitle}</p>}
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X size={20} /></button>
      </div>
      {children}
    </div>
  </div>;
}

function FormActions({ onClose, submitLabel }: { onClose: () => void; submitLabel: string }) {
  return <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
    <button type="button" className={mutedButton} onClick={onClose}>Cancelar</button>
    <SubmitButton>{submitLabel}</SubmitButton>
  </div>;
}

function DateField({ name, defaultValue }: { name: string; defaultValue: string }) {
  return <label className="block min-w-0">
    <span className={labelClass}>Fecha</span>
    <input className={inputClass} name={name} type="date" defaultValue={defaultValue} required />
  </label>;
}

function LoanFields({ loan, edit }: { loan?: Loan; edit?: boolean }) {
  const [mode, setMode] = useState<"OPENING_BALANCE" | "TRACKED_DISBURSEMENTS">(
    loan?.balance_mode === "OPENING_BALANCE" ? "OPENING_BALANCE" : "TRACKED_DISBURSEMENTS",
  );
  return <div className="space-y-4">
    {edit && <input type="hidden" name="loan_id" value={loan?.id} />}
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block min-w-0">
        <span className={labelClass}>Nombre del préstamo *</span>
        <input className={inputClass} name="name" required maxLength={120}
          placeholder="Ej. Crédito personal" defaultValue={loan?.name ?? ""} />
      </label>
      <label className="block min-w-0">
        <span className={labelClass}>Acreedor / banco *</span>
        <input className={inputClass} name="lender" required maxLength={150}
          placeholder="Ej. Banco Agrícola o familiar" defaultValue={loan?.lender ?? ""} />
      </label>
    </div>
    {!edit && <>
      <fieldset className="space-y-2 rounded-xl border border-slate-700 p-3">
        <legend className="px-2 text-sm font-medium text-slate-200">Tipo de registro</legend>
        <label className="flex cursor-pointer gap-2 text-sm text-slate-200">
          <input type="radio" name="balance_mode" value="OPENING_BALANCE"
            checked={mode === "OPENING_BALANCE"} onChange={() => setMode("OPENING_BALANCE")} className="accent-emerald-400" />
          Ya tengo este préstamo (deuda actual)
        </label>
        <label className="flex cursor-pointer gap-2 text-sm text-slate-200">
          <input type="radio" name="balance_mode" value="TRACKED_DISBURSEMENTS"
            checked={mode === "TRACKED_DISBURSEMENTS"} onChange={() => setMode("TRACKED_DISBURSEMENTS")} className="accent-emerald-400" />
          Préstamo nuevo (registraré el desembolso)
        </label>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className={labelClass}>Monto original del crédito *</span>
          <input className={inputClass} name="original_amount" type="number" required min="0.01" step="0.01" placeholder="0.00" />
        </label>
        {mode === "OPENING_BALANCE" && <label className="block min-w-0">
          <span className={labelClass}>Deuda pendiente actual *</span>
          <input className={inputClass} name="opening_debt" type="number" required min="0.01" step="0.01" placeholder="0.00" />
        </label>}
      </div>
      <DateField name="started_on" defaultValue={todaySV()} />
      <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
        {mode === "OPENING_BALANCE"
          ? "Se registra únicamente la deuda pendiente. No se agrega efectivo a ninguna cuenta. No ingresés pagos ya incluidos en este saldo inicial."
          : "La deuda comienza en $0. El dinero y la deuda aumentarán cuando registres el desembolso."}
      </p>
    </>}
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="block min-w-0">
        <span className={labelClass}>Interés anual % (opcional)</span>
        <input className={inputClass} name="annual_interest_rate" type="number" min="0" max="100" step="0.0001"
          defaultValue={loan?.annual_interest_rate ?? ""} placeholder="Ej. 12.5" />
      </label>
      <label className="block min-w-0">
        <span className={labelClass}>Cuota estimada (opcional)</span>
        <input className={inputClass} name="expected_installment" type="number" min="0.01" step="0.01"
          defaultValue={loan?.expected_installment ?? ""} placeholder="0.00" />
      </label>
      <label className="block min-w-0">
        <span className={labelClass}>Día de pago (opcional)</span>
        <input className={inputClass} name="due_day" type="number" min="1" max="31" step="1"
          defaultValue={loan?.due_day ?? ""} placeholder="Ej. 15" />
      </label>
    </div>
    <label className="block">
      <span className={labelClass}>Notas (opcional)</span>
      <textarea className={inputClass} name="notes" maxLength={1000} rows={2}
        placeholder="Detalles del crédito" defaultValue={loan?.notes ?? ""} />
    </label>
  </div>;
}

function CreateLoanForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: (message: string) => void }) {
  const [state, action] = useActionState(createLoan, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  return <form action={action} className="space-y-4">
    <LoanFields />
    <FormError message={state.error} />
    <FormActions onClose={onClose} submitLabel="Crear préstamo" />
  </form>;
}

function EditLoanForm({ loan, onClose, onSuccess }: {
  loan: Loan; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(updateLoan, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  return <form action={action} className="space-y-4">
    <LoanFields loan={loan} edit />
    <p className="rounded-lg bg-slate-800/60 p-3 text-xs text-slate-300">
      Por seguridad, el monto original, la deuda inicial y la modalidad contable no se editan aquí.
    </p>
    <FormError message={state.error} />
    <FormActions onClose={onClose} submitLabel="Guardar cambios" />
  </form>;
}

function AccountSelect({ accounts }: { accounts: Account[] }) {
  return <label className="block">
    <span className={labelClass}>Cuenta *</span>
    <select className={inputClass} name="account_id" defaultValue="" required>
      <option value="" disabled>Seleccioná una cuenta</option>
      {accounts.map((account) => <option key={account.id} value={account.id}>
        {account.name} · {money(account.current_balance)}
      </option>)}
    </select>
  </label>;
}

function OperationKey() {
  const [key, setKey] = useState("");
  useEffect(() => { setKey(crypto.randomUUID()); }, []);
  return <input type="hidden" name="idempotency_key" value={key} />;
}

function DisbursementForm({ loan, accounts, onClose, onSuccess }: {
  loan: Loan; accounts: Account[]; onClose: () => void; onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(disburseLoan, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="loan_id" value={loan.id} />
    <OperationKey />
    <p className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-300">
      El desembolso suma dinero a la cuenta seleccionada y aumenta la deuda del préstamo en el mismo monto. No es un ingreso salarial.
    </p>
    <AccountSelect accounts={accounts} />
    <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
      <label className="block">
        <span className={labelClass}>Monto recibido *</span>
        <input className={inputClass} type="number" name="amount" min="0.01" step="0.01" required placeholder="0.00" />
      </label>
      <DateField name="effective_on" defaultValue={todaySV()} />
    </div>
    <label className="block">
      <span className={labelClass}>Nota (opcional)</span>
      <input className={inputClass} name="note" maxLength={1000} placeholder="Desembolso inicial" />
    </label>
    <FormError message={state.error} />
    <FormActions onClose={onClose} submitLabel="Registrar desembolso" />
  </form>;
}

function PaymentForm({ loan, accounts, categories, onClose, onSuccess }: {
  loan: Loan; accounts: Account[]; categories: Category[]; onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(payLoan, initialState);
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("0");
  const [fees, setFees] = useState("0");
  const total = (Number(principal) || 0) + (Number(interest) || 0) + (Number(fees) || 0);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  return <form action={action} className="space-y-4">
    <input type="hidden" name="loan_id" value={loan.id} />
    <OperationKey />
    <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
      Registrá solo pagos que NO estén incluidos en la deuda inicial de MiPistiyo. La amortización disminuye deuda; intereses y comisiones son gastos.
    </p>
    <AccountSelect accounts={accounts} />
    <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
      <label className="block">
        <span className={labelClass}>Abono a capital</span>
        <input className={inputClass} type="number" name="principal" min="0" step="0.01" value={principal}
          onChange={(event) => setPrincipal(event.target.value)} placeholder="0.00" />
      </label>
      <label className="block">
        <span className={labelClass}>Intereses</span>
        <input className={inputClass} type="number" name="interest" min="0" step="0.01" value={interest}
          onChange={(event) => setInterest(event.target.value)} />
      </label>
      <label className="block">
        <span className={labelClass}>Comisiones</span>
        <input className={inputClass} type="number" name="fees" min="0" step="0.01" value={fees}
          onChange={(event) => setFees(event.target.value)} />
      </label>
    </div>
    {Number(interest) > 0 && <label className="block">
      <span className={labelClass}>Categoría de intereses *</span>
      <select className={inputClass} name="interest_category" defaultValue="" required>
        <option value="" disabled>Seleccioná categoría de gasto</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>}
    {Number(fees) > 0 && <label className="block">
      <span className={labelClass}>Categoría de comisiones *</span>
      <select className={inputClass} name="fee_category" defaultValue="" required>
        <option value="" disabled>Seleccioná categoría de gasto</option>
        {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>}
    <div className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-950/60 p-3">
      <span className="text-sm text-slate-300">Total a descontar de la cuenta</span>
      <strong className="text-lg text-white">{money(total)}</strong>
    </div>
    <p className="text-xs text-slate-400">Capital pendiente: {money(loan.current_debt)}. El abono a capital no puede superarlo.</p>
    <DateField name="effective_on" defaultValue={todaySV()} />
    <label className="block">
      <span className={labelClass}>Nota (opcional)</span>
      <input className={inputClass} name="note" maxLength={1000} placeholder="Pago de cuota mensual" />
    </label>
    <FormError message={state.error} />
    <FormActions onClose={onClose} submitLabel="Registrar pago" />
  </form>;
}

function ToggleLoanForm({ loan, onSuccess }: {
  loan: Loan; onSuccess: (message: string) => void;
}) {
  const [state, action] = useActionState(toggleLoan, initialState);
  useEffect(() => { if (state.success) onSuccess(state.success); }, [state.success, onSuccess]);
  const canArchive = !loan.is_active || loan.current_debt === 0;
  return <form action={action} className="space-y-1">
    <input type="hidden" name="loan_id" value={loan.id} />
    <button type="submit" disabled={!canArchive}
      title={!canArchive ? "Primero debés saldar la deuda" : loan.is_active ? "Archivar préstamo" : "Reactivar préstamo"}
      onClick={(event) => {
        if (loan.is_active && !window.confirm(`¿Archivar el préstamo «${loan.name}»?`)) {
          event.preventDefault();
        }
      }} className={`${mutedButton} inline-flex items-center gap-1.5`}>
      {loan.is_active ? <Archive size={15} /> : <RotateCcw size={15} />}
      {loan.is_active ? "Archivar" : "Reactivar"}
    </button>
    <FormError message={state.error} />
  </form>;
}

export function LoanManager({ loans, accounts, categories, payments }: Props) {
  const router = useRouter();
  const [modal, setModal] = useState<ModalState>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const onClose = useCallback(() => setModal(null), []);
  const onSuccess = useCallback((message: string) => {
    setModal(null);
    setNotice(message);
    router.refresh();
  }, [router]);

  const active = loans.filter((loan) => loan.is_active);
  const pendingTotal = loans.reduce((sum, loan) => sum + loan.current_debt, 0);
  const paidOff = loans.filter((loan) => loan.current_debt === 0).length;
  const modalLoan = modal && "loanId" in modal ? loans.find((loan) => loan.id === modal.loanId) : undefined;

  return <div className="space-y-6">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold">Préstamos</h1>
        <p className="mt-1 text-sm text-slate-400">Controlá tus créditos, desembolsos y abonos sin duplicar dinero.</p>
      </div>
      <button type="button" onClick={() => setModal({ type: "create" })} className={`${greenButton} inline-flex items-center gap-2`}>
        <Plus size={18} /> Nuevo préstamo
      </button>
    </div>

    {notice && <div role="status" className="flex items-start justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
      <span className="flex items-center gap-2"><CheckCircle2 size={18} />{notice}</span>
      <button aria-label="Cerrar notificación" onClick={() => setNotice(null)}><X size={18} /></button>
    </div>}

    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-400">Deuda total pendiente</p>
        <p className="mt-2 text-2xl font-bold text-white">{money(pendingTotal)}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-400">Préstamos activos</p>
        <p className="mt-2 text-2xl font-bold text-white">{active.length}</p>
      </div>
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-xs text-slate-400">Préstamos sin deuda</p>
        <p className="mt-2 text-2xl font-bold text-emerald-400">{paidOff}</p>
      </div>
    </div>

    {!loans.length && <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
      <Landmark className="mx-auto text-emerald-400" size={32} />
      <h2 className="mt-3 text-lg font-semibold">Todavía no tenés préstamos</h2>
      <p className="mt-1 text-sm text-slate-400">Registrá uno existente o creá un crédito nuevo.</p>
    </div>}

    <div className="grid gap-4 xl:grid-cols-2">
      {loans.map((loan) => {
        const loanPayments = payments.filter((payment) => payment.loan_id === loan.id).slice(0, 5);
        const utilization = Math.min(100, Math.max(0, loan.original_amount > 0 ? loan.current_debt / loan.original_amount * 100 : 0));
        return <article key={loan.id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><Landmark size={22} /></div>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold">{loan.name}</h2>
              <p className="mt-0.5 text-sm text-slate-400">{loan.lender}</p>
            </div>
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
              !loan.is_active ? "bg-slate-700 text-slate-300" : loan.current_debt === 0
                ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-500/10 text-amber-300"
            }`}>{!loan.is_active ? "Archivado" : loan.current_debt === 0 ? "Sin deuda" : "Pendiente"}</span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-slate-400">Capital pendiente</p>
              <p className="mt-1 text-2xl font-bold text-white">{money(loan.current_debt)}</p>
            </div>
            <div>
              <p className="text-xs text-slate-400">Monto original</p>
              <p className="mt-1 text-lg font-semibold text-slate-200">{money(loan.original_amount)}</p>
            </div>
          </div>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${utilization}%` }} />
          </div>
          <p className="mt-1 text-xs text-slate-500">Capital pendiente respecto al importe original (no representa porcentaje pagado en desembolsos parciales).</p>

          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-400">
            <span className="flex items-center gap-1"><CalendarDays size={14} /> Inicio: {loan.started_on}</span>
            {loan.due_day && <span>Día de pago: {loan.due_day}</span>}
            {loan.expected_installment != null && <span>Cuota: {money(loan.expected_installment)}</span>}
            {loan.annual_interest_rate != null && <span>Interés anual: {Number(loan.annual_interest_rate)}%</span>}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            {loan.balance_mode === "OPENING_BALANCE" ? "Deuda inicial registrada" : "Desembolsos registrados desde MiPistiyo"}
          </p>
          {loan.notes && <p className="mt-3 text-sm text-slate-400">{loan.notes}</p>}

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-4">
            {loan.is_active && <button className={`${greenButton} inline-flex items-center gap-1.5`} type="button" onClick={() => setModal({ type: "payment", loanId: loan.id })}>
              <CreditCard size={16} /> Abonar
            </button>}
            {loan.is_active && loan.balance_mode === "TRACKED_DISBURSEMENTS" && <button type="button"
              className={`${mutedButton} inline-flex items-center gap-1.5`}
              onClick={() => setModal({ type: "disbursement", loanId: loan.id })}>
              <ArrowDownToLine size={16} /> Desembolso
            </button>}
            <button type="button" className={`${mutedButton} inline-flex items-center gap-1.5`}
              onClick={() => setModal({ type: "edit", loanId: loan.id })}>
              <Pencil size={15} /> Editar
            </button>
            <ToggleLoanForm loan={loan} onSuccess={onSuccess} />
          </div>

          {loanPayments.length > 0 && <div className="mt-5 border-t border-slate-800 pt-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-300"><History size={16} /> Últimos pagos</div>
            <div className="space-y-2">
              {loanPayments.map((p) => <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-slate-400">{p.effective_on} · {p.account_name}
                  {p.is_reversed && <span className="ml-2 text-amber-400">Reversado</span>}
                </span>
                <span className={p.is_reversed ? "text-slate-500 line-through" : "text-slate-200"}>
                  {money(p.principal + p.interest + p.fees)}
                  <span className="ml-1 text-slate-500">(capital {money(p.principal)})</span>
                </span>
              </div>)}
            </div>
          </div>}
        </article>;
      })}
    </div>

    {modal?.type === "create" && <Modal title="Nuevo préstamo" subtitle="Elegí cómo comienza el control financiero." onClose={onClose}>
      <CreateLoanForm onClose={onClose} onSuccess={onSuccess} />
    </Modal>}
    {modal?.type === "edit" && modalLoan && <Modal title={`Editar · ${modalLoan.name}`} onClose={onClose}>
      <EditLoanForm loan={modalLoan} onClose={onClose} onSuccess={onSuccess} />
    </Modal>}
    {modal?.type === "disbursement" && modalLoan && <Modal title={`Desembolso · ${modalLoan.name}`} onClose={onClose}>
      <DisbursementForm loan={modalLoan} accounts={accounts} onClose={onClose} onSuccess={onSuccess} />
    </Modal>}
    {modal?.type === "payment" && modalLoan && <Modal title={`Abonar · ${modalLoan.name}`} onClose={onClose}>
      <PaymentForm loan={modalLoan} accounts={accounts} categories={categories} onClose={onClose} onSuccess={onSuccess} />
    </Modal>}
  </div>;
}
