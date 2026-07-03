import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInvoiceGate, runEmailGate } from '../src/substrate/gate.ts';
import type { PolicyLimits } from '../src/types.ts';

const LIMITS: PolicyLimits = {
  auto_send_max: 2000,
  daily_value_max: 5000,
  actions_per_run_max: 10,
  emails_per_customer_day_max: 3,
  unmatched_escalate_over: 250,
  overdue_chase_days: 14,
  overdue_escalate_days: 30,
};

const baseInput = {
  killSwitchEngaged: false,
  invoiceGross: 1416,
  customerHasPaidHistory: true,
  lineItemDelta: 0,
  dailyAutoSentValue: 0,
  actionsThisRun: 0,
  limits: LIMITS,
};

test('gate passes a clean in-policy invoice (JOB-9001 shape)', () => {
  const result = runInvoiceGate(baseInput);
  assert.equal(result.allowed, true);
  assert.equal(result.failedCheck, null);
  assert.equal(result.checks.length, 6);
  assert.ok(result.checks.every((c) => c.pass));
});

test('gate fails on total over auto-send limit and names the check (JOB-9002 shape)', () => {
  const result = runInvoiceGate({ ...baseInput, invoiceGross: 3180 });
  assert.equal(result.allowed, false);
  assert.equal(result.failedCheck, 'total_within_auto_send_max');
});

test('gate boundary: exactly £2,000 passes; £2,000.01 fails', () => {
  assert.equal(runInvoiceGate({ ...baseInput, invoiceGross: 2000 }).allowed, true);
  assert.equal(runInvoiceGate({ ...baseInput, invoiceGross: 2000.01 }).allowed, false);
});

test('gate fails when kill switch engaged, before anything else', () => {
  const result = runInvoiceGate({ ...baseInput, killSwitchEngaged: true, invoiceGross: 9999 });
  assert.equal(result.failedCheck, 'kill_switch_absent');
});

test('gate fails on no payment history', () => {
  const result = runInvoiceGate({ ...baseInput, customerHasPaidHistory: false });
  assert.equal(result.failedCheck, 'customer_has_paid_history');
});

test('gate line-item tolerance is £0.01', () => {
  assert.equal(runInvoiceGate({ ...baseInput, lineItemDelta: 0.01 }).allowed, true);
  assert.equal(runInvoiceGate({ ...baseInput, lineItemDelta: 0.02 }).failedCheck, 'line_items_match_job_sheet');
});

test('gate enforces daily £5,000 auto-send value including this invoice', () => {
  assert.equal(runInvoiceGate({ ...baseInput, dailyAutoSentValue: 3584 }).allowed, true); // 3584+1416 = 5000
  assert.equal(
    runInvoiceGate({ ...baseInput, dailyAutoSentValue: 3584.01 }).failedCheck,
    'daily_auto_send_value_within_limit',
  );
});

test('gate enforces 10 actions per run', () => {
  assert.equal(runInvoiceGate({ ...baseInput, actionsThisRun: 9 }).allowed, true);
  assert.equal(runInvoiceGate({ ...baseInput, actionsThisRun: 10 }).failedCheck, 'actions_per_run_within_limit');
});

test('gate reports ALL failed checks, first-failed named', () => {
  const result = runInvoiceGate({
    ...baseInput,
    invoiceGross: 3000,
    customerHasPaidHistory: false,
  });
  assert.equal(result.failedCheck, 'total_within_auto_send_max');
  assert.equal(result.checks.filter((c) => !c.pass).length, 2);
});

test('email gate enforces 3 emails/customer/day', () => {
  const base = {
    killSwitchEngaged: false,
    emailsToCustomerToday: 0,
    actionsThisRun: 0,
    frozenRecords: [],
    touchesRecords: ['INV-1013'],
    limits: LIMITS,
  };
  assert.equal(runEmailGate({ ...base, emailsToCustomerToday: 2 }).allowed, true);
  assert.equal(runEmailGate({ ...base, emailsToCustomerToday: 3 }).failedCheck, 'emails_per_customer_day_within_limit');
});

test('email gate blocks records frozen by open escalations', () => {
  const result = runEmailGate({
    killSwitchEngaged: false,
    emailsToCustomerToday: 0,
    actionsThisRun: 0,
    frozenRecords: ['INV-1001'],
    touchesRecords: ['INV-1001'],
    limits: LIMITS,
  });
  assert.equal(result.failedCheck, 'records_not_frozen_by_escalation');
});
