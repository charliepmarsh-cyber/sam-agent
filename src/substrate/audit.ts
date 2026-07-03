import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { PolicyCheck } from '../types.ts';

export interface AuditEntry {
  id: string;
  ts: string;
  tenant_id: string;
  run_id: string;
  action: string;
  inputs: unknown;
  outputs: unknown;
  policy_checks: PolicyCheck[];
  model: string | null;
  policies_sha256: string;
}

export interface AuditInput {
  run_id: string;
  action: string;
  inputs?: unknown;
  outputs?: unknown;
  policy_checks?: PolicyCheck[];
  model?: string | null;
  policies_sha256: string;
}

const SECRETISH_KEYS = /^(authorization|api[_-]?key|secret|token|password|bearer)$/i;

/**
 * Append-only JSONL audit log — one line per action. If it isn't logged,
 * it didn't happen. Defensively redacts secret-shaped keys and any literal
 * vault values that leak into inputs/outputs.
 */
export class AuditLog {
  readonly filePath: string;
  readonly tenantId: string;
  #secretValues: string[];

  constructor(filePath: string, tenantId: string, secretValues: string[] = []) {
    this.filePath = filePath;
    this.tenantId = tenantId;
    this.#secretValues = secretValues;
    mkdirSync(path.dirname(filePath), { recursive: true });
  }

  append(input: AuditInput): AuditEntry {
    const entry: AuditEntry = {
      id: randomUUID(),
      ts: new Date().toISOString(),
      tenant_id: this.tenantId,
      run_id: input.run_id,
      action: input.action,
      inputs: input.inputs ?? null,
      outputs: input.outputs ?? null,
      policy_checks: input.policy_checks ?? [],
      model: input.model ?? null,
      policies_sha256: input.policies_sha256,
    };
    let line = JSON.stringify(entry, (key, value) =>
      SECRETISH_KEYS.test(key) ? '[REDACTED]' : value,
    );
    for (const secret of this.#secretValues) {
      if (secret.length >= 8) line = line.split(secret).join('[REDACTED]');
    }
    appendFileSync(this.filePath, line + '\n');
    return entry;
  }

  /** Read the log back (for eval + briefing traceability checks). */
  readAll(): AuditEntry[] {
    if (!existsSync(this.filePath)) return [];
    return readFileSync(this.filePath, 'utf8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as AuditEntry);
  }
}
