import type { CustomerRecord, InvoiceRecord } from '../types.ts';

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface SendResult {
  invoice: InvoiceRecord;
  /** 'direct' = clean response; 'verified-after-timeout' = ambiguous failure resolved by a read. */
  path: 'direct' | 'verified-after-timeout' | 'retried-after-verify';
}

/**
 * Pre-built integration tier: QuickBooks-shaped accounting API client.
 * The API key is fetched at call time (never stored on the instance),
 * and sendInvoice implements verify-before-retry: on ambiguous failure
 * it reads invoice status before ever considering a retry.
 */
export class AccountingClient {
  readonly baseUrl: string;
  #getKey: () => string;
  #timeoutMs: number;

  constructor(baseUrl: string, getKey: () => string, timeoutMs = 2500) {
    this.baseUrl = baseUrl;
    this.#getKey = getKey;
    this.#timeoutMs = timeoutMs;
  }

  async #request<T>(method: string, pathname: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.#getKey()}`,
      'content-type': 'application/json',
      ...extraHeaders,
    };
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(this.#timeoutMs),
      });
    } catch (err) {
      throw new ToolError(`accounting ${method} ${pathname}: ${(err as Error).name === 'TimeoutError' ? 'TIMEOUT' : (err as Error).message}`);
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ToolError(`accounting ${method} ${pathname}: HTTP ${response.status} ${detail.slice(0, 200)}`);
    }
    return (await response.json()) as T;
  }

  async customers(): Promise<CustomerRecord[]> {
    return (await this.#request<{ customers: CustomerRecord[] }>('GET', '/customers')).customers;
  }

  async invoices(since?: string): Promise<InvoiceRecord[]> {
    const q = since ? `?since=${encodeURIComponent(since)}` : '';
    return (await this.#request<{ invoices: InvoiceRecord[] }>('GET', `/invoices${q}`)).invoices;
  }

  async invoice(id: string): Promise<InvoiceRecord | null> {
    try {
      return (await this.#request<{ invoice: InvoiceRecord }>('GET', `/invoices/${id}`)).invoice;
    } catch (err) {
      if (err instanceof ToolError && err.message.includes('HTTP 404')) return null;
      throw err;
    }
  }

  async createInvoice(draft: {
    job_id: string;
    customer_id: string;
    issue_date: string;
    due_date: string;
    net: number;
    vat: number;
    gross: number;
    memo?: string;
  }): Promise<InvoiceRecord> {
    return (await this.#request<{ invoice: InvoiceRecord }>('POST', '/invoices', draft)).invoice;
  }

  /**
   * Send an invoice. Payment-adjacent, so on ambiguous failure (timeout)
   * we NEVER retry blind: read the invoice status first (policies.md §5).
   * Only if the read proves the send did NOT happen is one retry made.
   */
  async sendInvoice(id: string, opts?: { forceTimeout?: boolean }): Promise<SendResult> {
    const headers = opts?.forceTimeout ? { 'x-sim-timeout': '1' } : undefined;
    try {
      const result = await this.#request<{ invoice: InvoiceRecord }>('POST', `/invoices/${id}/send`, {}, headers);
      return { invoice: result.invoice, path: 'direct' };
    } catch (err) {
      if (!(err instanceof ToolError) || !err.message.includes('TIMEOUT')) throw err;
      // Ambiguous failure → verify before any retry.
      const current = await this.invoice(id);
      if (!current) throw new ToolError(`send ${id}: timeout, then invoice not found on verify`);
      if (current.status === 'SENT') {
        return { invoice: current, path: 'verified-after-timeout' };
      }
      // Verified the send did not happen — a single retry is now permitted.
      const retried = await this.#request<{ invoice: InvoiceRecord }>('POST', `/invoices/${id}/send`, {});
      return { invoice: retried.invoice, path: 'retried-after-verify' };
    }
  }
}
