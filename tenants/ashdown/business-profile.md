# Ashdown Electrical Services Ltd — Business Profile

> **Simulation environment.** Fictional company created as the tenant for the "Sam" operations & finance agent demo build. All names, figures, and data are generated.

## Company overview

| Field | Detail |
|---|---|
| Legal name | Ashdown Electrical Services Ltd |
| Trading since | 2014 |
| Location | Swindon, Wiltshire, UK |
| Team | 6 (owner, office manager, 4 electricians) |
| Revenue | ~£42,000/month (~£500k/yr) |
| Work mix | 60% commercial maintenance contracts, 30% domestic installs, 10% emergency call-outs |
| Accounting | QuickBooks Online (simulated via sandbox API/CSV) |
| Banking | Starling Business (simulated bank feed) |
| Payment terms | Domestic: on completion. Commercial: Net 30 |

## People

- **Maria Ashdown** — Owner/MD. Sam's escalation point. Wants a daily briefing at 07:30 and hates surprises about cash flow.
- **Dev Patel** — Office manager. Handles quoting and scheduling. Sam's secondary escalation contact when Maria is unavailable.
- **Field team** — Tom, Ryan, Aisha, Callum. Submit job sheets via mobile app at job completion; a signed job sheet is the trigger condition for invoicing.

## The problem Sam solves

Maria spends 6–8 hours/week on invoicing, chasing payments, and reconciling the bank feed against QuickBooks. Invoices go out late (average 4 days after job completion), which pushes cash collection out. Discrepancies (short payments, duplicate payments, unreferenced deposits) sit unnoticed for weeks.

## Sam's remit (v1)

1. **Invoice generation** — when a signed job sheet lands, generate the invoice and send it if within policy limits; queue for approval otherwise.
2. **Daily reconciliation** — match bank transactions to open invoices, flag anything that doesn't tie out.
3. **Daily briefing** — 07:30 ops & finance summary to Maria: cash position, invoices sent/paid/overdue, discrepancies, actions taken, actions awaiting approval.
4. **Escalation** — anything outside policy goes to a human with full context attached.

## Systems Sam touches

| System | Access tier | Simulated by |
|---|---|---|
| QuickBooks-style accounting API | Pre-built integration | `mock-api/accounting` (local Express server serving generated data) |
| Bank feed API | Self-integration tier (agent discovers via OpenAPI spec) | `mock-api/bank` (serves `bank_transactions.csv` + `/openapi.json`) |
| Email (invoice delivery, briefings) | Pre-built | Console/log output or a Mailtrap-style sandbox |
