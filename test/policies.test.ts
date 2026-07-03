import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadPolicies, parseFrontmatter, PolicyLoadError } from '../src/substrate/policies.ts';

const VALID = `---
auto_send_max: 2000
daily_value_max: 5000
actions_per_run_max: 10
emails_per_customer_day_max: 3
unmatched_escalate_over: 250
overdue_chase_days: 14
overdue_escalate_days: 30
---

# Policies
prose here
`;

function tenantWithPolicies(content: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sam-pol-'));
  writeFileSync(path.join(dir, 'policies.md'), content);
  return dir;
}

test('loads valid policies with all seven limits', () => {
  const loaded = loadPolicies(tenantWithPolicies(VALID));
  assert.equal(loaded.limits.auto_send_max, 2000);
  assert.equal(loaded.limits.overdue_escalate_days, 30);
  assert.match(loaded.sha256, /^[0-9a-f]{64}$/);
});

test('hash changes when the file changes', () => {
  const a = loadPolicies(tenantWithPolicies(VALID));
  const b = loadPolicies(tenantWithPolicies(VALID.replace('2000', '2500')));
  assert.notEqual(a.sha256, b.sha256);
});

test('halts on missing frontmatter', () => {
  assert.throws(() => loadPolicies(tenantWithPolicies('# no frontmatter\n')), PolicyLoadError);
});

test('halts on missing limit key', () => {
  const broken = VALID.replace('auto_send_max: 2000\n', '');
  assert.throws(() => loadPolicies(tenantWithPolicies(broken)), PolicyLoadError);
});

test('halts on unreadable file', () => {
  assert.throws(() => loadPolicies(mkdtempSync(path.join(tmpdir(), 'sam-empty-'))), PolicyLoadError);
});

test('frontmatter parser rejects non-numeric values', () => {
  assert.throws(() => parseFrontmatter('---\nauto_send_max: lots\n---\n'), PolicyLoadError);
});
