import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  reflection_json TEXT
);
CREATE TABLE IF NOT EXISTS recon_state (
  tenant_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (tenant_id, key)
);
CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('EXACT','PROBABLE')),
  confidence REAL NOT NULL,
  amount REAL NOT NULL,
  matched_at TEXT NOT NULL,
  UNIQUE (tenant_id, transaction_id)
);
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  type TEXT NOT NULL,
  invoice_id TEXT,
  transaction_ids TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','HELD','CLOSED')),
  detail TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  hold_until TEXT,
  dedupe_key TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS escalations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('URGENT','STANDARD')),
  observed TEXT NOT NULL,
  records TEXT NOT NULL,
  policy_triggered TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  withheld_actions TEXT NOT NULL,
  audit_refs TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  opened_at TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  UNIQUE (tenant_id, dedupe_key)
);
CREATE TABLE IF NOT EXISTS approval_queue (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  invoice_id TEXT,
  customer_id TEXT NOT NULL,
  amount REAL NOT NULL,
  reason TEXT NOT NULL,
  failed_check TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING','APPROVED','SENT','REJECTED')),
  queued_at TEXT NOT NULL,
  UNIQUE (tenant_id, job_id)
);
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  subject TEXT NOT NULL,
  invoice_id TEXT,
  sent_at TEXT NOT NULL,
  sent_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS autosend_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  amount REAL NOT NULL,
  sent_date TEXT NOT NULL,
  UNIQUE (tenant_id, invoice_id)
);
`;

/**
 * Open (and initialize) the tenant database. SQLite for the demo; the
 * repository layer is the only consumer, so swapping to Postgres/pgvector
 * is a driver change, not a rewrite.
 */
export function openDatabase(dbPath: string): Database.Database {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}
