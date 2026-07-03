#!/usr/bin/env bash
# Sam demo — proves every line of the definition of done, in order.
# Run from sam-agent/: bash demo.sh
set -euo pipefail

TENANT=ashdown
AS_OF=2026-07-02   # the seeded dataset's "today" (answer_key seed=20260702)
SAM="node src/cli.ts --tenant $TENANT --as-of $AS_OF"

step() { printf '\n\033[1;36m━━━ %s ━━━\033[0m\n\n' "$*"; }

step "1/6  Eval: 8/8 planted discrepancies + JOB-9001/9002 vs answer_key.json"
node eval/run-eval.ts

step "2/6  Fresh boot — one command, mocks in-process: --now reconcile"
$SAM --reset --now reconcile --timeout-rate 0

step "3/6  Verify-before-retry: every send times out (rate=1); Sam reads status before retrying"
$SAM --reset --now reconcile --timeout-rate 1
node -e "
const fs=require('fs');
const lines=fs.readFileSync('tenants/$TENANT/audit.jsonl','utf8').trim().split('\n').map(JSON.parse);
const v=lines.filter(l=>l.action==='SEND_VERIFY_PATH');
if(!v.length){console.error('expected a SEND_VERIFY_PATH audit line');process.exit(1)}
console.log('verify-before-retry proven:',JSON.stringify(v[0].outputs));
"

step "4/6  07:30 briefing: --now brief (worst news first, traceable numbers)"
$SAM --now brief --timeout-rate 0

step "5/6  KILL SWITCH mid-run: engaged after 6 actions; the next action's pre-check halts"
if $SAM --now reconcile --timeout-rate 0 --halt-after 6; then
  echo "expected a non-zero HALTED exit"; exit 1
else
  echo "(exit code $? = halted, as designed)"
fi
node -e "
const fs=require('fs');
const lines=fs.readFileSync('tenants/$TENANT/audit.jsonl','utf8').trim().split('\n').map(JSON.parse);
const h=lines.filter(l=>l.action==='HALTED');
if(!h.length){console.error('no HALTED audit line found');process.exit(1)}
console.log('HALTED audit line:',JSON.stringify(h[h.length-1].outputs));
"
echo "— while halted, a new cycle refuses to start:"
$SAM --now reconcile || echo "(refused, exit $?)"
$SAM --resume

step "6/6  audit.jsonl ALONE reconstructs every action (incl. policy hash in force)"
node eval/audit-report.ts $TENANT

printf '\n\033[1;32mDefinition of done: all demonstrated.\033[0m\n'
