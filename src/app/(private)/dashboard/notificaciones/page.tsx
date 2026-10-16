import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { Bell, BellRing, CalendarClock, CreditCard, Landmark, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  markAllNotificationsRead, markNotificationRead, saveNotificationPreferences,
} from "./actions";

type Notice = {
  id: string;
  kind: "RECURRING" | "CARD" | "LOAN";
  title: string;
  message: string;
  href: string;
  due_on: string;
  created_at: string;
  read_at: string | null;
};
type Preferences = {
  remind_days: number;
  recurring_enabled: boolean;
  cards_enabled: boolean;
  loans_enabled: boolean;
  email_enabled: boolean;
};

function dateLabel(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return new Intl.DateTimeFormat("es-SV", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  }).format(date);
}

const field = "w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white focus:border-emerald-500 focus:outline-none";
const panel = "rounded-2xl border border-slate-800 bg-slate-900/80 p-5";

async function NotificationsContent() {
  await connection();
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return <p role="alert">Necesitás iniciar sesión.</p>;

  // La primera visita crea preferencias predeterminadas y prepara avisos del usuario.
  const refresh = await supabase.rpc("refresh_due_notifications");
  if (refresh.error) return <p role="alert" className="text-rose-300">No se pudieron generar los avisos: {refresh.error.message}</p>;

  const [noticesResult, prefsResult] = await Promise.all([
    supabase.from("notifications")
      .select("id,kind,title,message,href,due_on,created_at,read_at")
      .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_preferences")
      .select("remind_days,recurring_enabled,cards_enabled,loans_enabled,email_enabled")
      .eq("user_id", user.id).single(),
  ]);
  if (noticesResult.error || prefsResult.error) {
    return <p role="alert" className="text-rose-300">No se pudieron cargar los avisos: {noticesResult.error?.message ?? prefsResult.error?.message}</p>;
  }

  const notices = (noticesResult.data ?? []) as Notice[];
  const prefs = prefsResult.data as Preferences;
  const unread = notices.filter((notice) => !notice.read_at).length;
  const emailConfigured = Boolean(process.env.RESEND_API_KEY && process.env.RESEND_FROM && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.CRON_SECRET && process.env.NEXT_PUBLIC_APP_URL);

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-emerald-400"><BellRing size={19}/><span className="text-xs font-semibold uppercase tracking-[.18em]">MiPistiyo</span></div>
        <h1 className="mt-2 text-3xl font-bold">Notificaciones</h1>
        <p className="mt-1 text-sm text-slate-400">Vencimientos próximos y pagos programados. Ningún aviso descuenta dinero.</p>
      </div>
      {unread > 0 && <form action={markAllNotificationsRead}>
        <button className="inline-flex items-center gap-2 rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:bg-slate-800" type="submit">
          <CheckCheck size={16}/> Marcar todas como leídas ({unread})
        </button>
      </form>}
    </header>

    <section className="grid gap-5 lg:grid-cols-[1.45fr_1fr]">
      <div className={panel}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold"><Bell size={18} className="text-emerald-400"/> Avisos recientes</h2>
        {notices.length === 0 ? <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">No hay vencimientos cercanos con tu configuración actual.</p> :
          <div className="space-y-3">
            {notices.map((notice) => {
              const Icon = notice.kind === "RECURRING" ? CalendarClock : notice.kind === "CARD" ? CreditCard : Landmark;
              return <article key={notice.id} className={`rounded-xl border p-4 ${notice.read_at ? "border-slate-800 bg-slate-950/50" : "border-emerald-500/25 bg-emerald-500/5"}`}>
                <div className="flex items-start gap-3">
                  <div className="rounded-lg bg-slate-800 p-2 text-emerald-400"><Icon size={18}/></div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold">{notice.title}</p>
                    <p className="text-xs text-slate-400">{dateLabel(notice.due_on)}</p>
                    <p className="pt-1 text-sm text-slate-300">{notice.message}</p>
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <Link href={notice.href} className="text-xs font-medium text-emerald-400 hover:underline">Ver módulo →</Link>
                      {!notice.read_at && <form action={markNotificationRead}>
                        <input type="hidden" name="notification_id" value={notice.id}/>
                        <button type="submit" className="text-xs text-slate-400 hover:text-white">Marcar como leído</button>
                      </form>}
                    </div>
                  </div>
                  {!notice.read_at && <span className="mt-2 h-2 w-2 rounded-full bg-emerald-400" aria-label="Sin leer"/>}
                </div>
              </article>;
            })}
          </div>
        }
        {notices.length === 100 && <p className="mt-4 text-xs text-amber-300">Mostrando los últimos 100 avisos.</p>}
      </div>

      <div className={`${panel} h-fit`}>
        <h2 className="mb-2 text-lg font-semibold">Preferencias</h2>
        <p className="mb-4 text-xs text-slate-400">Se aplican a nuevos avisos. Los ya generados permanecen en el historial.</p>
        <form action={saveNotificationPreferences} className="space-y-4">
          <div>
            <label htmlFor="remind_days" className="mb-1 block text-sm text-slate-300">Avisarme con anticipación</label>
            <select id="remind_days" name="remind_days" defaultValue={String(prefs.remind_days)} className={field}>
              {[0,1,2,3,5,7,14].map((days) => <option key={days} value={days}>{days === 0 ? "El día del vencimiento" : `${days} días antes`}</option>)}
            </select>
          </div>
          {([
            ["recurring_enabled","Pagos recurrentes",prefs.recurring_enabled],
            ["cards_enabled","Tarjetas de crédito",prefs.cards_enabled],
            ["loans_enabled","Préstamos",prefs.loans_enabled],
          ] as const).map(([name,label,checked]) => <label key={name} className="flex cursor-pointer items-center justify-between gap-3 text-sm text-slate-300">
            {label}<input type="checkbox" name={name} defaultChecked={checked} className="h-4 w-4 accent-emerald-500"/>
          </label>)}
          <div className="border-t border-slate-800 pt-4">
            <label className="flex items-center justify-between gap-3 text-sm text-slate-300">También enviarme correos
              <input type="checkbox" name="email_enabled" defaultChecked={prefs.email_enabled} disabled={!emailConfigured} className="h-4 w-4 accent-emerald-500"/>
            </label>
            <p className="mt-2 text-xs text-slate-500">{emailConfigured ? "Utiliza el correo de tu cuenta de Google. Los envíos requieren el cron activo en producción." : "Disponible después de configurar Resend, la clave de servicio y el cron del servidor."}</p>
          </div>
          <button type="submit" className="w-full rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-emerald-400">Guardar preferencias</button>
        </form>
        <p className="mt-4 text-xs leading-relaxed text-amber-200/90">Las fechas habituales de tarjetas y préstamos son orientativas: verificá siempre el estado de cuenta. Marcar un aviso como leído no confirma un pago.</p>
      </div>
    </section>
  </div>;
}

export default function NotificationsPage() {
  return <Suspense fallback={<p className="p-6 text-slate-400">Cargando avisos...</p>}><NotificationsContent/></Suspense>;
}
