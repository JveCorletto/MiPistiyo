/**
 * Parser conservador de texto OCR. Nunca contabiliza operaciones ni interpreta
 * que una transferencia recibida sea necesariamente un ingreso contable.
 */
export type FinancialDocumentType =
  | "RECEIPT"
  | "CARD_PURCHASE_ALERT"
  | "TRANSFER"
  | "CARD_PAYMENT"
  | "LOAN_PAYMENT"
  | "PAYMENT"
  | "UNKNOWN";

export type ReceiptDraft = {
  merchant: string;
  total: string;
  date: string;
  /** Hora real detectada en el documento, HH:MM; no la hora del dispositivo. */
  time: string;
  /** Solo los últimos cuatro dígitos; nunca se extrae ni almacena el número completo. */
  cardLastFour: string;
  rawText: string;
  warnings: string[];
  documentType: FinancialDocumentType;
  institution: string;
  reference: string;
  counterparty: string;
  /** La dirección se propone solo cuando el documento la expresa explícitamente. */
  suggestedDirection: "IN" | "OUT" | null;
};

const normalize = (value: string) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toUpperCase()
  .replace(/\s+/g, " ")
  .trim();

const months: Record<string, number> = {
  ENERO: 1, ENE: 1, FEBRERO: 2, FEB: 2, MARZO: 3, MAR: 3,
  ABRIL: 4, ABR: 4, MAYO: 5, MAY: 5, JUNIO: 6, JUN: 6,
  JULIO: 7, JUL: 7, AGOSTO: 8, AGO: 8,
  SEPTIEMBRE: 9, SETIEMBRE: 9, SEPT: 9, SET: 9, SEP: 9,
  OCTUBRE: 10, OCT: 10, NOVIEMBRE: 11, NOV: 11,
  DICIEMBRE: 12, DIC: 12,
};

