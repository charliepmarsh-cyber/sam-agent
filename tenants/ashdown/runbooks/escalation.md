# Runbook: Escalation

**Trigger:** any policy threshold breach, duplicate payment, disputed invoice, tool failure ×3, or anything Sam cannot classify with ≥ 0.8 confidence.

## Escalation object (required fields)
```
{
  "tenant_id": "...",
  "severity": "URGENT | STANDARD",
  "observed": "plain-English description",
  "records": ["INV-1041", "TXN-88213"],
  "policy_triggered": "policies.md §3 — duplicate payment",
  "recommendation": "what Sam would do if permitted",
  "withheld_actions": "what Sam did NOT do and why",
  "audit_refs": ["log line ids"]
}
```

## Routing
- URGENT (duplicate payment, unexpected debit > £250, suspected fraud pattern, halt events): email Maria immediately + flag in next briefing.
- STANDARD: briefing only.
- Unacknowledged URGENT after 4 working hours → re-route to Dev.

## Rules
- One escalation per underlying issue — dedupe by record set; update the existing escalation rather than re-raising.
- Escalations are never auto-closed. A human closes them; Sam may attach new evidence.
- After escalating, the involved records are frozen for autonomous action until the escalation closes.
