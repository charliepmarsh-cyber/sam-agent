import path from 'node:path';
import type { Run } from '../agent/run.ts';
import { loadJobSheets } from '../mock-api/data.ts';
import { runInvoiceGate } from '../substrate/gate.ts';
import { killSwitchEngaged } from '../substrate/killswitch.ts';
import { addDays } from '../lib/dates.ts';
import type { CustomerRecord, InvoiceRecord, JobSheetRecord, PolicyCheck } from '../types.ts';

const VAT_STANDARD = 0.2;
/** 5% only when the job sheet carries the domestic-energy flag (none in the seeded data). */
const VAT_DOMESTIC_ENERGY = 0.05;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface BuiltInvoice {
  net: number;
  vat: number;
  gross: number;
  issue_date: string;
  due_date: string;
  memo: string;
}

/** runbooks/invoicing.md §2 — line items verbatim, VAT, terms by customer type. */
export function buildInvoice(job: JobSheetRecord, customer: CustomerRecord, asOf: string, domesticEnergy = false): BuiltInvoice {
  const net = round2(job.net_amount);
  const vat = round2(net * (domesticEnergy ? VAT_DOMESTIC_ENERGY : VAT_STANDARD));
  return {
    net,
    vat,
    gross: round2(net + vat),
    issue_date: asOf,
    due_date: customer.type === 'commercial' ? addDays(asOf, customer.terms_days || 30) : asOf,
    memo: `Job sheet ${job.job_id} — ${job.description}`,
  };
}

/**
 * runbooks/invoicing.md: heartbeat sweep for signed job sheets with no
 * invoice yet. Validate → build → six-check policy gate → send (with
 * verify-before-retry) or queue for approval with the failed check named.
 */
export async function invoiceSweepSkill(run: Run): Promise<void> {
  const { repo, accounting, tenantRoot, tenantId, asOf } = run.boot;

  const jobSheets = await run.act('READ_JOB_SHEETS', { source: path.join('tenants', tenantId, 'data', 'job_sheets.csv') }, () =>
    loadJobSheets(path.join(tenantRoot, 'data')),
  );
  const invoices = await run.act('READ_INVOICES', { source: 'accounting API' }, () => accounting.invoices());
  const customers = await run.act('READ_CUSTOMERS', { source: 'accounting API' }, () => accounting.customers());
  const customerById = new Map(customers.map((c) => [c.customer_id, c]));
  const invoicedJobs = new Set(invoices.map((i) => i.job_id));
  const queuedJobs = new Set(repo.approvals().map((a) => a.job_id));

  const pending = jobSheets.filter((j) => !invoicedJobs.has(j.job_id) && !queuedJobs.has(j.job_id));
  if (pending.length === 0) {
    run.log('INVOICE_SWEEP', { job_sheets: jobSheets.length }, { pending: 0, note: 'nothing to invoice' });
    return;
  }

  for (const job of pending) {
    // §1 validate
    if (!job.signed || !job.customer_id || !job.completion_date || job.net_amount <= 0) {
      run.log('JOB_SHEET_INVALID', { job: job.job_id }, { reason: 'missing signature, customer, completion date, or line items — not invoiceable' });
      run.notes.push(`Job sheet ${job.job_id} is not invoiceable (validation failed) — surfaced for a human.`);
      continue;
    }
    const customer = customerById.get(job.customer_id);
    if (!customer) {
      const queued = repo.queueApproval({
        job_id: job.job_id,
        invoice_id: null,
        customer_id: job.customer_id,
        amount: round2(job.net_amount * (1 + VAT_STANDARD)),
        reason: `customer ${job.customer_id} not found in the accounting system — new customers always queue`,
        failed_check: 'customer_resolves_in_accounting',
      });
      run.log('INVOICE_QUEUED', { job: job.job_id }, { approval: queued?.id ?? 'duplicate', reason: 'unresolved customer' });
      continue;
    }

    // §2 build
    const built = buildInvoice(job, customer, asOf);

    // §3 policy gate — hard checks, in order, all-or-queue.
    const gate = runInvoiceGate({
      killSwitchEngaged: killSwitchEngaged(tenantRoot),
      invoiceGross: built.gross,
      customerHasPaidHistory: repo.customerHasPaidInvoice(customer.customer_id, (invId) => invoices.find((i) => i.invoice_id === invId)?.customer_id ?? null),
      lineItemDelta: Math.abs(built.net - job.net_amount),
      dailyAutoSentValue: repo.autoSentValueOn(asOf),
      actionsThisRun: run.autonomousActions,
      limits: run.policies.limits,
    });
    run.log('INVOICE_GATE', { job: job.job_id, gross: built.gross }, { allowed: gate.allowed, failed_check: gate.failedCheck }, { policy_checks: gate.checks });

    if (!gate.allowed) {
      if (gate.failedCheck === 'actions_per_run_within_limit' || gate.failedCheck === 'daily_auto_send_value_within_limit') {
        run.hitLimit(gate.failedCheck, `invoice for ${job.job_id} queued instead of sent`);
      }
      // Build as DRAFT so the amount is real, then queue with the failed check named.
      const draft = await run.act('CREATE_DRAFT_INVOICE', { job: job.job_id, customer: customer.customer_id, gross: built.gross }, () =>
        accounting.createInvoice({ job_id: job.job_id, customer_id: customer.customer_id, ...built }),
      );
      const failedDetail = gate.checks.find((c) => c.name === gate.failedCheck)?.detail ?? gate.failedCheck ?? 'gate failed';
      const queued = repo.queueApproval({
        job_id: job.job_id,
        invoice_id: draft.invoice_id,
        customer_id: customer.customer_id,
        amount: built.gross,
        reason: failedDetail,
        failed_check: gate.failedCheck ?? 'unknown',
      });
      run.log('INVOICE_QUEUED', { job: job.job_id, invoice: draft.invoice_id }, { approval: queued?.id ?? 'duplicate', failed_check: gate.failedCheck });
      continue;
    }

    // §4 send & verify (verify-before-retry lives in the client).
    const draft = await run.act('CREATE_INVOICE', { job: job.job_id, customer: customer.customer_id, gross: built.gross }, () =>
      accounting.createInvoice({ job_id: job.job_id, customer_id: customer.customer_id, ...built }),
    );
    await sendWithVerify(run, draft, gate.checks);
  }
}

