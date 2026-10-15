"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Wallet,
  CreditCard,
  HandCoins,
  ChartPie,
  Settings,
  LogOut,
  X,
} from "lucide-react";

import { signOut } from "@/app/auth/actions";

const menu = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
  },
  {
    label: "Movimientos",
    href: "/dashboard/movimientos",
    icon: ArrowLeftRight,
  },
  {
    label: "Cuentas",
    href: "/dashboard/cuentas",
    icon: Wallet,
  },
  {
    label: "Tarjetas",
    href: "/dashboard/tarjetas",
    icon: CreditCard,
  },
  {
    label: "Préstamos",
    href: "/dashboard/prestamos",
    icon: HandCoins,
  },
  {
    label: "Presupuestos",
    href: "/dashboard/presupuestos",
    icon: ChartPie,
  },
  {
    label: "Configuración",
    href: "/dashboard/configuracion",
    icon: Settings,
  },
];

type Props = {
  open: boolean;
  onClose: () => void;
};

export function Sidebar({ open, onClose }: Props) {
  const pathname = usePathname();

  return (
    <>
      {open && (
        <button
          aria-label="Cerrar menú"
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 flex w-64
          flex-col border-r border-slate-800
          bg-slate-950 transition-transform
          md:translate-x-0
          ${open ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        <div className="flex h-20 items-center justify-between border-b border-slate-800 px-6">
          <div>
            <h1 className="text-2xl font-bold text-emerald-400">
              MiPistiyo.
            </h1>
            <p className="text-xs text-slate-500">
              Tu pisto, bajo control.
            </p>
          </div>

          <button
            onClick={onClose}
            className="text-slate-400 md:hidden"
            aria-label="Cerrar menú"
          >
            <X size={22} />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {menu.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`
                  flex items-center gap-3 rounded-lg
                  px-4 py-3 text-sm transition-colors
                  ${
                    active
                      ? "bg-emerald-500/15 font-semibold text-emerald-400"
                      : "text-slate-400 hover:bg-slate-800 hover:text-white"
                  }
                `}
              >
                <Icon size={19} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-slate-800 p-4">
          <form action={signOut}>
            <button
              type="submit"
              className="flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm text-red-400 hover:bg-red-500/10"
            >
              <LogOut size={19} />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>
    </>
  );
}