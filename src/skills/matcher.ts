import { businessDaysBetween } from '../lib/dates.ts';
import type { InvoiceRecord, TransactionRecord } from '../types.ts';

/**
 * Pure classification logic for runbooks/reconciliation.md §2–§4.
 * No I/O, no model calls: the fuzzy payer-name step is returned as an
 * AMOUNT_CANDIDATE for the caller to confirm (Haiku or heuristic), so
 * every deterministic rule here is unit-testable in isolation.
 */

export interface SeenTransaction {
  transaction_id: string;
  date: string;
  amount: number;
  reference: string | null;
}

export interface ExpectedFee {
  descriptor: string;
  amount: number;
}

export interface MatcherContext {
  invoices: InvoiceRecord[];
  /** Invoice IDs already matched to a payment (from memory). */
  paidInvoiceIds: Set<string>;
  /** Previously processed transactions, for duplicate detection. */
  seenTransactions: SeenTransaction[];
  expectedFees: ExpectedFee[];
  /** policies.md §3: unmatched item escalation threshold (£). */
  escalateOver: number;
}

export type TxnClassification =
  | { kind: 'DUPLICATE_PAY'; invoiceId: string; priorTransactionId: string; reference: string }
  | { kind: 'EXACT'; invoiceId: string; deMinimisDelta: number }
  | { kind: 'SHORT_PAY'; invoiceId: string; shortBy: number }
  | { kind: 'OVER_PAY'; invoiceId: string; overBy: number }
  | { kind: 'AMOUNT_CANDIDATE'; invoiceId: string; payerName: string; customerName: string }
  | { kind: 'BANK_FEE'; descriptor: string }
  | { kind: 'UNEXPECTED_FEE' }
  | { kind: 'UNREFERENCED'; direction: 'credit' | 'debit'; escalate: boolean };

const AMOUNT_TOLERANCE = 0.005;
/** Runbook §2.2: a shortfall must exceed £1 to open SHORT_PAY. Smaller
 * gaps are treated as settled (de minimis) but the delta is logged. */
const SHORT_PAY_FLOOR = 1.0;
const DUPLICATE_WINDOW_BUSINESS_DAYS = 5;

export function extractInvoiceRef(description: string): string | null {
  return description.match(/INV-\d+/)?.[0] ?? null;
}

/** "FP PRIYA HOBBS INV-1003" → "PRIYA HOBBS"; "FP OWEN PAYMENT" → "OWEN PAYMENT". */
export function extractPayerName(description: string): string {
  return description
    .replace(/^FP\s+/i, '')
    .replace(/\s*INV-\d+\s*$/, '')
    .trim();
}

function isFeeLike(description: string): boolean {
  return /\b(FEE|CHARGE)\b/i.test(description);
}

export function classifyTransaction(txn: TransactionRecord, ctx: MatcherContext): TxnClassification {
  const reference = extractInvoiceRef(txn.description);

  // §3 duplicate detection first: same amount + same reference within 5
  // business days of an already-processed payment is a duplicate even
  // though its invoice is (by definition) already paid.
  if (reference) {
    const prior = ctx.seenTransactions.find(
      (seen) =>
        seen.reference === reference &&
        Math.abs(seen.amount - txn.amount) <= AMOUNT_TOLERANCE &&
        businessDaysBetween(seen.date, txn.date) <= DUPLICATE_WINDOW_BUSINESS_DAYS,
    );
    if (prior) {
      return { kind: 'DUPLICATE_PAY', invoiceId: reference, priorTransactionId: prior.transaction_id, reference };
    }

    const invoice = ctx.invoices.find((inv) => inv.invoice_id === reference);
    if (invoice && !ctx.paidInvoiceIds.has(invoice.invoice_id)) {
      const delta = txn.amount - invoice.gross; // positive = overpaid
      if (Math.abs(delta) <= AMOUNT_TOLERANCE) return { kind: 'EXACT', invoiceId: invoice.invoice_id, deMinimisDelta: 0 };
      if (delta < 0 && -delta > SHORT_PAY_FLOOR) {
        return { kind: 'SHORT_PAY', invoiceId: invoice.invoice_id, shortBy: Math.round(-delta * 100) / 100 };
      }
      if (delta > AMOUNT_TOLERANCE) {
        return { kind: 'OVER_PAY', invoiceId: invoice.invoice_id, overBy: Math.round(delta * 100) / 100 };
      }
      // Short by ≤ £1: below the runbook's SHORT_PAY floor — settle, log the delta.
      return { kind: 'EXACT', invoiceId: invoice.invoice_id, deMinimisDelta: Math.round(delta * 100) / 100 };
    }
    // Reference to an unknown or already-paid invoice outside the duplicate window.
    return unreferenced(txn, ctx);
  }

  if (txn.amount < 0) {
    const fee = ctx.expectedFees.find(
      (f) =>
        f.descriptor.toUpperCase() === txn.description.toUpperCase() &&
        Math.abs(f.amount - txn.amount) <= AMOUNT_TOLERANCE,
    );
    if (fee) return { kind: 'BANK_FEE', descriptor: fee.descriptor };
    if (isFeeLike(txn.description)) return { kind: 'UNEXPECTED_FEE' };
    return unreferenced(txn, ctx);
  }

  // §2.3 amount-only: exact amount, single open candidate; the caller
  // still has to confirm payer-name similarity before holding PROBABLE.
  const candidates = ctx.invoices.filter(
    (inv) => !ctx.paidInvoiceIds.has(inv.invoice_id) && Math.abs(inv.gross - txn.amount) <= AMOUNT_TOLERANCE,
  );
  if (candidates.length === 1 && candidates[0]) {
    return {
      kind: 'AMOUNT_CANDIDATE',
      invoiceId: candidates[0].invoice_id,
      payerName: extractPayerName(txn.description),
      customerName: candidates[0].customer_name,
    };
  }
  return unreferenced(txn, ctx);
}

function unreferenced(txn: TransactionRecord, ctx: MatcherContext): TxnClassification {
  return {
    kind: 'UNREFERENCED',
    direction: txn.amount < 0 ? 'debit' : 'credit',
    escalate: Math.abs(txn.amount) > ctx.escalateOver,
  };
}
