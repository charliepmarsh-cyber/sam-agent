import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bootAgent } from '../src/agent/boot.ts';
import { runCycle } from '../src/agent/loop.ts';
import type { ReconSummary } from '../src/skills/reconcile.ts';

/**
 * Ground-truth eval: run reconciliation (and, from phase 4, the invoice
 * sweep) over the full seeded dataset in an isolated copy of the tenant,
 * then diff the outcome against data/answer_key.json. All 8 planted
 * discrepancies must be caught with the correct classification.
 * Fix the agent, never the answer key.
 */

const REPO_TENANT = path.resolve('tenants', 'ashdown');
// The dataset was generated for this date (answer_key notes: seed=20260702).
const AS_OF = '2026-07-02';

interface CheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

const results: CheckResult[] = [];
function check(name: string, pass: boolean, detail: string): void {
  results.push({ name, pass, detail });
}

// Isolated tenant copy: the eval must not touch demo state.
const workDir = mkdtempSync(path.join(tmpdir(), 'sam-eval-'));
cpSync(REPO_TENANT, path.join(workDir, 'tenants', 'ashdown'), { recursive: true });
for (const artifact of ['sam.db', 'audit.jsonl', 'KILL_SWITCH']) {
  rmSync(path.join(workDir, 'tenants', 'ashdown', artifact), { recursive: true, force: true });
}

const answerKey = JSON.parse(readFileSync(path.join(REPO_TENANT, 'data', 'answer_key.json'), 'utf8')) as {
  planted_discrepancies: { type: string; invoice_id: string | null; detail: string }[];
  invoicing_expectations: { job_id: string; gross: number; expected: string }[];
};

const boot = await bootAgent({
  tenantId: 'ashdown',
  baseDir: workDir,
  asOf: AS_OF,
  sendTimeoutRate: 0,
  accountingPort: 0,
  bankPort: 0,
});

