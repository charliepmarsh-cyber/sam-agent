import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Proof that audit.jsonl alone reconstructs every action Sam took:
 * reads ONLY the audit log (no DB, no API) and prints the full action
 * history with policy hashes, gate verdicts, and model attribution.
 */
const tenantId = process.argv[2] ?? 'ashdown';
const auditPath = path.resolve('tenants', tenantId, 'audit.jsonl');

interface Line {
  ts: string;
  run_id: string;
  action: string;
  inputs: unknown;
  outputs: unknown;
  policy_checks: { name: string; pass: boolean }[];
  model: string | null;
  policies_sha256: string;
}

const lines = readFileSync(auditPath, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Line);

console.log(`\n═══ Reconstruction of tenant "${tenantId}" from audit.jsonl alone (${lines.length} actions) ═══\n`);

let currentRun = '';
for (const line of lines) {
  if (line.run_id !== currentRun) {
    currentRun = line.run_id;
    const hash = line.policies_sha256.length > 12 ? `${line.policies_sha256.slice(0, 12)}…` : line.policies_sha256;
    console.log(`\n▶ ${currentRun} (policies in force: ${hash})`);
  }
  const gates = line.policy_checks.length ? ` [gates: ${line.policy_checks.map((c) => `${c.name}=${c.pass ? 'PASS' : 'FAIL'}`).join(', ')}]` : '';
  const model = line.model ? ` (model: ${line.model})` : '';
  const detail = summarize(line);
  console.log(`  ${line.ts.slice(11, 19)}  ${line.action}${detail}${model}${gates}`);
}

function summarize(line: Line): string {
  const outputs = line.outputs as Record<string, unknown> | null;
  const inputs = line.inputs as Record<string, unknown> | null;
  const bits: string[] = [];
  for (const source of [inputs, outputs]) {
    if (!source || typeof source !== 'object') continue;
    for (const key of ['invoice', 'transaction', 'job', 'reason', 'gross', 'amount', 'failed_check', 'path']) {
      if (source[key] !== undefined && source[key] !== null && bits.length < 3) bits.push(`${key}=${JSON.stringify(source[key])}`);
    }
  }
  return bits.length ? ` — ${bits.join(', ')}` : '';
}
