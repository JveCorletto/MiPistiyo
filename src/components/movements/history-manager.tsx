"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Banknote,
  CalendarClock, ChevronDown, CreditCard, History, RotateCcw, X,
} from "lucide-react";
import {
  cancelMovement, type CancelMovementState,
} from "@/app/(private)/dashboard/movimientos/actions";
import type { HistoryRow } from "@/lib/movements/history";

const usd = (value: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
const numeric = (value: number | string | null) => Number(value ?? 0);

function kindLabel(item: HistoryRow) {
  const names: Record<string, string> = {
    INCOME: "Ingreso", EXPENSE: "Gasto", EXTERNAL_OUT: "Transferencia enviada",
    EXTERNAL_IN: "Transferencia recibida", TRANSFER: "Transferencia propia",
    CARD_PAYMENT: "Pago a tarjeta", LOAN_PAYMENT: "Pago a préstamo",
    LOAN_DISBURSEMENT: "Desembolso de préstamo", ADJUSTMENT: "Ajuste contable",
  };
  return names[item.kind] ?? item.kind;
}

function title(item: HistoryRow) {
  if (["EXPENSE", "INCOME", "EXTERNAL_IN", "EXTERNAL_OUT"].includes(item.kind))
    return item.description || item.category_name || kindLabel(item);
  if (item.kind === "CARD_PAYMENT") return `Pago a ${item.card_name ?? "tarjeta"}`;
  if (item.kind === "LOAN_PAYMENT") return `Pago a ${item.loan_name ?? "préstamo"}`;
  if (item.kind === "LOAN_DISBURSEMENT") return `Desembolso de ${item.loan_name ?? "préstamo"}`;
  if (item.kind === "TRANSFER") return "Transferencia entre cuentas propias";
  return item.description || kindLabel(item);
}

function icon(item: HistoryRow) {
  if (item.origin === "HISTORICAL") return <History size={20} />;
  if (["INCOME", "EXTERNAL_IN", "LOAN_DISBURSEMENT"].includes(item.kind)) return <ArrowDownLeft size={20} />;
  if (item.kind === "CARD_PAYMENT") return <CreditCard size={20} />;
  if (item.kind === "LOAN_PAYMENT") return <Banknote size={20} />;
  if (item.kind === "TRANSFER") return <ArrowLeftRight size={20} />;
  return <ArrowUpRight size={20} />;
}

function DetailsLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 border-b border-slate-800/70 py-2 text-sm">
    <dt className="text-slate-400">{label}</dt><dd className="max-w-full break-words text-right text-slate-200">{value}</dd>
  </div>;
}

const initialState: CancelMovementState = { error: null, success: null };

