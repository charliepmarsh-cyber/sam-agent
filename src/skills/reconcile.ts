import type { Run } from '../agent/run.ts';
import { classifyTransaction, extractInvoiceRef, type SeenTransaction, type ExpectedFee } from './matcher.ts';
import { runEmailGate } from '../substrate/gate.ts';
import { addBusinessDays, daysBetween } from '../lib/dates.ts';
import type { CustomerRecord, EscalationObject, InvoiceRecord } from '../types.ts';

export interface ReconSummary {
  as_of: string;
  credits_processed: number;
  matched: { count: number; value: number };
  probable: { invoice_id: string; transaction_id: string; payer: string }[];
  discrepancy_ids: string[];
  escalation_ids: string[];
  fees: { count: number; value: number };
  needs_chasing: { invoice_id: string; customer_id: string; customer_name: string; amount: number; days_overdue: number; reminder: string }[];
  reminders_sent: { invoice_id: string; customer_id: string }[];
  held: { transaction_id: string; amount: number; hold_until: string }[];
  auto_match_rate: number;
}

/** Default expected-fee schedule seeded into memory on first run (Starling business account). */
const DEFAULT_EXPECTED_FEES: ExpectedFee[] = [{ descriptor: 'STARLING MONTHLY FEE', amount: -7.0 }];

/**
 * runbooks/reconciliation.md, faithfully: deterministic match passes,
 * duplicate detection, unreferenced handling with hold/escalate
 * thresholds, fee classification, then the aging pass. Every action is
 * audited; escalation objects follow runbooks/escalation.md including
 * withheld_actions.
 */
