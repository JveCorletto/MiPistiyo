/** Datos OCR mínimos para completar un formulario financiero en la misma pestaña.
 * Nunca se transfiere la foto ni el texto OCR completo y nada se guarda por sí mismo.
 */
export type FinanceOcrMode = "INTERNAL" | "EXTERNAL" | "CARD" | "LOAN";
export type FinanceOcrPrefill = {
  mode: FinanceOcrMode;
  amount: string;
  date: string;
  institution: string;
  reference: string;
  counterparty: string;
  direction: "IN" | "OUT" | null;
  createdAt: number;
};
const KEY = "mipistiyo:ocr-finance:v1";
const MAX_AGE_MS = 10 * 60 * 1000;
const allowedModes = new Set(["INTERNAL", "EXTERNAL", "CARD", "LOAN"]);
export function storeFinanceOcrPrefill(data: FinanceOcrPrefill): void {
  window.sessionStorage.setItem(KEY, JSON.stringify(data));
}
export function takeFinanceOcrPrefill(): FinanceOcrPrefill | null {
  const raw = window.sessionStorage.getItem(KEY);
  window.sessionStorage.removeItem(KEY);
  if (!raw) return null;
  try {
    const item = JSON.parse(raw) as Partial<FinanceOcrPrefill>;
    if (!allowedModes.has(item.mode ?? "") ||
      typeof item.createdAt !== "number" ||
      Date.now() - item.createdAt > MAX_AGE_MS ||
      item.createdAt > Date.now() + 60_000) return null;
    return {
      mode: item.mode as FinanceOcrMode,
      amount: typeof item.amount === "string" && /^\d{1,12}\.\d{2}$/.test(item.amount) ? item.amount : "",
      date: typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : "",
      institution: typeof item.institution === "string" ? item.institution.slice(0, 65) : "",
      reference: typeof item.reference === "string" ? item.reference.slice(0, 36) : "",
      counterparty: typeof item.counterparty === "string" ? item.counterparty.slice(0, 120) : "",
      direction: item.direction === "IN" || item.direction === "OUT" ? item.direction : null,
      createdAt: item.createdAt,
    };
  } catch {
    return null;
  }
}
