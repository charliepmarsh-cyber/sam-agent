# Sam Agent Demo — Build Specification

Self-directed build replicating the architecture from a real Upwork job posting: an autonomous Operations & Finance agent ("Sam") for a small business, running on a generalizable agent substrate. Tenant: Ashdown Electrical Services Ltd (fictional, seeded dataset).

## Architecture at a glance

```
┌─────────────────────────────────────────────────────────┐
│ HEARTBEAT (node-cron)          KILL SWITCH (file+HTTP)   │
│   └─ wake → load policies → plan → execute → reflect →  │
│      sleep                                               │
├──────────────┬──────────────────┬───────────────────────┤
│ RUNTIME      │ TOOL TIERS       │ SAFETY                │
│ identity.md  │ 1 pre-built:     │ audit log (JSONL)     │
│ skills/*.md  │   accounting API │ approval queue        │
│ runbooks/*.md│ 2 self-integr.:  │ blast-radius counters │
│ policies.md  │   bank OpenAPI   │ rate limits           │
│              │ 3 fallback:      │                       │
│              │   Playwright     │                       │
├──────────────┴──────────────────┴───────────────────────┤
│ MEMORY: Postgres + pgvector (or SQLite+sqlite-vec for   │
│ the demo), all tables keyed by tenant_id                 │
├──────────────────────────────────────────────────────────┤
│ MODEL LAYER: Claude API, two-tier routing               │
│ (Haiku for classification/matching, Sonnet for planning │
│ and briefing) + prompt caching on policies/runbooks     │
└──────────────────────────────────────────────────────────┘
```

## The nine subsystems, demo-scale

### 1. Agent runtime & identity
Everything that defines Sam is a file, not code: `identity.md` (who Sam is, tone, remit), `policies.md`, `runbooks/*.md`, `skills/*.md`. The runtime is a thin TypeScript loop that assembles these into the model context each cycle. Framework choice for the demo: a minimal hand-rolled loop over the Claude API — because the point being demonstrated is the substrate pattern (files-as-configuration, plan/execute/reflect), and a hand-rolled loop shows you understand what frameworks like OpenClaw abstract away. Document the tradeoff in the README.

### 2. Autonomy loop & scheduler
`node-cron` heartbeat: 06:45 reconciliation, 07:30 briefing, plus an event watcher on the job-sheet folder. Each wake: check kill switch → load policies (with content hash logged, so the audit trail proves which policy version governed each action) → plan (model call: "given state + runbooks, what needs doing?") → execute step-by-step through the policy gates → reflect (score the run, write to memory) → sleep. Not request/response: no run is triggered by a user message.

### 3. Self-improvement (architecture only in v1)
Every run's reflection object lands in `runs/`. A weekly job feeds the last N reflections + the answer key results to the model and asks for proposed diffs to runbook files. Diffs are written to `proposals/` as unified patches; nothing auto-applies in the demo (in the full spec, confidence ≥ threshold would auto-apply). This demonstrates the architecture supports it without pretending week-one maturity.

### 4. Tool access in three tiers
- **Pre-built:** `mock-api/accounting` — small Express server serving the generated CSVs as a QuickBooks-shaped REST API (invoices, customers, send-invoice endpoint with simulated latency and a 2% random timeout to exercise the verify-before-retry rule).
- **Self-integration:** `mock-api/bank` serves `/openapi.json`. Sam is given only the base URL; a `discover_api` skill fetches the spec, generates typed tool definitions at runtime, and calls the endpoints. This is the tier the job posting flagged as "the part most people get wrong" — the demo shows spec-driven discovery with a human-readable integration report Sam writes for the audit trail.
- **Fallback:** Playwright stub against a local HTML "supplier portal" page (one scripted lookup), enough to prove the tier exists.

### 5. Credential management
Demo scale: secrets in a local vault process (or Bitwarden Secrets Manager free tier if you want the real SDK on the CV) retrieved at call time by scoped key `tenant/ashdown/accounting-api`. Never written to memory, logs, or model context — the audit log records the key name only.

### 6. Memory
Tables: `facts` (embedded, semantic retrieval), `runs` (reflections), `recon_state` (cursor, holds), `escalations`, `audit_log`. Every table has `tenant_id` and every query is scoped through a repository layer that requires it — no raw table access from skill code. SQLite + sqlite-vec is fine for the demo; note the Postgres/pgvector/Neon swap is a driver change.

### 7. Policies & runbooks
The loader reads `policies.md` fresh each cycle, hashes it, injects it into context (prompt-cached), and hard-codes only one thing: the gate executor that turns "policy checks" into deterministic code checks (limits are parsed from a small YAML frontmatter block in policies.md so the human-readable file is also the machine-readable source of truth).

### 8. Safety controls
- **Audit log:** append-only JSONL, one line per action: timestamp, tenant, action, inputs, outputs, policy checks with pass/fail, model + prompt hash.
- **Approval gates:** approval queue is a table + section of the briefing; approved items re-run the full gate.
- **Blast radius:** counters for actions/run, £/day, emails/customer/day, enforced in the gate executor (not in the prompt — prompts advise, code enforces).
- **Kill switch:** `KILL_SWITCH` file check before every action (not just per run) + a `/halt` HTTP endpoint that writes the file.

### 9. Multi-tenancy
One tenant in the demo, but: tenant root folder per tenant (`tenants/ashdown/`), tenant_id on every row, credentials namespaced per tenant, and the runtime takes tenant_id as its only boot argument. The README shows the second-tenant onboarding path: add a folder, add vault entries, add a cron line.

## Build plan (evenings/weekend scale)

| Phase | Deliverable | Est. |
|---|---|---|
| 1 | Mock APIs serving generated data + audit logger + kill switch | 3–4 h |
| 2 | Heartbeat loop: load policies → plan → execute one read-only task (pull transactions, print briefing) | 4–5 h |
| 3 | Reconciliation skill + gate executor + memory writes; verify against answer_key.json | 5–6 h |
| 4 | Invoicing skill with approval queue (JOB-9001 auto-sends, JOB-9002 queues) | 3–4 h |
| 5 | Self-integration tier: OpenAPI discovery on the bank API | 4–5 h |
| 6 | Briefing generation + reflection + weekly-review stub | 3–4 h |
| 7 | README, architecture diagram, demo video | 3 h |

**Definition of done:** one command boots Sam; the 06:45/07:30 cycle runs unattended; all 8 planted discrepancies are caught with correct classifications per the answer key; JOB-9001 auto-sends and JOB-9002 queues; the kill switch halts mid-run; the audit log reconstructs every action.

## Demo video script (2–3 min, your video background is the differentiator here)

1. Cold open: the 07:30 briefing email on screen — "this was written by an agent that woke itself up."
2. Terminal: heartbeat firing, plan step, policy hash logged.
3. The catch: show TXN duplicate pair in the raw CSV → Sam's escalation object → the "what Sam deliberately did NOT do" line. This is the money shot for anyone hiring on autonomous-agent safety.
4. Kill switch: touch the file mid-run, show the halt log line.
5. Close on the answer key: 8/8 planted discrepancies, classifications correct.

## Honest framing for the portfolio

"Self-directed build: autonomous operations & finance agent on a multi-tenant substrate — file-defined identity and policies, heartbeat autonomy loop, three-tier tool access including runtime OpenAPI self-integration, deterministic policy gates, full audit trail and kill switch. Built against a seeded synthetic dataset with a ground-truth discrepancy answer key (8/8 caught)."

Every clause in that sentence is true and demonstrable in the repo and the video.
