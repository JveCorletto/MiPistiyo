"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, X, ScanText } from "lucide-react";
import { useRouter } from "next/navigation";
import { ReceiptScanner, type ScanDestination } from "@/components/movements/receipt-scanner";
import { storeFinanceOcrPrefill } from "@/lib/ocr/scan-handoff";
import type { ReceiptDraft } from "@/lib/ocr/parse-receipt";

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
    last_four?: string | null;
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
    draft,
}: Props & {
    draft: ReceiptDraft | null;
    onSuccess: (message: string) => void;
    onCancel: () => void;
}) {
    const [kind, setKind] = useState<"INCOME" | "EXPENSE" | null>(
        draft && !["RECEIPT", "CARD_PURCHASE_ALERT"].includes(draft.documentType) ? null : "EXPENSE"
    );
    const [sourceType, setSourceType] =
        useState<"ACCOUNT" | "CARD">(draft?.documentType === "CARD_PURCHASE_ALERT" ? "CARD" : "ACCOUNT");
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
    const matchingCards = draft?.documentType === "CARD_PURCHASE_ALERT" && draft.cardLastFour
        ? cards.filter(c => c.kind === "CREDIT" && c.last_four?.trim() === draft.cardLastFour)
        : [];
    // Solo se preselecciona si existe UNA coincidencia; nunca adivinamos tarjetas.
    const matchingCardId = matchingCards.length === 1 ? matchingCards[0].id : "";

    return (
        <form action={action} className="space-y-4">
            <input
                type="hidden"
                name="idempotency_key"
                value={idempotencyKey}
            />
            {draft && (
                <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs leading-relaxed text-emerald-200">
                    Datos sugeridos por OCR. Confirmá el tipo (gasto/ingreso), monto, fecha, categoría y cuenta o tarjeta. Evitá registros duplicados.
                    {draft.documentType === "CARD_PURCHASE_ALERT" && (
                        <span className="mt-1 block">Compra con tarjeta{draft.cardLastFour ? ` •••• ${draft.cardLastFour}` : ""}. Confirmá el banco, tarjeta y categoría antes de guardar.</span>
                    )}
                    {(!draft.date || !draft.total) && " Faltan datos que deberás completar manualmente."}
                </div>
            )}
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
            <input type="hidden" name="kind" value={kind ?? ""} />
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
                        defaultValue={draft?.total ?? ""}
                        required
                    />
                </div>
                <div>
                    <label className="mb-2 block text-sm">Fecha</label>
                    <DatePicker
                        name="date"
                        defaultValue={draft ? draft.date : today}
                        allowEmpty={Boolean(draft)}
                        disabled={pending}
                    />
                </div>
            </div>

            <div>
                <label className="mb-2 block text-sm">Hora real del movimiento (opcional)</label>
                <input className={fieldClass} type="time" name="occurred_time" step={60}
                    defaultValue={draft?.time ?? ""} disabled={pending} />
                <p className="mt-1 text-xs text-slate-500">Es la hora de la compra, no la hora de la captura ni del registro.</p>
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
                        defaultValue={sourceType === "CARD" ? matchingCardId : ""}
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
                    defaultValue={draft ? (
                        draft.documentType === "RECEIPT" || draft.documentType === "CARD_PURCHASE_ALERT"
                            ? `Compra en ${draft.merchant || "comercio por confirmar"}${draft.documentType === "CARD_PURCHASE_ALERT" && draft.cardLastFour ? ` · tarjeta ••••${draft.cardLastFour}` : ""}`
                            : `Comprobante ${draft.institution || draft.merchant}${draft.reference ? ` · Ref. ${draft.reference}` : ""}`
                    ) : ""}
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
                    disabled={pending || !kind || !categories.some(c => c.kind === kind) ||
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
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [draft, setDraft] = useState<ReceiptDraft | null>(null);
    const [formVersion, setFormVersion] = useState(0);
    const [message, setMessage] = useState<string | null>(null);

    function showModal(withScanner: boolean) {
        setDraft(null);
        setFormVersion(v => v + 1);
        setScanning(withScanner);
        setOpen(true);
    }
    function useScannedData(receipt: ReceiptDraft, destination: ScanDestination) {
        if (destination === "MOVEMENT") {
            setDraft(receipt);
            setFormVersion(version => version + 1);
            setScanning(false);
            return;
        }
        try {
            // Se transmite únicamente el borrador mínimo, nunca la foto ni todo el OCR.
            storeFinanceOcrPrefill({
                mode: destination,
                amount: receipt.total,
                date: receipt.date,
                institution: receipt.institution,
                reference: receipt.reference,
                counterparty: receipt.counterparty,
                direction: receipt.suggestedDirection,
                createdAt: Date.now(),
            });
            // Cada comprobante tiene un identificador propio para que el destino
            // lo procese, incluso si Next.js conserva TransferManager montado.
            const requestId = crypto.randomUUID();
            closeModal();
            router.push(`/dashboard/transferencias?from_ocr=1&mode=${destination}&ocr_request=${requestId}`);
        } catch {
            setMessage("No se pudo trasladar el borrador. Probá de nuevo o usá el formulario manual.");
        }
    }
    function closeModal() {
        setOpen(false);
        setScanning(false);
        setDraft(null);
    }

    useEffect(() => {
        if (!message) return;
        const timer = setTimeout(() => setMessage(null), 4000);
        return () => clearTimeout(timer);
    }, [message]);

    return (
        <>
            <div className="flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={() => showModal(false)}
                    className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
                >
                    <Plus size={18} /> Nuevo movimiento
                </button>
                <button
                    type="button"
                    onClick={() => showModal(true)}
                    className="inline-flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-300 hover:bg-emerald-500/15"
                >
                    <ScanText size={18} /> Escanear comprobante
                </button>
            </div>

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
                        aria-label={scanning ? "Escanear comprobante" : "Nuevo movimiento"}
                        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto overflow-x-hidden rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl">
                        <div className="mb-5 flex items-center justify-between">
                            <h2 className="text-xl font-semibold">
                                {scanning ? "Escanear comprobante" : "Nuevo movimiento"}
                            </h2>
                            <button type="button" onClick={closeModal} aria-label="Cerrar" className="rounded-lg p-1 hover:bg-slate-800">
                                <X size={20} />
                            </button>
                        </div>
                        {scanning ? (
                            <ReceiptScanner
                                onManual={() => { setDraft(null); setFormVersion(v => v + 1); setScanning(false); }}
                                onUse={useScannedData}
                            />
                        ) : (
                            <MovementForm
                                key={formVersion}
                                {...props}
                                draft={draft}
                                onCancel={closeModal}
                                onSuccess={(text) => {
                                    closeModal();
                                    setMessage(text);
                                }}
                            />
                        )}
                    </div>
                </div>
            )}
        </>
    );
}
