"use client";

import { useActionState, useEffect } from "react";
import { updateCard, type CardState, } from "@/app/(private)/dashboard/tarjetas/actions";
import type { CardRecord } from "./card-card";

type Props = {
  card: CardRecord;
  onCancel: () => void;
  onSuccess: (message: string) => void;
};

const initialState: CardState = {
  success: null,
  error: null,
};

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500";

export function EditCardForm({
  card,
  onCancel,
  onSuccess,
}: Props) {
  const [state, action, pending] = useActionState(
    updateCard,
    initialState
  );

  useEffect(() => {
    if (state.success) onSuccess(state.success);
  }, [state.success, onSuccess]);

  return (
    <form
      action={action}
      className="space-y-4 rounded-xl border border-emerald-500/30 bg-slate-900 p-5"
    >
      <h3 className="text-lg font-semibold">
        Editar tarjeta
      </h3>

      <p className="text-xs text-slate-400">
        {card.kind === "CREDIT"
          ? "Tarjeta de crédito"
          : "Tarjeta de débito"}
      </p>

      <input type="hidden" name="id" value={card.id} />

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          Nombre
        </label>
        <input
          name="name"
          defaultValue={card.name}
          maxLength={120}
          required
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          Banco emisor
        </label>
        <input
          name="issuer"
          defaultValue={card.issuer ?? ""}
          maxLength={150}
          className={inputClass}
        />
      </div>

      <div>
        <label className="mb-1 block text-sm text-slate-300">
          Últimos 4 dígitos
        </label>
        <input
          name="last_four"
          defaultValue={card.last_four ?? ""}
          maxLength={4}
          pattern="[0-9]{4}"
          inputMode="numeric"
          className={inputClass}
        />
      </div>

      {card.kind === "CREDIT" && (
        <>
          <div>
            <label className="mb-1 block text-sm text-slate-300">
              Límite de crédito
            </label>
            <input
              name="credit_limit"
              type="number"
              min="0.01"
              step="0.01"
              required
              defaultValue={String(card.credit_limit ?? "")}
              className={inputClass}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-300">
                Día de corte
              </label>
              <input
                name="cutoff_day"
                type="number"
                min="1"
                max="31"
                required
                defaultValue={card.cutoff_day ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-300">
                Día de pago
              </label>
              <input
                name="due_day"
                type="number"
                min="1"
                max="31"
                required
                defaultValue={card.due_day ?? ""}
                className={inputClass}
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm text-slate-300">
              Vencimiento respecto al corte
            </label>
            <select
              name="due_month_offset"
              defaultValue={card.due_month_offset}
              className={inputClass}
            >
              <option value="0">Mismo mes</option>
              <option value="1">Mes siguiente</option>
              <option value="2">Dos meses después</option>
            </select>
          </div>

          <label className="flex items-start gap-2 text-sm text-slate-300">
            <input
              name="enforce_credit_limit"
              type="checkbox"
              defaultChecked={card.enforce_credit_limit}
              className="mt-1 accent-emerald-500"
            />
            Impedir compras que superen el límite
          </label>
        </>
      )}

      {state.error && (
        <p
          role="alert"
          className="rounded-lg bg-red-500/10 p-3 text-sm text-red-400"
        >
          {state.error}
        </p>
      )}

      <div className="flex gap-2 border-t border-slate-800 pt-4">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-lg border border-slate-700 px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-emerald-500 px-3 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}