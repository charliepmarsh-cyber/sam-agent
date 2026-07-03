import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertNotHalted, engageKillSwitch, killSwitchEngaged, HaltError } from '../src/substrate/killswitch.ts';

test('no kill switch → actions proceed', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sam-ks-'));
  assert.equal(killSwitchEngaged(dir), false);
  assert.doesNotThrow(() => assertNotHalted(dir));
});

test('KILL_SWITCH file halts', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sam-ks-'));
  writeFileSync(path.join(dir, 'KILL_SWITCH'), '');
  assert.throws(() => assertNotHalted(dir), HaltError);
});

test('engageKillSwitch (the /halt path) writes the file', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sam-ks-'));
  engageKillSwitch(dir, 'test halt');
  assert.equal(killSwitchEngaged(dir), true);
});
