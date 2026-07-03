#!/usr/bin/env bash
# One-take recording rig for the portfolio video.
# Start your screen recorder, then: bash portfolio/record-demo.sh
# Press Enter to advance between beats — timings match portfolio/vo/*.mp3.
set -euo pipefail
cd "$(dirname "$0")/.."

TENANT=ashdown
AS_OF=2026-07-02
SAM="node src/cli.ts --tenant $TENANT --as-of $AS_OF"

pause() { printf '\n\033[2m[beat %s ready — press Enter for the next]\033[0m' "$1"; read -r; clear; }

# Pre-roll (not recorded): make sure today's briefing exists for Beat 1.
$SAM --reset --now reconcile --timeout-rate 0 >/dev/null 2>&1
$SAM --now brief --timeout-rate 0 >/dev/null 2>&1
clear
printf '\033[1mBEAT 1 — open tenants/%s/briefings/%s.md in your Markdown viewer and slow-scroll it.\033[0m\n' "$TENANT" "$AS_OF"
printf 'VO clip: vo/beat1.mp3 (~20s)\n'
pause 1

printf '\033[1mBEAT 2 — the heartbeat run (VO: vo/beat2.mp3)\033[0m\n\n'
$SAM --reset --now reconcile --timeout-rate 0
pause 2

printf '\033[1mBEAT 3 — the duplicate (VO: vo/beat3.mp3)\033[0m\n'
printf 'Show data/bank_transactions.csv lines 2-3 (TXN-88001/88002), then this escalation:\n\n'
node -e "
const Database=require('better-sqlite3');
const db=new Database('tenants/$TENANT/sam.db');
const e=db.prepare(\"SELECT severity,observed,recommendation,withheld_actions,records FROM escalations WHERE severity='URGENT'\").get();
console.log('  ['+e.severity+'] '+e.observed);
console.log('  Records: '+JSON.parse(e.records).join(', '));
console.log('  Recommended: '+e.recommendation);
console.log('');
console.log('  >>> What Sam deliberately did NOT do: <<<');
console.log('  '+e.withheld_actions);
"
pause 3

printf '\033[1mBEAT 4 — kill switch mid-run (VO: vo/beat4.mp3)\033[0m\n\n'
$SAM --now reconcile --timeout-rate 0 --halt-after 6 || true
printf '\n— and while halted, Sam refuses to start:\n\n'
$SAM --now reconcile || true
$SAM --resume >/dev/null
pause 4

printf '\033[1mBEAT 5 — the receipts (VO: vo/beat5.mp3)\033[0m\n\n'
node eval/run-eval.ts | tail -25
printf '\n\033[1;32m(hold on 8/8, then cut to end card)\033[0m\n'
