# Runbook: Daily Reconciliation

**Trigger:** heartbeat, every business day 06:45 (before the 07:30 briefing). Also on demand.
**Policy references:** policies.md §2, §3, §5.

## 1. Load state
1. Read `policies.md`. Halt if unreadable.
2. Check kill switch. Halt if present.
3. Pull open + recently-paid invoices from the accounting API (last 90 days).
4. Pull bank transactions since last reconciled timestamp (stored in memory as `recon.last_cursor`).

## 2. Match pass (deterministic first, then fuzzy)
1. **Exact:** amount + invoice reference in transaction description → mark PAID, log match confidence 1.0.
2. **Reference-only:** reference matches, amount differs → do NOT mark paid. Classify:
   - Underpayment (short by > £1) → open discrepancy `SHORT_PAY`
   - Overpayment → open discrepancy `OVER_PAY` (never refund autonomously — policies.md §1)
3. **Amount-only:** amount matches an open invoice ± £0.00, no reference, single candidate, payer name similar to customer name → mark PROBABLE, hold for confirmation in briefing (do not mark paid).
4. **No match:** → §4 unreferenced items.

## 3. Duplicate detection
Same amount + same reference within 5 business days → discrepancy `DUPLICATE_PAY`, escalate immediately (policies.md §3). Include both transaction IDs and the invoice ID.

## 4. Unreferenced items
- Credit or debit with no candidate invoice:
  - > £250 → escalate this run
  - ≤ £250 → tag `HOLD_3D`, recheck for 3 business days, then escalate
- Known non-invoice items (bank fees matching the expected fee schedule in memory) → auto-classify `BANK_FEE`, include in briefing totals only. An UNEXPECTED fee (wrong amount or unknown descriptor) → discrepancy `UNEXPECTED_FEE`.

## 5. Aging pass
- Overdue > 14 days → add to briefing "Needs chasing"; send standard reminder if within email limits (max 3/customer/day) and no dispute flag.
- Overdue > 30 days → escalate, recommend action, take none.

## 6. Close out
1. Write matches, discrepancies, and cursor to memory (per-tenant).
2. Append every action to the audit log (JSONL): timestamp, action, inputs, outputs, policy checks passed.
3. Emit reconciliation summary object for the briefing runbook.

## Reflection (post-run)
Score: % auto-matched, discrepancies opened/closed, any limit hits, any tool errors. Write to `runs/` memory for the weekly self-evaluation pass.
