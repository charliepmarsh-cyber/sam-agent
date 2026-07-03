import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Thrown when the kill switch is engaged; the run loop aborts cleanly on it. */
export class HaltError extends Error {
  constructor(reason: string) {
    super(`HALTED: ${reason}`);
    this.name = 'HaltError';
  }
}

export function killSwitchPath(tenantRoot: string): string {
  return path.join(tenantRoot, 'KILL_SWITCH');
}

export function killSwitchEngaged(tenantRoot: string): boolean {
  return existsSync(killSwitchPath(tenantRoot));
}

/** Checked before EVERY action, not once per run. */
export function assertNotHalted(tenantRoot: string): void {
  if (killSwitchEngaged(tenantRoot)) {
    throw new HaltError(`KILL_SWITCH present at ${killSwitchPath(tenantRoot)}`);
  }
}

/** The /halt endpoint writes the file, so file-existence is the single source of truth. */
export function engageKillSwitch(tenantRoot: string, reason: string): void {
  writeFileSync(killSwitchPath(tenantRoot), `${new Date().toISOString()} ${reason}\n`, { flag: 'a' });
}
