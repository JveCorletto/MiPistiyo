import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatHistoryDay, formatHistorySummaryDay,
  formatMovementTime, historyTimestamp,
} from '../src/lib/movements/format-history-date.ts';

test('DATE no cambia de día por zona local', () => {
  assert.equal(formatHistoryDay('2026-10-15'), '15 oct 2026');
});
test('hora real opcional: solo se presenta si existe', () => {
  assert.deepEqual(formatHistorySummaryDay('2026-10-15', null), {
    day: '15 oct 2026', operationTime: null,
  });
  assert.deepEqual(formatHistorySummaryDay('2026-10-15', '17:58:00'), {
    day: '15 oct 2026', operationTime: '5:58 p. m.',
  });
});
test('rechaza hora inválida o ausente', () => {
  assert.equal(formatMovementTime('25:00'), null);
  assert.equal(formatMovementTime('13:72'), null);
  assert.equal(formatMovementTime(''), null);
});
test('timestamptz muestra hora de REGISTRO en El Salvador sin Intl', () => {
  assert.deepEqual(historyTimestamp('2026-10-16T00:58:00+00:00'), {
    isoDay: '2026-10-15', day: '15 oct 2026', time: '6:58 p. m.', dateTime: '15 oct 2026, 6:58 p. m.',
  });
});
