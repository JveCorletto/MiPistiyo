import type { HistoryRow } from "@/lib/movements/history";

/** La coincidencia solo genera una advertencia: nunca cancela registros. */
export function extractBankReference(description: string | null | undefined): string {
  const text = (description ?? "").normalize("NFKC").toUpperCase();
  const match = text.match(/\b(?:REF(?:ERENCIA)?\.?|REFERENCIA)\s*[:#-]?\s*([A-Z0-9-]{5,36})\b/);
  return match?.[1] ?? "";
}

function amountInCents(value: number | string | null): number | null {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : null;
}

/**
 * Compara operaciones vigentes. Una referencia y mismo importe es indicio fuerte;
 * sin referencia, misma fecha + tipo + fuente/destino + importe es solo indicio.
 */
export function findPotentialDuplicates(rows: HistoryRow[]): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  const matches = new Map<string, Set<string>>();

  for (const row of rows) {
    if (row.is_reversed) continue;
    const cents = amountInCents(row.amount);
    if (cents === null || cents <= 0) continue;
    const ref = extractBankReference(row.description);
    const source = [row.account_id ?? "", row.to_account_id ?? "", row.card_id ?? "", row.loan_id ?? ""].join(":");
    const keys = [];
    if (ref) keys.push(`REF|${row.kind}|${cents}|${ref}`);
    // Sin referencia, coincidencia orientativa: no se invalidará automáticamente.
    if (source !== ":::") {
      let extra = "";
      if (row.kind === "EXTERNAL_IN" || row.kind === "EXTERNAL_OUT") {
        // Dos transferencias diferentes a terceros con mismo valor no bastan.
        extra = (row.description ?? "").normalize("NFKC").toUpperCase().replace(/\s+/g, " ").trim();
      }
      keys.push(`DATE|${row.kind}|${cents}|${row.effective_on}|${source}|${extra}`);
    }
    for (const key of keys) {
      const members = groups.get(key) ?? [];
      members.push(row.id);
      groups.set(key, members);
    }
  }

  for (const ids of groups.values()) {
    if (ids.length < 2) continue;
    for (const id of ids) {
      const others = matches.get(id) ?? new Set<string>();
      for (const other of ids) if (other !== id) others.add(other);
      matches.set(id, others);
    }
  }
  return Object.fromEntries([...matches].map(([id, others]) => [id, [...others]]));
}

export type ReversalImpact = {
  label: string;
  balanceType: "ACCOUNT" | "CARD" | "LOAN";
  /** Cambio en saldo bancario o deuda, con signo. */
  change: number;
};

export type LedgerSnapshot = {
  operation_id: string;
  account_id: string | null;
  card_id: string | null;
  loan_id: string | null;
  delta: number | string;
};

/** Invertir cada asiento, no estimar usando el importe visible del historial. */
export function buildReversalImpacts(
  entries: LedgerSnapshot[],
  names: { accounts: Record<string, string>; cards: Record<string, string>; loans: Record<string, string> },
): Record<string, ReversalImpact[]> {
  const byOperation = new Map<string, Map<string, ReversalImpact>>();
  for (const entry of entries) {
    const type = entry.account_id ? "ACCOUNT" : entry.card_id ? "CARD" : "LOAN";
    const targetId = entry.account_id ?? entry.card_id ?? entry.loan_id;
    if (!targetId) continue;
    const changeCents = -Math.round(Number(entry.delta) * 100);
    if (!Number.isSafeInteger(changeCents)) continue;
    const key = `${type}:${targetId}`;
    const group = byOperation.get(entry.operation_id) ?? new Map<string, ReversalImpact>();
    const name = type === "ACCOUNT" ? names.accounts[targetId] : type === "CARD" ? names.cards[targetId] : names.loans[targetId];
    const prev = group.get(key);
    group.set(key, {
      label: name ?? `${type === "ACCOUNT" ? "Cuenta" : type === "CARD" ? "Tarjeta" : "Préstamo"} (${targetId.slice(0, 8)}…)`,
      balanceType: type,
      change: ((prev ? Math.round(prev.change * 100) : 0) + changeCents) / 100,
    });
    byOperation.set(entry.operation_id, group);
  }
  return Object.fromEntries([...byOperation].map(([id, impacts]) => [id, [...impacts.values()].filter(p => p.change !== 0)]));
}
