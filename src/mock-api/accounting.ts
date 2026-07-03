import express from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadCustomers, loadInvoices } from './data.ts';
import { engageKillSwitch } from '../substrate/killswitch.ts';
import type { InvoiceRecord } from '../types.ts';

interface AccountingState {
  created: InvoiceRecord[];
  statusOverrides: Record<string, InvoiceRecord['status']>;
  nextInvoiceNumber: number;
}

export interface AccountingApiOptions {
  dataDir: string;
  tenantRoot: string;
  apiKey: string;
  /** Probability a send call "times out" (server acts, response never arrives). */
  sendTimeoutRate: number;
}

/**
 * QuickBooks-shaped mock accounting API, backed by the seeded CSVs.
 * State (created invoices, status changes) is held in memory for the
 * lifetime of the server process.
 *
 * The simulated timeout on POST /invoices/:id/send is deliberately
 * nasty: the server DOES mark the invoice SENT but never responds, so
 * the caller faces an ambiguous failure and must verify-before-retry.
 */
export function createAccountingApi(opts: AccountingApiOptions): Express {
  const customers = loadCustomers(opts.dataDir);
  const invoices: InvoiceRecord[] = loadInvoices(opts.dataDir);

  // Sandbox state survives process restarts (a --now CLI run per task is
  // normal), like a real accounting system would. Gitignored overlay.
  const statePath = path.join(opts.tenantRoot, 'accounting-state.json');
  const state: AccountingState = existsSync(statePath)
    ? (JSON.parse(readFileSync(statePath, 'utf8')) as AccountingState)
    : { created: [], statusOverrides: {}, nextInvoiceNumber: 9001 };
  invoices.push(...state.created);
  for (const invoice of invoices) {
    const override = state.statusOverrides[invoice.invoice_id];
    if (override) invoice.status = override;
  }
  const persist = (): void => writeFileSync(statePath, JSON.stringify(state, null, 2));

  const app = express();
  app.use(express.json());

  app.post('/halt', (_req: Request, res: Response) => {
    engageKillSwitch(opts.tenantRoot, 'halt endpoint hit (accounting)');
    res.json({ halted: true });
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization !== `Bearer ${opts.apiKey}`) {
      res.status(401).json({ error: 'invalid or missing API key' });
      return;
    }
    next();
  });

  app.get('/customers', (_req: Request, res: Response) => {
    res.json({ customers });
  });

  app.get('/invoices', (req: Request, res: Response) => {
    const since = typeof req.query.since === 'string' ? req.query.since : null;
    const result = since ? invoices.filter((i) => i.issue_date >= since) : invoices;
    res.json({ invoices: result });
  });

  app.get('/invoices/:id', (req: Request, res: Response) => {
    const invoice = invoices.find((i) => i.invoice_id === req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'invoice not found' });
      return;
    }
    res.json({ invoice });
  });

  app.post('/invoices', (req: Request, res: Response) => {
    const b = req.body as Partial<InvoiceRecord> & { memo?: string };
    if (!b.customer_id || !b.job_id || typeof b.net !== 'number' || typeof b.gross !== 'number') {
      res.status(400).json({ error: 'customer_id, job_id, net, gross required' });
      return;
    }
    if (invoices.some((i) => i.job_id === b.job_id)) {
      res.status(409).json({ error: `invoice already exists for ${b.job_id}` });
      return;
    }
    const customer = customers.find((c) => c.customer_id === b.customer_id);
    if (!customer) {
      res.status(404).json({ error: 'customer not found' });
      return;
    }
    const invoice: InvoiceRecord = {
      invoice_id: `INV-${state.nextInvoiceNumber++}`,
      job_id: b.job_id,
      customer_id: b.customer_id,
      customer_name: customer.name,
      issue_date: b.issue_date ?? new Date().toISOString().slice(0, 10),
      due_date: b.due_date ?? new Date().toISOString().slice(0, 10),
      net: b.net,
      vat: b.vat ?? 0,
      gross: b.gross,
      status: 'DRAFT',
    };
    invoices.push(invoice);
    state.created.push(invoice);
    persist();
    res.status(201).json({ invoice });
  });

  app.post('/invoices/:id/send', (req: Request, res: Response) => {
    const invoice = invoices.find((i) => i.invoice_id === req.params.id);
    if (!invoice) {
      res.status(404).json({ error: 'invoice not found' });
      return;
    }
    const forceTimeout = req.headers['x-sim-timeout'] === '1';
    const timedOut = forceTimeout || Math.random() < opts.sendTimeoutRate;
    invoice.status = 'SENT';
    state.statusOverrides[invoice.invoice_id] = 'SENT';
    persist();
    if (timedOut) {
      // Ambiguous failure: the send happened but the response never comes.
      return;
    }
    res.json({ invoice, emailed_to: customers.find((c) => c.customer_id === invoice.customer_id)?.email ?? null });
  });

  return app;
}
