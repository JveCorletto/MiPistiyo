import test from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptText, parseReceiptAmount, extractReceiptDate } from '../src/lib/ocr/parse-receipt.ts';

test('total real, no subtotal ni IVA', () => {
  const r = parseReceiptText('SUPER SELECTOS\nNIT: 001231\nFECHA: 12/10/2026\nSUBTOTAL $20.00\nIVA $2.60\nTOTAL A PAGAR $22.60\nEFECTIVO $30.00\nCAMBIO $7.40');
  assert.equal(r.merchant, 'SUPER SELECTOS');
  assert.equal(r.total, '22.60');
  assert.equal(r.date, '2026-10-12');
});
test('monto con millares y coma decimal', () => {
  const r = parseReceiptText('FERRETERIA CENTRAL\n15-10-2026\nTOTAL $1.234,56');
  assert.equal(r.total, '1234.56');
});
test('sin total inequívoco deja monto para revisión manual', () => {
  const r = parseReceiptText('FARMACIA\n12/10/2026\nProducto 10.00\nProducto 20.00');
  assert.equal(r.total, '');
  assert.ok(r.warnings.length);
});
test('no acepta fechas inexistentes', () => {
  assert.equal(extractReceiptDate('Fecha: 31/02/2026'), '');
});
test('interpreta dos separadores de millares', () => {
  assert.equal(parseReceiptAmount('$1,234,567.89'), 1234567.89);
});
test('BAC: transferencia con monto, fecha escrita, referencia y remitente sin dirección inventada', () => {
  const r = parseReceiptText(`2 BAC\nNotificación de transferencia\nHola,\nLe informamos que MARIA ELENA\nPEREZ LOPEZ realizó una transferencia a\nla cuenta bancaria N° 000123456 a nombre de\nJORGE LUIS PEREZ LOPEZ.\nFecha 15 octubre 2026\nHora 5:58 PM\nMonto $25.00\nDetalle (Sin detalle)\nReferencia 987654321`);
  assert.equal(r.documentType, 'TRANSFER');
  assert.equal(r.institution, 'BAC');
  assert.equal(r.merchant, 'BAC');
  assert.equal(r.total, '25.00');
  assert.equal(r.date, '2026-10-15');
  assert.equal(r.reference, '987654321');
  assert.equal(r.counterparty, 'MARIA ELENA PEREZ LOPEZ');
  assert.equal(r.suggestedDirection, null);
  assert.ok(!r.warnings.some(w => w.includes('No se encontró un importe')));
});
test('monto en siguiente línea de la etiqueta', () => {
  const r = parseReceiptText('BAC\nTransferencia enviada\nFecha: 15 de octubre de 2026\nMonto\n$45.75\nReferencia\n123456789');
  assert.equal(r.total, '45.75');
  assert.equal(r.date, '2026-10-15');
  assert.equal(r.suggestedDirection, 'OUT');
});
test('pagos de tarjeta y préstamo no se confunden con gastos ordinarios', () => {
  const card = parseReceiptText('BANCO\nComprobante de pago a tarjeta de crédito\n15/10/2026\nMonto pagado $20.00');
  const loan = parseReceiptText('BANCO\nAbono a préstamo\n15 octubre 2026\nTOTAL PAGADO $120.00');
  assert.equal(card.documentType, 'CARD_PAYMENT');
  assert.equal(loan.documentType, 'LOAN_PAYMENT');
  assert.equal(loan.total, '120.00');
});
test('múltiples importes etiquetados incompatibles no elige uno al azar', () => {
  const r = parseReceiptText('TRANSFERENCIA\nMonto $25.00\nMonto $35.00\nFecha: 15 octubre 2026');
  assert.equal(r.total, '');
});
test('fecha escrita inválida no se normaliza silenciosamente', () => {
  assert.equal(extractReceiptDate('31 febrero 2026'), '');
});

test('SMS B. Cuscatlán: compra con tarjeta, importe USD pegado y hora de la transacción', () => {
  const raw = `6:48\nMie, 14 Oct\nB.CUSCATLAN · Mensajes · 5 min\nAlerta de compra B.CUSCATLAN con su Tarjeta de\nCredito Titular 2906 por USD63.95 en SELECTOS SAN\nLUIS el 2026-10-14 18:42. Mas inf. 22122000`;
  const result = parseReceiptText(raw);
  assert.equal(result.documentType, 'CARD_PURCHASE_ALERT');
  assert.equal(result.institution, 'Banco Cuscatlán');
  assert.equal(result.merchant, 'SELECTOS SAN LUIS');
  assert.equal(result.total, '63.95');
  assert.equal(result.date, '2026-10-14');
  assert.equal(result.time, '18:42');
  assert.equal(result.cardLastFour, '2906');
  assert.equal(result.reference, '');
  assert.equal(result.suggestedDirection, null);
});

test('SMS con US$ separado, hora no confiable si solo aparece reloj del teléfono', () => {
  const result = parseReceiptText(`6:48\nAlerta de compra con Tarjeta de Crédito Titular 2906 por US$ 10.25 en SUPERMERCADO EL 2026-10-14.`);
  assert.equal(result.documentType, 'CARD_PURCHASE_ALERT');
  assert.equal(result.total, '10.25');
  assert.equal(result.merchant, 'SUPERMERCADO');
  assert.equal(result.time, '');
});

test('No acepta 2906 como monto ni 22122000 como referencia', () => {
  const result = parseReceiptText('Alerta de compra con su Tarjeta de Credito Titular 2906. Mas inf. 22122000');
  assert.equal(result.total, '');
  assert.equal(result.reference, '');
  assert.equal(result.cardLastFour, '2906');
});

test('no interpreta pago a tarjeta como compra', () => {
  const result = parseReceiptText('Comprobante de pago a tarjeta de crédito\nFecha: 15 octubre 2026\nMonto pagado $50.00');
  assert.equal(result.documentType, 'CARD_PAYMENT');
});
