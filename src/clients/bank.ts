import type { TransactionRecord } from '../types.ts';

/**
 * The reconciliation skill depends only on this interface. Sam has NO
 * pre-built client for the bank API: the only implementation is built
 * at runtime by the discover_api skill (src/skills/discover.ts) from
 * the API's own /openapi.json.
 */
export interface BankFeed {
  /** How this client came to exist — recorded in the audit trail. */
  origin: 'discovered';
  /** Pull all transactions after the given cursor (null = from the start). */
  pullSince(cursor: string | null): Promise<{ transactions: TransactionRecord[]; lastCursor: string | null }>;
  balance(): Promise<{ balance: number; currency: string; as_of: string | null }>;
}
