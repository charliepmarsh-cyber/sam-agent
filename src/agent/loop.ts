import { loadPolicies, PolicyLoadError } from '../substrate/policies.ts';
import { killSwitchEngaged, HaltError } from '../substrate/killswitch.ts';
import type { AgentBoot } from './boot.ts';
import { Run, SelfHaltError } from './run.ts';
import { getSkill } from '../skills/index.ts';
import type { RunReflection } from '../types.ts';

export type TaskHint = 'reconcile' | 'brief' | 'weekly';

export interface CycleResult {
  status: 'DONE' | 'HALTED' | 'ERROR' | 'SKIPPED_HALTED' | 'POLICY_LOAD_FAILED';
  runId: string | null;
  reflection: RunReflection | null;
}

/**
 * One heartbeat cycle: kill-switch check → load+hash policies → plan
 * (model proposes, zod validates) → execute step-by-step through gates →
 * reflect. A HaltError anywhere aborts cleanly with a HALTED audit line.
 */
export async function runCycle(boot: AgentBoot, taskHint: TaskHint): Promise<CycleResult> {
  if (killSwitchEngaged(boot.tenantRoot)) {
    boot.audit.append({
      run_id: 'pre-run',
      action: 'HALTED',
      inputs: { taskHint },
      outputs: { reason: 'KILL_SWITCH present at wake' },
      policies_sha256: 'n/a',
    });
    console.log(`[sam] HALTED — kill switch engaged, ${taskHint} cycle not started`);
    return { status: 'SKIPPED_HALTED', runId: null, reflection: null };
  }

  let policies;
  try {
    policies = loadPolicies(boot.tenantRoot);
  } catch (err) {
    if (err instanceof PolicyLoadError) {
      boot.audit.append({
        run_id: 'pre-run',
        action: 'POLICY_LOAD_FAILED',
        inputs: { taskHint },
        outputs: { error: err.message },
        policies_sha256: 'unavailable',
      });
      boot.repo.raiseEscalation({
        tenant_id: boot.tenantId,
        severity: 'URGENT',
        observed: `policies.md could not be loaded: ${err.message}`,
        records: ['policies.md'],
        policy_triggered: 'identity.md — halt and escalate if policy unreadable',
        recommendation: 'Restore policies.md from version control, then re-run.',
        withheld_actions: 'Entire cycle withheld — no actions taken without a readable policy file.',
        audit_refs: [],
      });
      console.error(`[sam] ${err.message}`);
      return { status: 'POLICY_LOAD_FAILED', runId: null, reflection: null };
    }
    throw err;
  }

  const run = new Run(boot, policies, taskHint);
  run.log('RUN_START', { taskHint, as_of: boot.asOf }, { policies_sha256: policies.sha256 });
  console.log(`[sam] ${run.runId} — ${taskHint} cycle, policies ${policies.sha256.slice(0, 12)}…`);

  try {
    // Plan: the model proposes a task list; anything out-of-schema is
    // rejected and the deterministic runbook plan is used instead.
    const stateSummary = summarizeState(boot);
    const planned = await boot.model.plan(taskHint, stateSummary);
    run.log('PLAN', { taskHint, stateSummary }, { steps: planned.plan.steps, source: planned.source }, { model: planned.model });
    if (planned.rejected) {
      run.log('PLAN_REJECTED', { reason: planned.rejected }, { fallback: 'deterministic runbook plan' }, { model: planned.model });
      run.notes.push('A model plan was rejected (out of schema) and replaced by the runbook fallback plan.');
    }

    for (const step of planned.plan.steps) {
      const skill = getSkill(step.skill);
      if (!skill) {
        run.log('STEP_SKIPPED', { step }, { reason: 'unknown skill — model output not executable' });
        run.notes.push(`Planned step "${step.skill}" is not an executable skill; skipped.`);
        continue;
      }
      console.log(`[sam]   step: ${step.skill} — ${step.reason}`);
      await skill(run);
    }

    const reflection = reflect(run);
    run.log('REFLECTION', null, reflection);
    boot.repo.finishRun(run.runId, 'DONE', reflection);
    console.log(`[sam] ${run.runId} done — ${reflection.actions_taken} autonomous actions, ${reflection.escalations_opened} escalations`);
    return { status: 'DONE', runId: run.runId, reflection };
  } catch (err) {
    if (err instanceof HaltError) {
      run.log('HALTED', null, { reason: err.message, aborted_mid_run: true });
      boot.repo.finishRun(run.runId, 'HALTED', reflect(run));
      console.log(`[sam] ${run.runId} HALTED mid-run — no further actions (including email)`);
      return { status: 'HALTED', runId: run.runId, reflection: null };
    }
    if (err instanceof SelfHaltError) {
      run.log('SELF_HALT', null, { reason: err.message });
      boot.repo.raiseEscalation({
        tenant_id: boot.tenantId,
        severity: 'URGENT',
        observed: `Self-halted: ${err.message}`,
        records: [run.runId],
        policy_triggered: 'policies.md §5 — 3 consecutive tool-call failures',
        recommendation: 'Check mock API availability / network, then re-run the cycle.',
        withheld_actions: 'Remaining planned steps withheld for this run.',
        audit_refs: run.auditRefs.slice(-5),
      });
      boot.repo.finishRun(run.runId, 'ERROR', reflect(run));
      return { status: 'ERROR', runId: run.runId, reflection: null };
    }
    run.log('RUN_ERROR', null, { error: (err as Error).message });
    boot.repo.finishRun(run.runId, 'ERROR', reflect(run));
    throw err;
  }
}

function summarizeState(boot: AgentBoot): string {
  const openEscalations = boot.repo.escalations('OPEN').length;
  const pendingApprovals = boot.repo.approvals('PENDING').length;
  const heldDiscrepancies = boot.repo.discrepancies('HELD').length;
  const cursor = boot.repo.getState('recon.last_cursor');
  return [
    `as_of: ${boot.asOf}`,
    `open_escalations: ${openEscalations}`,
    `pending_approvals: ${pendingApprovals}`,
    `held_discrepancies: ${heldDiscrepancies}`,
    `recon_cursor: ${cursor ?? 'none (first run)'}`,
  ].join('\n');
}

function reflect(run: Run): RunReflection {
  const matches = run.boot.repo.matches();
  const lastSummary = run.boot.repo.getState('recon.last_summary');
  const autoMatchRate = lastSummary ? ((JSON.parse(lastSummary) as { auto_match_rate?: number }).auto_match_rate ?? 0) : 0;
  return {
    auto_match_rate: autoMatchRate,
    matched_count: matches.length,
    matched_value: Math.round(matches.reduce((s, m) => s + m.amount, 0) * 100) / 100,
    discrepancies_opened: run.boot.repo.discrepancies().length,
    escalations_opened: run.boot.repo.escalations().length,
    limit_hits: run.limitHit ? [run.limitHit] : [],
    tool_errors: run.toolErrors,
    actions_taken: run.autonomousActions,
    notes: run.notes,
  };
}
