import type { Database } from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import type { DiscrepancyType, EscalationObject, RunReflection } from '../types.ts';

export interface MatchRow {
  invoice_id: string;
  transaction_id: string;
  kind: 'EXACT' | 'PROBABLE';
  confidence: number;
  amount: number;
  matched_at: string;
}

export interface DiscrepancyRow {
  id: string;
  type: DiscrepancyType;
  invoice_id: string | null;
  transaction_ids: string[];
  amount: number;
  status: 'OPEN' | 'HELD' | 'CLOSED';
  detail: string;
  opened_at: string;
  hold_until: string | null;
}

export interface EscalationRow extends EscalationObject {
  id: string;
  status: 'OPEN' | 'CLOSED';
  opened_at: string;
}

export interface ApprovalRow {
  id: string;
  job_id: string;
  invoice_id: string | null;
  customer_id: string;
  amount: number;
  reason: string;
  failed_check: string;
  status: 'PENDING' | 'APPROVED' | 'SENT' | 'REJECTED';
  queued_at: string;
}

/**
 * The ONLY way skill code touches the database. Every statement is
 * parameterized on the tenant_id fixed at construction — there is no
 * method that accepts a tenant, and the raw Database handle is private,
 * so an unscoped query is unrepresentable from skill code.
 */
export class TenantRepository {
  readonly tenantId: string;
  #db: Database;

  constructor(db: Database, tenantId: string) {
    if (!tenantId) throw new Error('repository requires a tenant_id');
    this.#db = db;
    this.tenantId = tenantId;
  }

  // ---- recon_state (cursor, holds, expected fees) ----
  getState(key: string): string | null {
    const row = this.#db
      .prepare('SELECT value FROM recon_state WHERE tenant_id = ? AND key = ?')
      .get(this.tenantId, key) as { value: string } | undefined;
    return row?.value ?? null;
  }

  setState(key: string, value: string): void {
    this.#db
      .prepare(
        `INSERT INTO recon_state (tenant_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT (tenant_id, key) DO UPDATE SET value = excluded.value`,
      )
      .run(this.tenantId, key, value);
  }

  // ---- facts ----
  addFact(kind: string, content: string): void {
    this.#db
      .prepare('INSERT INTO facts (tenant_id, kind, content, created_at) VALUES (?, ?, ?, ?)')
      .run(this.tenantId, kind, content, new Date().toISOString());
  }

  factsByKind(kind: string): string[] {
    const rows = this.#db
      .prepare('SELECT content FROM facts WHERE tenant_id = ? AND kind = ? ORDER BY id')
      .all(this.tenantId, kind) as { content: string }[];
    return rows.map((r) => r.content);
  }

  // ---- matches ----
  recordMatch(m: MatchRow): void {
    this.#db
      .prepare(
        `INSERT INTO matches (tenant_id, invoice_id, transaction_id, kind, confidence, amount, matched_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, transaction_id) DO NOTHING`,
      )
      .run(this.tenantId, m.invoice_id, m.transaction_id, m.kind, m.confidence, m.amount, m.matched_at);
  }

  matches(): MatchRow[] {
    return this.#db
      .prepare('SELECT invoice_id, transaction_id, kind, confidence, amount, matched_at FROM matches WHERE tenant_id = ? ORDER BY id')
      .all(this.tenantId) as MatchRow[];
  }

  matchForTransaction(transactionId: string): MatchRow | null {
    return (
      (this.#db
        .prepare('SELECT invoice_id, transaction_id, kind, confidence, amount, matched_at FROM matches WHERE tenant_id = ? AND transaction_id = ?')
        .get(this.tenantId, transactionId) as MatchRow | undefined) ?? null
    );
  }

  exactMatchedInvoiceIds(): Set<string> {
    const rows = this.#db
      .prepare("SELECT invoice_id FROM matches WHERE tenant_id = ? AND kind = 'EXACT'")
      .all(this.tenantId) as { invoice_id: string }[];
    return new Set(rows.map((r) => r.invoice_id));
  }

  customerHasPaidInvoice(customerId: string, invoiceCustomer: (invoiceId: string) => string | null): boolean {
    for (const invoiceId of this.exactMatchedInvoiceIds()) {
      if (invoiceCustomer(invoiceId) === customerId) return true;
    }
    return false;
  }