export async function reconcileSkill(run: Run): Promise<void> {
  const { repo, bank, accounting, model, tenantId, asOf } = run.boot;
  const summary: ReconSummary = {
    as_of: asOf,
    credits_processed: 0,
    matched: { count: 0, value: 0 },
    probable: [],
    discrepancy_ids: [],
    escalation_ids: [],
    fees: { count: 0, value: 0 },
    needs_chasing: [],
    reminders_sent: [],
    held: [],
    auto_match_rate: 0,
  };

  // §1 load state
  const cursor = repo.getState('recon.last_cursor');
  const invoices = await run.act('READ_INVOICES', { source: 'accounting API', credential: `tenant/${tenantId}/accounting-api` }, () =>
    accounting.invoices(),
  );
  const customers = await run.act('READ_CUSTOMERS', { source: 'accounting API' }, () => accounting.customers());
  const pulled = await run.act(
    'PULL_TRANSACTIONS',
    { since_cursor: cursor, client: bank.origin, credential: `tenant/${tenantId}/bank-api` },
    () => bank.pullSince(cursor),
  );

  if (repo.factsByKind('expected_fee').length === 0) {
    for (const fee of DEFAULT_EXPECTED_FEES) repo.addFact('expected_fee', JSON.stringify(fee));
    run.log('FACT_SEEDED', { kind: 'expected_fee' }, DEFAULT_EXPECTED_FEES);
  }
  const expectedFees = repo.factsByKind('expected_fee').map((f) => JSON.parse(f) as ExpectedFee);

  const seen: SeenTransaction[] = JSON.parse(repo.getState('recon.seen_txns') ?? '[]');
  const seenIds = new Set(seen.map((s) => s.transaction_id));
  const paidInvoiceIds = repo.exactMatchedInvoiceIds();
  const customerById = new Map(customers.map((c) => [c.customer_id, c]));

  // §3 (holds): release HOLD_3D items whose window has lapsed, escalate.
  for (const held of repo.discrepancies('HELD')) {
    if (held.hold_until && held.hold_until <= asOf) {
      repo.releaseHold(held.id);
      const escalation = await raiseEscalation(run, summary, {
        tenant_id: tenantId,
        severity: 'STANDARD',
        observed: `Unreferenced item ${held.transaction_ids.join(', ')} (£${held.amount.toFixed(2)}) still unmatched after the 3-business-day hold.`,
        records: [held.id, ...held.transaction_ids],
        policy_triggered: 'policies.md §3 — unmatched ≤ £250, hold 3 business days, then escalate',
        recommendation: 'Ask the payer for the date/amount and tie it to an invoice, or return the funds.',
        withheld_actions: 'Did not allocate the funds to any invoice and did not contact any customer about it.',
      });
      if (escalation) run.log('HOLD_ESCALATED', { discrepancy: held.id }, { escalation });
    }
  }

  // §2–§4 match passes, oldest first.
  let exactCount = 0;
  for (const txn of pulled.transactions) {
    if (seenIds.has(txn.transaction_id)) continue;
    const classification = classifyTransaction(txn, {
      invoices,
      paidInvoiceIds,
      seenTransactions: seen,
      expectedFees,
      escalateOver: run.policies.limits.unmatched_escalate_over,
    });
    if (txn.amount > 0) summary.credits_processed++;

    switch (classification.kind) {
      case 'EXACT': {
        repo.recordMatch({
          invoice_id: classification.invoiceId,
          transaction_id: txn.transaction_id,
          kind: 'EXACT',
          confidence: 1.0,
          amount: txn.amount,
          matched_at: asOf,
        });
        paidInvoiceIds.add(classification.invoiceId);
        exactCount++;
        summary.matched.count++;
        summary.matched.value += txn.amount;
        run.log('MATCH_EXACT', { transaction: txn.transaction_id, invoice: classification.invoiceId }, {
          confidence: 1.0,
          de_minimis_delta: classification.deMinimisDelta,
        });
        break;
      }
      case 'SHORT_PAY': {
        const opened = repo.openDiscrepancy({
          type: 'SHORT_PAY',
          invoice_id: classification.invoiceId,
          transaction_ids: [txn.transaction_id],
          amount: -classification.shortBy,
          status: 'OPEN',
          detail: `Short-paid by £${classification.shortBy.toFixed(2)} — invoice NOT marked paid (runbook §2.2).`,
          hold_until: null,
        });
        if (opened) summary.discrepancy_ids.push(opened.id);
        run.log('DISCREPANCY_SHORT_PAY', { transaction: txn.transaction_id, invoice: classification.invoiceId }, { short_by: classification.shortBy });
        break;
      }
      case 'OVER_PAY': {
        const opened = repo.openDiscrepancy({
          type: 'OVER_PAY',
          invoice_id: classification.invoiceId,
          transaction_ids: [txn.transaction_id],
          amount: classification.overBy,
          status: 'OPEN',
          detail: `Overpaid by £${classification.overBy.toFixed(2)}. Refunds are never autonomous (policies.md §1).`,
          hold_until: null,
        });
        if (opened) summary.discrepancy_ids.push(opened.id);
        run.log('DISCREPANCY_OVER_PAY', { transaction: txn.transaction_id, invoice: classification.invoiceId }, { over_by: classification.overBy });
        break;
      }
      case 'DUPLICATE_PAY': {
        const opened = repo.openDiscrepancy({
          type: 'DUPLICATE_PAY',
          invoice_id: classification.invoiceId,
          transaction_ids: [classification.priorTransactionId, txn.transaction_id],
          amount: txn.amount,
          status: 'OPEN',
          detail: `Same amount + reference ${classification.reference} within 5 business days.`,
          hold_until: null,
        });
        if (opened) summary.discrepancy_ids.push(opened.id);
        await raiseEscalation(run, summary, {
          tenant_id: tenantId,
          severity: 'URGENT',
          observed: `Suspected duplicate payment: £${txn.amount.toFixed(2)} received twice for ${classification.reference} (${classification.priorTransactionId} then ${txn.transaction_id}, within 5 business days).`,
          records: [classification.invoiceId, classification.priorTransactionId, txn.transaction_id],
          policy_triggered: 'policies.md §3 — suspected duplicate payment: escalate immediately, NEVER attempt an autonomous refund',
          recommendation: `Confirm with the bank, then refund one payment of £${txn.amount.toFixed(2)} to the customer manually.`,
          withheld_actions: `Did NOT attempt an autonomous refund of £${txn.amount.toFixed(2)} and did NOT email the customer — refunds and credit notes are never autonomous (policies.md §1, §3).`,
        });
        run.log('DISCREPANCY_DUPLICATE_PAY', { transaction: txn.transaction_id, prior: classification.priorTransactionId, invoice: classification.invoiceId }, { amount: txn.amount });
        break;
      }
      case 'AMOUNT_CANDIDATE': {
        const similarity = await run.act(
          'CLASSIFY_PAYER_NAME',
          { payer: classification.payerName, customer: classification.customerName },
          () => model.nameSimilar(classification.payerName, classification.customerName),
        );
        if (similarity.similar) {
          repo.recordMatch({
            invoice_id: classification.invoiceId,
            transaction_id: txn.transaction_id,
            kind: 'PROBABLE',
            confidence: 0.85,
            amount: txn.amount,
            matched_at: asOf,
          });
          summary.probable.push({ invoice_id: classification.invoiceId, transaction_id: txn.transaction_id, payer: classification.payerName });
          run.log(
            'MATCH_PROBABLE',
            { transaction: txn.transaction_id, invoice: classification.invoiceId },
            { confidence: 0.85, note: 'held for confirmation in briefing — NOT marked paid (runbook §2.3)' },
            { model: similarity.model },
          );
        } else {
          await handleUnreferenced(run, summary, txn.transaction_id, txn.amount, 'credit', Math.abs(txn.amount) > run.policies.limits.unmatched_escalate_over);
        }
        break;
      }
      case 'BANK_FEE': {
        summary.fees.count++;
        summary.fees.value += Math.abs(txn.amount);
        run.log('CLASSIFY_BANK_FEE', { transaction: txn.transaction_id }, { descriptor: classification.descriptor, amount: txn.amount });
        break;
      }
      case 'UNEXPECTED_FEE': {
        const opened = repo.openDiscrepancy({
          type: 'UNEXPECTED_FEE',
          invoice_id: null,
          transaction_ids: [txn.transaction_id],
          amount: txn.amount,
          status: 'OPEN',
          detail: `Debit £${Math.abs(txn.amount).toFixed(2)} "${txn.description}" not on the expected fee schedule.`,
          hold_until: null,
        });
        if (opened) summary.discrepancy_ids.push(opened.id);
        run.log('DISCREPANCY_UNEXPECTED_FEE', { transaction: txn.transaction_id }, { amount: txn.amount, description: txn.description });
        break;
      }
      case 'UNREFERENCED': {
        await handleUnreferenced(run, summary, txn.transaction_id, txn.amount, classification.direction, classification.escalate);
        break;
      }
    }

    seen.push({ transaction_id: txn.transaction_id, date: txn.date, amount: txn.amount, reference: extractInvoiceRef(txn.description) });
    seenIds.add(txn.transaction_id);
  }

  // §5 aging pass — after escalations above so freezes apply.
  await agingPass(run, summary, invoices, customerById, paidInvoiceIds);

  // §6 close out
  summary.matched.value = Math.round(summary.matched.value * 100) / 100;
  summary.fees.value = Math.round(summary.fees.value * 100) / 100;
  summary.auto_match_rate = summary.credits_processed === 0 ? 1 : Math.round((exactCount / summary.credits_processed) * 100) / 100;
  if (pulled.lastCursor !== null) repo.setState('recon.last_cursor', pulled.lastCursor);
  repo.setState('recon.seen_txns', JSON.stringify(seen));
  repo.setState('recon.last_summary', JSON.stringify(summary));
  run.log('RECON_SUMMARY', { as_of: asOf }, summary);
}

