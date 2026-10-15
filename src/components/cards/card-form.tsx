"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createCard,
  type CardState,
} from "@/app/(private)/dashboard/tarjetas/actions";

type BankAccount = {
  id: string;
  name: string;
};

type Props = {
  accounts: BankAccount[];
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

const initialState: CardState = {
  error: null,
  success: null,
};

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500";

export function CardForm({
  accounts,
  onSuccess,
  onCancel,
}: Props) {
  const [kind, setKind] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [state, action, pending] = useActionState(
    createCard,
    initialState
  );

  useEffect(() => {
    if (state.success) onSuccess(state.success);
  }, [state.success, onSuccess]);

  return (
    <form action={action} className="space-y-4">
      <div>
        <label className="mb-2 block text-sm text-slate-300">
          Tipo de tarjeta
        </label>
        <select
          name="kind"
          value={kind}
          onChange={(e) =>
            setKind(e.target.value as "DEBIT" | "CREDIT")
          }
          className={inputClass}
          disabled={pending}
        >
          <option value="DEBIT">Débito</option>
          <option value="CREDIT">Crédito</option>
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-2 block text-sm text-slate-300">
            Nombre
          </label>
          <input
            name="name"
            required
            maxLength={120}
            placeholder="Visa principal"
            className={inputClass}
          />
        </div>

        <div>
          <label className="mb-2 block text-sm text-slate-300">
            Banco emisor
          </label>
          <input
            name="issuer"
            maxLength={150}
            placeholder="Banco"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label className="mb-2 block text-sm text-slate-300">
          Últimos 4 dígitos (opcional)
        </label>
        <input
          name="last_four"
          maxLength={4}
          inputMode="numeric"
          pattern="[0-9]{4}"
          placeholder="1234"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-slate-500">
          Nunca introduzcas el número completo ni el CVV.
        </p>
      </div>

      {kind === "DEBIT" ? (
        <div>
          <label className="mb-2 block text-sm text-slate-300">
            Cuenta bancaria vinculada
          </label>
          <select
            name="account_id"
            required
            defaultValue=""
            className={inputClass}
          >
            <option value="" disabled>
              Selecciona una cuenta
            </option>
            {accounts.map((account) => (
              <option value={account.id} key={account.id}>
                {account.name}
              </option>
            ))}
          </select>
          {accounts.length === 0 && (
            <p className="mt-2 text-xs text-amber-400">
              Primero debes crear una cuenta bancaria activa
              en Mis Cuentas.
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Límite de crédito
              </label>
              <input
                type="number"
                name="credit_limit"
                min="0.01"
                step="0.01"
                required
                placeholder="1000.00"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Deuda inicial
              </label>
              <input
                type="number"
                name="opening_debt"
                min="0"
                step="0.01"
                required
                defaultValue="0.00"
                className={inputClass}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Día de corte
              </label>
              <input
                name="cutoff_day"
                type="number"
                min="1"
                max="31"
                required
                placeholder="15"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Día de pago
              </label>
              <input
                name="due_day"
                type="number"
                min="1"
                max="31"
                required
                placeholder="5"
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-slate-300">
                Pago respecto al corte
              </label>
              <select
                name="due_month_offset"
                defaultValue="1"
                className={inputClass}
              >
                <option value="0">Mismo mes</option>
                <option value="1">Mes siguiente</option>
                <option value="2">Dos meses después</option>
              </select>
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              name="enforce_credit_limit"
              className="mt-1 accent-emerald-500"
            />
            <span>
              Impedir compras que superen el límite de crédito
            </span>
          </label>

          <p className="text-xs text-slate-500">
            El saldo inicial representa lo que ya le debes al
            banco. No se registrará nuevamente como gasto.
          </p>
        </>
      )}

      {state.error && (
        <p role="alert" className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex justify-end gap-3 border-t border-slate-800 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending || (kind === "DEBIT" && accounts.length === 0)}
          className="rounded-lg bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Registrar tarjeta"}
        </button>
      </div>
    </form>
  );
}