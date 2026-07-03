import type { Run } from '../agent/run.ts';
import type { SkillName } from '../model/client.ts';
import { reconcileSkill } from './reconcile.ts';
import { invoiceSweepSkill, processApprovalsSkill } from './invoicing.ts';
import { briefingSkill } from './briefing.ts';
import { weeklyReviewSkill } from './weekly.ts';

export type Skill = (run: Run) => Promise<void>;

const skills: Partial<Record<SkillName, Skill>> = {
  reconcile: reconcileSkill,
  invoice_sweep: invoiceSweepSkill,
  process_approvals: processApprovalsSkill,
  briefing: briefingSkill,
  weekly_review: weeklyReviewSkill,
};

export function getSkill(name: string): Skill | null {
  return (skills as Record<string, Skill | undefined>)[name] ?? null;
}

export function registerSkill(name: SkillName, skill: Skill): void {
  skills[name] = skill;
}