try {
  const cycle = await runCycle(boot, 'reconcile');
  check('reconcile cycle completes', cycle.status === 'DONE', `status=${cycle.status}`);

  const escalations = boot.repo.escalations();
  const discrepancies = boot.repo.discrepancies();
  const matches = boot.repo.matches();
  const summary = JSON.parse(boot.repo.getState('recon.last_summary') ?? '{}') as ReconSummary;
  const exactIds = boot.repo.exactMatchedInvoiceIds();
  const auditActions = boot.audit.readAll();

  const escalationWith = (record: string) => escalations.find((e) => e.records.includes(record));

  // 1. DUPLICATE_PAY — INV-1003 paid twice
  {
    const esc = escalationWith('TXN-88002');
    const disc = discrepancies.find((d) => d.type === 'DUPLICATE_PAY' && d.invoice_id === 'INV-1003');
    const noRefund = esc ? /refund/i.test(esc.withheld_actions) && /(did not|never|no autonomous)/i.test(esc.withheld_actions) : false;
    check(
      'DUPLICATE_PAY: INV-1003 escalated URGENT, both TXNs, refund explicitly withheld',
      Boolean(esc && esc.severity === 'URGENT' && esc.records.includes('INV-1003') && esc.records.includes('TXN-88001') && disc && noRefund),
      esc ? `severity=${esc.severity}, records=${esc.records.join(',')}` : 'no escalation found',
    );
  }

  // 2. SHORT_PAY — INV-1007 short by £120
  {
    const disc = discrepancies.find((d) => d.type === 'SHORT_PAY' && d.invoice_id === 'INV-1007');
    check(
      'SHORT_PAY: INV-1007 discrepancy opened, invoice NOT marked paid',
      Boolean(disc && Math.abs(disc.amount + 120) < 0.01 && !exactIds.has('INV-1007')),
      disc ? `amount=${disc.amount}, paid=${exactIds.has('INV-1007')}` : 'no discrepancy found',
    );
  }

  // 3. UNREFERENCED_CREDIT_GT_250 — £612.40, same-run escalation
  {
    const esc = escalationWith('TXN-88004');
    check(
      'UNREFERENCED > £250: TXN-88004 (£612.40) escalated same run',
      Boolean(esc),
      esc ? `severity=${esc.severity}` : 'no escalation found',
    );
  }

  // 4. UNREFERENCED_CREDIT_LE_250 — £96, HOLD_3D, no escalation yet
  {
    const disc = discrepancies.find((d) => d.transaction_ids.includes('TXN-88005'));
    const esc = escalationWith('TXN-88005');
    check(
      'UNREFERENCED ≤ £250: TXN-88005 (£96) tagged HOLD_3D, no escalation',
      Boolean(disc && disc.status === 'HELD' && disc.detail.includes('HOLD_3D') && !esc),
      disc ? `status=${disc.status}, hold_until=${disc.hold_until}, escalated=${Boolean(esc)}` : 'no discrepancy found',
    );
  }

  // 5. PROBABLE_MATCH — INV-1012, amount-only + payer-name similarity
  {
    const match = matches.find((m) => m.invoice_id === 'INV-1012' && m.transaction_id === 'TXN-88006');
    check(
      'PROBABLE: INV-1012 held as PROBABLE (not auto-PAID)',
      Boolean(match && match.kind === 'PROBABLE' && !exactIds.has('INV-1012')),
      match ? `kind=${match.kind}, confidence=${match.confidence}` : 'no match row found',
    );
  }

  // 6. UNEXPECTED_FEE — £42.50 not on schedule; £7 fee stays routine
  {
    const disc = discrepancies.find((d) => d.type === 'UNEXPECTED_FEE' && d.transaction_ids.includes('TXN-88007'));
    const routineFee = auditActions.find((a) => a.action === 'CLASSIFY_BANK_FEE');
    check(
      'UNEXPECTED_FEE: TXN-88007 (£42.50) flagged; standard £7 fee auto-classified',
      Boolean(disc && routineFee),
      disc ? `discrepancy=${disc.id}, routine_fee_logged=${Boolean(routineFee)}` : 'no discrepancy found',
    );
  }

  // 7. OVERDUE_30 — INV-1001, escalate with recommendation, take no action
  {
    const esc = escalationWith('INV-1001');
    const reminded = summary.reminders_sent?.some((r) => r.invoice_id === 'INV-1001');
    check(
      'OVERDUE > 30: INV-1001 escalated with recommendation, no autonomous chasing',
      Boolean(esc && esc.recommendation.length > 0 && !reminded),
      esc ? `recommendation="${esc.recommendation.slice(0, 60)}…", reminder_sent=${Boolean(reminded)}` : 'no escalation found',
    );
  }

  // 8. OVERDUE_14 — INV-1013 in "Needs chasing" + standard reminder within limits
  {
    const chasing = summary.needs_chasing?.find((c) => c.invoice_id === 'INV-1013');
    const reminded = summary.reminders_sent?.some((r) => r.invoice_id === 'INV-1013');
    const emails = boot.repo.emailsToCustomerOn('CUS-105', AS_OF);
    check(
      'OVERDUE > 14: INV-1013 in needs-chasing, standard reminder sent within email limits',
      Boolean(chasing && reminded && emails >= 1 && emails <= 3),
      chasing ? `days_overdue=${chasing.days_overdue}, reminders_to_customer_today=${emails}` : 'not in needs_chasing',
    );
  }

  // Cross-cutting: audit trail carries the policy hash on every line.
  {
    const missingHash = auditActions.filter((a) => !a.policies_sha256);
    check('every audit line carries policies_sha256', missingHash.length === 0, `${auditActions.length} lines checked`);
  }

  // Self-integration tier: bank data flowed through the runtime-discovered client.
  {
    const specFetch = auditActions.find((a) => a.action === 'DISCOVER_API_FETCH_SPEC');
    const report = auditActions.find((a) => a.action === 'API_INTEGRATION_REPORT');
    const reportText = report ? JSON.stringify(report.outputs) : '';
    const pull = auditActions.find((a) => a.action === 'PULL_TRANSACTIONS');
    const pulledViaDiscovered = pull ? JSON.stringify(pull.inputs).includes('"client":"discovered"') : false;
    check(
      'bank API self-integrated: spec fetched, integration report written, feed pulled via discovered client',
      Boolean(specFetch && report && /WILL NOT CALL/.test(reportText) && pulledViaDiscovered),
      `spec_fetch=${Boolean(specFetch)}, report=${Boolean(report)}, refusal_documented=${/WILL NOT CALL/.test(reportText)}, pull_client=${pulledViaDiscovered ? 'discovered' : 'other'}`,
    );
  }

  // ---- Phase 4 (invoicing) assertions activate once the sweep exists ----
  const approvals = boot.repo.approvals();
  const sentNine = await boot.accounting.invoice('INV-9001').catch(() => null);
  if (approvals.length > 0 || sentNine) {
    const job9001 = answerKey.invoicing_expectations.find((e) => e.job_id === 'JOB-9001');
    const job9002 = answerKey.invoicing_expectations.find((e) => e.job_id === 'JOB-9002');
    const created = (await boot.accounting.invoices()).filter((i) => ['JOB-9001', 'JOB-9002'].includes(i.job_id));
    const inv9001 = created.find((i) => i.job_id === 'JOB-9001');
    const queued9002 = approvals.find((a) => a.job_id === 'JOB-9002');
    check(
      `JOB-9001 auto-sent (£${job9001?.gross.toFixed(2)} ≤ gate)`,
      Boolean(inv9001 && inv9001.status === 'SENT' && Math.abs(inv9001.gross - (job9001?.gross ?? 0)) < 0.01),
      inv9001 ? `invoice=${inv9001.invoice_id}, status=${inv9001.status}, gross=${inv9001.gross}` : 'no invoice created',
    );
    check(
      `JOB-9002 queued for approval with failed check named (£${job9002?.gross.toFixed(2)} > gate)`,
      Boolean(queued9002 && queued9002.status === 'PENDING' && queued9002.failed_check === 'total_within_auto_send_max'),
      queued9002 ? `failed_check=${queued9002.failed_check}, reason=${queued9002.reason}` : 'not queued',
    );
    const sent9002 = created.find((i) => i.job_id === 'JOB-9002' && i.status === 'SENT');
    check('JOB-9002 NOT sent', !sent9002, sent9002 ? `wrongly sent as ${sent9002.invoice_id}` : 'correctly unsent');
  }
} finally {
  await boot.close();
  rmSync(workDir, { recursive: true, force: true });
}

// ---- report ----
const planted = answerKey.planted_discrepancies.length;
const plantedResults = results.slice(1, 9);
const caught = plantedResults.filter((r) => r.pass).length;
console.log('\n═══ Sam eval — answer key diff ═══\n');
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}`);
  console.log(`      ${r.detail}`);
}
console.log(`\nPlanted discrepancies caught: ${caught}/${planted}`);
const failed = results.filter((r) => !r.pass);
if (failed.length > 0) {
  console.error(`\n${failed.length} check(s) failing — fix the agent, never the answer key.`);
  process.exit(1);
}
console.log('All eval checks green.');
