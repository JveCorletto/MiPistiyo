"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, X } from "lucide-react";

import { DatePicker } from "@/components/ui/date-picker";
import { createMovement, type MovementState } from "@/app/(private)/dashboard/movimientos/actions";

type Category = {
    id: string;
    name: string;
    kind: string;
};

type Source = {
    id: string;
    name: string;
    kind: string;
};

type Props = {
    categories: Category[];
    accounts: Source[];
    cards: Source[];
};

const initialState: MovementState = {
    error: null,
    success: null,
};

const fieldClass =
    "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500";

function MovementForm({
    categories,
    accounts,
    cards,
    onSuccess,
    onCancel,
}: Props & {
    onSuccess: (message: string) => void;
    onCancel: () => void;
}) {
    const [kind, setKind] = useState<"INCOME" | "EXPENSE">("EXPENSE");
    const [sourceType, setSourceType] =
        useState<"ACCOUNT" | "CARD">("ACCOUNT");
    const [recordMode, setRecordMode] = useState<"CURRENT" | "HISTORICAL">("CURRENT");

    const [idempotencyKey] = useState(() => crypto.randomUUID());
    const [today] = useState(() => {
        const parts = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/El_Salvador",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        }).formatToParts(new Date());

        const part = (name: string) =>
            parts.find(p => p.type === name)?.value ?? "";

        return `${part("year")}-${part("month")}-${part("day")}`;
    });

    const [state, action, pending] = useActionState(
        createMovement, initialState
    );

    useEffect(() => {
        if (state.success) onSuccess(state.success);
    }, [state.success, onSuccess]);

    const options = sourceType === "CARD" ? cards : accounts;

    return (
        <form action={action} className="space-y-4">
            <input
                type="hidden"
                name="idempotency_key"
                value={idempotencyKey}
            />
            <div className="grid grid-cols-2 gap-2">
                {(["EXPENSE", "INCOME"] as const).map(k => (
                    <button
                        key={k}
                        type="button"
                        disabled={pending}
                        onClick={() => {
                            setKind(k);
                            setSourceType("ACCOUNT");
                        }}
                        className={`rounded-lg px-4 py-2.5 text-sm ${kind === k
                            ? "bg-emerald-500 text-slate-950 font-semibold"
                            : "bg-slate-800 text-slate-300"
                            }`}
                    >
                        {k === "EXPENSE" ? "Gasto" : "Ingreso"}
                    </button>
                ))}
            </div>
            <input type="hidden" name="kind" value={kind} />
            <input type="hidden" name="record_mode" value={recordMode} />

            <fieldset className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
                <legend className="px-2 text-sm font-medium text-slate-300">
                    ¿Cómo registrar este movimiento?
                </legend>

                <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${recordMode === "CURRENT"
                            ? "border-emerald-500 bg-emerald-500/10"
                            : "border-slate-700 hover:bg-slate-800"
                        }`}
                >
                    <input
                        type="radio"
                        name="movement_mode_visual"
                        checked={recordMode === "CURRENT"}
                        onChange={() => setRecordMode("CURRENT")}
                        disabled={pending}
                        className="mt-1 accent-emerald-500"
                    />

                    <span>
                        <span className="block text-sm font-semibold">
                            Movimiento nuevo
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                            Afectará el saldo de la cuenta o la deuda
                            de la tarjeta.
                        </span>
                    </span>
                </label>

                <label
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${recordMode === "HISTORICAL"
                            ? "border-amber-500 bg-amber-500/10"
                            : "border-slate-700 hover:bg-slate-800"
                        }`}
                >
                    <input
                        type="radio"
                        name="movement_mode_visual"
                        checked={recordMode === "HISTORICAL"}
                        onChange={() => setRecordMode("HISTORICAL")}
                        disabled={pending}
                        className="mt-1 accent-amber-400"
                    />

                    <span>
                        <span className="block text-sm font-semibold">
                            Ya incluido en el saldo inicial
                        </span>
                        <span className="mt-1 block text-xs text-slate-400">
                            Se agregará al historial sin descontar
                            ni sumar nuevamente el dinero.
                        </span>
                    </span>
                </label>

                {recordMode === "HISTORICAL" && (
                    <div
                        role="note"
                        className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200"
                    >
                        Utiliza esta opción solamente cuando el importe ya
                        formaba parte del saldo inicial registrado en
                        MiPistiyo. La fecha debe ser igual o anterior
                        a la apertura contable de la cuenta o tarjeta.
                    </div>
                )}
            </fieldset>

            <div className="grid min-w-0 gap-4 sm:grid-cols-2 [&>*]:min-w-0">
                <div>
                    <label className="mb-2 block text-sm">Monto (USD)</label>
                    <input
                        className={fieldClass}
                        name="amount"
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="0.00"
                        required
                    />
                </div>
                <div>
                    <label className="mb-2 block text-sm">Fecha</label>
                    <DatePicker
                        name="date"
                        defaultValue={today}
                        disabled={pending}
                    />
                </div>
            </div>

            <div>
                <label className="mb-2 block text-sm">Categoría</label>
                <select
                    key={kind}
                    name="category_id"
                    required
                    defaultValue=""
                    className={fieldClass}
                >
                    <option value="" disabled>Seleccionar categoría</option>
                    {categories.filter(c => c.kind === kind).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
                <div>
                    <label className="mb-2 block text-sm">Método</label>
                    <select
                        name="source_type"
                        value={sourceType}
                        onChange={e => setSourceType(
                            e.target.value as "ACCOUNT" | "CARD"
                        )}
                        className={fieldClass}
                        disabled={pending}
                    >
                        <option value="ACCOUNT">
                            {kind === "INCOME" ? "Cuenta destino" : "Efectivo / banco"}
                        </option>
                        {kind === "EXPENSE" &&
                            <option value="CARD">Tarjeta</option>}
                    </select>
                </div>

                <div>
                    <label className="mb-2 block text-sm">
                        {sourceType === "CARD" ? "Tarjeta" : "Cuenta"}
                    </label>
                    <select
                        key={`${kind}-${sourceType}`}
                        name="source_id"
                        required
                        defaultValue=""
                        className={fieldClass}
                    >
                        <option value="" disabled>Seleccionar</option>
                        {options.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.name} {s.kind === "CREDIT" ? "(crédito)" : ""}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            <div>
                <label className="mb-2 block text-sm">
                    Descripción (opcional)
                </label>
                <textarea
                    className={fieldClass}
                    rows={2}
                    maxLength={1000}
                    name="note"
                    placeholder="Ej. Compra de supermercado"
                />
            </div>

            {state.error && (
                <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                    {state.error}
                </p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                    type="button"
                    disabled={pending}
                    onClick={onCancel}
                    className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
                >
                    Cancelar
                </button>
                <button
                    disabled={pending || !categories.some(c => c.kind === kind) ||
                        options.length === 0}
                    className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
                >
                    {pending ? "Guardando..." : "Guardar movimiento"}
                </button>
            </div>
        </form>
    );
}

export function CreateMovementModal(props: Props) {
    const [open, setOpen] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => setMessage(null), 4000);
        return () => clearTimeout(timer);
    }, [message]);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950"
            >
                <Plus size={18} /> Nuevo movimiento
            </button>

            {message && (
                <div role="status" className="fixed right-4 top-20 z-[90] rounded-lg bg-slate-800 px-4 py-3 text-emerald-400 shadow-xl">
                    {message}
                </div>
            )}

            {open && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Nuevo movimiento"
                        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-xl font-semibold">
                                Nuevo movimiento
                            </h2>
                            <button
                                onClick={() => setOpen(false)}
                                aria-label="Cerrar"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <MovementForm
                            {...props}
                            onCancel={() => setOpen(false)}
                            onSuccess={text => {
                                setOpen(false);
                                setMessage(text);
                            }}
                        />
                    </div>
                </div>
            )}
        </>
    );
}