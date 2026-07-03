// Core shared types for the Sam agent substrate.

export interface PolicyLimits {
  auto_send_max: number;
  daily_value_max: number;
  actions_per_run_max: number;
  emails_per_customer_day_max: number;
  unmatched_escalate_over: number;
  overdue_chase_days: number;
  overdue_escalate_days: number;
}

export interface LoadedPolicies {
  limits: PolicyLimits;
  sha256: string;
  raw: string;
}

export interface PolicyCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface GateResult {
  allowed: boolean;
  checks: PolicyCheck[];
  /** Name of the first failed check, per runbook "queue with the failed check named". */
  failedCheck: string | null;
}

export interface CustomerRecord {
  customer_id: string;
  name: string;
  type: 'commercial' | 'domestic';
  terms_days: number;
  email: string;
}

export interface InvoiceRecord {
  invoice_id: string;
  job_id: string;
  customer_id: string;
  customer_name: string;
  issue_date: string;
  due_date: string;
  net: number;
  vat: number;
  gross: number;
  status: 'DRAFT' | 'SENT' | 'PAID';
}

export interface TransactionRecord {
  transaction_id: string;
  date: string;
  amount: number;
  description: string;
}

export interface JobSheetRecord {
  job_id: string;
  customer_id: string;
  description: string;
  net_amount: number;
  signed: boolean;
  completion_date: string;
}

export interface EscalationObject {
  tenant_id: string;
  severity: 'URGENT' | 'STANDARD';
  observed: string;
  records: string[];
  policy_triggered: string;
  recommendation: string;
  withheld_actions: string;
  audit_refs: string[];
}

export type DiscrepancyType =
  | 'SHORT_PAY'
  | 'OVER_PAY'
  | 'DUPLICATE_PAY'
  | 'UNEXPECTED_FEE'
  | 'UNREFERENCED_CREDIT'
  | 'UNREFERENCED_DEBIT';

export interface RunReflection {
  auto_match_rate: number;
  matched_count: number;
  matched_value: number;
  discrepancies_opened: number;
  escalations_opened: number;
  limit_hits: string[];
  tool_errors: number;
  actions_taken: number;
  notes: string[];
}
