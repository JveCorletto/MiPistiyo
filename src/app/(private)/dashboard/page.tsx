import { Suspense } from "react";
import { connection } from "next/server";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  CreditCard,
  Landmark,
  Scale,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);

function SummaryCard({
  title,
  value,
  icon: Icon,
  color,
}: {
  title: string;
  value: number;
  icon: React.ComponentType<{ size?: number }>;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {title}
        </p>
        <span className={color}>
          <Icon size={22} />
        </span>
      </div>
      <p className="text-2xl font-bold">
        {money(value)}
      </p>
    </div>
  );
}

async function DashboardContent() {
  await connection();

  const supabase = await createClient();

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/El_Salvador",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const month = `${today.slice(0, 7)}-01`;

  const { data, error } = await supabase.rpc(
    "get_dashboard",
    { p_month: month }
  );

  if (error) {
    return (
      <div className="rounded-xl border border-red-900 bg-red-950/30 p-5 text-red-300">
        No se pudo cargar el resumen financiero:
        {" "}{error.message}
      </div>
    );
  }

  const summary = data?.[0];

  if (!summary) {
    return (
      <p className="text-slate-400">
        No hay información financiera disponible.
      </p>
    );
  }

  const cards = [
    {
      title: "Ingresos del mes",
      value: Number(summary.income),
      icon: TrendingUp,
      color: "text-emerald-400",
    },
    {
      title: "Gastos del mes",
      value: Number(summary.expense),
      icon: TrendingDown,
      color: "text-rose-400",
    },
    {
      title: "Dinero disponible",
      value: Number(summary.cash_available),
      icon: Wallet,
      color: "text-sky-400",
    },
    {
      title: "Deuda en tarjetas",
      value: Number(summary.credit_debt),
      icon: CreditCard,
      color: "text-amber-400",
    },
    {
      title: "Deuda en préstamos",
      value: Number(summary.loan_debt),
      icon: Landmark,
      color: "text-violet-400",
    },
    {
      title: "Patrimonio neto",
      value: Number(summary.net_worth),
      icon: Scale,
      color: "text-emerald-400",
    },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card) => (
          <SummaryCard key={card.title} {...card} />
        ))}
      </div>

      <section className="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
        <h2 className="text-lg font-semibold">
          Balance mensual
        </h2>

        <p className="mt-2 text-3xl font-bold text-emerald-400">
          {money(Number(summary.balance))}
        </p>

        <p className="mt-3 text-sm text-slate-400">
          Diferencia entre ingresos y gastos
          reconocidos durante este mes.
        </p>
      </section>
    </>
  );
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          Mi Dashboard
        </h1>
        <p className="mt-2 text-slate-400">
          Tu situación financiera de un vistazo.
        </p>
      </div>

      <Suspense
        fallback={
          <p className="text-slate-400">
            Cargando tus finanzas...
          </p>
        }
      >
        <DashboardContent />
      </Suspense>
    </div>
  );
}