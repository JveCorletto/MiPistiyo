import { Suspense } from "react";
import { connection } from "next/server";
import {
  ArrowDownLeft,
  ArrowUpRight,
  History,
} from "lucide-react";

import { createClient } from "@/lib/supabase/server";
import { CreateMovementModal } from "@/components/movements/create-movement-modal";

const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(value);

async function MovementsContent() {
  await connection();

  const supabase = await createClient();

  // ============================================
  // 1. CONSULTAR DATOS
  // ============================================

  const [
    categoriesResult,
    accountsResult,
    cardsResult,
    transactionsResult,
    historicalResult,
  ] = await Promise.all([
    supabase
      .from("categories")
      .select("id,name,kind,is_active")
      .order("name"),

    supabase
      .from("accounts")
      .select("id,name,kind,is_active")
      .order("name"),

    supabase
      .from("cards")
      .select("id,name,kind,is_active")
      .order("name"),

    supabase
      .from("transactions")
      .select(`
        id,
        operation_id,
        kind,
        category_id,
        source_account_id,
        source_card_id,
        amount,
        description,
        created_at
      `)
      .order("created_at", { ascending: false })
      .limit(50),

    supabase
      .from("historical_transactions")
      .select(`
        id,
        kind,
        category_id,
        source_account_id,
        source_card_id,
        amount,
        description,
        effective_on
      `)
      .order("effective_on", { ascending: false })
      .limit(50),
  ]);

  // ============================================
  // 2. VALIDAR ERRORES
  // ============================================

  const queryError =
    categoriesResult.error ??
    accountsResult.error ??
    cardsResult.error ??
    transactionsResult.error ??
    historicalResult.error;

  if (queryError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-900 bg-red-950/30 p-5 text-red-400"
      >
        No se pudieron cargar los movimientos:
        {" "}
        {queryError.message}
      </div>
    );
  }

  // ============================================
  // 3. PREPARAR DATOS
  // ============================================

  const categories = categoriesResult.data ?? [];
  const accounts = accountsResult.data ?? [];
  const cards = cardsResult.data ?? [];
  const transactions = transactionsResult.data ?? [];
  const historicalTransactions = historicalResult.data ?? [];

  const categoryMap = new Map(
    categories.map((category) => [
      category.id,
      category.name,
    ])
  );

  const sourceMap = new Map([
    ...accounts.map(
      (account) => [account.id, account.name] as const
    ),
    ...cards.map(
      (card) => [card.id, card.name] as const
    ),
  ]);

  // ============================================
  // 4. CONSULTAR OPERACIONES DEL LIBRO MAYOR
  // ============================================

  const operationIds = [
    ...new Set(
      transactions.map((transaction) => transaction.operation_id)
    ),
  ];

  const { data: operations, error: operationsError } =
    operationIds.length > 0
      ? await supabase
          .from("operations")
          .select("id,effective_on,reversal_of")
          .in("id", operationIds)
      : { data: [], error: null };

  if (operationsError) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-red-900 bg-red-950/30 p-5 text-red-400"
      >
        No se pudieron consultar las operaciones:
        {" "}
        {operationsError.message}
      </div>
    );
  }

  const operationMap = new Map(
    (operations ?? []).map((operation) => [
      operation.id,
      operation,
    ])
  );

  // ============================================
  // 5. VALIDAR SI EXISTEN MOVIMIENTOS
  // ============================================

  const hasTransactions = transactions.length > 0;
  const hasHistorical = historicalTransactions.length > 0;
  const hasMovements = hasTransactions || hasHistorical;

  // ============================================
  // 6. RENDERIZAR PÁGINA
  // ============================================

  return (
    <div className="space-y-6">
      {/* ENCABEZADO */}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Movimientos
          </h1>

          <p className="mt-2 text-slate-400">
            Registra y consulta tus ingresos y gastos.
          </p>
        </div>

        <CreateMovementModal
          categories={categories.filter(
            (category) => category.is_active
          )}
          accounts={accounts.filter(
            (account) => account.is_active
          )}
          cards={cards.filter(
            (card) => card.is_active
          )}
        />
      </div>

      {/* ESTADO VACÍO */}

      {!hasMovements && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center">
          <ArrowUpRight
            size={36}
            className="mx-auto text-emerald-400"
          />

          <h2 className="mt-4 text-lg font-semibold">
            Todavía no tienes movimientos
          </h2>

          <p className="mt-2 text-sm text-slate-400">
            Registra tu primer ingreso o gasto
            para comenzar a controlar tus finanzas.
          </p>
        </div>
      )}

      {/* ===================================== */}
      {/* MOVIMIENTOS CONTABILIZADOS            */}
      {/* ===================================== */}

      {hasTransactions && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-semibold">
              Movimientos contabilizados
            </h2>

            <p className="mt-1 text-xs text-slate-400">
              Operaciones registradas en el libro mayor.
            </p>
          </div>

          {transactions.map((transaction) => {
            const operation = operationMap.get(
              transaction.operation_id
            );

            const sourceId =
              transaction.source_account_id ??
              transaction.source_card_id;

            const isIncome = transaction.kind === "INCOME";

            return (
              <article
                key={transaction.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 transition-colors hover:border-slate-700"
              >
                {/* ÍCONO */}

                <div
                  className={`rounded-lg p-2.5 ${
                    isIncome
                      ? "bg-emerald-500/10 text-emerald-400"
                      : "bg-red-500/10 text-red-400"
                  }`}
                >
                  {isIncome ? (
                    <ArrowDownLeft size={20} />
                  ) : (
                    <ArrowUpRight size={20} />
                  )}
                </div>

                {/* INFORMACIÓN */}

                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {transaction.description ||
                      categoryMap.get(transaction.category_id) ||
                      "Movimiento"}
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    {categoryMap.get(transaction.category_id) ??
                      "Sin categoría"}

                    {" · "}

                    {sourceId
                      ? sourceMap.get(sourceId) ??
                        "Cuenta o tarjeta"
                      : "Sin origen"}

                    {" · "}

                    {operation?.effective_on ?? "Sin fecha"}
                  </p>
                </div>

                {/* MONTO */}

                <p
                  className={`font-semibold ${
                    isIncome
                      ? "text-emerald-400"
                      : "text-white"
                  }`}
                >
                  {isIncome ? "+" : "-"}
                  {money(Number(transaction.amount))}
                </p>
              </article>
            );
          })}
        </section>
      )}

      {/* ===================================== */}
      {/* MOVIMIENTOS HISTÓRICOS                */}
      {/* ===================================== */}

      {hasHistorical && (
        <section className="space-y-3">
          <div>
            <div className="flex items-center gap-2">
              <History
                size={20}
                className="text-amber-400"
              />

              <h2 className="text-lg font-semibold">
                Movimientos históricos
              </h2>
            </div>

            <p className="mt-1 text-xs text-slate-400">
              Movimientos ya incluidos en los saldos
              iniciales. No modifican nuevamente tu dinero
              ni las deudas de tus tarjetas.
            </p>
          </div>

          {historicalTransactions.map((movement) => {
            const sourceId =
              movement.source_account_id ??
              movement.source_card_id;

            const isIncome = movement.kind === "INCOME";

            return (
              <article
                key={`historical-${movement.id}`}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/10 bg-slate-900 px-4 py-3 transition-colors hover:border-amber-500/30"
              >
                {/* ÍCONO HISTÓRICO */}

                <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-400">
                  <History size={20} />
                </div>

                {/* INFORMACIÓN */}

                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {movement.description ||
                      categoryMap.get(movement.category_id) ||
                      "Movimiento histórico"}
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    {categoryMap.get(movement.category_id) ??
                      "Sin categoría"}

                    {" · "}

                    {sourceId
                      ? sourceMap.get(sourceId) ??
                        "Cuenta o tarjeta"
                      : "Sin origen"}

                    {" · "}

                    {movement.effective_on}
                  </p>

                  <span className="mt-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
                    <History size={12} />
                    Incluido en saldo inicial
                  </span>
                </div>

                {/* MONTO */}

                <p
                  className={`font-semibold ${
                    isIncome
                      ? "text-emerald-400"
                      : "text-white"
                  }`}
                >
                  {isIncome ? "+" : "-"}
                  {money(Number(movement.amount))}
                </p>
              </article>
            );
          })}
        </section>
      )}
    </div>
  );
}

export default function MovementsPage() {
  return (
    <Suspense
      fallback={
        <div className="p-6 text-slate-400">
          Cargando movimientos...
        </div>
      }
    >
      <MovementsContent />
    </Suspense>
  );
}