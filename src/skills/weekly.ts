import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Run } from '../agent/run.ts';
import { PLANNING_MODEL } from '../model/client.ts';

/**
 * Weekly self-review (architecture demonstration, v1): feed the last N
 * run reflections to Sonnet and emit proposed unified diffs to runbook
 * files into proposals/. NOTHING auto-applies — a human reviews and
 * commits (in the full spec, confidence ≥ threshold would auto-apply).
 */
export async function weeklyReviewSkill(run: Run): Promise<void> {
  const { repo, model, tenantRoot, asOf } = run.boot;
  const recentRuns = repo.recentRuns(10);
  const reflections = recentRuns
    .filter((r) => r.reflection_json)
    .map((r) => ({ run_id: r.run_id, task: r.task, status: r.status, reflection: JSON.parse(r.reflection_json as string) as unknown }));

  const proposalsDir = path.join(tenantRoot, 'proposals');
  mkdirSync(proposalsDir, { recursive: true });

  if (reflections.length === 0) {
    run.log('WEEKLY_REVIEW', { runs_considered: 0 }, { note: 'no run reflections yet — nothing to review' });
    return;
  }

  if (!model.enabled) {
    const stub = [
      `# Weekly self-review — ${asOf} (offline stub)`,
      ``,
      `ANTHROPIC_API_KEY not configured, so no runbook diffs were proposed this week.`,
      `Reflections that WOULD have been reviewed (${reflections.length} runs):`,
      ``,
      ...reflections.map((r) => `- ${r.run_id} [${r.task}/${r.status}]: ${JSON.stringify(r.reflection)}`),
      ``,
      `Nothing is ever auto-applied: proposals land here as unified diffs for human review.`,
    ].join('\n');
    const stubPath = path.join(proposalsDir, `${asOf}-weekly-review.md`);
    await run.act('WEEKLY_REVIEW', { runs_considered: reflections.length, model: null }, () => {
      writeFileSync(stubPath, stub);
      return { proposal_path: path.relative(tenantRoot, stubPath), diffs_proposed: 0, note: 'offline — reflections summarized, no model proposals' };
    });
    return;
  }

  const prompt =
    `Here are the reflections from my last ${reflections.length} runs:\n\n` +
    JSON.stringify(reflections, null, 2) +
    `\n\nPropose improvements to my runbook files (runbooks/*.md) based on patterns in these reflections ` +
    `(e.g. recurring unreferenced payments, repeated limit hits, matcher misses). ` +
    `Respond with unified diff blocks ONLY (--- a/runbooks/x.md / +++ b/runbooks/x.md format), ` +
    `plus a one-line rationale comment above each diff. If nothing warrants a change, say "NO_CHANGES".`;

  const proposal = await run.act('WEEKLY_REVIEW_MODEL_CALL', { runs_considered: reflections.length }, () => model.prose(prompt, 2000), {
    model: PLANNING_MODEL,
  });

  const proposalPath = path.join(proposalsDir, `${asOf}-runbook-proposals.diff`);
  await run.act('WEEKLY_REVIEW', { runs_considered: reflections.length, model: PLANNING_MODEL }, () => {
    const content = proposal ?? 'NO_CHANGES (model call failed)';
    writeFileSync(proposalPath, `# Proposed by Sam ${asOf} — NEVER auto-applied; review and commit by hand.\n\n${content}\n`);
    return { proposal_path: path.relative(tenantRoot, proposalPath), no_changes: content.includes('NO_CHANGES') };
  });
}
