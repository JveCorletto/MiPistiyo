import test from 'node:test';
import assert from 'node:assert/strict';
import { extractBankReference, findPotentialDuplicates, buildReversalImpacts } from '../src/lib/movements/duplicates.ts';

const sample = (id, overrides = {}) => ({
  id, user_id: 'u', origin: 'OPERATION', kind: 'TRANSFER', effective_on: '2026-10-15',
  created_at: '2026-10-15T15:00:00Z', description: 'BAC · Ref. 205498332', amount: 10,
  account_id: 'origen', to_account_id: 'destino', card_id: null, loan_id: null,
  is_reversed: false, ...overrides,
});

test('extrae referencia exacta (no número de cuenta)', () => {
  assert.equal(extractBankReference('BAC · Ref. 205498332'), '205498332');
  assert.equal(extractBankReference('Transferencia Referencia: ABC-2345'), 'ABC-2345');
  assert.equal(extractBankReference('Cuenta bancaria 123456789'), '');
});

test('advierte transferencias repetidas, excluye anuladas', () => {
  const matches = findPotentialDuplicates([sample('a'), sample('b'), sample('c', { is_reversed: true })]);
  assert.deepEqual(matches.a, ['b']);
  assert.deepEqual(matches.b, ['a']);
  assert.equal(matches.c, undefined);
});

test('no confunde transferencias del mismo monto a destinos diferentes', () => {
  const matches = findPotentialDuplicates([
    sample('a', { description: null }),
    sample('b', { description: null, to_account_id: 'otro-destino' }),
  ]);
  assert.deepEqual(matches, {});
});

test('gasto debitado: el reverso devuelve el dinero a la cuenta', () => {
  const data = [{ operation_id: 'gasto', account_id: 'origen', card_id: null, loan_id: null, delta: '-3.50' }];
  const impacts = buildReversalImpacts(data, { accounts: { origen: 'BAC' }, cards: {}, loans: {} });
  assert.equal(impacts.gasto[0].change, 3.5);
  assert.equal(impacts.gasto[0].label, 'BAC');
});

test('transferencia propia: devuelve al origen y quita del destino', () => {
  const data = [
    { operation_id: 'tr', account_id: 'origen', card_id: null, loan_id: null, delta: '-10.00' },
    { operation_id: 'tr', account_id: 'destino', card_id: null, loan_id: null, delta: '10.00' },
  ];
  const impacts = buildReversalImpacts(data, { accounts: { origen: 'BAC', destino: 'Ahorros' }, cards: {}, loans: {} });
  assert.deepEqual(impacts.tr.map(i => i.change), [10, -10]);
});

test('gasto con tarjeta crédito: disminuye la deuda al anular', () => {
  const impacts = buildReversalImpacts([
    { operation_id: 'tarjeta', account_id: null, card_id: 'visa', loan_id: null, delta: '25.00' },
  ], { accounts: {}, cards: { visa: 'Visa Oro' }, loans: {} });
  assert.equal(impacts.tarjeta[0].change, -25);
  assert.equal(impacts.tarjeta[0].balanceType, 'CARD');
});

test('ingreso duplicado: devuelve el saldo al importe anterior', () => {
  const impacts = buildReversalImpacts([
    { operation_id: 'ingreso', account_id: 'origen', card_id: null, loan_id: null, delta: '25.00' },
  ], { accounts: { origen: 'BAC' }, cards: {}, loans: {} });
  assert.equal(impacts.ingreso[0].change, -25);
});
