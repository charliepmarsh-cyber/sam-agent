import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AuditLog } from '../src/substrate/audit.ts';

function freshLog(secrets: string[] = []): AuditLog {
  const dir = mkdtempSync(path.join(tmpdir(), 'sam-audit-'));
  return new AuditLog(path.join(dir, 'audit.jsonl'), 'ashdown', secrets);
}

test('appends one JSONL line per action with required fields', () => {
  const log = freshLog();
  log.append({ run_id: 'r1', action: 'TEST_ACTION', inputs: { a: 1 }, outputs: { b: 2 }, policies_sha256: 'abc' });
  log.append({ run_id: 'r1', action: 'SECOND', policies_sha256: 'abc' });
  const lines = readFileSync(log.filePath, 'utf8').trim().split('\n');
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]!);
  assert.equal(first.tenant_id, 'ashdown');
  assert.equal(first.action, 'TEST_ACTION');
  assert.ok(first.ts);
  assert.ok(first.id);
  assert.equal(first.policies_sha256, 'abc');
});

test('is append-only across instances (reopening does not truncate)', () => {
  const log = freshLog();
  log.append({ run_id: 'r1', action: 'A', policies_sha256: 'x' });
  const reopened = new AuditLog(log.filePath, 'ashdown');
  reopened.append({ run_id: 'r2', action: 'B', policies_sha256: 'x' });
  assert.equal(reopened.readAll().length, 2);
});

test('redacts secret-shaped keys and literal vault values', () => {
  const secret = 'supersecretvalue123';
  const log = freshLog([secret]);
  log.append({
    run_id: 'r1',
    action: 'CALL_API',
    inputs: { authorization: `Bearer ${secret}`, api_key: secret, url: 'http://x', note: `embedded ${secret} here` },
    policies_sha256: 'x',
  });
  const raw = readFileSync(log.filePath, 'utf8');
  assert.ok(!raw.includes(secret), 'secret value must never appear in the audit log');
  assert.ok(raw.includes('[REDACTED]'));
});
