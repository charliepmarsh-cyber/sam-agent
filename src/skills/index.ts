import type { Run } from '../agent/run.ts';
import type { SkillName } from '../model/client.ts';
import { reconcileSkill } from './reconcile.ts';
import { invoiceSweepSkill, processApprovalsSkill } from './invoicing.ts';
import { ensureBankFeed } from './discover.ts';

export type Skill = (run: Run) => Promise<void>;

const skills: Partial<Record<SkillName, Skill>> = {
  reconcile: reconcileSkill,
  invoice_sweep: invoiceSweepSkill,
  process_approvals: processApprovalsSkill,

  // Minimal placeholder until phase 6 implements runbooks/daily-briefing.md.
  briefing: async (run) => {
    const bank = await ensureBankFeed(run);
    const balance = await run.act('READ_BALANCE', { client: bank.origin }, () => bank.balance());
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
