import path from 'node:path';
import type { Server } from 'node:http';
import { createAccountingApi } from './accounting.ts';
import { createBankApi } from './bank.ts';
import { Vault } from '../substrate/vault.ts';

export interface MockServers {
  accountingUrl: string;
  bankUrl: string;
  close: () => Promise<void>;
}

export interface MockServerOptions {
  tenantRoot: string;
  vault: Vault;
  tenantId: string;
  accountingPort?: number;
  bankPort?: number;
  sendTimeoutRate?: number;
}

export const OPENING_BALANCE = 12000;

export async function startMockServers(opts: MockServerOptions): Promise<MockServers> {
  const dataDir = path.join(opts.tenantRoot, 'data');
  const accounting = createAccountingApi({
    dataDir,
    tenantRoot: opts.tenantRoot,
    apiKey: opts.vault.get(`tenant/${opts.tenantId}/accounting-api`),
    sendTimeoutRate: opts.sendTimeoutRate ?? Number(process.env.SAM_SEND_TIMEOUT_RATE ?? 0.02),
  });
  const bank = createBankApi({
    dataDir,
    tenantRoot: opts.tenantRoot,
    apiKey: opts.vault.get(`tenant/${opts.tenantId}/bank-api`),
    openingBalance: OPENING_BALANCE,
  });

  const listen = (app: ReturnType<typeof createAccountingApi>, port: number): Promise<Server> =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, '127.0.0.1', () => resolve(server));
      server.on('error', reject);
    });

  const accountingServer = await listen(accounting, opts.accountingPort ?? 4001);
  const bankServer = await listen(bank, opts.bankPort ?? 4002);
  const port = (s: Server): number => (s.address() as { port: number }).port;

  return {
    accountingUrl: `http://127.0.0.1:${port(accountingServer)}`,
    bankUrl: `http://127.0.0.1:${port(bankServer)}`,
    close: async () => {
      await Promise.all([
        new Promise((r) => accountingServer.close(r)),
        new Promise((r) => bankServer.close(r)),
      ]);
    },
  };
}

// Standalone: `pnpm mocks` (expects tenants/<id>/ layout relative to CWD).
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const tenantId = process.env.SAM_TENANT ?? 'ashdown';
  const tenantRoot = path.resolve('tenants', tenantId);
  const secretsPath = path.resolve('.secrets.json');
  Vault.ensureDemoSecrets(secretsPath, [`tenant/${tenantId}/accounting-api`, `tenant/${tenantId}/bank-api`]);
  const vault = new Vault(secretsPath);
  const servers = await startMockServers({ tenantRoot, vault, tenantId });
  console.log(`[mock] accounting API: ${servers.accountingUrl}`);
  console.log(`[mock] bank API:       ${servers.bankUrl} (spec at /openapi.json)`);
}
