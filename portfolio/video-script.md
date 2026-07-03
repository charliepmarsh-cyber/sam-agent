# Demo video script — "Sam" (target 2:15–2:45)

Format: screen capture + your voiceover. Terminal font large (16pt+), dark theme.
Prep before recording: `cd sam-agent && node src/cli.ts --tenant ashdown --reset`
All demo commands use `--as-of 2026-07-02` (the dataset's "today").

---

## Beat 1 — Cold open on the briefing (0:00–0:25)

**Screen:** `tenants/ashdown/briefings/2026-07-02.md` open, styled nicely (Markdown preview). Slow scroll from the URGENT headline.

**VO:**
"This morning briefing — cash position, an urgent duplicate payment, three invoices to chase — wasn't written by a person. It was written at 7:30 AM by an agent that woke itself up, reconciled the bank feed, and sent the invoices it was allowed to send. The interesting word is *allowed*."

## Beat 2 — The heartbeat run (0:25–0:55)

**Screen:** terminal, run:
`node src/cli.ts --tenant ashdown --reset --now reconcile --as-of 2026-07-02 --timeout-rate 0`
Let the plan step, the escalation email line, and `INV-9001 £1,416 sent autonomously` scroll.

**VO:**
"Every cycle: check the kill switch, reload the policy file and fingerprint it, plan with Claude, then execute through hard gates. This invoice — £1,416 — passed six checks written in tested code, so it went out. This one — £3,180 — is over the £2,000 limit, so it queued for human approval, with the exact failed check named. The model plans. Code decides."

## Beat 3 — The money shot: duplicate payment (0:55–1:35)

**Screen:** split/cut between:
1. `data/bank_transactions.csv` — highlight TXN-88001 and TXN-88002 (same £1,135.20, same INV-1003, 3 days apart)
2. The escalation in the briefing — zoom on **"What I deliberately did NOT do: Did NOT attempt an autonomous refund…"**

**VO:**
"Here's the trap in the data: the same customer paid the same invoice twice, three days apart. Sam caught it, escalated it as urgent — and this is the line I care about: what it deliberately did NOT do. No autonomous refund. Refunds are never autonomous, and the audit trail records the restraint, not just the action. If you're letting an agent near money, this line is the whole product."

## Beat 4 — Kill switch (1:35–2:05)

**Screen:** terminal:
`node src/cli.ts --tenant ashdown --now reconcile --as-of 2026-07-02 --halt-after 6`
Show the HALTED line, then:
`node src/cli.ts --tenant ashdown --now reconcile --as-of 2026-07-02` → "HALTED — kill switch engaged, cycle not started"

**VO:**
"And when you want it to stop: a kill-switch file, checked before every single action — not once per run. It halts mid-cycle, logs the halt, and refuses to start again until a human clears it."

## Beat 5 — Close on the receipts (2:05–2:35)

**Screen:** `node eval/run-eval.ts` output — the PASS column and "Planted discrepancies caught: 8/8". Hold on it.

**VO:**
"The dataset has a sealed answer key with eight planted discrepancies. Sam catches eight out of eight, with the correct classification — and the eval is in the repo, so you can run it yourself. If your business runs on invoices and a bank feed, this substrate is reusable: new tenant, one folder, two credentials, one cron line. Link's below."

---

### Edit notes
- Captions on throughout (most Upwork viewers watch muted)
- Zoom/highlight the £ figures and the "did NOT do" line — those two moments carry the video
- End card: your name / CPM Growth Systems, repo URL, "AI agents with provable safety rails"
