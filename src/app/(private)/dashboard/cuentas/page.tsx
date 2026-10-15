import { Suspense } from "react";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Banknote, Landmark, Wallet, CheckCircle2, Ban, } from "lucide-react";

import { toggleAccount } from "./actions";
import { AccountCard, type Account, } from "@/components/accounts/account-card";
import { CreateAccountModal } from "@/components/accounts/create-account-modal";

const currencyFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
});

const accountTypes = {
    CASH: { label: "Efectivo", icon: Banknote },
    BANK: { label: "Cuenta bancaria", icon: Landmark },
    WALLET: { label: "Billetera digital", icon: Wallet },
};

async function AccountsContent() {
    await connection();

    const supabase = await createClient();


    const { data, error } = await supabase
        .from("v_account_balances")
        .select(
            "id, name, kind, currency, current_balance, is_active, allow_overdraft"
        )
        .order("name", { ascending: true });

    const { data: accountDetails, error: detailsError } =
        await supabase
            .from("accounts")
            .select("id, description");

    if (detailsError) {
        console.error(
            "Error consultando detalles:",
            detailsError.message
        );
    }

    const descriptionMap = new Map(
        (accountDetails ?? []).map((account) => [
            account.id,
            account.description,
        ])
    );

    const accountsWithDescription = (data ?? []).map(
        (account) => ({
            ...account,
            description: descriptionMap.get(account.id) ?? null,
        })
    );


    const accounts = accountsWithDescription as Account[];

    const activeAccounts = accounts.filter(
        (account) => account.is_active
    );

    const totalBalance = activeAccounts.reduce(
        (sum, account) => sum + Number(account.current_balance),
        0
    );

    return (
        <div className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                    <p className="text-sm text-slate-400">
                        Saldo de cuentas activas
                    </p>

                    <p className="mt-3 text-3xl font-bold text-emerald-400">
                        {currencyFormatter.format(totalBalance)}
                    </p>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                    <p className="text-sm text-slate-400">
                        Cuentas activas
                    </p>

                    <p className="mt-3 text-3xl font-bold">
                        {activeAccounts.length}
                    </p>
                </div>
            </div>

            <div className="space-y-4">
                <section className="space-y-4">
                    <h2 className="text-xl font-semibold">
                        Mis cuentas registradas
                    </h2>

                    {accounts.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-10 text-center">
                            <Wallet
                                size={36}
                                className="mx-auto text-emerald-400"
                            />

                            <h3 className="mt-4 text-lg font-semibold">
                                Todavía no tienes cuentas
                            </h3>

                            <p className="mt-2 text-sm text-slate-400">
                                Crea tu primera cuenta para comenzar
                                a controlar tu dinero.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {accounts.map((account) => (
                                <AccountCard
                                    key={account.id}
                                    account={account}
                                />
                            ))}
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
}


export default function AccountsPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">
            Mis Cuentas
          </h1>
          <p className="mt-2 text-slate-400">
            Administra tu efectivo, bancos y billeteras.
          </p>
        </div>

        <CreateAccountModal />
      </div>

      <Suspense
        fallback={
          <p className="text-slate-400">
            Cargando cuentas...
          </p>
        }
      >
        <AccountsContent />
      </Suspense>
    </div>
  );
}
