# Sam — autonomous operations & finance agent (demo build)

Self-directed build: an autonomous operations & finance agent on a multi-tenant substrate — file-defined identity and policies, heartbeat autonomy loop, three-tier tool access including runtime OpenAPI self-integration, deterministic policy gates, full audit trail and kill switch. Built against a seeded synthetic dataset with a ground-truth discrepancy answer key (**8/8 caught**).

Tenant: **Ashdown Electrical Services Ltd** (fictional, seeded — see `tenants/ashdown/`). Sam invoices from signed job sheets, reconciles the bank feed, chases what needs chasing, and writes Maria a 90-second briefing every morning. It wakes on a schedule; no run is triggered by a user message.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ HEARTBEAT (node-cron)          KILL SWITCH (file+HTTP)   │
│   └─ wake → load policies → plan → execute → reflect →  │
│      sleep                                               │
├──────────────┬──────────────────┬───────────────────────┤
│ RUNTIME      │ TOOL TIERS       │ SAFETY                │
│ identity.md  │ 1 pre-built:     │ audit log (JSONL)     │
│ runbooks/*.md│   accounting API │ approval queue        │
│ policies.md  │ 2 self-integr.:  │ blast-radius counters │
│              │   bank OpenAPI   │ rate limits           │
│              │ 3 fallback:      │                       │
│              │   (see tradeoffs)│                       │
├──────────────┴──────────────────┴───────────────────────┤
│ MEMORY: SQLite (better-sqlite3), every table keyed by   │
│ tenant_id through a repository layer — Postgres/pgvector │
│ swap is a driver change                                  │
├──────────────────────────────────────────────────────────┤
│ MODEL LAYER: Claude API, two-tier routing               │
│ (claude-haiku-4-5 classify/match, claude-sonnet-4-6     │
│ plan/brief) + prompt caching on policies/runbooks       │
└──────────────────────────────────────────────────────────┘
```

## Quick start

```bash
cd sam-agent
pnpm install
pnpm sam --tenant ashdown              # one-command boot: mocks in-process + 06:45/07:30 heartbeat
pnpm sam --tenant ashdown --now reconcile   # on-demand cycle (demo)
pnpm sam --tenant ashdown --now brief
pnpm eval                              # diff agent output against data/answer_key.json
pnpm test                              # unit tests (gate executor, matcher, substrate)
bash demo.sh                           # the full definition-of-done sequence
```

Optional: `ANTHROPIC_API_KEY` in the environment enables live Sonnet planning, Haiku match classification, and weekly-review diff proposals. **Without it, every safety-relevant behaviour is identical** — planning falls back to the deterministic runbook plan, name-matching to a token heuristic, and each audit line records `model: null` so the trail shows exactly which decisions were model-made.

Useful flags: `--as-of YYYY-MM-DD` (business date; the dataset is seeded for 2026-07-02), `--approve <APR-id|all>`, `--reset`, `--halt`, `--resume`, `--halt-after N` (demo: engages the real kill switch mid-run), `--timeout-rate 0..1` (send-timeout simulation).

## The invariants (enforced in code, verified in tests/eval)

| Invariant | Where |
|---|---|
| Policy gates are code, not prompts — limits parsed from `policies.md` YAML frontmatter; gate executor is a pure function | `src/substrate/policies.ts`, `src/substrate/gate.ts`, `test/gate.test.ts` |
| Kill switch checked before **every** action; mid-run halt logs `HALTED` and aborts cleanly | `src/agent/run.ts` (`act()`), `src/substrate/killswitch.ts`, demo step 5 |
| Append-only JSONL audit: timestamp, tenant, action, I/O, every policy check, model, `policies.md` sha256 at decision time | `src/substrate/audit.ts`, `eval/audit-report.ts` |
| `tenant_id` on every table and query; repository fixes the tenant at construction; boot takes `tenant_id` as the only required argument | `src/db/repository.ts`, `test/repository.test.ts` |
| Verify-before-retry on payment-adjacent calls (the accounting mock times out ~2% of sends *after* acting) | `src/clients/accounting.ts` (`sendInvoice`), demo step 3 |
| Secrets never in memory tables, logs, or model context — vault by scoped key; audit records key names and redacts values defensively | `src/substrate/vault.ts`, `src/substrate/audit.ts`, `test/audit.test.ts` |
| The model plans; code executes — plan JSON is zod-validated; out-of-schema output is logged, skipped, surfaced in the briefing | `src/model/client.ts`, `src/agent/loop.ts` |

## Tool access in three tiers

1. **Pre-built:** `mock-api/accounting` — QuickBooks-shaped Express API over the seeded CSVs, with a simulated ambiguous send-timeout to exercise verify-before-retry.
2. **Self-integration:** Sam is given **only the bank API base URL**. `src/skills/discover.ts` fetches `/openapi.json`, generates zod validators at runtime, decides under policy what it will and won't call (it refuses `POST /payments/initiate` and says why), writes a human-readable integration report to `reports/` and the audit trail, and reconciliation consumes the feed through that discovered client. There is no pre-built bank client in the codebase.
3. **Fallback (browser automation):** architecture slot only — see tradeoffs below.

## What the eval proves (`pnpm eval`)

All 8 planted discrepancies from `data/answer_key.json`, each with the correct classification: duplicate payment (URGENT escalation, `withheld_actions` states no autonomous refund was attempted), short-pay (invoice not marked paid), unreferenced credit > £250 (same-run escalation), unreferenced credit ≤ £250 (`HOLD_3D`), amount-only probable match (held, not auto-paid), unexpected fee, 30-day overdue (escalate, act not), 14-day overdue (needs-chasing + standard reminder within email limits). Plus: JOB-9001 (£1,416) auto-sends, JOB-9002 (£3,180) queues with `total_within_auto_send_max` named, bank data provably flowed through the runtime-discovered client, and every audit line carries the policy hash.

## Multi-tenancy: onboarding tenant #2

1. `mkdir tenants/<id>` with `identity.md`, `policies.md` (frontmatter + prose), `runbooks/`, `data/`.
2. Add `tenant/<id>/accounting-api` and `tenant/<id>/bank-api` to `.secrets.json`.
3. Add a cron line / service unit: `pnpm sam --tenant <id>`.

Nothing else: every table row, credential key, audit file, and briefing path is derived from the tenant id.

## Deliberate tradeoffs (read this before hiring me to build the real one)

- **Hand-rolled loop over a framework:** the point demonstrated is the substrate pattern — files-as-configuration, plan/execute/reflect, gates in code. A framework would hide exactly the parts worth showing.
- **No Playwright fallback tier in this build:** the 7-phase build prompt scoped it out (and adding the dependency without asking was off-limits). The tier exists in the architecture; the slot is documented above.
- **Offline fallbacks instead of hard model dependency:** planning and fuzzy matching degrade to deterministic code with `model: null` audit attribution. This keeps the eval reproducible and the demo runnable anywhere; it also honours the deeper rule that nothing safety-relevant may live in a prompt.
- **`node:test` + Node's native TypeScript execution:** zero test/build dependencies; `tsc --noEmit` typechecks in CI fashion.
- **Semantic memory (sqlite-vec) not wired:** the `facts` table stores the expected-fee schedule as plain rows; nothing in the demo needs vector recall, and Anthropic ships no embedding API to pair with it. The swap-in point is `src/db/database.ts`.
- **Mock accounting state persists to a gitignored overlay** (`tenants/*/accounting-state.json`) so multi-invocation demos behave like a real ledger.

## Repo map

```
sam-agent/
├── demo.sh                 # definition-of-done, provable line by line
├── eval/run-eval.ts        # answer-key diff (fix the agent, never the key)
├── eval/audit-report.ts    # reconstructs everything from audit.jsonl alone
├── src/
│   ├── cli.ts              # pnpm sam --tenant <id> [...]
│   ├── agent/              # boot, run context (act()), cycle loop, heartbeat
│   ├── substrate/          # policies loader+hash, gates, audit, kill switch, vault
│   ├── db/                 # schema + tenant-scoped repository
│   ├── model/              # Claude two-tier routing, prompt caching, zod plans
│   ├── skills/             # reconcile, matcher, invoicing, discover, briefing, weekly
│   ├── clients/            # accounting (verify-before-retry); bank = interface only
│   └── mock-api/           # accounting + bank Express mocks, /halt endpoints
├── tenants/ashdown/        # identity, policies (frontmatter), runbooks, seeded data
└── test/                   # 49 unit tests
```
