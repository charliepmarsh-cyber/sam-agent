import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoice } from '../src/skills/invoicing.ts';
import type { CustomerRecord, JobSheetRecord } from '../src/types.ts';

const domestic: CustomerRecord = { customer_id: 'CUS-207', name: 'Owen Doyle', type: 'domestic', terms_days: 0, email: 'o@example.com' };
const commercial: CustomerRecord = { customer_id: 'CUS-101', name: 'MarlWood Facilities Ltd', type: 'commercial', terms_days: 30, email: 'a@example.com' };

function job(id: string, customer: string, net: number): JobSheetRecord {
  return { job_id: id, customer_id: customer, description: 'test job', net_amount: net, signed: true, completion_date: '2026-07-01' };
}

test('JOB-9001: £1,180 net → £1,416 gross at 20% VAT, domestic due on receipt', () => {
  const built = buildInvoice(job('JOB-9001', 'CUS-207', 1180), domestic, '2026-07-02');
  assert.equal(built.vat, 236);
  assert.equal(built.gross, 1416);
  assert.equal(built.due_date, '2026-07-02');
});

test('JOB-9002: £2,650 net → £3,180 gross, commercial Net 30', () => {
  const built = buildInvoice(job('JOB-9002', 'CUS-101', 2650), commercial, '2026-07-02');
  assert.equal(built.gross, 3180);
  assert.equal(built.due_date, '2026-08-01');
});

test('domestic-energy flag applies 5% VAT', () => {
  const built = buildInvoice(job('JOB-X', 'CUS-207', 1000), domestic, '2026-07-02', true);
  assert.equal(built.vat, 50);
  assert.equal(built.gross, 1050);
});

test('net amounts round to pennies', () => {
  const built = buildInvoice(job('JOB-Y', 'CUS-207', 33.335), domestic, '2026-07-02');
  assert.equal(built.net, 33.34);
  assert.equal(built.gross, 40.01);
});
