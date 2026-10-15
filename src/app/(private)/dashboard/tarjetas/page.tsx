import { Suspense } from "react";
import { connection } from "next/server";
import { CreditCard, Landmark, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

import { CreateCardModal } from "@/components/cards/create-card-modal";
import { CardCard, type CardRecord, type CardBalance, } from "@/components/cards/card-card";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(n);

async function CardsContent() {
  await connection();

  const supabase = await createClient();

  const [cardsResult, balancesResult, accountsResult] =
    await Promise.all([
      supabase
        .from("cards")
        .select(
          "id,name,kind,issuer,last_four,account_id,credit_limit,cutoff_day,due_day,due_month_offset,enforce_credit_limit,is_active"
        )

        .order("created_at", { ascending: false }),

      supabase
        .from("v_card_balances")
        .select(
          "id,current_debt,available_credit,over_limit_amount"
        ),

      supabase
        .from("v_account_balances")
        .select("id,name,kind,is_active,current_balance"),
    ]);

  if (
    cardsResult.error ||
    balancesResult.error ||
    accountsResult.error
  ) {
    return (
      <p role="alert" className="rounded-lg bg-red-500/10 p-4 text-red-400">
        No se pudieron cargar las tarjetas:
        {" "}
        {cardsResult.error?.message ??
          balancesResult.error?.message ??
          accountsResult.error?.message}
      </p>
    );
  }

  const cards = (cardsResult.data ?? []) as CardRecord[];
  const balances = (balancesResult.data ?? []) as CardBalance[];
  const accounts = accountsResult.data ?? [];

  const balanceMap = new Map(balances.map((b) => [b.id, b]));
  const accountMap = new Map(accounts.map((a) => [a.id, a]));

  const bankAccounts = accounts
    .filter((a) => a.kind === "BANK" && a.is_active)
    .map((a) => ({ id: a.id, name: a.name }));

  const creditCards = cards.filter((c) => c.kind === "CREDIT");

  const totalDebt = creditCards.reduce(
    (sum, card) =>
      sum + Number(balanceMap.get(card.id)?.current_debt ?? 0),
    0
  );

  const totalAvailable = creditCards.reduce(
    (sum, card) =>
      sum + Number(balanceMap.get(card.id)?.available_credit ?? 0),
    0
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Mis Tarjetas</h1>
          <p className="mt-2 text-slate-400">
            Controla tus tarjetas de crédito y débito.
          </p>
        </div>

        <CreateCardModal accounts={bankAccounts} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">
            Deuda total en tarjetas
          </p>
          <p className="mt-2 text-2xl font-bold">
            {money(totalDebt)}
          </p>
        </div>

        <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
          <p className="text-sm text-slate-400">
            Crédito disponible
          </p>
          <p className="mt-2 text-2xl font-bold text-emerald-400">
            {money(totalAvailable)}
          </p>
        </div>
      </div>

      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-10 text-center">
          <CreditCard
            size={40}
            className="mx-auto text-emerald-400"
          />
          <h2 className="mt-4 text-lg font-semibold">
            Todavía no tienes tarjetas
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            Registra tu primera tarjeta para comenzar.
          </p>
        </div>
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
          {cards.map((card) => {
            const balance = balanceMap.get(card.id);

            const linkedAccount = card.account_id
              ? accountMap.get(card.account_id)
              : undefined;

            return (
              <CardCard
                key={card.id}
                card={card}
                balance={balance}
                account={
                  linkedAccount
                    ? {
                      name: linkedAccount.name,
                      current_balance: linkedAccount.current_balance,
                    }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CardsPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6 text-slate-400">
          Cargando tarjetas...
        </p>
      }
    >
      <CardsContent />
    </Suspense>
  );
}