"use client";

import { useActionState } from "react";
import {
    createAccount,
    type AccountState,
} from "@/app/(private)/dashboard/cuentas/actions";

const initialAccountState: AccountState = {
    error: null,
    success: null,
};

export function AccountForm() {
    const [state, formAction, pending] = useActionState(
        createAccount,
        initialAccountState
    );

    return (
        <form
            action={formAction}
            className="space-y-5 rounded-xl border border-slate-800 bg-slate-900 p-6"
        >
            <div>
                <h2 className="text-xl font-semibold">
                    Nueva cuenta
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                    Registra dónde guardas tu dinero.
                </p>
            </div>

            <div>
                <label
                    htmlFor="account-name"
                    className="mb-2 block text-sm text-slate-300"
                >
                    Nombre de la cuenta
                </label>

                <input
                    id="account-name"
                    name="name"
                    type="text"
                    required
                    maxLength={120}
                    placeholder="Ej. Efectivo personal"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                />
            </div>

            <div>
                <label
                    htmlFor="account-kind"
                    className="mb-2 block text-sm text-slate-300"
                >
                    Tipo de cuenta
                </label>

                <select
                    id="account-kind"
                    name="kind"
                    required
                    defaultValue="CASH"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                >
                    <option value="CASH">Efectivo</option>
                    <option value="BANK">Cuenta bancaria</option>
                    <option value="WALLET">Billetera digital</option>
                </select>
            </div>

            <div>
                <label
                    htmlFor="opening-balance"
                    className="mb-2 block text-sm text-slate-300"
                >
                    Saldo inicial (USD)
                </label>

                <input
                    id="opening-balance"
                    name="opening_balance"
                    type="number"
                    min="0"
                    max="9999999999999999.99"
                    step="0.01"
                    defaultValue="0.00"
                    required
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                />

                <p className="mt-2 text-xs text-slate-500">
                    Dinero que ya tienes en esta cuenta.
                    No se registrará como ingreso.
                </p>
            </div>

            <div>
                <label
                    htmlFor="account-description"
                    className="mb-2 block text-sm text-slate-300"
                >
                    Descripción (opcional)
                </label>

                <textarea
                    id="account-description"
                    name="description"
                    maxLength={1000}
                    rows={3}
                    placeholder="Información adicional"
                    className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                />
            </div>

            <label className="flex items-start gap-3 text-sm text-slate-300">
                <input
                    type="checkbox"
                    name="allow_overdraft"
                    className="mt-1 accent-emerald-500"
                />
                <span>
                    Permitir sobregiro
                    <span className="block text-xs text-slate-500">
                        La cuenta podrá registrar saldos negativos.
                    </span>
                </span>
            </label>

            {state.error && (
                <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
                    {state.error}
                </p>
            )}

            {state.success && (
                <p role="status" className="rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-400">
                    {state.success}
                </p>
            )}

            <button
                type="submit"
                disabled={pending}
                className="w-full rounded-lg bg-emerald-500 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
            >
                {pending ? "Guardando..." : "Crear cuenta"}
            </button>
        </form>
    );
}