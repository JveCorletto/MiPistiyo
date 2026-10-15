"use client";

import { useActionState, useEffect } from "react";
import {
  createAccount,
  type AccountState,
} from "@/app/(private)/dashboard/cuentas/actions";

type Props = {
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

const initialState: AccountState = {
  error: null,
  success: null,
};

export function AccountForm({ onSuccess, onCancel }: Props) {
  const [state, formAction, pending] = useActionState(
    createAccount,
    initialState
  );

  useEffect(() => {
    if (state.success) {
      onSuccess(state.success);
    }
  }, [state.success, onSuccess]);

  return (
    <form action={formAction} className="space-y-4">
      <div>
        <label htmlFor="account-name" className="mb-2 block text-sm text-slate-300">
          Nombre de la cuenta
        </label>
        <input
          id="account-name"
          name="name"
          type="text"
          required
          maxLength={120}
          placeholder="Ej. Cuenta de ahorro"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
        />
      </div>

      <div>
        <label htmlFor="account-kind" className="mb-2 block text-sm text-slate-300">
          Tipo de cuenta
        </label>
        <select
          id="account-kind"
          name="kind"
          defaultValue="CASH"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
        >
          <option value="CASH">Efectivo</option>
          <option value="BANK">Cuenta bancaria</option>
          <option value="WALLET">Billetera digital</option>
        </select>
      </div>

      <div>
        <label htmlFor="opening-balance" className="mb-2 block text-sm text-slate-300">
          Saldo inicial (USD)
        </label>
        <input
          id="opening-balance"
          name="opening_balance"
          type="number"
          min="0"
          step="0.01"
          defaultValue="0.00"
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
        />
        <p className="mt-1 text-xs text-slate-500">
          No se contabilizará como ingreso.
        </p>
      </div>

      <div>
        <label htmlFor="account-description" className="mb-2 block text-sm text-slate-300">
          Descripción (opcional)
        </label>
        <textarea
          id="account-description"
          name="description"
          maxLength={1000}
          rows={2}
          placeholder="Información adicional"
          className="w-full resize-none rounded-lg border border-slate-700 bg-slate-950 px-4 py-2.5 text-white outline-none focus:border-emerald-500"
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
            Permite registrar saldos negativos.
          </span>
        </span>
      </label>

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          Cancelar
        </button>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Crear cuenta"}
        </button>
      </div>
    </form>
  );
}