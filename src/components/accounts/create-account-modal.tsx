"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Plus,
  X,
  CheckCircle2,
} from "lucide-react";

import { AccountForm } from "./account-form";

export function CreateAccountModal() {
  const [open, setOpen] = useState(false);
  const [notification, setNotification] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const closeModal = useCallback(() => {
    setOpen(false);
  }, []);

  const handleSuccess = useCallback((message: string) => {
    setOpen(false);
    setNotification(message);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeModal();
      }

      if (event.key === "Tab" && dialogRef.current) {
        const elements = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
          )
        );

        if (elements.length === 0) return;

        const first = elements[0];
        const last = elements[elements.length - 1];

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
      triggerRef.current?.focus();
    };
  }, [open, closeModal]);

  useEffect(() => {
    if (!notification) return;

    const timeout = setTimeout(() => {
      setNotification(null);
    }, 4000);

    return () => clearTimeout(timeout);
  }, [notification]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400"
      >
        <Plus size={18} />
        Nueva cuenta
      </button>

      {notification && (
        <div
          role="status"
          className="fixed right-4 top-20 z-[70] flex max-w-sm items-center gap-3 rounded-xl border border-emerald-500/30 bg-slate-800 px-4 py-3 text-sm text-emerald-300 shadow-xl"
        >
          <CheckCircle2 size={19} className="shrink-0" />
          <span>{notification}</span>
          <button
            type="button"
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
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeModal();
            }
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-account-title"
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h2
                  id="create-account-title"
                  className="text-xl font-bold"
                >
                  Nueva cuenta
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  Agrega una cuenta a MiPistiyo.
                </p>
              </div>

              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeModal}
                className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                aria-label="Cerrar modal"
              >
                <X size={20} />
              </button>
            </div>

            <AccountForm
              onSuccess={handleSuccess}
              onCancel={closeModal}
            />
          </div>
        </div>
      )}
    </>
  );
}