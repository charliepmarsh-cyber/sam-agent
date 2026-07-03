import { randomUUID } from 'node:crypto';
import { assertNotHalted, engageKillSwitch } from '../substrate/killswitch.ts';
import type { AgentBoot } from './boot.ts';
import type { LoadedPolicies, PolicyCheck } from '../types.ts';

export class SelfHaltError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SelfHaltError';
  }
}

export interface ActOptions {
  /** Counts against the 10-autonomous-actions-per-run blast radius. */
  autonomous?: boolean;
  policy_checks?: PolicyCheck[];
  model?: string | null;
}

/**
 * Per-cycle run context. Every action — read or write — goes through
 * act(), which checks the kill switch BEFORE the action, appends an
 * audit line after it, and tracks the blast-radius counters.
 */
export class Run {
  readonly runId: string;
  readonly boot: AgentBoot;
  readonly policies: LoadedPolicies;
  /** Autonomous (side-effectful) actions taken this run. */
  autonomousActions = 0;
  /** All audited actions this run (used by the demo halt-after trigger). */
  auditedActions = 0;
  auditRefs: string[] = [];
  limitHit: string | null = null;
  notes: string[] = [];
  toolErrors = 0;
  #consecutiveToolFailures = 0;

  constructor(boot: AgentBoot, policies: LoadedPolicies, task: string) {
    this.runId = `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`;
    this.boot = boot;
    this.policies = policies;
    boot.repo.startRun(this.runId, task);
  }

  async act<T>(action: string, inputs: unknown, fn: () => Promise<T> | T, opts: ActOptions = {}): Promise<T> {
    // Kill switch is checked before EVERY action, not once per run.
    assertNotHalted(this.boot.tenantRoot);
    let output: T;
    try {
      output = await fn();
      this.#consecutiveToolFailures = 0;
    } catch (err) {
      this.toolErrors++;
      this.#consecutiveToolFailures++;
      this.log(action, inputs, { error: (err as Error).message }, opts);
      if (this.#consecutiveToolFailures >= 3) {
        throw new SelfHaltError(`3 consecutive tool failures; last: ${(err as Error).message}`);
      }
      throw err;
    }
    if (opts.autonomous) this.autonomousActions++;
    this.log(action, inputs, output, opts);
    return output;
  }

  /** Audit without executing (for decisions, gate verdicts, skips). */
  log(action: string, inputs: unknown, outputs: unknown, opts: ActOptions = {}): string {
    const entry = this.boot.audit.append({
      run_id: this.runId,
      action,
      inputs,
      outputs,
      policy_checks: opts.policy_checks ?? [],
      model: opts.model ?? null,
      policies_sha256: this.policies.sha256,
    });
    this.auditRefs.push(entry.id);
    this.auditedActions++;
    if (this.boot.haltAfter !== null && this.auditedActions >= this.boot.haltAfter) {
      // Demo instrumentation: writes the REAL kill-switch file; the next
      // act() call hits the same file check an operator's touch would.
      engageKillSwitch(this.boot.tenantRoot, `demo: halt-after ${this.boot.haltAfter} actions`);
    }
    return entry.id;
  }

  hitLimit(name: string, detail: string): void {
    if (!this.limitHit) this.limitHit = name;
    this.log('LIMIT_REACHED', { limit: name }, { detail });
    this.notes.push(`Blast-radius limit hit: ${name} (${detail}) — stopped autonomous actions, finished the briefing.`);
  }
}
