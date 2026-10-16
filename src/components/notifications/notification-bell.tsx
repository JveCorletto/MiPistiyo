"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

export function NotificationBell() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let disposed = false;
    async function refresh() {
      try {
        const response = await fetch("/api/notifications/count", { cache: "no-store" });
        if (!response.ok) return;
        const data: { unread?: number } = await response.json();
        if (!disposed) setUnread(Math.max(0, Number(data.unread) || 0));
      } catch { /* Red intermitente: no impedir navegación. */ }
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { disposed = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [pathname]);

  return <Link href="/dashboard/notificaciones"
    className="relative inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-800 hover:text-emerald-400 focus-visible:outline-2 focus-visible:outline-emerald-400"
    aria-label={unread ? `Notificaciones: ${unread} sin leer` : "Notificaciones"}>
    <Bell size={20}/>
    {unread > 0 && <span className="absolute -right-1 -top-1 flex min-h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500 px-1 text-[10px] font-bold text-slate-950">
      {unread > 99 ? "99+" : unread}
    </span>}
  </Link>;
}
