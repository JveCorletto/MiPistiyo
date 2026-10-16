"use client";

import {
  useActionState, useCallback, useEffect, useRef, useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { DatePicker } from "@/components/ui/date-picker";
import { takeFinanceOcrPrefill, type FinanceOcrPrefill } from "@/lib/ocr/scan-handoff";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote,
  CheckCircle2, CreditCard, History, Landmark, Plus, X,
} from "lucide-react";
import {
  createFinanceOperation, type FinanceActionState,
} from "@/app/(private)/dashboard/transferencias/actions";

export type AccountOption = {
  id: string; name: string; kind: string; is_active: boolean; current_balance: number;
};
export type CreditCardOption = {
  id: string; name: string; is_active: boolean; current_debt: number;
};
export type LoanOption = {
  id: string; name: string; is_active: boolean; current_debt: number;
};
export type CategoryOption = {
  id: string; name: string; kind: string; is_active: boolean;
};
export type FinanceHistoryItem = {
  id: string;
  type: "INTERNAL" | "EXTERNAL_OUT" | "EXTERNAL_IN" | "CARD" | "LOAN";
  title: string;
  detail: string;
  amount: number;
  date: string;
  created_at: string;
  reversed: boolean;
  breakdown?: string;
};

type Props = {
  accounts: AccountOption[];
  creditCards: CreditCardOption[];
  loans: LoanOption[];
  categories: CategoryOption[];
  history: FinanceHistoryItem[];
};
type Mode = "INTERNAL" | "EXTERNAL" | "CARD" | "LOAN";
type Dialog = { mode: Mode; idempotencyKey: string; prefill?: FinanceOcrPrefill } | null;

const inputClass = "w-full min-w-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 disabled:opacity-50";
const labelClass = "mb-1.5 block text-xs font-medium text-slate-300";
const secondaryButton = "rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50";
const mainButton = "rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50";
const money = (value: number) => new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD",
}).format(value);
const ZERO_STATE: FinanceActionState = { error: null, success: null };

function todayInSV(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/El_Salvador", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function Modal({ title, children, onClose }: {
  title: string; children: ReactNode; onClose: () => void;
}) {
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-sm sm:p-5"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title}
        className="max-h-[92vh] w-full max-w-xl overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-5 shadow-2xl sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-white">{title}</h2>
            <p className="mt-1 text-xs text-slate-400">Las operaciones cambian los saldos al confirmarse.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={mainButton}>
      {pending ? "Registrando..." : "Confirmar operación"}
    </button>
  );
}

function FormSelect({ label, name, children, defaultValue = "" }: {
  label: string; name: string; children: ReactNode; defaultValue?: string;
}) {
  return (
    <label className="block min-w-0">
      <span className={labelClass}>{label}</span>
      <select name={name} defaultValue={defaultValue} required className={inputClass}>
        {children}
      </select>
    </label>
  );
}

function AccountChoices({ accounts, placeholder }: {
  accounts: AccountOption[]; placeholder: string;
}) {
  return <>
    <option value="" disabled>{placeholder}</option>
    {accounts.filter((a) => a.is_active).map((a) => (
      <option key={a.id} value={a.id}>{a.name} · {money(a.current_balance)}</option>
    ))}
  </>;
}

function AmountField({ name = "amount", label = "Monto ($)", defaultValue }: { name?: string; label?: string; defaultValue?: string }) {
  return <label className="block min-w-0">
    <span className={labelClass}>{label}</span>
    <input type="number" name={name} min="0.01" step="0.01" inputMode="decimal"
      placeholder="0.00" defaultValue={defaultValue} required className={inputClass} />
  </label>;
}

function HistoricalWarning() {
  return <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-200">
    Registrá aquí únicamente operaciones que <strong>todavía no estén incluidas</strong> en los saldos iniciales.
    No registres de nuevo pagos o transferencias anteriores que ya figuren en el banco.
  </p>;
}