function CancelDialog({ item, onClose, onSuccess }: {
  item: HistoryRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(cancelMovement, initialState);

  useEffect(() => { if (state.success) onSuccess(); }, [state.success, onSuccess]);

  return <div role="presentation" className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 p-4">
    <section role="dialog" aria-modal="true" aria-labelledby="cancel-movement-title"
      className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-950 p-5 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div><h2 id="cancel-movement-title" className="text-lg font-semibold">Anular movimiento</h2>
          <p className="mt-1 text-sm text-slate-400">{title(item)} · {usd(numeric(item.amount))}</p>
        </div>
        <button type="button" aria-label="Cerrar" onClick={onClose} disabled={pending} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800"><X size={20}/></button>
      </div>
      <p className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-200">
        {item.origin === "HISTORICAL"
          ? "Se anulará el registro histórico y se excluirá de los reportes. No se modifican saldos de cuentas ni deudas."
          : "Se realizará un reverso contable, sin borrar el registro original. El sistema rechazará la anulación si deja algún saldo o deuda inválido."}
      </p>
      <form action={action} className="mt-4 space-y-4">
        <input type="hidden" name="id" value={item.id} />
        <input type="hidden" name="origin" value={item.origin} />
        <input type="hidden" name="idempotency_key" value={idempotencyKey} />
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">Motivo de anulación (obligatorio)</span>
          <textarea autoFocus name="reason" required minLength={5} maxLength={1000} rows={3}
            disabled={pending} placeholder="Ej. Importe incorrecto; registraré el movimiento corregido."
            className="w-full resize-y rounded-lg border border-slate-700 bg-slate-900 p-3 text-sm text-white outline-none focus:border-amber-400" />
        </label>
        {state.error && <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-300">{state.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="rounded-lg border border-slate-700 px-4 py-2 text-sm hover:bg-slate-800">Cancelar</button>
          <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-60 hover:bg-amber-400">
            {pending ? "Anulando..." : "Confirmar anulación"}
          </button>
        </div>
      </form>
    </section>
  </div>;
}

export function HistoryManager({ items }: { items: HistoryRow[] }) {
  const router = useRouter();
  const [cancelItem, setCancelItem] = useState<HistoryRow | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!items.length) return <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center text-slate-400">
    No se encontraron operaciones con esos filtros.
  </div>;

  return <>
    {message && <div role="status" className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-300">
      <span>{message}</span><button type="button" aria-label="Cerrar mensaje" onClick={() => setMessage(null)}><X size={16}/></button>
    </div>}
    <div className="space-y-2">
      {items.map((item) => {
        const income = ["INCOME", "EXTERNAL_IN", "LOAN_DISBURSEMENT"].includes(item.kind);
        const neutral = ["TRANSFER", "CARD_PAYMENT", "LOAN_PAYMENT", "ADJUSTMENT"].includes(item.kind);
        return <details key={`${item.origin}-${item.id}`} className={`group rounded-xl border bg-slate-900 transition-colors ${item.is_reversed ? "border-slate-800/70 opacity-75" : item.origin === "HISTORICAL" ? "border-amber-500/20" : "border-slate-800 hover:border-slate-700"}`}>
          <summary className="flex cursor-pointer list-none items-center gap-3 p-3 sm:p-4 [&::-webkit-details-marker]:hidden">
            <div className={`shrink-0 rounded-lg p-2.5 ${item.origin === "HISTORICAL" ? "bg-amber-500/10 text-amber-400" : income ? "bg-emerald-500/10 text-emerald-400" : neutral ? "bg-sky-500/10 text-sky-400" : "bg-rose-500/10 text-rose-400"}`}>
              {icon(item)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-100">{title(item)}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                <span>{item.effective_on}</span><span>·</span><span>{kindLabel(item)}</span>
                {item.category_name && <><span>·</span><span>{item.category_name}</span></>}
                {item.origin === "HISTORICAL" && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-300">Histórico</span>}
                {item.is_reversed && <span className="rounded bg-rose-500/10 px-1.5 py-0.5 text-rose-300">Anulado</span>}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <p className={`text-sm font-semibold tabular-nums ${item.is_reversed ? "text-slate-500 line-through" : income ? "text-emerald-400" : "text-slate-100"}`}>
                {income ? "+" : neutral ? "" : "−"}{usd(numeric(item.amount))}
              </p>
              <ChevronDown size={16} aria-hidden className="ml-auto mt-1 text-slate-500 transition-transform group-open:rotate-180" />
            </div>
          </summary>
          <div className="border-t border-slate-800 px-4 pb-4 pt-2">
            <dl className="grid gap-x-6 md:grid-cols-2">
              <DetailsLine label="Fecha del movimiento" value={item.effective_on} />
              <DetailsLine label="Registrado" value={new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeStyle: "short", timeZone: "America/El_Salvador" }).format(new Date(item.created_at))} />
              <DetailsLine label="Descripción" value={item.description} />
              <DetailsLine label="Categoría" value={item.category_name} />
              <DetailsLine label="Cuenta origen" value={item.account_name} />
              <DetailsLine label="Cuenta destino" value={item.to_account_name} />
              <DetailsLine label="Tarjeta" value={item.card_name} />
              <DetailsLine label="Préstamo" value={item.loan_name} />
              {item.kind === "LOAN_PAYMENT" && <>
                <DetailsLine label="Abono a capital" value={usd(numeric(item.principal))} />
                <DetailsLine label="Intereses" value={usd(numeric(item.interest))} />
                <DetailsLine label="Comisiones" value={usd(numeric(item.fees))} />
              </>}
              {item.kind === "ADJUSTMENT" && <DetailsLine label="Ajuste (+/−)" value={usd(numeric(item.adjustment_delta))} />}
              {item.is_reversed && <>
                <DetailsLine label="Anulado el" value={item.reversed_at ? new Intl.DateTimeFormat("es-SV", { dateStyle: "medium", timeZone: "America/El_Salvador" }).format(new Date(item.reversed_at)) : ""} />
                <DetailsLine label="Motivo de anulación" value={item.reversal_reason} />
              </>}
              <DetailsLine label="Referencia de auditoría" value={item.id} />
            </dl>
            {!item.is_reversed && <div className="mt-4 flex justify-end">
              <button type="button" onClick={() => setCancelItem(item)}
                className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 px-3 py-2 text-sm font-medium text-amber-300 hover:bg-amber-500/10">
                <RotateCcw size={16} /> Anular operación
              </button>
            </div>}
            {item.origin === "HISTORICAL" && <p className="mt-2 flex items-center gap-1 text-xs text-slate-500"><CalendarClock size={13} /> Ya estaba incluido en la apertura; nunca generó un asiento contable.</p>}
          </div>
        </details>;
      })}
    </div>
    {cancelItem && <CancelDialog item={cancelItem} onClose={() => setCancelItem(null)} onSuccess={() => {
      setCancelItem(null);
      setMessage("Movimiento anulado. El historial y los reportes se actualizaron.");
      router.refresh();
    }} />}
  </>;
}
