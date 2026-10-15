"use client";

import { useActionState, useCallback, useEffect, useRef, useState } from "react";
import {
    CreditCard,
    Landmark,
    Pencil,
    Power,
    CheckCircle2,
    X,
} from "lucide-react";

import {
    toggleCard,
    type CardState,
} from "@/app/(private)/dashboard/tarjetas/actions";
import { EditCardForm } from "./edit-card-form";

export type CardRecord = {
    id: string;
    name: string;
    kind: "DEBIT" | "CREDIT";
    issuer: string | null;
    last_four: string | null;
    account_id: string | null;
    credit_limit: number | string | null;
    cutoff_day: number | null;
    due_day: number | null;
    due_month_offset: number;
    enforce_credit_limit: boolean;
    is_active: boolean;
};

export type CardBalance = {
    id: string;
    current_debt: number | string;
    available_credit: number | string | null;
    over_limit_amount: number | string | null;
};

type LinkedAccount = {
    name: string;
    current_balance: number | string;
};

type Props = {
    card: CardRecord;
    balance?: CardBalance;
    account?: LinkedAccount;
};

const initialState: CardState = {
    error: null,
    success: null,
};

const money = (value: number) =>
    new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
    }).format(value);

export function CardCard({ card, balance, account }: Props) {
    const [editing, setEditing] = useState(false);
    const [popoverOpen, setPopoverOpen] = useState(false);
    const [notification, setNotification] = useState<string | null>(null);

    const popoverRef = useRef<HTMLDivElement>(null);

    const [toggleState, toggleAction, toggling] = useActionState(
        toggleCard,
        initialState
    );

    const handleSuccess = useCallback((message: string) => {
        setEditing(false);
        setNotification(message);
    }, []);

    useEffect(() => {
        if (toggleState.success) {
            setPopoverOpen(false);
            setNotification(toggleState.success);
        }
    }, [toggleState]);

    useEffect(() => {
        if (!notification) return;
        const timeout = setTimeout(() => setNotification(null), 4000);
        return () => clearTimeout(timeout);
    }, [notification]);

    useEffect(() => {
        if (!popoverOpen) return;

        function outside(event: PointerEvent) {
            if (
                popoverRef.current &&
                !popoverRef.current.contains(event.target as Node)
            ) {
                setPopoverOpen(false);
            }
        }

        function escape(event: KeyboardEvent) {
            if (event.key === "Escape") setPopoverOpen(false);
        }

        document.addEventListener("pointerdown", outside);
        document.addEventListener("keydown", escape);

        return () => {
            document.removeEventListener("pointerdown", outside);
            document.removeEventListener("keydown", escape);
        };
    }, [popoverOpen]);


    const debt = Number(balance?.current_debt ?? 0);
    const available = Number(balance?.available_credit ?? 0);
    const limit = Number(card.credit_limit ?? 0);

    const utilization = limit > 0
        ? Math.max(0, (debt / limit) * 100)
        : 0;

    const percent = Math.min(100, utilization);

    const progressColor =
        utilization > 85
            ? "bg-red-500"
            : utilization >= 75
                ? "bg-yellow-400"
                : "bg-emerald-500";


    return (
        <div className="relative">
            {notification && (
                <div
                    role="status"
                    className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300"
                >
                    <span className="flex items-center gap-2">
                        <CheckCircle2 size={16} />
                        {notification}
                    </span>
                    <button
                        onClick={() => setNotification(null)}
                        aria-label="Cerrar aviso"
                    >
                        <X size={15} />
                    </button>
                </div>
            )}

            {editing ? (
                <EditCardForm
                    card={card}
                    onCancel={() => setEditing(false)}
                    onSuccess={handleSuccess}
                />
            ) : (
                <article className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                    <div className="flex items-start gap-3">
                        <div
                            className={`rounded-lg p-2.5 transition-colors duration-200 ${card.is_active
                                ? "bg-emerald-500/10 text-emerald-400"
                                : "bg-slate-700/40 text-slate-500"
                                }`}
                        >
                            {card.kind === "CREDIT" ? (
                                <CreditCard size={21} />
                            ) : (
                                <Landmark size={21} />
                            )}
                        </div>

                        <div className="min-w-0 flex-1">
                            <h3 className="truncate font-semibold">{card.name}</h3>

                            <p className="mt-1 text-xs text-slate-400">
                                {card.kind === "CREDIT" ? "Crédito" : "Débito"}
                                {card.issuer ? ` · ${card.issuer}` : ""}
                                {card.last_four ? ` · •••• ${card.last_four}` : ""}
                            </p>

                            <p className={`mt-1 text-xs ${card.is_active ? "text-emerald-400" : "text-slate-500"
                                }`}>
                                {card.is_active ? "Activa" : "Inactiva"}
                            </p>
                        </div>

                        <div className="flex shrink-0 gap-1">
                            <button
                                type="button"
                                onClick={() => setEditing(true)}
                                aria-label={`Editar ${card.name}`}
                                title="Editar tarjeta"
                                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-emerald-400"
                            >
                                <Pencil size={17} />
                            </button>

                            <div ref={popoverRef} className="relative">
                                <button
                                    type="button"
                                    onClick={() => setPopoverOpen(!popoverOpen)}
                                    aria-label={
                                        card.is_active
                                            ? `Desactivar ${card.name}`
                                            : `Activar ${card.name}`
                                    }
                                    aria-expanded={popoverOpen}
                                    title="Cambiar estado"
                                    className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-emerald-400"
                                >
                                    <Power size={17} />
                                </button>

                                {popoverOpen && (
                                    <div
                                        role="dialog"
                                        aria-label="Confirmar cambio de estado"
                                        className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-2xl"
                                    >
                                        <p className="text-sm font-semibold">
                                            {card.is_active
                                                ? "¿Desactivar tarjeta?"
                                                : "¿Activar tarjeta?"}
                                        </p>
                                        <p className="mt-2 text-xs text-slate-400">
                                            El historial financiero permanecerá intacto.
                                            {card.kind === "CREDIT" && card.is_active &&
                                                " La deuda pendiente no desaparecerá."}
                                        </p>

                                        {toggleState.error && (
                                            <p role="alert" className="mt-2 text-xs text-red-400">
                                                {toggleState.error}
                                            </p>
                                        )}

                                        <form action={toggleAction} className="mt-4 flex gap-2">
                                            <input type="hidden" name="id" value={card.id} />
                                            <input
                                                type="hidden"
                                                name="is_active"
                                                value={String(card.is_active)}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setPopoverOpen(false)}
                                                disabled={toggling}
                                                className="flex-1 rounded-lg border border-slate-600 px-2 py-2 text-xs"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={toggling}
                                                className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold disabled:opacity-50 ${card.is_active
                                                    ? "bg-red-500 text-white"
                                                    : "bg-emerald-500 text-slate-950"
                                                    }`}
                                            >
                                                {toggling ? "Guardando..." : "Confirmar"}
                                            </button>
                                        </form>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {card.kind === "CREDIT" ? (
                        <>
                            <div className="mt-4 flex items-end justify-between gap-3">
                                <div>
                                    <p className="text-xs text-slate-400">Deuda actual</p>
                                    <p className="mt-1 text-xl font-bold">{money(debt)}</p>
                                </div>
                                <div className="text-right">
                                    <p className="text-xs text-slate-400">Disponible</p>
                                    <p className="mt-1 font-semibold text-emerald-400">
                                        {money(available)}
                                    </p>
                                </div>
                            </div>
                            
                            <div
                                role="progressbar"
                                aria-label="Utilización del crédito"
                                aria-valuenow={Math.min(100, utilization)}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-700"
                            >
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
                                    style={{ width: `${percent}%` }}
                                />
                            </div>

                            <div className="mt-2 flex justify-between text-xs text-slate-400">
                                <span>Límite: {money(limit)}</span>
                                <span>{percent.toFixed(0)}% utilizado</span>
                            </div>

                            <div className="mt-3 flex justify-between border-t border-slate-800 pt-3 text-xs text-slate-400">
                                <span>Corte: día {card.cutoff_day}</span>
                                <span>Pago: día {card.due_day}</span>
                            </div>

                            {Number(balance?.over_limit_amount ?? 0) > 0 && (
                                <p className="mt-2 text-xs text-amber-400">
                                    Sobrelímite: {money(Number(balance?.over_limit_amount))}
                                </p>
                            )}
                        </>
                    ) : (
                        <div className="mt-4 border-t border-slate-800 pt-3">
                            <p className="text-xs text-slate-400">
                                {account?.name ?? "Cuenta vinculada"}
                            </p>
                            <p className="mt-1 text-xl font-bold">
                                {account
                                    ? money(Number(account.current_balance))
                                    : "—"}
                            </p>
                        </div>
                    )}
                </article>
            )}
        </div>
    );
}