function OperationForm({ mode, keyId, accounts, cards, loans, categories, prefill, onClose, onDone }: {
  mode: Mode;
  keyId: string;
  accounts: AccountOption[];
  cards: CreditCardOption[];
  loans: LoanOption[];
  categories: CategoryOption[];
  prefill?: FinanceOcrPrefill;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [state, action] = useActionState(createFinanceOperation, ZERO_STATE);
  const [direction, setDirection] = useState<"OUT" | "IN" | null>(prefill ? prefill.direction : "OUT");
  const [interest, setInterest] = useState("0");
  const [fees, setFees] = useState("0");
  const [principal, setPrincipal] = useState("");

  useEffect(() => {
    if (state.success) onDone(state.success);
  }, [state.success, onDone]);

  const expenseCategories = categories.filter((c) => c.kind === "EXPENSE" && c.is_active);
  const incomeCategories = categories.filter((c) => c.kind === "INCOME" && c.is_active);
  const selectedExternalCategories = direction === "OUT" ? expenseCategories : direction === "IN" ? incomeCategories : [];
  const totalLoan = (Number(principal || 0) + Number(interest || 0) + Number(fees || 0));

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="idempotency_key" value={keyId} />
      {prefill && <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs leading-relaxed text-emerald-200">
        Datos sugeridos desde OCR. Revisá importe, fecha, dirección, cuenta y clasificación antes de confirmar.
        {prefill.reference && ` Referencia sugerida: ${prefill.reference}.`}
        {mode === "EXTERNAL" && " Una transferencia recibida no siempre es ingreso; confirmá su naturaleza contable."}
        {mode === "LOAN" && ` El comprobante indica ${prefill.amount ? money(Number(prefill.amount)) : "un monto sin identificar"} en total. Separá correctamente capital, intereses y comisiones.`}
      </p>}

      {mode === "INTERNAL" && <>
        <p className="text-sm text-slate-400">
          Pasás dinero entre dos cuentas registradas en MiPistiyo. Aunque sean bancos distintos,
          no es ingreso ni gasto.
        </p>
        <FormSelect label="Cuenta de origen *" name="account_id">
          <option value="" disabled>Seleccioná origen</option>
          {accounts.filter((a) => a.is_active).map((a) => (
            <option key={a.id} value={a.id}>{a.name} · {money(a.current_balance)}</option>
          ))}
        </FormSelect>
        <FormSelect label="Cuenta de destino *" name="to_account_id">
          <AccountChoices accounts={accounts} placeholder="Seleccioná destino" />
        </FormSelect>
        <AmountField defaultValue={prefill?.amount} />
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-emerald-300">
          Se descuenta de origen y se suma al destino. El patrimonio no cambia.
        </div>
      </>}

      {mode === "EXTERNAL" && <>
        <p className="text-sm text-slate-400">
          Para dinero enviado a terceros como <strong>gasto</strong> o recibido de terceros como
          <strong> ingreso</strong>. Si ambas cuentas son tuyas, usá «Entre mis cuentas».
        </p>
        <fieldset className="space-y-2">
          <legend className={labelClass}>Dirección</legend>
          <div className="grid grid-cols-2 gap-2">
            <label className={`cursor-pointer rounded-xl border p-3 text-sm ${direction === "OUT" ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700"}`}>
              <input className="mr-2 accent-emerald-500" type="radio" name="direction" value="OUT"
                required checked={direction === "OUT"} onChange={() => setDirection("OUT")} />Enviar
            </label>
            <label className={`cursor-pointer rounded-xl border p-3 text-sm ${direction === "IN" ? "border-emerald-500 bg-emerald-500/10" : "border-slate-700"}`}>
              <input className="mr-2 accent-emerald-500" type="radio" name="direction" value="IN"
                required checked={direction === "IN"} onChange={() => setDirection("IN")} />Recibir
            </label>
          </div>
        </fieldset>
        {direction === null && <p className="rounded-lg bg-amber-500/10 p-2 text-xs text-amber-200">
          El comprobante no indica si esta transferencia es entrante o saliente para vos. Elegí la dirección antes de continuar.
        </p>}
        <label className="block min-w-0">
          <span className={labelClass}>{direction === "OUT" ? "Destinatario *" : direction === "IN" ? "Remitente *" : "Contraparte *"}</span>
          <input type="text" name="counterparty" required minLength={2} maxLength={120}
            placeholder={direction === "OUT" ? "Ej. Juan Pérez / Empresa" : direction === "IN" ? "Ej. Empleador / Cliente" : "Seleccioná la dirección"}
            defaultValue={prefill?.counterparty ?? ""} className={inputClass} />
        </label>
        <FormSelect label={direction === "OUT" ? "Cuenta desde la que enviás *" : direction === "IN" ? "Cuenta en la que recibís *" : "Cuenta *"} name="account_id">
          <AccountChoices accounts={accounts} placeholder="Seleccioná la cuenta" />
        </FormSelect>
        <FormSelect key={direction} label={direction === "OUT" ? "Categoría de gasto *" : direction === "IN" ? "Categoría de ingreso *" : "Categoría *"} name="category_id">
          <option value="" disabled>Seleccioná una categoría</option>
          {selectedExternalCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>
        <AmountField defaultValue={prefill?.amount} />
        <p className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">
          Una transferencia externa no siempre representa ingreso/gasto: para mover dinero
          entre cuentas propias, registrá primero ambas en MiPistiyo y usá transferencia interna.
          Reembolsos o dinero prestado requieren su clasificación correcta.
        </p>
      </>}

      {mode === "CARD" && <>
        <p className="text-sm text-slate-400">Un pago a tarjeta de crédito disminuye tu dinero y la deuda, <strong>no se registra como un gasto nuevo</strong>.</p>
        <FormSelect label="Cuenta desde la que pagás *" name="account_id">
          <AccountChoices accounts={accounts} placeholder="Seleccioná la cuenta" />
        </FormSelect>
        <FormSelect label="Tarjeta de crédito *" name="card_id">
          <option value="" disabled>Seleccioná la tarjeta</option>
          {cards.filter((c) => c.is_active).map((card) =>
            <option key={card.id} value={card.id}>{card.name} · Deuda {money(card.current_debt)}</option>)}
        </FormSelect>
        <AmountField label="Monto del abono ($)" defaultValue={prefill?.amount} />
        <p className="rounded-lg border border-slate-700 bg-slate-950/50 p-3 text-xs text-slate-400">
          Se aplica como abono general a la tarjeta. La asignación a un estado de cuenta
          específico se implementará en una fase posterior.
        </p>
      </>}

      {mode === "LOAN" && <>
        <p className="text-sm text-slate-400">Desglosá el pago: solamente el capital baja la deuda; intereses y comisiones cuentan como gastos.</p>
        <FormSelect label="Cuenta desde la que pagás *" name="account_id">
          <AccountChoices accounts={accounts} placeholder="Seleccioná la cuenta" />
        </FormSelect>
        <FormSelect label="Préstamo *" name="loan_id">
          <option value="" disabled>Seleccioná el préstamo</option>
          {loans.filter((l) => l.is_active).map((loan) =>
            <option key={loan.id} value={loan.id}>{loan.name} · Deuda {money(loan.current_debt)}</option>)}
        </FormSelect>
        <div className="grid min-w-0 gap-3 sm:grid-cols-3 [&>*]:min-w-0">
          <label className="block min-w-0">
            <span className={labelClass}>Capital ($)</span>
            <input className={inputClass} name="principal" type="number" min="0" step="0.01"
              placeholder="0.00" value={principal} onChange={(e) => setPrincipal(e.target.value)} />
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>Intereses ($)</span>
            <input className={inputClass} name="interest" type="number" min="0" step="0.01"
              value={interest} onChange={(e) => setInterest(e.target.value)} />
          </label>
          <label className="block min-w-0">
            <span className={labelClass}>Comisiones ($)</span>
            <input className={inputClass} name="fees" type="number" min="0" step="0.01"
              value={fees} onChange={(e) => setFees(e.target.value)} />
          </label>
        </div>
        {Number(interest) > 0 && <FormSelect label="Categoría de intereses *" name="interest_category">
          <option value="" disabled>Seleccioná una categoría de gasto</option>
          {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>}
        {Number(fees) > 0 && <FormSelect label="Categoría de comisiones *" name="fee_category">
          <option value="" disabled>Seleccioná una categoría de gasto</option>
          {expenseCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </FormSelect>}
        <div className="flex items-center justify-between rounded-lg border border-slate-700 bg-slate-950/60 p-3">
          <span className="text-sm text-slate-400">Total que sale de la cuenta</span>
          <span className="font-semibold text-white">{money(Number.isFinite(totalLoan) ? totalLoan : 0)}</span>
        </div>
      </>}

      <div className="grid min-w-0 gap-3 sm:grid-cols-2 [&>*]:min-w-0">
        <label className="block min-w-0">
          <span className={labelClass}>Fecha *</span>
          <DatePicker name="effective_on"
            defaultValue={prefill ? prefill.date : todayInSV()}
            allowEmpty={Boolean(prefill && !prefill.date)} />
        </label>
        <label className="block min-w-0">
          <span className={labelClass}>Nota (opcional)</span>
          <input name="note" type="text" maxLength={600} placeholder="Referencia o descripción"
            defaultValue={prefill?.reference ? `${prefill.institution ? `${prefill.institution} · ` : ""}Ref. ${prefill.reference}` : ""}
            className={inputClass} />
        </label>
      </div>

      <HistoricalWarning />
      {state.error && <p role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">{state.error}</p>}
      <div className="flex flex-wrap justify-end gap-2 border-t border-slate-800 pt-4">
        <button type="button" onClick={onClose} className={secondaryButton}>Cancelar</button>
        <SubmitButton />
      </div>
    </form>
  );
}

const actionCards: { mode: Mode; title: string; subtitle: string; Icon: typeof ArrowLeftRight }[] = [
  { mode: "INTERNAL", title: "Entre mis cuentas", subtitle: "Dinero propio, sin ingreso ni gasto", Icon: ArrowLeftRight },
  { mode: "EXTERNAL", title: "A / de terceros", subtitle: "Pago o cobro con categoría", Icon: ArrowUpRight },
  { mode: "CARD", title: "Pagar tarjeta", subtitle: "Reduce la deuda de crédito", Icon: CreditCard },
  { mode: "LOAN", title: "Pagar préstamo", subtitle: "Capital, intereses y comisiones", Icon: Landmark },
];

const labels: Record<Mode, string> = {
  INTERNAL: "Transferencia entre cuentas",
  EXTERNAL: "Transferencia con terceros",
  CARD: "Pago de tarjeta de crédito",
  LOAN: "Pago de préstamo",
};

export function TransferManager({ accounts, creditCards, loans, categories, history }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // No usar un booleano permanente: Next.js puede reutilizar este componente
  // cuando el usuario vuelve a escanear otro documento.
  const lastHandledOcrRequest = useRef<string | null>(null);
  const fromOcr = searchParams.get("from_ocr");
  const ocrRequest = searchParams.get("ocr_request");
  const requestedMode = searchParams.get("mode");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice, setNotice] = useState("");
  const open = (mode: Mode) => setDialog({ mode, idempotencyKey: crypto.randomUUID() });

  // No usar router.replace() inmediatamente después de setDialog():
  // la navegación de Next.js puede volver a montar TransferManager y cerrar el modal.
  // Limpiamos los parámetros solo al cerrar o completar el formulario.
  const clearOcrParams = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("from_ocr")) return;
    url.searchParams.delete("from_ocr");
    url.searchParams.delete("mode");
    url.searchParams.delete("ocr_request");
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, []);

  const close = useCallback(() => {
    setDialog(null);
    clearOcrParams();
  }, [clearOcrParams]);

  useEffect(() => {
    if (fromOcr !== "1") return;

    // El ID cambia en CADA escaneo. Aunque React conserve el componente vivo,
    // un segundo comprobante sí debe abrir un segundo formulario.
    // "legacy" permite recibir enlaces creados antes de este parche.
    const requestKey = ocrRequest ?? "legacy";
    if (lastHandledOcrRequest.current === requestKey) return;
    lastHandledOcrRequest.current = requestKey;

    const scanned = takeFinanceOcrPrefill();
    if (scanned) {
      setNotice("");
      setDialog({ mode: scanned.mode, idempotencyKey: crypto.randomUUID(), prefill: scanned });
      return;
    }

    // Si el borrador expiró, abrir el modal elegido sin autocompletarlo.
    if (requestedMode === "INTERNAL" || requestedMode === "EXTERNAL" ||
        requestedMode === "CARD" || requestedMode === "LOAN") {
      setDialog({ mode: requestedMode, idempotencyKey: crypto.randomUUID() });
      setNotice("El OCR no está disponible o expiró. Completá y verificá el formulario manualmente.");
    } else {
      setNotice("El borrador OCR expiró o no está disponible. Seleccioná una operación manualmente.");
    }
  }, [fromOcr, ocrRequest, requestedMode]);

  const onDone = useCallback((message: string) => {
    setDialog(null);
    clearOcrParams();
    setNotice(message);
    router.refresh();
  }, [router, clearOcrParams]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(""), 6500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const totalBalance = accounts.reduce((total, a) => total + a.current_balance, 0);
  const cardDebt = creditCards.reduce((total, c) => total + c.current_debt, 0);
  const loanDebt = loans.reduce((total, l) => total + l.current_debt, 0);

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-bold text-white">Transferencias y pagos</h1>
        <p className="mt-2 text-sm text-slate-400">Mové dinero entre cuentas, enviá a terceros y aboná tus deudas.</p>
      </div>
      <button type="button" onClick={() => open("INTERNAL")} className={`${mainButton} inline-flex items-center gap-2`}>
        <Plus size={18} /> Nueva operación
      </button>
    </header>

    {notice && <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
      <CheckCircle2 size={18} className="mt-0.5 shrink-0" />{notice}
    </div>}

    <div className="grid gap-3 sm:grid-cols-3">
      {[
        { label: "Saldo en cuentas", value: totalBalance, Icon: Banknote },
        { label: "Deuda en tarjetas", value: cardDebt, Icon: CreditCard },
        { label: "Deuda en préstamos", value: loanDebt, Icon: Landmark },
      ].map(({ label, value, Icon }) => <div key={label} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <div className="flex items-center gap-2 text-sm text-slate-400"><Icon size={17} />{label}</div>
        <p className="mt-2 text-xl font-semibold text-white">{money(value)}</p>
      </div>)}
    </div>

    <section className="space-y-3">
      <h2 className="text-lg font-semibold text-white">¿Qué querés hacer?</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {actionCards.map(({ mode, title, subtitle, Icon }) => <button key={mode} type="button"
          onClick={() => open(mode)}
          className="group flex min-w-0 items-start gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-left transition hover:border-emerald-500/50 hover:bg-slate-800/70">
          <div className="rounded-lg bg-emerald-500/10 p-2 text-emerald-400"><Icon size={19} /></div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">{subtitle}</p>
          </div>
        </button>)}
      </div>
    </section>

    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <History size={20} className="text-slate-400" />
        <h2 className="text-lg font-semibold text-white">Actividad reciente</h2>
      </div>
      {history.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          Todavía no hay transferencias ni pagos registrados.
        </p>
      ) : history.map((item) => {
        const Icon = item.type === "INTERNAL" ? ArrowLeftRight
          : item.type === "CARD" ? CreditCard
          : item.type === "LOAN" ? Landmark
          : item.type === "EXTERNAL_IN" ? ArrowDownLeft : ArrowUpRight;
        return <article key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400"><Icon size={19} /></div>
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm font-semibold text-white">{item.title}</p>
            <p className="mt-1 break-words text-xs text-slate-400">{item.detail} · {item.date}</p>
            {item.breakdown && <p className="mt-1 text-xs text-slate-500">{item.breakdown}</p>}
            {item.reversed && <span className="mt-1 inline-flex rounded-md bg-amber-500/10 px-2 py-0.5 text-xs text-amber-400">Operación anulada</span>}
          </div>
          <span className={`font-semibold ${item.reversed ? "text-slate-500 line-through" : item.type === "EXTERNAL_IN" ? "text-emerald-400" : "text-white"}`}>
            {item.type === "EXTERNAL_IN" ? "+" : item.type === "INTERNAL" ? "" : "-"}{money(item.amount)}
          </span>
        </article>;
      })}
      {history.length >= 80 && <p className="text-xs text-slate-400">Se muestran únicamente los 80 movimientos más recientes.</p>}
    </section>

    {dialog && <Modal title={labels[dialog.mode]} onClose={close}>
      <OperationForm key={dialog.idempotencyKey} mode={dialog.mode} keyId={dialog.idempotencyKey}
        accounts={accounts} cards={creditCards} loans={loans} categories={categories}
        prefill={dialog.prefill} onClose={close} onDone={onDone} />
    </Modal>}
  </div>;
}