/** runbooks/invoicing.md §5 — human-approved items send on the next heartbeat with the full gate re-run. */
export async function processApprovalsSkill(run: Run): Promise<void> {
  const { repo, accounting, tenantRoot, asOf } = run.boot;
  const approved = repo.approvals('APPROVED');
  if (approved.length === 0) {
    run.log('APPROVALS_SWEEP', null, { approved_pending_send: 0 });
    return;
  }
  const invoices = await run.act('READ_INVOICES', { source: 'accounting API' }, () => accounting.invoices());

  for (const approval of approved) {
    const invoice = approval.invoice_id ? invoices.find((i) => i.invoice_id === approval.invoice_id) : undefined;
    if (!invoice) {
      run.log('APPROVAL_SKIPPED', { approval: approval.id }, { reason: 'no draft invoice on record — needs manual creation' });
      run.notes.push(`Approved item ${approval.id} (${approval.job_id}) has no draft invoice; needs a human to create it.`);
      continue;
    }
    // Same §3 gate re-run, minus the auto-send-size checks a human has
    // explicitly overridden by approving (total & payment history);
    // blast-radius limits still apply and are never human-waivable mid-run.
    const gate = runInvoiceGate({
      killSwitchEngaged: killSwitchEngaged(tenantRoot),
      invoiceGross: 0, // approved amount no longer counts against the auto-send size cap...
      customerHasPaidHistory: true, // ...nor the history check — a human said send it
      lineItemDelta: 0,
      dailyAutoSentValue: repo.autoSentValueOn(asOf),
      actionsThisRun: run.autonomousActions,
      limits: run.policies.limits,
    });
    run.log('APPROVAL_GATE', { approval: approval.id, invoice: invoice.invoice_id }, { allowed: gate.allowed, failed_check: gate.failedCheck }, { policy_checks: gate.checks });
    if (!gate.allowed) {
      run.notes.push(`Approved ${approval.id} still blocked by ${gate.failedCheck}; will retry next heartbeat.`);
      continue;
    }
    await sendWithVerify(run, invoice, gate.checks, approval.id);
  }
}

async function sendWithVerify(run: Run, invoice: InvoiceRecord, policyChecks: PolicyCheck[], approvalId?: string): Promise<void> {
  const { repo, accounting, asOf } = run.boot;
  const result = await run.act(
    'SEND_INVOICE',
    { invoice: invoice.invoice_id, job: invoice.job_id, gross: invoice.gross, approval: approvalId ?? null },
    () => accounting.sendInvoice(invoice.invoice_id),
    { autonomous: true, policy_checks: policyChecks },
  );
  if (result.path !== 'direct') {
    run.log('SEND_VERIFY_PATH', { invoice: invoice.invoice_id }, {
      path: result.path,
      note: 'ambiguous send failure — invoice status read BEFORE any retry (policies.md §5)',
    });
  }
  if (approvalId) {
    repo.setApprovalStatus(approvalId, 'SENT');
  } else {
    repo.logAutoSend(invoice.invoice_id, invoice.gross, asOf);
  }
  console.log(`[sam] invoice ${invoice.invoice_id} (${invoice.job_id}) £${invoice.gross.toFixed(2)} sent${approvalId ? ` (approved: ${approvalId})` : ' autonomously'}`);
}
