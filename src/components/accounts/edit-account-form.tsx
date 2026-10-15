"use client";

import { useActionState, useEffect } from "react";
import {
  updateAccount,
  type AccountState,
} from "@/app/(private)/dashboard/cuentas/actions";

type Props = {
  account: {
    id: string;
    name: string;
    description: string | null;
  };
  onSuccess: (message: string) => void;
  onCancel: () => void;
};

const initialState: AccountState = {
  error: null,
  success: null,
};

export function EditAccountForm({
  account,
  onSuccess,
  onCancel,
}: Props) {
  const [state, formAction, pending] = useActionState(
    updateAccount,
    initialState
  );

  useEffect(() => {
    if (state.success) {
      onSuccess(state.success);
    }
  }, [state.success, onSuccess]);

  return (
    <form
      action={formAction}
      className="space-y-4 rounded-xl border border-emerald-500/30 bg-slate-900 p-5"
    >
      <h3 className="text-lg font-semibold">Editar cuenta</h3>

      <input type="hidden" name="id" value={account.id} />

      <div>
        <label htmlFor="edit-name" className="mb-2 block text-sm">
          Nombre
        </label>
        <input
          id="edit-name"
          name="name"
          type="text"
          defaultValue={account.name}
          maxLength={120}
          required
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-emerald-500"
        />
      </div>

      <div>
        <label htmlFor="edit-description" className="mb-2 block text-sm">
          Descripción
        </label>
        <textarea
          id="edit-description"
          name="description"
          defaultValue={account.description ?? ""}
          maxLength={1000}
          rows={3}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 outline-none focus:border-emerald-500"
        />
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="flex-1 rounded-lg border border-slate-700 px-4 py-2 disabled:opacity-50"
        >
          Cancelar
        </button>

        <button
          type="submit"
          disabled={pending}
          className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950 disabled:opacity-50"
        >
          {pending ? "Guardando..." : "Guardar cambios"}
        </button>
      </div>
    </form>
  );
}