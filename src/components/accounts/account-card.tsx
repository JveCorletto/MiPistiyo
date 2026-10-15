"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  Landmark,
  Wallet,
  Pencil,
  Power,
  CheckCircle2,
  X,
} from "lucide-react";

import { EditAccountForm } from "./edit-account-form";
import { toggleAccount } from "@/app/(private)/dashboard/cuentas/actions";

export type Account = {
  id: string;
  name: string;
  kind: "CASH" | "BANK" | "WALLET";
  currency: string;
  current_balance: number | string;
  is_active: boolean;
  allow_overdraft: boolean;
  description: string | null;
};

const types = {
  CASH: { label: "Efectivo", icon: Banknote },
  BANK: { label: "Cuenta bancaria", icon: Landmark },
  WALLET: { label: "Billetera digital", icon: Wallet },
};

export function AccountCard({ account }: { account: Account }) {
  const [editing, setEditing] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const popoverRef = useRef<HTMLDivElement>(null);

  const handleSuccess = useCallback((message: string) => {
    setEditing(false);
    setNotification(message);
  }, []);

  useEffect(() => {
    if (!notification) return;

    const timeout = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timeout);
  }, [notification]);

  useEffect(() => {
    if (!popoverOpen) return;

    function handleOutside(event: PointerEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node)
      ) {
        setPopoverOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPopoverOpen(false);
    }

    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [popoverOpen]);

  const config = types[account.kind];
  const Icon = config.icon;

  const balance = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: account.currency,
  }).format(Number(account.current_balance));

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
            type="button"
            onClick={() => setNotification(null)}
            aria-label="Cerrar notificación"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {editing ? (
        <EditAccountForm
          account={account}
          onSuccess={handleSuccess}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="rounded-xl border border-slate-800 bg-slate-900 px-4 py-3">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5 text-emerald-400">
              <Icon size={21} />
            </div>

            <div className="min-w-0 flex-1">
              <h3 className="truncate font-semibold">
                {account.name}
              </h3>

              <p className="mt-0.5 text-xs text-slate-400">
                {config.label}
                <span className="mx-1.5">·</span>
                <span
                  className={
                    account.is_active
                      ? "text-emerald-400"
                      : "text-slate-500"
                  }
                >
                  {account.is_active ? "Activa" : "Inactiva"}
                </span>
              </p>

              <p className="mt-2 text-xl font-bold">
                {balance}
              </p>

              {account.description && (
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                  {account.description}
                </p>
              )}
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setEditing(true)}
                title="Editar cuenta"
                aria-label={`Editar ${account.name}`}
                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-400"
              >
                <Pencil size={17} />
              </button>

              <div ref={popoverRef} className="relative">
                <button
                  type="button"
                  title={
                    account.is_active
                      ? "Desactivar cuenta"
                      : "Activar cuenta"
                  }
                  aria-label={
                    account.is_active
                      ? `Desactivar ${account.name}`
                      : `Activar ${account.name}`
                  }
                  aria-expanded={popoverOpen}
                  onClick={() => setPopoverOpen(!popoverOpen)}
                  className={`rounded-lg p-2 transition-colors hover:bg-slate-800 ${
                    account.is_active
                      ? "text-slate-400 hover:text-red-400"
                      : "text-emerald-400"
                  }`}
                >
                  <Power size={17} />
                </button>

                {popoverOpen && (
                  <div
                    role="dialog"
                    aria-label="Confirmar estado de cuenta"
                    className="absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-slate-700 bg-slate-800 p-4 shadow-2xl"
                  >
                    <p className="text-sm font-semibold">
                      {account.is_active
                        ? "¿Desactivar cuenta?"
                        : "¿Activar cuenta?"}
                    </p>

                    <p className="mt-2 text-xs leading-relaxed text-slate-400">
                      {account.is_active
                        ? "La cuenta quedará inactiva, pero conservará su historial y saldo."
                        : "La cuenta volverá a estar disponible para registrar movimientos."}
                    </p>

                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={() => setPopoverOpen(false)}
                        className="flex-1 rounded-lg border border-slate-600 px-3 py-2 text-xs hover:bg-slate-700"
                      >
                        Cancelar
                      </button>

                      <form action={toggleAccount} className="flex-1">
                        <input
                          type="hidden"
                          name="id"
                          value={account.id}
                        />
                        <input
                          type="hidden"
                          name="is_active"
                          value={String(account.is_active)}
                        />

                        <button
                          type="submit"
                          className={`w-full rounded-lg px-3 py-2 text-xs font-semibold ${
                            account.is_active
                              ? "bg-red-500 text-white hover:bg-red-400"
                              : "bg-emerald-500 text-slate-950 hover:bg-emerald-400"
                          }`}
                        >
                          Confirmar
                        </button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}