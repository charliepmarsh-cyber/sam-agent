import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Run } from '../agent/run.ts';
import { ensureBankFeed } from './discover.ts';
import type { ReconSummary } from './reconcile.ts';
import type { SeenTransaction } from './matcher.ts';
import { addDays } from '../lib/dates.ts';

/**
 * runbooks/daily-briefing.md, exactly: strict section order, worst news
 * first, plain English, every number traceable to record IDs, readable
 * in ~90 seconds. The numbers come straight from memory/audit records —
 * the model may polish nothing here; structure is the contract.
 */
export async function briefingSkill(run: Run): Promise<void> {
  const { repo, accounting, tenantRoot, asOf } = run.boot;
  const bank = await ensureBankFeed(run);

  const balance = await run.act('READ_BALANCE', { client: bank.origin }, () => bank.balance());
  const invoices = await run.act('READ_INVOICES', { source: 'accounting API' }, () => accounting.invoices());

  const summaryRaw = repo.getState('recon.last_summary');
  const summary = summaryRaw ? (JSON.parse(summaryRaw) as ReconSummary) : null;
  const reconRanToday = summary?.as_of === asOf;
  const escalations = repo.escalations('OPEN');
  const urgent = escalations.filter((e) => e.severity === 'URGENT');
  const discrepancies = repo.discrepancies().filter((d) => d.status !== 'CLOSED');
  const approvals = repo.approvals('PENDING');
  const autoSends = repo.autoSendsOn(asOf);
  const emails = repo.emailsOn(asOf);
  const probable = repo.matches().filter((m) => m.kind === 'PROBABLE');
  const paidIds = repo.exactMatchedInvoiceIds();

  // Movement vs yesterday: net of transactions dated yesterday (traceable to TXN ids).
  const seen: SeenTransaction[] = JSON.parse(repo.getState('recon.seen_txns') ?? '[]');
  const yesterday = addDays(asOf, -1);
  const yesterdayTxns = seen.filter((t) => t.date === yesterday);
  const movement = Math.round(yesterdayTxns.reduce((s, t) => s + t.amount, 0) * 100) / 100;

  // Expected receipts next 7 days: open invoices due in (asOf, asOf+7].
  const horizon = addDays(asOf, 7);
  const expected = invoices.filter(
    (i) => i.status === 'SENT' && !paidIds.has(i.invoice_id) && i.due_date >= asOf && i.due_date <= horizon,
  );
  const expectedValue = Math.round(expected.reduce((s, i) => s + i.gross, 0) * 100) / 100;

  const gbp = (n: number): string => `£${n.toFixed(2)}`;
  const lines: string[] = [];

  // 1. Headline — worst news first.
  let headline: string;
  if (urgent.length > 0) {
    headline = `URGENT: ${urgent.length === 1 ? urgent[0]!.observed : `${urgent.length} urgent escalations need you today — worst: ${urgent[0]!.observed}`}`;
  } else if (run.limitHit) {
    headline = `A blast-radius limit (${run.limitHit}) stopped autonomous work early today — details below.`;
  } else if (!reconRanToday) {
    headline = `Reconciliation has NOT run for ${asOf} — figures below are from the last completed run${summary ? ` (${summary.as_of})` : ''}.`;
  } else {
    headline = `Cash ${movement >= 0 ? 'up' : 'down'} ${gbp(Math.abs(movement))} since yesterday; ${escalations.length} open escalation${escalations.length === 1 ? '' : 's'}, nothing urgent.`;
  }
  lines.push(`# Daily briefing — ${asOf}`, '', `**${headline}**`, '');

  // 2. Cash position.
  lines.push('## Cash position');
  lines.push(`- Bank balance: ${gbp(balance.balance)} (bank feed, as of ${balance.as_of ?? 'n/a'})`);
  lines.push(
    `- vs yesterday: ${movement >= 0 ? '+' : ''}${gbp(movement).replace('£-', '-£')} (${yesterdayTxns.length === 0 ? 'no transactions' : yesterdayTxns.map((t) => t.transaction_id).join(', ')})`,
  );
  lines.push(`- Expected in next 7 days: ${gbp(expectedValue)} across ${expected.length} open invoice${expected.length === 1 ? '' : 's'} due by ${horizon}${expected.length ? ` (${expected.map((i) => i.invoice_id).join(', ')})` : ''}`);
  lines.push('');

  // 3. Escalations & discrepancies.
  lines.push('## Escalations & discrepancies');
  if (escalations.length === 0 && discrepancies.length === 0 && probable.length === 0) {
    lines.push('- None open.');
  }
  for (const e of escalations) {
    lines.push(`- **[${e.severity}] ${e.id}** — ${e.observed}`);
    lines.push(`  - Records: ${e.records.join(', ')} | Policy: ${e.policy_triggered}`);
    lines.push(`  - Recommended: ${e.recommendation}`);
    lines.push(`  - What I deliberately did NOT do: ${e.withheld_actions}`);
  }
  const escalatedRecords = new Set(escalations.flatMap((e) => e.records));
  for (const d of discrepancies) {
    if (d.transaction_ids.some((t) => escalatedRecords.has(t)) || (d.invoice_id && escalatedRecords.has(d.invoice_id))) continue;
    lines.push(`- **[${d.status}] ${d.id} (${d.type})** — ${d.detail} Records: ${[d.invoice_id, ...d.transaction_ids].filter(Boolean).join(', ')}`);
  }
  for (const p of probable) {
    lines.push(`- **[AWAITING CONFIRMATION]** ${p.invoice_id} looks paid by ${p.transaction_id} (confidence ${p.confidence}) — please confirm so I can mark it paid.`);
  }
  lines.push('');

  // 4. Awaiting your approval.
  lines.push('## Awaiting your approval');
  if (approvals.length === 0) lines.push('- Nothing queued.');
  for (const a of approvals) {
    lines.push(`- **${a.id}** — ${a.job_id}${a.invoice_id ? ` (draft ${a.invoice_id})` : ''}, ${gbp(a.amount)}: ${a.reason}`);
  }
  lines.push('');

  // 5. Done autonomously since last briefing.
  const sentValue = Math.round(autoSends.reduce((s, a) => s + a.amount, 0) * 100) / 100;
  lines.push('## Done autonomously since last briefing');
  lines.push(`- Invoices sent: ${autoSends.length} (${gbp(sentValue)})${autoSends.length ? ` — ${autoSends.map((a) => a.invoice_id).join(', ')}` : ''}`);
  if (reconRanToday && summary) {
    lines.push(`- Payments matched: ${summary.matched.count} (${gbp(summary.matched.value)}), auto-match rate ${(summary.auto_match_rate * 100).toFixed(0)}%`);
    lines.push(`- Bank fees classified: ${summary.fees.count} (${gbp(summary.fees.value)})`);
  } else {
    lines.push('- Payments matched: reconciliation did not run today (see headline).');
  }
  const reminders = emails.filter((e) => e.kind === 'reminder');
  lines.push(`- Reminders sent: ${reminders.length}${reminders.length ? ` — ${reminders.map((r) => `${r.invoice_id} → ${r.customer_id}`).join(', ')}` : ''}`);
  lines.push('');

  // 6. Needs chasing.
  lines.push('## Needs chasing (overdue > 14 days)');
  const chasing = summary?.needs_chasing ?? [];
  if (chasing.length === 0) lines.push('- Nothing over 14 days.');
  for (const c of chasing) {
    lines.push(`- ${c.customer_name}: ${gbp(c.amount)} (${c.invoice_id}), ${c.days_overdue} days overdue — ${c.reminder}`);
  }
  lines.push('');

  // 7. Sam's notes (max 3 bullets).
  lines.push("## Sam's notes");
  const notes = run.notes.slice(0, 3);
  if (probable.length > 0 && notes.length < 3) {
    notes.push(`Unreferenced payments keep arriving (${probable.length} probable + ${summary?.held.length ?? 0} held this run) — worth adding the invoice number to payment instructions.`);
  }
  if (notes.length === 0) notes.push('Nothing unusual to flag today.');
  for (const n of notes.slice(0, 3)) lines.push(`- ${n}`);

  const briefing = lines.join('\n');

  // Delivery: email Maria (console mock) + copy to memory and briefings/.
  await run.act(
    'DELIVER_BRIEFING',
    { to: 'maria (owner)', as_of: asOf },
    () => {
      const dir = path.join(tenantRoot, 'briefings');
      mkdirSync(dir, { recursive: true });
      const filePath = path.join(dir, `${asOf}.md`);
      try {
        writeFileSync(filePath, briefing);
      } catch (err) {
        // Retry once, then surface at next heartbeat (runbook delivery rule).
        try {
          writeFileSync(filePath, briefing);
        } catch {
          run.notes.push(`Briefing file delivery failed twice: ${(err as Error).message}`);
          return { delivered: 'console-only', error: (err as Error).message };
        }
      }
      console.log('\n' + briefing + '\n');
      return { delivered: 'console+file', path: path.relative(tenantRoot, filePath), sections: 7 };
    },
    { autonomous: true },
  );
  repo.setState('briefing.last_date', asOf);
}
