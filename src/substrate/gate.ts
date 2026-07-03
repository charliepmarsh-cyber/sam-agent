import type { GateResult, PolicyCheck, PolicyLimits } from '../types.ts';

/**
 * Policy gates are code, not prompts. These are pure functions over
 * explicit inputs — no I/O, no model calls — so they are unit-testable
 * and their verdicts are reproducible from the audit line alone.
 */

const EPSILON = 1e-9;

function check(name: string, pass: boolean, detail: string): PolicyCheck {
  return { name, pass, detail };
}

function toResult(checks: PolicyCheck[]): GateResult {
  const firstFailed = checks.find((c) => !c.pass);
  return { allowed: !firstFailed, checks, failedCheck: firstFailed?.name ?? null };
}

export interface InvoiceGateInput {
  killSwitchEngaged: boolean;
  /** Invoice total inc. VAT, £. */
  invoiceGross: number;
  /** Customer has ≥ 1 previously PAID invoice. */
  customerHasPaidHistory: boolean;
  /** Absolute £ difference between invoice line total and the job sheet. */
  lineItemDelta: number;
  /** £ value already auto-sent today (excluding this invoice). */
  dailyAutoSentValue: number;
  /** Autonomous actions already taken this run. */
  actionsThisRun: number;
  limits: PolicyLimits;
}

/** The six-check invoicing gate from runbooks/invoicing.md §3, in runbook order. */
export function runInvoiceGate(i: InvoiceGateInput): GateResult {
  const L = i.limits;
  const checks: PolicyCheck[] = [
    check('kill_switch_absent', !i.killSwitchEngaged, i.killSwitchEngaged ? 'KILL_SWITCH engaged' : 'no kill switch'),
    check(
      'total_within_auto_send_max',
      i.invoiceGross <= L.auto_send_max + EPSILON,
      `invoice total £${i.invoiceGross.toFixed(2)} vs auto-send limit £${L.auto_send_max.toFixed(2)}`,
    ),
    check(
      'customer_has_paid_history',
      i.customerHasPaidHistory,
      i.customerHasPaidHistory ? 'customer has ≥1 previously paid invoice' : 'no previously paid invoice on record',
    ),
    check(
      'line_items_match_job_sheet',
      i.lineItemDelta <= 0.01 + EPSILON,
      `line item delta £${i.lineItemDelta.toFixed(2)} (tolerance £0.01)`,
    ),
    check(
      'daily_auto_send_value_within_limit',
      i.dailyAutoSentValue + i.invoiceGross <= L.daily_value_max + EPSILON,
      `£${i.dailyAutoSentValue.toFixed(2)} sent today + £${i.invoiceGross.toFixed(2)} vs daily limit £${L.daily_value_max.toFixed(2)}`,
    ),
    check(
      'actions_per_run_within_limit',
      i.actionsThisRun < L.actions_per_run_max,
      `${i.actionsThisRun} actions this run vs limit ${L.actions_per_run_max}`,
    ),
  ];
  return toResult(checks);
}

export interface EmailGateInput {
  killSwitchEngaged: boolean;
  /** Emails already sent to this customer today. */
  emailsToCustomerToday: number;
  actionsThisRun: number;
  /** Record IDs frozen by open escalations; emails touching them are blocked. */
  frozenRecords: string[];
  /** Records this email concerns (e.g. the invoice being chased). */
  touchesRecords: string[];
  limits: PolicyLimits;
}

/** Blast-radius gate for outbound customer email (reminders etc.). */
export function runEmailGate(i: EmailGateInput): GateResult {
  const frozen = i.touchesRecords.filter((r) => i.frozenRecords.includes(r));
  const checks: PolicyCheck[] = [
    check('kill_switch_absent', !i.killSwitchEngaged, i.killSwitchEngaged ? 'KILL_SWITCH engaged' : 'no kill switch'),
    check(
      'emails_per_customer_day_within_limit',
      i.emailsToCustomerToday < i.limits.emails_per_customer_day_max,
      `${i.emailsToCustomerToday} emails to customer today vs limit ${i.limits.emails_per_customer_day_max}`,
    ),
    check(
      'actions_per_run_within_limit',
      i.actionsThisRun < i.limits.actions_per_run_max,
      `${i.actionsThisRun} actions this run vs limit ${i.limits.actions_per_run_max}`,
    ),
    check(
      'records_not_frozen_by_escalation',
      frozen.length === 0,
      frozen.length ? `frozen by open escalation: ${frozen.join(', ')}` : 'no frozen records touched',
    ),
  ];
  return toResult(checks);
}
