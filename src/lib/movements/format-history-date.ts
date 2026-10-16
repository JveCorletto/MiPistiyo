/**
 * Formatos deterministas para el historial financiero de MiPistiyo.
 * Evitan diferencias de ICU/Intl entre el SSR de Next.js y el navegador.
 *
 * El Salvador utiliza UTC-06:00 sin horario de verano en las fechas actuales.
 * `created_at` y `reversed_at` provienen de timestamptz (ISO con zona).
 * `effective_on` es DATE: representa el día del movimiento, NO su hora.
 */
const MONTHS = [
  "ene", "feb", "mar", "abr", "may", "jun",
  "jul", "ago", "sept", "oct", "nov", "dic",
] as const;

const OFFSET_MS = 6 * 60 * 60 * 1000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const ZONED_ISO = /(?:Z|[+-]\d{2}:\d{2})$/i;

function dayParts(isoDay: string): { year: number; month: number; day: number } | null {
  const match = DATE_ONLY.exec(isoDay);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() + 1 !== month ||
    utc.getUTCDate() !== day
  ) return null;
  return { year, month, day };
}

/** Respeta las fechas DATE; nunca usa la zona local del navegador. */
export function formatHistoryDay(isoDay: string | null | undefined): string {
  if (!isoDay) return "";
  const p = dayParts(isoDay);
  return p ? `${p.day} ${MONTHS[p.month - 1]} ${p.year}` : isoDay;
}

/**
 * Fecha y hora de REGISTRO expresadas en la zona de El Salvador.
 * Acepta únicamente timestamps con zona explícita para evitar interpretaciones
 * distintas en servidor y cliente.
 */
export function historyTimestamp(
  timestamp: string | null | undefined,
): { isoDay: string; day: string; time: string; dateTime: string } | null {
  if (!timestamp || !ZONED_ISO.test(timestamp)) return null;
  const utcMs = Date.parse(timestamp);
  if (!Number.isFinite(utcMs)) return null;
  const local = new Date(utcMs - OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth() + 1;
  const dayNum = local.getUTCDate();
  const hours24 = local.getUTCHours();
  const minute = String(local.getUTCMinutes()).padStart(2, "0");
  const hours12 = hours24 % 12 || 12;
  const time = `${hours12}:${minute} ${hours24 < 12 ? "a. m." : "p. m."}`;
  const isoDay = `${year}-${String(month).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
  const day = formatHistoryDay(isoDay);
  return { isoDay, day, time, dateTime: `${day}, ${time}` };
}

/** Convierte TIME de PostgreSQL (HH:MM[:SS]) a hora local legible, sin Intl. */
export function formatMovementTime(occurredTime: string | null | undefined): string | null {
  if (!occurredTime) return null;
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(occurredTime);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "a. m." : "p. m."}`;
}

/** Solo añade la hora REAL si fue capturada explícitamente para el movimiento. */
export function formatHistorySummaryDay(
  effectiveOn: string,
  occurredTime: string | null | undefined,
): { day: string; operationTime: string | null } {
  return {
    day: formatHistoryDay(effectiveOn),
    operationTime: formatMovementTime(occurredTime),
  };
}
