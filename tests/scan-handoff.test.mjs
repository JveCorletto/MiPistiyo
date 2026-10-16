import test from 'node:test';
import assert from 'node:assert/strict';
import { storeFinanceOcrPrefill, takeFinanceOcrPrefill } from '../src/lib/ocr/scan-handoff.ts';
function createSessionStorage() {
  const values = new Map();
  return {
    setItem: (key, value) => values.set(key, value),
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
}
test('borrador de sesión: se consume una sola vez', () => {
  globalThis.window = { sessionStorage: createSessionStorage() };
  storeFinanceOcrPrefill({ mode: 'EXTERNAL', amount: '25.00', date: '2026-10-15', institution: 'BAC', reference: '987654321', counterparty: 'MARIA ELENA', direction: null, createdAt: Date.now() });
  const r = takeFinanceOcrPrefill();
  assert.equal(r.amount, '25.00');
  assert.equal(r.direction, null);
  assert.equal(takeFinanceOcrPrefill(), null);
});
test('borrador vencido no se reutiliza', () => {
  globalThis.window = { sessionStorage: createSessionStorage() };
  storeFinanceOcrPrefill({ mode: 'CARD', amount: '20.00', date: '2026-10-15', institution: '', reference: '', counterparty: '', direction: null, createdAt: Date.now() - 11 * 60 * 1000 });
  assert.equal(takeFinanceOcrPrefill(), null);
});
