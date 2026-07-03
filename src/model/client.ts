import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const PLANNING_MODEL = 'claude-sonnet-4-6';
export const CLASSIFY_MODEL = 'claude-haiku-4-5';

export const TASK_SKILLS = ['process_approvals', 'reconcile', 'invoice_sweep', 'briefing', 'weekly_review'] as const;
export type SkillName = (typeof TASK_SKILLS)[number];

export const planSchema = z.object({
  steps: z
    .array(
      z.object({
        skill: z.enum(TASK_SKILLS),
        reason: z.string().min(1).max(500),
      }),
    )
    .min(1)
    .max(10),
});
export type Plan = z.infer<typeof planSchema>;

export interface PlanResult {
  plan: Plan;
  source: 'sonnet' | 'fallback';
  model: string | null;
  /** Set when a model response was rejected (unparseable / out of schema). */
  rejected: string | null;
}

/** Deterministic plans used when no API key is configured or the model output fails validation. */
const FALLBACK_PLANS: Record<string, Plan> = {
  reconcile: {
    steps: [
      { skill: 'process_approvals', reason: 'runbooks/invoicing.md §5 — approved items send on next heartbeat' },
      { skill: 'reconcile', reason: 'runbooks/reconciliation.md — 06:45 heartbeat' },
      { skill: 'invoice_sweep', reason: 'runbooks/invoicing.md — heartbeat sweep for missed job sheets' },
    ],
  },
  brief: { steps: [{ skill: 'briefing', reason: 'runbooks/daily-briefing.md — 07:30 heartbeat' }] },
  weekly: { steps: [{ skill: 'weekly_review', reason: 'weekly self-review of run reflections' }] },
};

/**
 * Model layer. The model plans; code executes (invariant 7): every model
 * response that drives actions is JSON validated with zod, and anything
 * out-of-schema is logged, skipped, and surfaced — never executed.
 *
 * Without ANTHROPIC_API_KEY the substrate stays fully functional on
 * deterministic fallbacks; every audit line records model=null so the
 * trail shows exactly which decisions were model-made.
 */
export class ModelClient {
  readonly enabled: boolean;
  #anthropic: Anthropic | null;
  #cachedContext: string;

  constructor(tenantRoot: string) {
    this.enabled = Boolean(process.env.ANTHROPIC_API_KEY);
    this.#anthropic = this.enabled ? new Anthropic() : null;
    this.#cachedContext = buildTenantContext(tenantRoot);
  }

  /** System blocks with prompt caching on the stable policies/runbooks context. */
  #system(): Anthropic.TextBlockParam[] {
    return [
      {
        type: 'text',
        text: this.#cachedContext,
        cache_control: { type: 'ephemeral' },
      },
    ];
  }

  async plan(taskHint: 'reconcile' | 'brief' | 'weekly', stateSummary: string): Promise<PlanResult> {
    const fallback = FALLBACK_PLANS[taskHint] ?? FALLBACK_PLANS['reconcile']!;
    if (!this.#anthropic) {
      return { plan: fallback, source: 'fallback', model: null, rejected: null };
    }
    let text = '';
    try {
      const response = await this.#anthropic.messages.create({
        model: PLANNING_MODEL,
        max_tokens: 1024,
        system: this.#system(),
        messages: [
          {
            role: 'user',
            content:
              `Heartbeat wake: task hint "${taskHint}". Current state:\n${stateSummary}\n\n` +
              `Decide what needs doing this cycle. Respond with ONLY a JSON object of shape ` +
              `{"steps":[{"skill":"...","reason":"..."}]} where skill is one of ${TASK_SKILLS.join(', ')}. ` +
              `Order matters; code executes each step through policy gates.`,
          },
        ],
      });
      text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const parsed = planSchema.safeParse(JSON.parse(extractJson(text)));
      if (!parsed.success) {
        return { plan: fallback, source: 'fallback', model: PLANNING_MODEL, rejected: `schema: ${parsed.error.message}` };
      }
      return { plan: parsed.data, source: 'sonnet', model: PLANNING_MODEL, rejected: null };
    } catch (err) {
      return {
        plan: fallback,
        source: 'fallback',
        model: PLANNING_MODEL,
        rejected: `unusable model response (${(err as Error).message}); raw: ${text.slice(0, 200)}`,
      };
    }
  }

  /**
   * Yes/no call for fuzzy payer-name similarity (Haiku). Falls back to a
   * deterministic token heuristic offline. Only ever advises the matcher —
   * the matcher's structural rules (single candidate, exact amount) are code.
   */
  async nameSimilar(payerName: string, customerName: string): Promise<{ similar: boolean; model: string | null }> {
    const heuristic = tokenOverlap(payerName, customerName);
    if (!this.#anthropic) return { similar: heuristic, model: null };
    try {
      const response = await this.#anthropic.messages.create({
        model: CLASSIFY_MODEL,
        max_tokens: 16,
        system: this.#system(),
        messages: [
          {
            role: 'user',
            content:
              `Bank payer string: "${payerName}". Customer name on invoice: "${customerName}". ` +
              `Could these plausibly be the same payer? Answer ONLY {"similar":true} or {"similar":false}.`,
          },
        ],
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      const parsed = z.object({ similar: z.boolean() }).safeParse(JSON.parse(extractJson(text)));
      if (!parsed.success) return { similar: heuristic, model: null };
      return { similar: parsed.data.similar, model: CLASSIFY_MODEL };
    } catch {
      return { similar: heuristic, model: null };
    }
  }

  /** Free-prose generation (briefing headline polish, weekly review). Returns null offline. */
  async prose(userPrompt: string, maxTokens: number): Promise<string | null> {
    if (!this.#anthropic) return null;
    try {
      const response = await this.#anthropic.messages.create({
        model: PLANNING_MODEL,
        max_tokens: maxTokens,
        system: this.#system(),
        messages: [{ role: 'user', content: userPrompt }],
      });
      return response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } catch {
      return null;
    }
  }
}

/** Deterministic fallback for payer-name similarity: shared token ≥ 3 chars. */
export function tokenOverlap(payerName: string, customerName: string): boolean {
  const tokens = (s: string): Set<string> =>
    new Set(
      s
        .toUpperCase()
        .split(/[^A-Z]+/)
        .filter((t) => t.length >= 3 && !['FP', 'THE', 'LTD', 'PAYMENT', 'TRANSFER', 'FROM'].includes(t)),
    );
  const a = tokens(payerName);
  const b = tokens(customerName);
  for (const t of a) {
    for (const u of b) {
      if (t === u || t.startsWith(u) || u.startsWith(t)) return true;
    }
  }
  return false;
}

function extractJson(text: string): string {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('no JSON object in model response');
  return text.slice(start, end + 1);
}

/** Identity + policies + runbooks, assembled fresh each boot — files are the configuration. */
function buildTenantContext(tenantRoot: string): string {
  const parts: string[] = [];
  for (const file of ['identity.md', 'policies.md', 'business-profile.md', 'faq.md']) {
    try {
      parts.push(`# FILE: ${file}\n\n${readFileSync(path.join(tenantRoot, file), 'utf8')}`);
    } catch {
      // identity/policies readability is enforced by the loop, not here
    }
  }
  const runbookDir = path.join(tenantRoot, 'runbooks');
  try {
    for (const file of readdirSync(runbookDir).sort()) {
      parts.push(`# FILE: runbooks/${file}\n\n${readFileSync(path.join(runbookDir, file), 'utf8')}`);
    }
  } catch {
    // no runbooks dir — surfaced elsewhere
  }
  return parts.join('\n\n---\n\n');
}
