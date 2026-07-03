import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { CustomerRecord, InvoiceRecord, JobSheetRecord, TransactionRecord } from '../types.ts';

/** Minimal CSV parser — the seeded data has no quoted fields. */
function parseCsv(filePath: string): Record<string, string>[] {
  const lines = readFileSync(filePath, 'utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines[0] ?? '').split(',');
  return lines.slice(1).map((line) => {
    const cells = line.split(',');
    const row: Record<string, string> = {};
    header.forEach((h, i) => (row[h] = cells[i] ?? ''));
    return row;
  });
}

export function loadCustomers(dataDir: string): CustomerRecord[] {
  return parseCsv(path.join(dataDir, 'customers.csv')).map((r) => ({
    customer_id: r.customer_id ?? '',
    name: r.name ?? '',
    type: (r.type === 'domestic' ? 'domestic' : 'commercial') as CustomerRecord['type'],
    terms_days: Number(r.terms_days ?? 0),
    email: r.email ?? '',
  }));
}

export function loadInvoices(dataDir: string): InvoiceRecord[] {
  return parseCsv(path.join(dataDir, 'invoices.csv')).map((r) => ({
    invoice_id: r.invoice_id ?? '',
    job_id: r.job_id ?? '',
    customer_id: r.customer_id ?? '',
    customer_name: r.customer_name ?? '',
    issue_date: r.issue_date ?? '',
    due_date: r.due_date ?? '',
    net: Number(r.net ?? 0),
    vat: Number(r.vat ?? 0),
    gross: Number(r.gross ?? 0),
    status: (r.status ?? 'SENT') as InvoiceRecord['status'],
  }));
}

export function loadTransactions(dataDir: string): TransactionRecord[] {
  return parseCsv(path.join(dataDir, 'bank_transactions.csv'))
    .map((r) => ({
      transaction_id: r.transaction_id ?? '',
      date: r.date ?? '',
      amount: Number(r.amount ?? 0),
      description: r.description ?? '',
    }))
    .sort((a, b) => (a.date === b.date ? a.transaction_id.localeCompare(b.transaction_id) : a.date.localeCompare(b.date)));
}

export function loadJobSheets(dataDir: string): JobSheetRecord[] {
  return parseCsv(path.join(dataDir, 'job_sheets.csv')).map((r) => ({
    job_id: r.job_id ?? '',
    customer_id: r.customer_id ?? '',
    description: r.description ?? '',
    net_amount: Number(r.net_amount ?? 0),
    signed: r.signed === 'yes',
    completion_date: r.completion_date ?? '',
  }));
}
