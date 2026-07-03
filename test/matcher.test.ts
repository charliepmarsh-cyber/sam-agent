import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTransaction, extractInvoiceRef, extractPayerName, type MatcherContext } from '../src/skills/matcher.ts';
import { tokenOverlap } from '../src/model/client.ts';
import type { InvoiceRecord, TransactionRecord } from '../src/types.ts';

function invoice(id: string, gross: number, customer = 'Priya Hobbs'): InvoiceRecord {
  return {
    invoice_id: id,
    job_id: `JOB-${id.slice(4)}`,
    customer_id: 'CUS-205',
    customer_name: customer,
    issue_date: '2026-04-22',
    due_date: '2026-04-22',
    net: gross / 1.2,
    vat: gross - gross / 1.2,
    gross,
    status: 'SENT',
  };
}

function txn(id: string, date: string, amount: number, description: string): TransactionRecord {
  return { transaction_id: id, date, amount, description };
}

function ctx(overrides: Partial<MatcherContext> = {}): MatcherContext {
  return {
    invoices: [invoice('INV-1003', 1135.2)],
    paidInvoiceIds: new Set(),
    seenTransactions: [],
    expectedFees: [{ descriptor: 'STARLING MONTHLY FEE', amount: -7 }],
    escalateOver: 250,
    ...overrides,
  };
}

test('reference extraction and payer extraction', () => {
  assert.equal(extractInvoiceRef('FP PRIYA HOBBS INV-1003'), 'INV-1003');
  assert.equal(extractInvoiceRef('FP MOBILE TRANSFER'), null);
  assert.equal(extractPayerName('FP PRIYA HOBBS INV-1003'), 'PRIYA HOBBS');
  assert.equal(extractPayerName('FP OWEN PAYMENT'), 'OWEN PAYMENT');
});

test('exact match: amount + reference', () => {
  const result = classifyTransaction(txn('T1', '2026-04-22', 1135.2, 'FP PRIYA HOBBS INV-1003'), ctx());
  assert.deepEqual(result, { kind: 'EXACT', invoiceId: 'INV-1003', deMinimisDelta: 0 });
});

test('duplicate: same amount + reference within 5 business days (the INV-1003 pair)', () => {
  const result = classifyTransaction(
    txn('TXN-88002', '2026-04-25', 1135.2, 'FP PRIYA HOBBS INV-1003'),
    ctx({
      paidInvoiceIds: new Set(['INV-1003']),
      seenTransactions: [{ transaction_id: 'TXN-88001', date: '2026-04-22', amount: 1135.2, reference: 'INV-1003' }],
    }),
  );
  assert.equal(result.kind, 'DUPLICATE_PAY');
  assert.equal((result as { priorTransactionId: string }).priorTransactionId, 'TXN-88001');
});

test('same reference+amount OUTSIDE the 5-business-day window is not a duplicate', () => {
  const result = classifyTransaction(
    txn('T2', '2026-05-15', 1135.2, 'FP PRIYA HOBBS INV-1003'),
    ctx({
      paidInvoiceIds: new Set(['INV-1003']),
      seenTransactions: [{ transaction_id: 'T1', date: '2026-04-22', amount: 1135.2, reference: 'INV-1003' }],
    }),
  );
  assert.equal(result.kind, 'UNREFERENCED');
});

test('short pay > £1 opens SHORT_PAY, not marked paid (INV-1007 shape)', () => {
  const result = classifyTransaction(
    txn('TXN-88003', '2026-06-05', 905.02, 'FP MARLWOOD FACIL INV-1007'),
    ctx({ invoices: [invoice('INV-1007', 1025.02, 'MarlWood Facilities Ltd')] }),
  );
  assert.deepEqual(result, { kind: 'SHORT_PAY', invoiceId: 'INV-1007', shortBy: 120 });
});

test('short by ≤ £1 settles as EXACT with the delta logged', () => {
  const result = classifyTransaction(
    txn('T3', '2026-04-22', 1134.7, 'FP PRIYA HOBBS INV-1003'),
    ctx(),
  );
  assert.equal(result.kind, 'EXACT');
  assert.equal((result as { deMinimisDelta: number }).deMinimisDelta, -0.5);
});

test('overpayment opens OVER_PAY', () => {
  const result = classifyTransaction(txn('T4', '2026-04-22', 1235.2, 'FP PRIYA HOBBS INV-1003'), ctx());
  assert.deepEqual(result, { kind: 'OVER_PAY', invoiceId: 'INV-1003', overBy: 100 });
});

test('amount-only single candidate → AMOUNT_CANDIDATE for name confirmation (INV-1012 shape)', () => {
  const result = classifyTransaction(
    txn('TXN-88006', '2026-05-15', 319.64, 'FP OWEN PAYMENT'),
    ctx({ invoices: [invoice('INV-1012', 319.64, 'Owen Okoye')] }),
  );
  assert.equal(result.kind, 'AMOUNT_CANDIDATE');
  assert.equal((result as { invoiceId: string }).invoiceId, 'INV-1012');
  assert.ok(tokenOverlap('OWEN PAYMENT', 'Owen Okoye'), 'fallback heuristic must confirm OWEN ~ Owen Okoye');
});

test('amount-only with multiple candidates stays unreferenced', () => {
  const result = classifyTransaction(
    txn('T5', '2026-05-15', 319.64, 'FP OWEN PAYMENT'),
    ctx({ invoices: [invoice('INV-1012', 319.64, 'Owen Okoye'), invoice('INV-1099', 319.64, 'Owen Doyle')] }),
  );
  assert.equal(result.kind, 'UNREFERENCED');
});

test('expected fee → BANK_FEE; unknown fee-like debit → UNEXPECTED_FEE', () => {
  assert.equal(classifyTransaction(txn('TXN-88008', '2026-06-22', -7, 'STARLING MONTHLY FEE'), ctx()).kind, 'BANK_FEE');
  assert.equal(
    classifyTransaction(txn('TXN-88007', '2026-06-28', -42.5, 'SERVICE CHARGE INTL WIRE'), ctx()).kind,
    'UNEXPECTED_FEE',
  );
});

test('unreferenced credit: > £250 escalates, ≤ £250 holds', () => {
  const big = classifyTransaction(txn('TXN-88004', '2026-06-30', 612.4, 'FP J HARGREAVES DEPOSIT'), ctx());
  assert.deepEqual(big, { kind: 'UNREFERENCED', direction: 'credit', escalate: true });
  const small = classifyTransaction(txn('TXN-88005', '2026-07-01', 96, 'FP MOBILE TRANSFER'), ctx());
  assert.deepEqual(small, { kind: 'UNREFERENCED', direction: 'credit', escalate: false });
});

test('unreferenced debit > £250 escalates', () => {
  const result = classifyTransaction(txn('T6', '2026-07-01', -400, 'CHQ 000123'), ctx());
  assert.deepEqual(result, { kind: 'UNREFERENCED', direction: 'debit', escalate: true });
});
