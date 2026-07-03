import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { LoadedPolicies } from '../types.ts';

export class PolicyLoadError extends Error {
  constructor(message: string) {
    super(`policies.md unusable — halting per identity.md: ${message}`);
    this.name = 'PolicyLoadError';
  }
}

const limitsSchema = z.object({
  auto_send_max: z.number().positive(),
  daily_value_max: z.number().positive(),
  actions_per_run_max: z.number().int().positive(),
  emails_per_customer_day_max: z.number().int().positive(),
  unmatched_escalate_over: z.number().positive(),
  overdue_chase_days: z.number().int().positive(),
  overdue_escalate_days: z.number().int().positive(),
});

/**
 * Parse the flat YAML frontmatter block at the top of policies.md.
 * The prose stays human-readable; the frontmatter is the machine source
 * of truth for the gate executor. Deliberately tiny: flat `key: number`
 * pairs only, so no YAML dependency.
 */
export function parseFrontmatter(raw: string): Record<string, number> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match || !match[1]) throw new PolicyLoadError('no YAML frontmatter block found');
  const out: Record<string, number> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const kv = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(-?\d+(?:\.\d+)?)$/);
    if (!kv || !kv[1] || !kv[2]) throw new PolicyLoadError(`unparseable frontmatter line: "${trimmed}"`);
    out[kv[1]] = Number(kv[2]);
  }
  return out;
}

/** Load policies.md fresh, hash it, and validate limits. Throws PolicyLoadError on any problem. */
export function loadPolicies(tenantRoot: string): LoadedPolicies {
  const filePath = path.join(tenantRoot, 'policies.md');
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new PolicyLoadError(`cannot read ${filePath}: ${(err as Error).message}`);
  }
  const parsed = limitsSchema.safeParse(parseFrontmatter(raw));
  if (!parsed.success) {
    throw new PolicyLoadError(`frontmatter failed validation: ${parsed.error.message}`);
  }
  return {
    limits: parsed.data,
    sha256: createHash('sha256').update(raw).digest('hex'),
    raw,
  };
}