  // ---- discrepancies ----
  openDiscrepancy(d: Omit<DiscrepancyRow, 'id' | 'opened_at'> & { dedupe_key?: string }): DiscrepancyRow | null {
    const id = `DIS-${randomUUID().slice(0, 8)}`;
    const opened_at = new Date().toISOString();
    const dedupe = d.dedupe_key ?? [d.type, d.invoice_id ?? '', ...d.transaction_ids].join('|');
    const res = this.#db
      .prepare(
        `INSERT INTO discrepancies (id, tenant_id, type, invoice_id, transaction_ids, amount, status, detail, opened_at, hold_until, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      )
      .run(id, this.tenantId, d.type, d.invoice_id, JSON.stringify(d.transaction_ids), d.amount, d.status, d.detail, opened_at, d.hold_until, dedupe);
    if (res.changes === 0) return null; // already open for this record set
    return { ...d, id, opened_at };
  }

  discrepancies(status?: 'OPEN' | 'HELD' | 'CLOSED'): DiscrepancyRow[] {
    const rows = (
      status
        ? this.#db.prepare('SELECT * FROM discrepancies WHERE tenant_id = ? AND status = ? ORDER BY opened_at').all(this.tenantId, status)
        : this.#db.prepare('SELECT * FROM discrepancies WHERE tenant_id = ? ORDER BY opened_at').all(this.tenantId)
    ) as (Omit<DiscrepancyRow, 'transaction_ids'> & { transaction_ids: string })[];
    return rows.map((r) => ({ ...r, transaction_ids: JSON.parse(r.transaction_ids) as string[] }));
  }

  releaseHold(id: string): void {
    this.#db
      .prepare("UPDATE discrepancies SET status = 'OPEN', hold_until = NULL WHERE tenant_id = ? AND id = ?")
      .run(this.tenantId, id);
  }

  // ---- escalations ----
  raiseEscalation(e: EscalationObject): EscalationRow | null {
    if (e.tenant_id !== this.tenantId) throw new Error('escalation tenant mismatch');
    const id = `ESC-${randomUUID().slice(0, 8)}`;
    const opened_at = new Date().toISOString();
    const dedupe = [...e.records].sort().join('|');
    const res = this.#db
      .prepare(
        `INSERT INTO escalations (id, tenant_id, severity, observed, records, policy_triggered, recommendation, withheld_actions, audit_refs, status, opened_at, dedupe_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)
         ON CONFLICT (tenant_id, dedupe_key) DO NOTHING`,
      )
      .run(id, this.tenantId, e.severity, e.observed, JSON.stringify(e.records), e.policy_triggered, e.recommendation, e.withheld_actions, JSON.stringify(e.audit_refs), opened_at, dedupe);
    if (res.changes === 0) return null; // dedupe by record set — update, don't re-raise
    return { ...e, id, status: 'OPEN', opened_at };
  }

  escalations(status?: 'OPEN' | 'CLOSED'): EscalationRow[] {
    const rows = (
      status
        ? this.#db.prepare('SELECT * FROM escalations WHERE tenant_id = ? AND status = ? ORDER BY opened_at').all(this.tenantId, status)
        : this.#db.prepare('SELECT * FROM escalations WHERE tenant_id = ? ORDER BY opened_at').all(this.tenantId)
    ) as (Omit<EscalationRow, 'records' | 'audit_refs'> & { records: string; audit_refs: string })[];
    return rows.map((r) => ({
      ...r,
      records: JSON.parse(r.records) as string[],
      audit_refs: JSON.parse(r.audit_refs) as string[],
    }));
  }

  /** Records frozen for autonomous action by open escalations (escalation.md rules). */
  frozenRecords(): string[] {
    return [...new Set(this.escalations('OPEN').flatMap((e) => e.records))];
  }

  // ---- approval queue ----
  queueApproval(a: Omit<ApprovalRow, 'id' | 'status' | 'queued_at'>): ApprovalRow | null {
    const id = `APR-${randomUUID().slice(0, 8)}`;
    const queued_at = new Date().toISOString();
    const res = this.#db
      .prepare(
        `INSERT INTO approval_queue (id, tenant_id, job_id, invoice_id, customer_id, amount, reason, failed_check, status, queued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?)
         ON CONFLICT (tenant_id, job_id) DO NOTHING`,
      )
      .run(id, this.tenantId, a.job_id, a.invoice_id, a.customer_id, a.amount, a.reason, a.failed_check, queued_at);
    if (res.changes === 0) return null;
    return { ...a, id, status: 'PENDING', queued_at };
  }

  approvals(status?: ApprovalRow['status']): ApprovalRow[] {
    return (
      status
        ? this.#db.prepare('SELECT * FROM approval_queue WHERE tenant_id = ? AND status = ? ORDER BY queued_at').all(this.tenantId, status)
        : this.#db.prepare('SELECT * FROM approval_queue WHERE tenant_id = ? ORDER BY queued_at').all(this.tenantId)
    ) as ApprovalRow[];
  }

  setApprovalStatus(id: string, status: ApprovalRow['status']): void {
    this.#db.prepare('UPDATE approval_queue SET status = ? WHERE tenant_id = ? AND id = ?').run(status, this.tenantId, id);
  }

  // ---- blast-radius counters ----
  logEmail(customerId: string, kind: string, subject: string, invoiceId: string | null, date: string): void {
    this.#db
      .prepare('INSERT INTO email_log (tenant_id, customer_id, kind, subject, invoice_id, sent_at, sent_date) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(this.tenantId, customerId, kind, subject, invoiceId, new Date().toISOString(), date);
  }

  emailsToCustomerOn(customerId: string, date: string): number {
    const row = this.#db
      .prepare('SELECT COUNT(*) AS n FROM email_log WHERE tenant_id = ? AND customer_id = ? AND sent_date = ?')
      .get(this.tenantId, customerId, date) as { n: number };
    return row.n;
  }

  emailsOn(date: string): { customer_id: string; kind: string; subject: string; invoice_id: string | null }[] {
    return this.#db
      .prepare('SELECT customer_id, kind, subject, invoice_id FROM email_log WHERE tenant_id = ? AND sent_date = ?')
      .all(this.tenantId, date) as { customer_id: string; kind: string; subject: string; invoice_id: string | null }[];
  }

  logAutoSend(invoiceId: string, amount: number, date: string): void {
    this.#db
      .prepare('INSERT INTO autosend_log (tenant_id, invoice_id, amount, sent_date) VALUES (?, ?, ?, ?) ON CONFLICT (tenant_id, invoice_id) DO NOTHING')
      .run(this.tenantId, invoiceId, amount, date);
  }

  autoSentValueOn(date: string): number {
    const row = this.#db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM autosend_log WHERE tenant_id = ? AND sent_date = ?')
      .get(this.tenantId, date) as { total: number };
    return row.total;
  }

  autoSendsOn(date: string): { invoice_id: string; amount: number }[] {
    return this.#db
      .prepare('SELECT invoice_id, amount FROM autosend_log WHERE tenant_id = ? AND sent_date = ?')
      .all(this.tenantId, date) as { invoice_id: string; amount: number }[];
  }

  // ---- runs ----
  startRun(runId: string, task: string): void {
    this.#db
      .prepare("INSERT INTO runs (run_id, tenant_id, task, status, started_at) VALUES (?, ?, ?, 'RUNNING', ?)")
      .run(runId, this.tenantId, task, new Date().toISOString());
  }

  finishRun(runId: string, status: 'DONE' | 'HALTED' | 'ERROR', reflection: RunReflection | null): void {
    this.#db
      .prepare('UPDATE runs SET status = ?, finished_at = ?, reflection_json = ? WHERE tenant_id = ? AND run_id = ?')
      .run(status, new Date().toISOString(), reflection ? JSON.stringify(reflection) : null, this.tenantId, runId);
  }

  recentRuns(limit: number): { run_id: string; task: string; status: string; started_at: string; reflection_json: string | null }[] {
    return this.#db
      .prepare('SELECT run_id, task, status, started_at, reflection_json FROM runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT ?')
      .all(this.tenantId, limit) as { run_id: string; task: string; status: string; started_at: string; reflection_json: string | null }[];
  }
}
