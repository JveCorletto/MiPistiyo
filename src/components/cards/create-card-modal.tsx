"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Plus, X, CheckCircle2 } from "lucide-react";
import { CardForm } from "./card-form";

type Props = {
  accounts: { id: string; name: string }[];
};

export function CreateCardModal({ accounts }: Props) {
  const [open, setOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  const success = useCallback((message: string) => {
    setOpen(false);
    setNotification(message);
  }, []);

  useEffect(() => {
    if (!open) return;

    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );

    focusable()[0]?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();

      if (event.key !== "Tab") return;

      const elements = focusable();
      const first = elements[0];
      const last = elements[elements.length - 1];

      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = oldOverflow;
      document.removeEventListener("keydown", onKeyDown);
      triggerRef.current?.focus();
    };
  }, [open, close]);

  useEffect(() => {
    if (!notification) return;
    const timeout = setTimeout(() => setNotification(null), 4000);
    return () => clearTimeout(timeout);
  }, [notification]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
      >
        <Plus size={18} />
        Nueva tarjeta
      </button>

      {notification && (
        <div
          role="status"
          className="fixed right-4 top-20 z-[70] flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-slate-800 px-4 py-3 text-sm text-emerald-300 shadow-xl"
        >
          <CheckCircle2 size={18} />
          {notification}
          <button
            onClick={() => setNotification(null)}
            aria-label="Cerrar notificación"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {open && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-card-title"
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between">
              <div>
                <h2
                  id="create-card-title"
                  className="text-xl font-bold"
                >
                  Nueva tarjeta
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Registra una tarjeta de crédito o débito.
                </p>
              </div>
              <button
                type="button"
                onClick={close}
                aria-label="Cerrar modal"
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800"
              >
                <X size={20} />
              </button>
            </div>

            <CardForm
              accounts={accounts}
              onCancel={close}
              onSuccess={success}
            />
          </div>
        </div>
      )}
    </>
  );
}