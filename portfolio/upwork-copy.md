# Upwork portfolio kit — Sam

## Title (max ~70 chars)

Autonomous Finance Agent with Provable Safety Rails — TypeScript + Claude

## Subtitle / one-liner

An AI employee that wakes itself up, reconciles the bank feed, sends invoices — and can prove every action it took. Hard-coded spending limits, approval queue, kill switch.

## Description (portfolio body)

Small businesses lose hours every week to invoicing, payment chasing, and bank reconciliation — but nobody trusts an AI to touch money. So I built one you can trust, and proved it.

"Sam" runs unattended on a heartbeat (06:45 reconcile, 07:30 owner briefing). The AI plans; deterministic code executes. Every invoice passes a six-check policy gate written in tested code — not in a prompt the model could ignore: ≤ £2,000 auto-send, customer payment history, line items match the signed job sheet, £5,000/day cap, 10 actions/run cap. Anything that fails queues for human approval with the failed check named.

Verified against a seeded dataset with a ground-truth answer key — 8/8 planted discrepancies caught with correct classifications: a duplicate payment (escalated URGENT, with the audit line explicitly recording that no autonomous refund was attempted), a short payment, unreferenced credits above and below the escalation threshold, an unexpected bank fee, and two overdue tiers.

Highlights:
• Kill switch checked before EVERY action — touch a file mid-run and the agent halts before its next step, logged
• Append-only audit log: one JSONL line per action with every policy check result and the SHA-256 of the policy file in force at decision time — the log alone reconstructs everything
• Self-integrating: given only a bank API base URL, the agent reads the OpenAPI spec, generates a typed client at runtime, and documents which endpoints it refuses to call under policy (payments)
• Verify-before-retry on payment-adjacent calls: on an ambiguous timeout it reads invoice status before ever retrying
• Multi-tenant substrate: onboarding tenant #2 = one folder + two vault keys + one cron line

Stack: TypeScript / Node, Claude API (Sonnet planning, Haiku classification, prompt caching), SQLite, Express, node-cron, zod. 49 unit tests + a ground-truth eval.

## Skills tags

AI Agent Development · Anthropic Claude · TypeScript · Node.js · Automation · API Integration · AI Safety · Bookkeeping Automation

## Two-liner for the top of proposals

I build AI agents with safety rails a business owner can verify: my last build reconciles a bank feed and sends invoices autonomously, caught 8/8 planted discrepancies against a ground-truth answer key, and halts mid-run from a kill switch — every action audit-logged with the policy version that allowed it. 2-min demo: [VIDEO LINK] · code: https://github.com/charliepmarsh-cyber/sam-agent

## Where to put it

- Portfolio item on the main profile AND any "AI Agent Development" specialized profile
- Video: upload to YouTube (unlisted is fine) and paste the link in the portfolio item — Upwork embeds it
- Repo link in the "project link" field
