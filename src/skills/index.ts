import type { Run } from '../agent/run.ts';
import type { SkillName } from '../model/client.ts';

export type Skill = (run: Run) => Promise<void>;

/**
 * Phase 2: minimal read-only proofs of the loop. The real skills land in
 * later phases and replace these entries — the loop contract stays fixed.
 */
const skills: Partial<Record<SkillName, Skill>> = {
  reconcile: async (run) => {
    const cursor = run.boot.repo.getState('recon.last_cursor');
    const pulled = await run.act(
      'PULL_TRANSACTIONS',
      { since_cursor: cursor, client: run.boot.bank.origin, credentials: 'vault key tenant/' + run.boot.tenantId + '/bank-api' },
      () => run.boot.bank.pullSince(cursor),
    );
    run.log('RECONCILE_STUB', null, {
      pulled: pulled.transactions.length,
      note: 'phase 2 read-only end-to-end — matching lands in phase 3',
    });
  },

  briefing: async (run) => {
    const balance = await run.act('READ_BALANCE', { client: run.boot.bank.origin }, () => run.boot.bank.balance());
    const lines = [
      `# Daily briefing — ${run.boot.asOf} (minimal, phase 2)`,
      `Cash position: £${balance.balance.toFixed(2)} as of ${balance.as_of ?? 'n/a'}.`,
      `Escalations open: ${run.boot.repo.escalations('OPEN').length}. Approvals pending: ${run.boot.repo.approvals('PENDING').length}.`,
    ];
    console.log('\n' + lines.join('\n') + '\n');
    run.log('BRIEFING_EMITTED', null, { lines: lines.length, delivery: 'console' });
  },
};

export function getSkill(name: string): Skill | null {
  return (skills as Record<string, Skill | undefined>)[name] ?? null;
}

export function registerSkill(name: SkillName, skill: Skill): void {
  skills[name] = skill;
}