async function handleUnreferenced(run: Run, summary: ReconSummary, transactionId: string, amount: number, direction: 'credit' | 'debit', escalate: boolean): Promise<void> {
  const { repo, tenantId, asOf } = run.boot;
  if (escalate) {
    const opened = repo.openDiscrepancy({
      type: direction === 'credit' ? 'UNREFERENCED_CREDIT' : 'UNREFERENCED_DEBIT',
      invoice_id: null,
      transaction_ids: [transactionId],
      amount,
      status: 'OPEN',
      detail: `Unreferenced ${direction} £${Math.abs(amount).toFixed(2)} > £${run.policies.limits.unmatched_escalate_over} — escalated same run (policies.md §3).`,
      hold_until: null,
    });
    if (opened) summary.discrepancy_ids.push(opened.id);
    await raiseEscalation(run, summary, {
      tenant_id: tenantId,
      // escalation.md routing: unexpected debits > £250 are URGENT; credits are STANDARD.
      severity: direction === 'debit' ? 'URGENT' : 'STANDARD',
      observed: `Unreferenced bank ${direction} of £${Math.abs(amount).toFixed(2)} (${transactionId}) with no candidate invoice or customer.`,
      records: [transactionId],
      policy_triggered: `policies.md §3 — unmatched ${direction} > £${run.policies.limits.unmatched_escalate_over} escalates same run`,
      recommendation: direction === 'credit' ? 'Identify the payer (bank portal shows remitter details) and allocate or return the funds.' : 'Verify the debit with the bank; dispute if not recognised.',
      withheld_actions: 'Did not allocate the funds to any invoice, did not issue any receipt, and did not contact anyone externally.',
    });
    run.log('UNREFERENCED_ESCALATED', { transaction: transactionId }, { amount, direction });
  } else {
    const holdUntil = addBusinessDays(asOf, 3);
    const opened = repo.openDiscrepancy({
      type: direction === 'credit' ? 'UNREFERENCED_CREDIT' : 'UNREFERENCED_DEBIT',
      invoice_id: null,
      transaction_ids: [transactionId],
      amount,
      status: 'HELD',
      detail: `HOLD_3D: unreferenced ${direction} £${Math.abs(amount).toFixed(2)} ≤ £${run.policies.limits.unmatched_escalate_over}; rechecking for late references until ${holdUntil}.`,
      hold_until: holdUntil,
    });
    if (opened) {
      summary.discrepancy_ids.push(opened.id);
      summary.held.push({ transaction_id: transactionId, amount, hold_until: holdUntil });
    }
    run.log('UNREFERENCED_HELD', { transaction: transactionId }, { amount, hold_until: holdUntil, tag: 'HOLD_3D' });
  }
}

