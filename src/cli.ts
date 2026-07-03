import { parseArgs } from 'node:util';
import { rmSync, existsSync } from 'node:fs';
import path from 'node:path';
import { bootAgent } from './agent/boot.ts';
import { runCycle, type TaskHint } from './agent/loop.ts';
import { startHeartbeat } from './agent/heartbeat.ts';
import { engageKillSwitch, killSwitchPath } from './substrate/killswitch.ts';

const { values } = parseArgs({
  options: {
    tenant: { type: 'string' },
    now: { type: 'string' },
    'as-of': { type: 'string' },
    approve: { type: 'string' },
    reset: { type: 'boolean', default: false },
    halt: { type: 'boolean', default: false },
    resume: { type: 'boolean', default: false },
    'halt-after': { type: 'string' },
    'timeout-rate': { type: 'string' },
  },
});

const tenantId = values.tenant;
if (!tenantId) {
  console.error('usage: pnpm sam --tenant <id> [--now reconcile|brief|weekly] [--as-of YYYY-MM-DD] [--approve <APR-id|all>] [--reset] [--halt] [--resume] [--halt-after N]');
  process.exit(2);
}

const tenantRoot = path.resolve('tenants', tenantId);
if (!existsSync(tenantRoot)) {
  console.error(`no tenant at ${tenantRoot} — onboarding a tenant = add a folder, vault entries, and a cron line`);
  process.exit(2);
}

if (values.reset) {
  for (const artifact of ['sam.db', 'sam.db-journal', 'sam.db-wal', 'sam.db-shm', 'audit.jsonl', 'KILL_SWITCH', 'accounting-state.json', 'briefings', 'reports', 'proposals']) {
    rmSync(path.join(tenantRoot, artifact), { recursive: true, force: true });
  }
  console.log(`[sam] reset: cleared runtime state for tenant ${tenantId}`);
  if (!values.now && !values.approve) process.exit(0);
}

if (values.halt) {
  engageKillSwitch(tenantRoot, 'manual --halt');
  console.log(`[sam] kill switch engaged at ${killSwitchPath(tenantRoot)}`);
  process.exit(0);
}

if (values.resume) {
  rmSync(killSwitchPath(tenantRoot), { force: true });
  console.log('[sam] kill switch cleared');
  if (!values.now) process.exit(0);
}

const bootOpts: Parameters<typeof bootAgent>[0] = { tenantId };
if (values['as-of']) bootOpts.asOf = values['as-of'];
if (values['halt-after']) bootOpts.haltAfter = Number(values['halt-after']);
if (values['timeout-rate']) bootOpts.sendTimeoutRate = Number(values['timeout-rate']);

const boot = await bootAgent(bootOpts);
console.log(`[sam] tenant ${boot.tenantId} — accounting ${boot.accounting.baseUrl}, bank ${boot.bankUrl} (as-of ${boot.asOf})`);
if (!boot.model.enabled) {
  console.log('[sam] ANTHROPIC_API_KEY not set — planning/briefing prose run on deterministic fallbacks (logged as model=null)');
}

if (values.approve) {
  const pending = boot.repo.approvals('PENDING');
  const targets = values.approve === 'all' ? pending : pending.filter((a) => a.id === values.approve);
  if (targets.length === 0) {
    console.log(`[sam] no PENDING approval matching "${values.approve}" (${pending.length} pending)`);
  }
  for (const approval of targets) {
    boot.repo.setApprovalStatus(approval.id, 'APPROVED');
    console.log(`[sam] ${approval.id} (${approval.job_id}, £${approval.amount.toFixed(2)}) approved — will send on next heartbeat with the full gate re-run`);
  }
  if (!values.now) {
    await boot.close();
    process.exitCode = 0;
  }
}

if (values.now) {
  const task = values.now as TaskHint;
  if (!['reconcile', 'brief', 'weekly'].includes(task)) {
    console.error(`unknown task "${task}" — expected reconcile | brief | weekly`);
    process.exit(2);
  }
  const result = await runCycle(boot, task);
  await boot.close();
  // exitCode (not process.exit) lets the event loop drain — avoids a
  // libuv teardown race on Windows while servers/DB finish closing.
  process.exitCode = result.status === 'DONE' ? 0 : result.status === 'HALTED' || result.status === 'SKIPPED_HALTED' ? 3 : 1;
} else if (!values.approve) {
  // No --now: stay resident. One command boots Sam — mocks in-process,
  // heartbeat armed, kill switch respected. Sam wakes itself; nothing
  // here waits for a user message.
  const heartbeat = startHeartbeat(boot);
  console.log('[sam] resident. Ctrl+C to stop; touch tenants/<id>/KILL_SWITCH or POST /halt to halt Sam.');
  process.on('SIGINT', () => {
    heartbeat.stop();
    void boot.close().then(() => {
      process.exitCode = 0;
    });
  });
}
