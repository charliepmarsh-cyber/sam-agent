import type { TransactionRecord } from '../types.ts';
import { ToolError } from './accounting.ts';

export interface BankPage {
  transactions: TransactionRecord[];
  next_cursor: string | null;
}

/**
 * The reconciliation skill depends only on this interface. Phase 2 wires
 * a thin direct client; the self-integration tier (discover_api) returns
 * the same interface built from the bank's OpenAPI spec at runtime.
 */
export interface BankFeed {
  /** How this client came to exist — recorded in the audit trail. */
  origin: 'direct' | 'discovered';
  /** Pull all transactions after the given cursor (null = from the start). */
  pullSince(cursor: string | null): Promise<{ transactions: TransactionRecord[]; lastCursor: string | null }>;
  balance(): Promise<{ balance: number; currency: string; as_of: string | null }>;
}

export function createDirectBankClient(baseUrl: string, getKey: () => string): BankFeed {
  const request = async <T>(pathname: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${pathname}`, {
        headers: { authorization: `Bearer ${getKey()}` },
        signal: AbortSignal.timeout(2500),
      });
    } catch (err) {
      throw new ToolError(`bank GET ${pathname}: ${(err as Error).message}`);
    }
    if (!response.ok) throw new ToolError(`bank GET ${pathname}: HTTP ${response.status}`);
    return (await response.json()) as T;
  };

  return {
    origin: 'direct',
    async pullSince(cursor: string | null) {
      const transactions: TransactionRecord[] = [];
      let next = cursor;
      let lastCursor = cursor;
      do {
        const q = next ? `?limit=100&cursor=${encodeURIComponent(next)}` : '?limit=100';
        const page = await request<BankPage>(`/transactions${q}`);
        transactions.push(...page.transactions);
        if (page.next_cursor !== null) lastCursor = page.next_cursor;
        next = page.next_cursor;
      } while (next !== null);
      return { transactions, lastCursor };
    },
    async balance() {
      return request<{ balance: number; currency: string; as_of: string | null }>('/balance');
    },
  };
}