async function agingPass(
  run: Run,
  summary: ReconSummary,
  invoices: InvoiceRecord[],
  customerById: Map<string, CustomerRecord>,
  paidInvoiceIds: Set<string>,
): Promise<void> {
  const { repo, tenantId, asOf } = run.boot;
  const limits = run.policies.limits;
  const probableInvoices = new Set(repo.matches().filter((m) => m.kind === 'PROBABLE').map((m) => m.invoice_id));
  const discrepancyInvoices = new Set(
    repo.discrepancies().filter((d) => d.status !== 'CLOSED' && d.invoice_id).map((d) => d.invoice_id as string),
  );

  for (const invoice of invoices) {
    if (invoice.status !== 'SENT') continue; // drafts aren't due
    if (paidInvoiceIds.has(invoice.invoice_id)) continue;
    if (probableInvoices.has(invoice.invoice_id)) continue; // probably paid — held for confirmation, don't chase
    const daysOverdue = daysBetween(invoice.due_date, asOf);
    if (daysOverdue <= limits.overdue_chase_days) continue;

    if (daysOverdue > limits.overdue_escalate_days) {
      await raiseEscalation(run, summary, {
        tenant_id: tenantId,
        severity: 'STANDARD',
        observed: `${invoice.invoice_id} (${invoice.customer_name}, £${invoice.gross.toFixed(2)}) is ${daysOverdue} days overdue — past the ${limits.overdue_escalate_days}-day escalation threshold.`,
        records: [invoice.invoice_id],
        policy_triggered: `policies.md §3 — overdue > ${limits.overdue_escalate_days} days → escalate, recommend action, take none`,
        recommendation: `Ring ${invoice.customer_name} directly or start a formal late-payment letter; consider pausing new work.`,
        withheld_actions: 'Sent no reminder and took no chasing action — beyond the standard templates, chasing is never autonomous (policies.md §1).',
      });
      summary.needs_chasing.push({
        invoice_id: invoice.invoice_id,
        customer_id: invoice.customer_id,
        customer_name: invoice.customer_name,
        amount: invoice.gross,
        days_overdue: daysOverdue,
        reminder: 'escalated — no autonomous action',
      });
      continue;
    }

    // 14 < overdue ≤ 30: standard reminder if within limits and clean.
    const entry = {
      invoice_id: invoice.invoice_id,
      customer_id: invoice.customer_id,
      customer_name: invoice.customer_name,
      amount: invoice.gross,
      days_overdue: daysOverdue,
      reminder: '',
    };
    if (discrepancyInvoices.has(invoice.invoice_id)) {
      entry.reminder = 'reminder withheld — open discrepancy on this invoice (uncertain state; surfaced instead)';
      run.log('REMINDER_WITHHELD', { invoice: invoice.invoice_id }, { reason: 'open discrepancy', days_overdue: daysOverdue });
      summary.needs_chasing.push(entry);
      continue;
    }
    if (run.limitHit) {
      entry.reminder = 'reminder withheld — blast-radius limit already hit this run';
      summary.needs_chasing.push(entry);
      continue;
    }
    const gate = runEmailGate({
      killSwitchEngaged: false, // act() checks the live file before sending
      emailsToCustomerToday: repo.emailsToCustomerOn(invoice.customer_id, asOf),
      actionsThisRun: run.autonomousActions,
      frozenRecords: repo.frozenRecords(),
      touchesRecords: [invoice.invoice_id, invoice.customer_id],
      limits,
    });
    if (!gate.allowed) {
      if (gate.failedCheck === 'actions_per_run_within_limit' || gate.failedCheck === 'emails_per_customer_day_within_limit') {
        run.hitLimit(gate.failedCheck, `reminder for ${invoice.invoice_id} withheld`);
      }
      entry.reminder = `reminder withheld — gate check failed: ${gate.failedCheck}`;
      run.log('REMINDER_WITHHELD', { invoice: invoice.invoice_id }, { gate }, { policy_checks: gate.checks });
      summary.needs_chasing.push(entry);
      continue;
    }
    const customer = customerById.get(invoice.customer_id);
    await run.act(
      'SEND_REMINDER_EMAIL',
      { invoice: invoice.invoice_id, customer: invoice.customer_id, days_overdue: daysOverdue },
      () => {
        const subject = `Payment reminder — ${invoice.invoice_id} (£${invoice.gross.toFixed(2)}, ${daysOverdue} days past terms)`;
        console.log(`[email → ${customer?.email ?? invoice.customer_id}] ${subject}`);
        repo.logEmail(invoice.customer_id, 'reminder', subject, invoice.invoice_id, asOf);
        return { subject, template: 'standard-14-day' };
      },
      { autonomous: true, policy_checks: gate.checks },
    );
    entry.reminder = 'standard reminder sent';
    summary.reminders_sent.push({ invoice_id: invoice.invoice_id, customer_id: invoice.customer_id });
    summary.needs_chasing.push(entry);
  }
}

async function raiseEscalation(run: Run, summary: ReconSummary, esc: Omit<EscalationObject, 'audit_refs'>): Promise<string | null> {
  const { repo } = run.boot;
  const raised = repo.raiseEscalation({ ...esc, audit_refs: run.auditRefs.slice(-3) });
  if (!raised) {
    run.log('ESCALATION_DEDUPED', { records: esc.records }, { note: 'existing open escalation covers these records; evidence attached, not re-raised' });
    return null;
  }
  summary.escalation_ids.push(raised.id);
  run.log('ESCALATION_RAISED', { records: esc.records, severity: esc.severity }, raised);
  if (esc.severity === 'URGENT') {
    // escalation.md routing: URGENT → email Maria immediately.
    await run.act(
      'SEND_ESCALATION_EMAIL',
      { to: 'maria (owner)', escalation: raised.id },
      () => {
        console.log(`[email → maria] URGENT escalation ${raised.id}: ${esc.observed}`);
        return { delivered: 'console-mock' };
      },
      { autonomous: true },
    );
  }
  return raised.id;
}
