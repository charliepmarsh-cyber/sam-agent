import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/database.ts';
import { TenantRepository } from '../src/db/repository.ts';

function twoTenants(): { a: TenantRepository; b: TenantRepository } {
  const db = openDatabase(':memory:');
  return { a: new TenantRepository(db, 'ashdown'), b: new TenantRepository(db, 'other-tenant') };
}

test('rows are invisible across tenants', () => {
  const { a, b } = twoTenants();
  a.setState('recon.last_cursor', 'abc');
  a.recordMatch({ invoice_id: 'INV-1', transaction_id: 'TXN-1', kind: 'EXACT', confidence: 1, amount: 10, matched_at: 'now' });
  a.raiseEscalation({
    tenant_id: 'ashdown',
    severity: 'URGENT',
    observed: 'x',
    records: ['INV-1'],
    policy_triggered: 'test',
    recommendation: 'r',
    withheld_actions: 'w',
    audit_refs: [],
  });
  assert.equal(b.getState('recon.last_cursor'), null);
  assert.equal(b.matches().length, 0);
  assert.equal(b.escalations().length, 0);
  assert.equal(a.matches().length, 1);
});

test('repository cannot be constructed without a tenant', () => {
  const db = openDatabase(':memory:');
  assert.throws(() => new TenantRepository(db, ''));
});

test('escalations dedupe by record set — update, never re-raise', () => {
  const { a } = twoTenants();
  const esc = {
    tenant_id: 'ashdown',
    severity: 'URGENT' as const,
    observed: 'duplicate payment',
    records: ['INV-1003', 'TXN-88001', 'TXN-88002'],
    policy_triggered: 'policies.md §3',
    recommendation: 'refund one payment',
    withheld_actions: 'no autonomous refund',
    audit_refs: [],
  };
  assert.ok(a.raiseEscalation(esc));
  assert.equal(a.raiseEscalation({ ...esc, records: ['TXN-88002', 'INV-1003', 'TXN-88001'] }), null);
  assert.equal(a.escalations().length, 1);
});

test('open escalations freeze their records', () => {
  const { a } = twoTenants();
  a.raiseEscalation({
    tenant_id: 'ashdown',
    severity: 'STANDARD',
    observed: 'overdue',
    records: ['INV-1001'],
    policy_triggered: 'policies.md §3',
    recommendation: 'ring them',
    withheld_actions: 'no chasing beyond templates',
    audit_refs: [],
  });
  assert.deepEqual(a.frozenRecords(), ['INV-1001']);
});

test('blast-radius counters aggregate per day', () => {
  const { a } = twoTenants();
  a.logAutoSend('INV-9001', 1416, '2026-07-02');
  a.logEmail('CUS-105', 'reminder', 'Payment reminder INV-1013', 'INV-1013', '2026-07-02');
  a.logEmail('CUS-105', 'reminder', 'Payment reminder again', 'INV-1013', '2026-07-02');
  assert.equal(a.autoSentValueOn('2026-07-02'), 1416);
  assert.equal(a.emailsToCustomerOn('CUS-105', '2026-07-02'), 2);
  assert.equal(a.emailsToCustomerOn('CUS-105', '2026-07-03'), 0);
});

test('discrepancies dedupe by type + records', () => {
  const { a } = twoTenants();
  const d = {
    type: 'SHORT_PAY' as const,
    invoice_id: 'INV-1007',
    transaction_ids: ['TXN-88003'],
    amount: -120,
    status: 'OPEN' as const,
    detail: 'short by £120',
    hold_until: null,
  };
  assert.ok(a.openDiscrepancy(d));
  assert.equal(a.openDiscrepancy(d), null);
  assert.equal(a.discrepancies().length, 1);
});
