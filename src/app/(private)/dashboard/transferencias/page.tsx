import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  TransferManager,
  type FinanceHistoryItem,
} from "@/components/transfers/transfer-manager";

async function TransfersContent() {
  await connection();
  const supabase = await createClient();

  const [
    accountsResult,
    balancesResult,
    cardsResult,
    cardBalancesResult,
    loansResult,
    loanBalancesResult,
    categoriesResult,
    transfersResult,
    cardPaymentsResult,
    loanPaymentsResult,
    externalResult,
  ] = await Promise.all([
    supabase.from("accounts").select("id,name,kind,is_active").order("name"),
    supabase.from("v_account_balances").select("id,current_balance"),
    supabase.from("cards").select("id,name,kind,is_active").order("name"),
    supabase.from("v_card_balances").select("id,current_debt"),
    supabase.from("loans").select("id,name,is_active").order("name"),
    supabase.from("v_loan_balances").select("id,current_debt"),
    supabase.from("categories").select("id,name,kind,is_active").order("name"),
    supabase.from("transfers")
      .select("id,operation_id,from_account_id,to_account_id,amount,created_at")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("card_payments")
      .select("id,operation_id,account_id,card_id,amount,created_at")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("loan_payments")
      .select("id,operation_id,account_id,loan_id,principal,interest,fees,created_at")
      .order("created_at", { ascending: false }).limit(50),
    // Las transferencias externas de esta versión se registran como gastos/ingresos
    // reales y quedan identificadas por un prefijo reservado en la descripción.
    supabase.from("transactions")
      .select("id,operation_id,kind,source_account_id,amount,description,created_at")
      .like("description", "Transferencia externa %")
      .order("created_at", { ascending: false }).limit(50),
  ]);

  const queryError = accountsResult.error ?? balancesResult.error ??
    cardsResult.error ?? cardBalancesResult.error ??
    loansResult.error ?? loanBalancesResult.error ??
    categoriesResult.error ?? transfersResult.error ??
    cardPaymentsResult.error ?? loanPaymentsResult.error ?? externalResult.error;

  if (queryError) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
      No se pudo cargar Transferencias y pagos: {queryError.message}
    </p>;
  }

  const balanceMap = new Map((balancesResult.data ?? [])
    .map((row) => [row.id, Number(row.current_balance)]));
  const debtMap = new Map((cardBalancesResult.data ?? [])
    .map((row) => [row.id, Number(row.current_debt)]));
  const loanDebtMap = new Map((loanBalancesResult.data ?? [])
    .map((row) => [row.id, Number(row.current_debt)]));

  const accounts = (accountsResult.data ?? []).map((account) => ({
    ...account, current_balance: balanceMap.get(account.id) ?? 0,
  }));
  const creditCards = (cardsResult.data ?? [])
    .filter((card) => card.kind === "CREDIT")
    .map((card) => ({
      id: card.id,
      name: card.name,
      is_active: card.is_active,
      current_debt: debtMap.get(card.id) ?? 0,
    }));
  const loans = (loansResult.data ?? []).map((loan) => ({
    ...loan, current_debt: loanDebtMap.get(loan.id) ?? 0,
  }));
  const categories = categoriesResult.data ?? [];

  const accountNames = new Map(accounts.map((item) => [item.id, item.name]));
  const cardNames = new Map(creditCards.map((item) => [item.id, item.name]));
  const loanNames = new Map(loans.map((item) => [item.id, item.name]));

  const transfers = transfersResult.data ?? [];
  const cardPayments = cardPaymentsResult.data ?? [];
  const loanPayments = loanPaymentsResult.data ?? [];
  const externalTransactions = externalResult.data ?? [];

  const operationIds = [...new Set([
    ...transfers.map((item) => item.operation_id),
    ...cardPayments.map((item) => item.operation_id),
    ...loanPayments.map((item) => item.operation_id),
    ...externalTransactions.map((item) => item.operation_id),
  ])];

  // Incluimos las operaciones de reverso para identificar pagos anulados
  // sin alterar ni borrar el historial contable.
  const { data: operations, error: operationsError } = operationIds.length
    ? await supabase.from("operations")
      .select("id,effective_on,memo,created_at,reversal_of")
      .or(`id.in.(${operationIds.join(",")}),reversal_of.in.(${operationIds.join(",")})`)
    : { data: [], error: null };

  if (operationsError) {
    return <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-red-300">
      No se pudo consultar el historial contable: {operationsError.message}
    </p>;
  }

  const operationMap = new Map((operations ?? []).map((op) => [op.id, op]));
  const reversedIds = new Set((operations ?? [])
    .filter((op) => op.reversal_of !== null)
    .map((op) => op.reversal_of));

  function info(operationId: string, fallbackCreated: string) {
    const op = operationMap.get(operationId);
    return {
      date: op?.effective_on ?? fallbackCreated.slice(0, 10),
      created_at: op?.created_at ?? fallbackCreated,
      reversed: reversedIds.has(operationId),
      note: op?.memo ?? "",
    };
  }

  const history: FinanceHistoryItem[] = [
    ...transfers.map((transfer): FinanceHistoryItem => ({
      id: `transfer-${transfer.id}`,
      type: "INTERNAL",
      title: "Transferencia entre mis cuentas",
      detail: `${accountNames.get(transfer.from_account_id) ?? "Cuenta"} → ${accountNames.get(transfer.to_account_id) ?? "Cuenta"}`,
      amount: Number(transfer.amount),
      ...info(transfer.operation_id, transfer.created_at),
    })),
    ...cardPayments.map((payment): FinanceHistoryItem => ({
      id: `card-${payment.id}`,
      type: "CARD",
      title: `Pago a ${cardNames.get(payment.card_id) ?? "tarjeta"}`,
      detail: `Desde ${accountNames.get(payment.account_id) ?? "cuenta"}`,
      amount: Number(payment.amount),
      ...info(payment.operation_id, payment.created_at),
    })),
    ...loanPayments.map((payment): FinanceHistoryItem => ({
      id: `loan-${payment.id}`,
      type: "LOAN",
      title: `Pago a ${loanNames.get(payment.loan_id) ?? "préstamo"}`,
      detail: `Desde ${accountNames.get(payment.account_id) ?? "cuenta"}`,
      amount: Number(payment.principal) + Number(payment.interest) + Number(payment.fees),
      breakdown: `Capital: $${Number(payment.principal).toFixed(2)} · Intereses: $${Number(payment.interest).toFixed(2)} · Comisiones: $${Number(payment.fees).toFixed(2)}`,
      ...info(payment.operation_id, payment.created_at),
    })),
    ...externalTransactions
      .filter((tx) => tx.description?.startsWith("Transferencia externa a:") ||
        tx.description?.startsWith("Transferencia externa de:"))
      .map((tx): FinanceHistoryItem => {
        const inbound = tx.description?.startsWith("Transferencia externa de:") ?? false;
        return {
          id: `external-${tx.id}`,
          type: inbound ? "EXTERNAL_IN" : "EXTERNAL_OUT",
          title: tx.description ?? "Transferencia externa",
          detail: inbound
            ? `Recibida en ${accountNames.get(tx.source_account_id ?? "") ?? "cuenta"}`
            : `Enviada desde ${accountNames.get(tx.source_account_id ?? "") ?? "cuenta"}`,
          amount: Number(tx.amount),
          ...info(tx.operation_id, tx.created_at),
        };
      }),
  ]
    .sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at))
    .slice(0, 80);

  return <TransferManager
    accounts={accounts}
    creditCards={creditCards}
    loans={loans}
    categories={categories}
    history={history}
  />;
}

export default function TransfersPage() {
  return <Suspense fallback={<div className="p-6 text-slate-400">Cargando transferencias y pagos...</div>}>
    <TransfersContent />
  </Suspense>;
}
