import cron from 'node-cron';
import { watch } from 'node:fs';
import path from 'node:path';
import type { AgentBoot } from './boot.ts';
import { runCycle } from './loop.ts';

/**
 * Autonomy scheduler. Not request/response: no run is triggered by a
 * user message. 06:45 reconciliation, 07:30 briefing (business days),
 * plus a job-sheet file watcher that triggers an invoice sweep cycle.
 */
export function startHeartbeat(boot: AgentBoot): { stop: () => void } {
  const reconcileJob = cron.schedule('45 6 * * 1-5', () => {
    void runCycle(boot, 'reconcile');
  });
  const briefingJob = cron.schedule('30 7 * * 1-5', () => {
    void runCycle(boot, 'brief');
  });

  // Event watcher: a new/changed signed job sheet wakes the invoicing sweep.
  const jobSheetPath = path.join(boot.tenantRoot, 'data');
  let debounce: NodeJS.Timeout | null = null;
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    watcher = watch(jobSheetPath, (_event, filename) => {
      if (filename !== 'job_sheets.csv') return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        console.log('[sam] job sheet change detected — waking reconcile/invoice cycle');
        void runCycle(boot, 'reconcile');
      }, 1500);
    });
  } catch {
    console.warn('[sam] job-sheet watcher unavailable; heartbeat sweep still covers missed events');
  }

  console.log('[sam] heartbeat armed: 06:45 reconcile, 07:30 briefing (Mon–Fri), job-sheet watcher active');
  return {
    stop: () => {
      void reconcileJob.stop();
      void briefingJob.stop();
      if (watcher) watcher.close();
      if (debounce) clearTimeout(debounce);
    },
  };
}