function validIsoDate(day: number, month: number, year: number): string {
  const fullYear = year < 100 ? (year < 70 ? 2000 + year : 1900 + year) : year;
  if (fullYear < 2000 || fullYear > 2100 || month < 1 || month > 12) return "";
  const date = new Date(Date.UTC(fullYear, month - 1, day));
  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) return "";
  return `${fullYear}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Permite AAAA-MM-DD, DD/MM/AAAA y «15 de octubre de 2026». */
export function extractReceiptDate(text: string): string {
  const raw = text.split(/\r?\n/).map(normalize).join("\n");
  const datePatterns: Array<RegExp> = [
    /\b(20\d{2})[\/-](0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])\b/g,
    /\b(0?[1-9]|[12]\d|3[01])[\/-](0?[1-9]|1[0-2])[\/-]((?:19|20)\d{2}|\d{2})\b/g,
  ];
  // Se da prioridad a líneas etiquetadas FECHA cuando el documento contiene varios días.
  const lines = raw.split(/\r?\n/);
  const tagged = lines.filter(line => /\bFECHA\b/.test(line)).join("\n");
  for (const candidateText of [tagged, raw]) {
    if (!candidateText) continue;
    for (const match of candidateText.matchAll(datePatterns[0])) {
      const iso = validIsoDate(Number(match[3]), Number(match[2]), Number(match[1]));
      if (iso) return iso;
    }
    for (const match of candidateText.matchAll(datePatterns[1])) {
      const iso = validIsoDate(Number(match[1]), Number(match[2]), Number(match[3]));
      if (iso) return iso;
    }
    const written = /\b(0?[1-9]|[12]\d|3[01])\s+(?:DE\s+)?(ENERO|ENE|FEBRERO|FEB|MARZO|MAR|ABRIL|ABR|MAYO|MAY|JUNIO|JUN|JULIO|JUL|AGOSTO|AGO|SEPTIEMBRE|SETIEMBRE|SEPT|SET|SEP|OCTUBRE|OCT|NOVIEMBRE|NOV|DICIEMBRE|DIC)\s+(?:DE[L]?\s+)?(20\d{2})\b/g;
    for (const match of candidateText.matchAll(written)) {
      const iso = validIsoDate(Number(match[1]), months[match[2]], Number(match[3]));
      if (iso) return iso;
    }
  }
  return "";
}

/**
 * Extrae únicamente la hora de la transacción cuando aparece PEGADA a la fecha
 * ISO del mensaje bancario. Nunca utiliza la hora de la pantalla de bloqueo.
 */
export function extractPurchaseAlertTime(text: string): string {
  const flat = normalize(text);
  const matched = flat.match(/\b20\d{2}[-/]\d{1,2}[-/]\d{1,2}\s+(?:A\s+LAS\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!matched) return "";
  return `${matched[1].padStart(2, "0")}:${matched[2]}`;
}

/**
 * Alertas como «Tarjeta de Crédito Titular 2906 por USD63.95 en
 * SELECTOS SAN LUIS el 2026-10-14 18:42». Restringimos el monto al que sigue
 * a POR/MONTO y una moneda para no confundir el teléfono o el saldo bancario.
 */
function extractCardPurchaseAmount(text: string): string {
  const flat = normalize(text);
  const matches = [...flat.matchAll(/\b(?:POR|MONTO(?:\s+DE)?|IMPORTE(?:\s+DE)?|VALOR(?:\s+DE)?)\s*(?:US\$|USD|\$)\s*(\d[\d.,]*[.,]\d{2})\b/g)]
    .map(match => parseReceiptAmount(match[1]))
    .filter((amount): amount is number => amount !== null);
  const unique = new Set(matches.map(value => value.toFixed(2)));
  return unique.size === 1 ? matches[0].toFixed(2) : "";
}

function extractCardLastFour(text: string): string {
  const flat = normalize(text);
  // Nunca tomamos números de teléfono ni referencias como sufijo de tarjeta.
  const matched = flat.match(/\b(?:TITULAR|TERMINADA?\s+EN|FINALIZA\s+EN|\*{3,4})\s*[:#-]?\s*(\d{4})\b/);
  return matched?.[1] ?? "";
}

function extractCardPurchaseMerchant(text: string): string {
  const flat = normalize(text);
  // Comercios después del monto, hasta la fecha de la COMPRA, no la fecha del teléfono.
  const matched = flat.match(/\b(?:US\$|USD|\$)\s*\d[\d.,]*[.,]\d{2}\s+EN\s+(.{3,100}?)\s+EL\s+20\d{2}[-/]\d{1,2}[-/]\d{1,2}\b/);
  if (!matched) return "";
  const merchant = matched[1].replace(/\s+/g, " ").trim().replace(/[.,;:]+$/, "");
  return merchant.length >= 3 && merchant.length <= 85 ? merchant : "";
}

/** Importes monetarios explícitos con dos decimales. No acepta números de referencia. */
export function parseReceiptAmount(value: string): number | null {
  const clean = value.replace(/[$\s]/g, "");
  const decimalIndex = Math.max(clean.lastIndexOf("."), clean.lastIndexOf(","));
  if (decimalIndex < 0 || clean.length - decimalIndex - 1 !== 2) return null;
  const integer = clean.slice(0, decimalIndex).replace(/[.,]/g, "");
  const fraction = clean.slice(decimalIndex + 1);
  if (!/^\d{1,12}$/.test(integer) || !/^\d{2}$/.test(fraction)) return null;
  const amount = Number(`${integer}.${fraction}`);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

const moneyPattern = /\$?\s*\d[\d.,]*[.,]\d{2}\b/g;
const ignoreAmountLine = /\b(SUBTOTAL|SUB TOTAL|I\.?V\.?A\.?|IMPUESTO|CAMBIO|VUELTO|PROPINA|DESCUENTO|AHORRO|RETENCION|RETENIDO|EXENTO|EFECTIVO RECIBIDO|MONTO ORIGINAL|CUOTA MINIMA|SALDO ANTERIOR|SALDO DISPONIBLE)\b/;
const strongTotal = /\b(TOTAL\s*(?:A\s*(?:PAGAR|CANCELAR)|VENTA|NETO|PAGADO)?|IMPORTE\s*TOTAL|MONTO\s*TOTAL|TOTAL\s*DEL\s*PAGO)\b/;
const amountLabel = /\b(MONTO(?:\s+(?:TRANSFERIDO|ENVIADO|RECIBIDO|ABONADO|PAGADO|DE\s+LA\s+TRANSACCION))?|IMPORTE|VALOR\s+(?:TRANSFERIDO|PAGADO)|PAGO\s+REALIZADO|ABONO\s+REALIZADO|A\s+PAGAR)\b/;

type AmountCandidate = { amount: number; priority: number; line: number };
function extractLabeledAmount(lines: string[]): string {
  const candidates: AmountCandidate[] = [];
  lines.forEach((line, index) => {
    const normalizedLine = normalize(line);
    if (ignoreAmountLine.test(normalizedLine)) return;
    const priority = strongTotal.test(normalizedLine) ? 3 : amountLabel.test(normalizedLine) ? 2 : 0;
    if (priority === 0) return;
    const matches = [...line.matchAll(moneyPattern)];
    // Algunos comprobantes muestran «Monto» en una línea y «$25.00» en la siguiente.
    const valueMatches = matches.length ? matches : (
      index + 1 < lines.length && !/\b(TOTAL|MONTO|SUBTOTAL|IVA|FECHA|REFERENCIA)\b/.test(normalize(lines[index + 1]))
        ? [...lines[index + 1].matchAll(moneyPattern)]
        : []
    );
    for (const match of valueMatches) {
      const amount = parseReceiptAmount(match[0]);
      if (amount !== null) candidates.push({ amount, priority, line: index });
    }
  });
  if (!candidates.length) return "";
  const max = Math.max(...candidates.map(c => c.priority));
  const strongest = candidates.filter(c => c.priority === max);
  const unique = new Set(strongest.map(c => c.amount.toFixed(2)));
  // Dos totales/«montos» distintos con la misma relevancia requieren revisión manual.
  if (unique.size > 1) return "";
  return strongest[strongest.length - 1].amount.toFixed(2);
}

function documentKind(text: string): FinancialDocumentType {
  const clean = normalize(text);
  // Debe evaluarse ANTES de «pago a tarjeta». Comprar con tarjeta crea un
  // GASTO, no es un pago de la deuda de esa tarjeta.
  if (/\b(?:ALERTA|NOTIFICACION)\s+DE\s+COMPRA\b/.test(clean)
      || (/\bCOMPRA\b/.test(clean) && /\bTARJETA\b/.test(clean)
          && /\b(?:USD|US\$)\s*\d/.test(clean))) {
    return "CARD_PURCHASE_ALERT";
  }
  if (/\b(PAGO|ABONO|CANCELACION|PAGADO)\b.{0,40}\b(TARJETA\s*(?:DE\s*)?CREDITO|TARJETA\s+(?:VISA|MASTER|MASTERCARD))\b/.test(clean)
    || /\b(TARJETA\s*(?:DE\s*)?CREDITO)\b.{0,40}\b(PAGO|ABONO)\b/.test(clean)) return "CARD_PAYMENT";
  if (/\b(PAGO|ABONO)\b.{0,40}\b(PRESTAMO|CREDITO\s+PERSONAL|CREDITO\s+HIPOTECARIO)\b/.test(clean)
    || /\b(PRESTAMO)\b.{0,40}\b(PAGO|ABONO)\b/.test(clean)) return "LOAN_PAYMENT";
  if (/\b(TRANSFERENCIA|TRANSFERIDO|TRASPASO\s+BANCARIO|TRANSFER)\b/.test(clean)) return "TRANSFER";
  if (/\b(COMPROBANTE\s+DE\s+PAGO|CONSTANCIA\s+DE\s+PAGO|PAGO\s+DE\s+SERVICIO)\b/.test(clean)) return "PAYMENT";
  if (/\b(FACTURA|TICKET|VENTA|NIT|NRC|TOTAL|SUBTOTAL|DTE)\b/.test(clean)) return "RECEIPT";
  return "UNKNOWN";
}

function extractReference(lines: string[]): string {
  for (const line of lines) {
    const match = normalize(line).match(/\b(?:REFERENCIA|REF\.?|NUMERO\s+DE\s+(?:OPERACION|TRANSACCION)|NO\.?\s+DE\s+(?:OPERACION|TRANSACCION))\s*[:#-]?\s*([A-Z0-9-]{5,36})\b/);
    if (match && !/^(?:CUENTA|FECHA|MONTO)$/.test(match[1])) return match[1];
  }
  return "";
}

function extractInstitution(lines: string[]): string {
  const header = lines.slice(0, 8).map(normalize);
  const names: [RegExp, string][] = [
    [/\bBAC\b/, "BAC"],
    [/\bBANCO\s+AGRICOLA\b/, "Banco Agrícola"],
    [/\b(?:BANCO\s+CUSCATLAN|B\s*\.\s*CUSCATLAN)\b/, "Banco Cuscatlán"],
    [/\bDAVIVIENDA\b/, "Davivienda"],
    [/\bBANCO\s+PROMERICA\b/, "Banco Promerica"],
    [/\bBANCO\s+HIPOTECARIO\b/, "Banco Hipotecario"],
  ];
  for (const line of header) for (const [pattern, title] of names) {
    if (pattern.test(line)) return title;
  }
  return "";
}

function extractCounterparty(text: string): string {
  // Hay casos como «que ANA MARIA\nPEREZ realizó una transferencia ...».
  // Es una sugerencia, no una prueba de quién es titular de la cuenta.
  const flat = text.replace(/\s+/g, " ").trim();
  const sender = flat.match(/\bque\s+([\p{L}\s.'-]{4,140}?)\s+realiz[oó]\s+una\s+transferencia\b/iu);
  if (sender) return sender[1].trim().replace(/\s+/g, " ").slice(0, 120);
  return "";
}

function findMerchant(lines: string[], institution: string, kind: FinancialDocumentType): string {
  if (kind !== "RECEIPT" && institution) return institution;
  const excluded = /\b(FACTURA|DOCUMENTO|TICKET|NIT|NRC|FECHA|HORA|CAJA|CASHIER|CLIENTE|DUI|VENTA|TOTAL|TELEFONO|TEL\.?|DIRECCION|IVA|CREDITO|CODIGO|COMPROBANTE|DTE|NUMERO|GRACIAS|BIENVENIDO|SUCURSAL|NOTIFICACION|TRANSFERENCIA|REFERENCIA|MONTO|ABONO|DETALLE|PAGO)\b/;
  const chosen = lines.slice(0, 10).find(line => {
    const candidate = normalize(line);
    return (candidate.match(/[A-Z]/g) ?? []).length >= 4
      && !excluded.test(candidate) && !/^[-\d\W]+$/.test(line) && line.length <= 65;
  });
  return chosen?.replace(/\s+/g, " ").slice(0, 65) ?? institution;
}

export function parseReceiptText(text: string): ReceiptDraft {
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(0, 250);
  const kind = documentKind(text);
  const institution = extractInstitution(lines);
  const date = extractReceiptDate(text);
  const total = kind === "CARD_PURCHASE_ALERT"
    ? extractCardPurchaseAmount(text) : extractLabeledAmount(lines);
  const reference = extractReference(lines);
  const merchant = kind === "CARD_PURCHASE_ALERT"
    ? extractCardPurchaseMerchant(text) : findMerchant(lines, institution, kind);
  const time = kind === "CARD_PURCHASE_ALERT" ? extractPurchaseAlertTime(text) : "";
  const cardLastFour = kind === "CARD_PURCHASE_ALERT" ? extractCardLastFour(text) : "";
  const warnings: string[] = [];
  let suggestedDirection: "IN" | "OUT" | null = null;
  const clean = normalize(text);
  if (kind === "CARD_PURCHASE_ALERT") {
    warnings.push("Confirmá el comercio, importe y tarjeta. Es una compra, NO un pago de tarjeta.");
    if (!cardLastFour) warnings.push("No se detectaron los últimos 4 dígitos de la tarjeta.");
  }
  if (kind === "TRANSFER") {
    if (/\b(TRANSFERENCIA\s+RECIBIDA|HAS\s+RECIBIDO\s+UNA\s+TRANSFERENCIA)\b/.test(clean)) suggestedDirection = "IN";
    else if (/\b(TRANSFERENCIA\s+ENVIADA|HAS\s+ENVIADO\s+UNA\s+TRANSFERENCIA)\b/.test(clean)) suggestedDirection = "OUT";
    // «A realizó una transferencia a B» NO identifica la dirección para el usuario actual.
    warnings.push("Confirmá si la transferencia fue propia o con terceros y si enviaste o recibiste el dinero.");
  }
  if (kind === "CARD_PAYMENT" || kind === "LOAN_PAYMENT") {
    warnings.push("Un pago de deuda no es un gasto nuevo. Confirmá la cuenta, la deuda y el importe antes de contabilizar.");
  }
  if (kind === "PAYMENT" || kind === "UNKNOWN") {
    warnings.push("Revisá la clase de operación; podría no corresponder a un gasto común.");
  }
  if (!total) warnings.push("No se encontró un importe inequívoco. Introducí el monto manualmente.");
  if (!date) warnings.push("No se identificó una fecha confiable. Elegila manualmente.");
  if (!merchant) warnings.push("No se identificó el emisor. Completá la descripción.");
  return {
    merchant, total, date, time, cardLastFour, rawText: text, warnings,
    documentType: kind, institution, reference,
    counterparty: kind === "TRANSFER" ? extractCounterparty(text) : "",
    suggestedDirection,
  };
}
