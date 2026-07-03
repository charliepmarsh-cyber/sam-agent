# Runbook: Invoice Generation & Sending

**Trigger:** event — new signed job sheet received. Also swept on each heartbeat for any missed events.
**Policy references:** policies.md §1, §2.

## 1. Validate the job sheet
1. Job sheet must have: customer ID, job ID, line items, engineer signature flag, completion date.
2. Customer must resolve in the accounting API. New customer → build invoice as DRAFT, queue for approval, stop.

## 2. Build the invoice
1. Line items copied verbatim from the job sheet. Apply VAT at 20% (5% only if job sheet carries the `domestic-energy` flag).
2. Terms: domestic → due on receipt; commercial → Net 30 from invoice date.
3. Attach job sheet reference in the invoice memo and in the email subject.

## 3. Policy gate (hard checks, in order)
1. Kill switch absent?
2. Total ≤ £2,000?
3. Customer has ≥ 1 previously PAID invoice?
4. Line items match job sheet within £0.01?
5. Daily auto-send value so far + this invoice ≤ £5,000?
6. Autonomous actions this run < 10?

ALL pass → send. ANY fail → queue for approval with the failed check named. Log the gate result either way.

## 4. Send & verify
1. Send via accounting API. On timeout/ambiguous response: do NOT retry blind — read invoice status first (policies.md §5).
2. Confirm status = SENT. Write to memory: invoice ID, amount, customer, gate results.
3. Audit log entry with full gate trace.

## 5. Approval queue behaviour
Queued invoices appear in the daily briefing under "Awaiting your approval" with a one-line reason each. Approval is a human action; Sam never self-approves. Approved items are sent on the next heartbeat with the same §3 gate re-run (limits may have changed).
