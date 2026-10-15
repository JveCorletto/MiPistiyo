"use client";

import { useActionState, useEffect, useState } from "react";
import {
  Plus, Pencil, Power, X, CheckCircle2
} from "lucide-react";
import {
  saveCategory, toggleCategory, seedCategories,
  type CategoryState
} from "./actions";

type Category = {
  id: string;
  name: string;
  kind: "INCOME" | "EXPENSE";
  color: string | null;
  is_active: boolean;
};

const emptyState: CategoryState = {
  error: null,
  success: null,
};

function CategoryForm({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [state, action, pending] = useActionState(
    saveCategory, emptyState
  );

  useEffect(() => {
    if (state.success) onSaved(state.success);
  }, [state.success, onSaved]);

  return (
    <form action={action} className="space-y-4">
      <input
        type="hidden"
        name="id"
        value={category?.id ?? ""}
      />
      <div>
        <label className="mb-2 block text-sm">Nombre</label>
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={category?.name ?? ""}
          placeholder="Ej. Mascotas"
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
        />
      </div>
      <div>
        <label className="mb-2 block text-sm">Tipo</label>
        <select
          name="kind"
          defaultValue={category?.kind ?? "EXPENSE"}
          disabled={!!category}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
        >
          <option value="EXPENSE">Gasto</option>
          <option value="INCOME">Ingreso</option>
        </select>
        {category && (
          <input type="hidden" name="kind" value={category.kind}/>
        )}
      </div>
      <div className="flex items-center gap-3">
        <label htmlFor="category-color" className="text-sm">
          Color
        </label>
        <input
          id="category-color"
          name="color"
          type="color"
          defaultValue={category?.color ?? "#10B981"}
          className="h-10 w-14 cursor-pointer"
        />
      </div>
      {state.error && (
        <p role="alert" className="text-sm text-red-400">
          {state.error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          disabled={pending}
          className="rounded-lg border border-slate-700 px-4 py-2"
        >
          Cancelar
        </button>
        <button
          disabled={pending}
          className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
        >
          {pending ? "Guardando..." : "Guardar"}
        </button>
      </div>
    </form>
  );
}

export function CategoryManager({
  categories,
}: {
  categories: Category[];
}) {
  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Category | null>(null);

  function saved(text: string) {
    setMessage(text);
    setOpen(false);
  }

  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 justify-end">
        <form action={seedCategories}>
          <button className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800">
            Agregar categorías sugeridas
          </button>
        </form>
        <button
          onClick={() => { setEditing(null); setOpen(true); }}
          className="flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950"
        >
          <Plus size={17}/> Nueva categoría
        </button>
      </div>

      {message && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm text-emerald-400">
          <CheckCircle2 size={17}/>{message}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        {(["INCOME", "EXPENSE"] as const).map(kind => (
          <section key={kind} className="space-y-3">
            <h2 className="text-lg font-semibold">
              {kind === "INCOME" ? "Ingresos" : "Gastos"}
            </h2>
            {categories.filter(c => c.kind === kind).map(c => (
              <div key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
                <span
                  className={`h-3 w-3 rounded-full ${!c.is_active ? "opacity-30" : ""}`}
                  style={{ backgroundColor: c.is_active ? (c.color ?? "#10B981") : "#64748B" }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{c.name}</p>
                  <p className="text-xs text-slate-500">
                    {c.is_active ? "Activa" : "Archivada"}
                  </p>
                </div>
                <button
                  title="Editar"
                  onClick={() => { setEditing(c); setOpen(true); }}
                  className="p-2 text-slate-400 hover:text-emerald-400"
                >
                  <Pencil size={17}/>
                </button>
                <button
                  title={c.is_active ? "Archivar" : "Reactivar"}
                  onClick={() => setConfirm(c)}
                  className="p-2 text-slate-400 hover:text-emerald-400"
                >
                  <Power size={17}/>
                </button>
              </div>
            ))}
          </section>
        ))}
      </div>

      {open && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4">
          <div role="dialog" aria-modal="true" aria-label="Editar categoría" className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold">
                {editing ? "Editar categoría" : "Nueva categoría"}
              </h2>
              <button onClick={() => setOpen(false)} aria-label="Cerrar"><X size={20}/></button>
            </div>
            <CategoryForm
              key={editing?.id ?? "new"}
              category={editing}
              onClose={() => setOpen(false)}
              onSaved={saved}
            />
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div role="dialog" aria-modal="true" aria-label="Confirmar estado" className="w-full max-w-sm rounded-xl bg-slate-800 p-5">
            <h2 className="font-semibold">
              {confirm.is_active ? "¿Archivar categoría?" : "¿Reactivar categoría?"}
            </h2>
            <p className="my-3 text-sm text-slate-400">
              Su historial financiero permanecerá intacto.
            </p>
            <form
              action={async form => {
                await toggleCategory(form);
                setConfirm(null);
                setMessage("Estado actualizado.");
              }}
              className="flex justify-end gap-2"
            >
              <input type="hidden" name="id" value={confirm.id}/>
              <input type="hidden" name="active" value={String(confirm.is_active)}/>
              <button type="button" onClick={() => setConfirm(null)} className="rounded-lg border border-slate-600 px-3 py-2 text-sm">Cancelar</button>
              <button className="rounded-lg bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Confirmar</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}