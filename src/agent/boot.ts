import path from 'node:path';
import { Vault } from '../substrate/vault.ts';
import { AuditLog } from '../substrate/audit.ts';
import { openDatabase } from '../db/database.ts';
import { TenantRepository } from '../db/repository.ts';
import { ModelClient } from '../model/client.ts';
import { AccountingClient } from '../clients/accounting.ts';
import type { BankFeed } from '../clients/bank.ts';
import { startMockServers, type MockServers } from '../mock-api/server.ts';
import { todayISO } from '../lib/dates.ts';

export interface BootOptions {
  /** Multi-tenancy invariant: tenant_id is the ONLY required boot argument. */
  tenantId: string;
  baseDir?: string;
  asOf?: string;
  /** Start the mock APIs in-process (one-command boot). */
  withMocks?: boolean;
  sendTimeoutRate?: number;
  accountingPort?: number;
  bankPort?: number;
  dbPath?: string;
  /** Demo instrumentation: engage the real KILL_SWITCH after N audited actions. */
  haltAfter?: number | null;
}

export interface AgentBoot {
  tenantId: string;
  tenantRoot: string;
  asOf: string;
  vault: Vault;
  audit: AuditLog;
  repo: TenantRepository;
  model: ModelClient;
  accounting: AccountingClient;
  /** Populated at runtime by the discover_api skill — Sam only gets bankUrl. */
  bank: BankFeed | null;
  bankUrl: string;
  mocks: MockServers | null;
  haltAfter: number | null;
  close: () => Promise<void>;
}

export async function bootAgent(opts: BootOptions): Promise<AgentBoot> {
  const baseDir = opts.baseDir ?? process.cwd();
  const tenantRoot = path.join(baseDir, 'tenants', opts.tenantId);
  const secretsPath = path.join(baseDir, '.secrets.json');
  const keys = [`tenant/${opts.tenantId}/accounting-api`, `tenant/${opts.tenantId}/bank-api`];
  Vault.ensureDemoSecrets(secretsPath, keys);
  const vault = new Vault(secretsPath);

  const audit = new AuditLog(path.join(tenantRoot, 'audit.jsonl'), opts.tenantId, vault.values());
  const db = openDatabase(opts.dbPath ?? path.join(tenantRoot, 'sam.db'));
  const repo = new TenantRepository(db, opts.tenantId);
  const model = new ModelClient(tenantRoot);

  let mocks: MockServers | null = null;
  let accountingUrl = process.env.SAM_ACCOUNTING_URL ?? 'http://127.0.0.1:4001';
  let bankUrl = process.env.SAM_BANK_URL ?? 'http://127.0.0.1:4002';
  if (opts.withMocks !== false) {
    const mockOpts: Parameters<typeof startMockServers>[0] = { tenantRoot, vault, tenantId: opts.tenantId };
    if (opts.sendTimeoutRate !== undefined) mockOpts.sendTimeoutRate = opts.sendTimeoutRate;
    if (opts.accountingPort !== undefined) mockOpts.accountingPort = opts.accountingPort;
    if (opts.bankPort !== undefined) mockOpts.bankPort = opts.bankPort;
    mocks = await startMockServers(mockOpts);
    accountingUrl = mocks.accountingUrl;
    bankUrl = mocks.bankUrl;
  }

  // Credentials resolved at call time from the vault — clients hold the getter, not the value.
  const accounting = new AccountingClient(accountingUrl, () => vault.get(`tenant/${opts.tenantId}/accounting-api`));

  return {
    tenantId: opts.tenantId,
    tenantRoot,
    asOf: opts.asOf ?? todayISO(),
    vault,
    audit,
    repo,
    model,
    accounting,
    bank: null,
    bankUrl,
    mocks,
    haltAfter: opts.haltAfter ?? null,
    close: async () => {
      if (mocks) await mocks.close();
      db.close();
    },
  };
}
