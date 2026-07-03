# Runbook: Daily Operations & Finance Briefing

**Trigger:** heartbeat, business days 07:30, after reconciliation completes.
**Audience:** Maria (owner). Plain English, no jargon, worst news first.

## Structure (strict order)

1. **Headline** — one sentence. Lead with anything urgent (escalations, limit hits, halts). If nothing urgent: cash position movement.
2. **Cash position** — bank balance, vs yesterday, expected receipts next 7 days (open invoices due).
3. **Escalations & discrepancies** — each with: what, records involved, policy triggered, recommended action, what Sam deliberately did not do.
4. **Awaiting your approval** — queued invoices with one-line reasons.
5. **Done autonomously since last briefing** — invoices sent (count + value), payments matched (count + value), reminders sent, fees classified.
6. **Needs chasing** — overdue > 14 days: customer, amount, days overdue.
7. **Sam's notes** — max 3 bullets: patterns noticed, suggestions, anything the weekly self-review should look at.

## Rules
- Never include full bank account numbers or credentials (policies.md §6).
- Every number must be traceable to a record ID in the audit log.
- If reconciliation failed or halted, the briefing still goes out, stating exactly what didn't run.
- Length target: readable in 90 seconds.

## Delivery
Email to Maria; copy stored in memory and in `briefings/` (per-tenant). Delivery failure → retry once, then log and surface at next heartbeat.
