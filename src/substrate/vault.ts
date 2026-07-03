import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * Demo secrets vault. Secrets live in a gitignored JSON file, keyed by
 * scoped names like `tenant/ashdown/accounting-api`. Secret VALUES must
 * never appear in memory tables, audit lines, or model context — callers
 * pass values straight into request headers and log only the key name.
 */
export class Vault {
  readonly path: string;
  #secrets: Record<string, string>;

  constructor(secretsPath: string) {
    this.path = secretsPath;
    if (!existsSync(secretsPath)) {
      throw new Error(`vault: secrets file missing at ${secretsPath}`);
    }
    this.#secrets = JSON.parse(readFileSync(secretsPath, 'utf8'));
  }

  get(key: string): string {
    const value = this.#secrets[key];
    if (!value) throw new Error(`vault: no secret for key "${key}"`);
    return value;
  }

  has(key: string): boolean {
    return typeof this.#secrets[key] === 'string' && this.#secrets[key].length > 0;
  }

  /** All secret values, for the audit logger's defensive redaction pass. */
  values(): string[] {
    return Object.values(this.#secrets);
  }

  /** First-boot convenience: create a demo secrets file with random keys. */
  static ensureDemoSecrets(secretsPath: string, keys: string[]): void {
    if (existsSync(secretsPath)) return;
    const secrets: Record<string, string> = {};
    for (const key of keys) secrets[key] = randomBytes(24).toString('hex');
    writeFileSync(secretsPath, JSON.stringify(secrets, null, 2));
  }
}
