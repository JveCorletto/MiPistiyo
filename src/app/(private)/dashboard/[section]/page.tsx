import { notFound } from "next/navigation";
import {
  ArrowLeftRight,
  Wallet,
  CreditCard,
  HandCoins,
  ChartPie,
  Settings,
} from "lucide-react";

const sections = {
  movimientos: {
    title: "Movimientos",
    description: "Control de ingresos y gastos.",
    icon: ArrowLeftRight,
  },
  cuentas: {
    title: "Mis Cuentas",
    description: "Efectivo y cuentas bancarias.",
    icon: Wallet,
  },
  tarjetas: {
    title: "Mis Tarjetas",
    description: "Tarjetas de crédito y débito.",
    icon: CreditCard,
  },
  prestamos: {
    title: "Mis Préstamos",
    description: "Deudas y abonos.",
    icon: HandCoins,
  },
  presupuestos: {
    title: "Mis Presupuestos",
    description: "Planificación de gastos.",
    icon: ChartPie,
  },
  configuracion: {
    title: "Configuración",
    description: "Preferencias personales.",
    icon: Settings,
  },
};

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;

  if (!(section in sections)) {
    notFound();
  }

  const item = sections[
    section as keyof typeof sections
  ];

  const Icon = item.icon;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {item.title}
        </h1>
        <p className="mt-2 text-slate-400">
          {item.description}
        </p>
      </div>

      <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center">
        <Icon size={40} className="text-emerald-400" />

        <h2 className="text-xl font-semibold">
          Próximamente
        </h2>

        <p className="max-w-sm text-sm text-slate-400">
          Estamos preparando este módulo de MiPistiyo.
        </p>
      </div>
    </div>
  );
}