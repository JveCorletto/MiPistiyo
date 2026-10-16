"use client";

import { useState } from "react";
import { Menu, CircleUserRound } from "lucide-react";
import { Sidebar } from "./sidebar";
import { NotificationBell } from "@/components/notifications/notification-bell";

type Props = {
  children: React.ReactNode;
  displayName: string;
  email: string;
};

export function AppShell({
  children,
  displayName,
  email,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <Sidebar
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      <div className="min-h-screen md:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-5 backdrop-blur md:px-8">
          <button
            onClick={() => setMenuOpen(true)}
            className="text-slate-300 md:hidden"
            aria-label="Abrir menú">
            <Menu size={24} />
          </button>

          <span className="hidden text-sm text-slate-400 md:block">
            Finanzas personales
          </span>

          <div className="flex items-center gap-3">
            <NotificationBell />
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium">
                {displayName}
              </p>
              <p className="text-xs text-slate-500">
                {email}
              </p>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
              <CircleUserRound size={21} />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-7xl p-5 md:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}