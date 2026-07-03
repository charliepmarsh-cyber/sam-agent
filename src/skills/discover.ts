import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Run } from '../agent/run.ts';
import type { BankFeed } from '../clients/bank.ts';
import { ToolError } from '../clients/accounting.ts';
import type { TransactionRecord } from '../types.ts';

/**
 * Self-integration tier. Sam is given ONLY a base URL. This skill:
 *   1. fetches /openapi.json,
 *   2. generates zod-validated tool definitions at runtime,
 *   3. decides — under policy — which endpoints it will and won't call,
 *   4. writes a human-readable integration report to the audit trail,
 *   5. returns a BankFeed built exclusively from the discovered tools.
 * There is no pre-built client for this API anywhere in the codebase.
 */

interface DiscoveredEndpoint {
  method: string;
  path: string;
  operationId: string;
  summary: string;
  params: { name: string; in: string; required: boolean; schema: unknown }[];
  responseSchema: unknown;
  /** Policy verdict made at discovery time. */
  callable: boolean;
  policyNote: string;
}

/** Convert the OpenAPI schema subset used by real-world specs into zod validators. */
export function zodFromOpenApi(schema: unknown): z.ZodType {
  if (!schema || typeof schema !== 'object') return z.unknown();
  const s = schema as Record<string, unknown>;
  const type = s.type;
  if (Array.isArray(type)) {
    const variants = type.map((t) => zodFromOpenApi({ ...s, type: t }));
    return variants.length === 1 ? (variants[0] as z.ZodType) : z.union(variants as [z.ZodType, z.ZodType, ...z.ZodType[]]);
  }
  switch (type) {
    case 'object': {
      const required = new Set((s.required as string[] | undefined) ?? []);
      const shape: Record<string, z.ZodType> = {};
      for (const [key, value] of Object.entries((s.properties as Record<string, unknown> | undefined) ?? {})) {
        const inner = zodFromOpenApi(value);
        shape[key] = required.has(key) ? inner : inner.optional();
      }
      // Loose: tolerate extra fields the spec doesn't mention; never invent absent ones.
      return z.looseObject(shape);
    }
    case 'array':
      return z.array(zodFromOpenApi(s.items));
    case 'string':
      return z.string();
    case 'integer': {
      let n = z.number().int();
      if (typeof s.minimum === 'number') n = n.min(s.minimum);
      if (typeof s.maximum === 'number') n = n.max(s.maximum);
      return n;
    }
    case 'number':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.unknown();
  }
}

/** Policy verdict for a discovered endpoint: reads are callable, writes are not. */
export function classifyEndpoint(method: string, endpointPath: string): { callable: boolean; policyNote: string } {
  if (method.toUpperCase() === 'GET') {
    return { callable: true, policyNote: 'read-only — callable autonomously' };
  }
  if (/payment|transfer|payee/i.test(endpointPath)) {
    return {
      callable: false,
      policyNote: 'WILL NOT CALL — initiating payments/transfers is never autonomous (policies.md §1); excluded from the generated toolset',
    };
  }
  return { callable: false, policyNote: 'WILL NOT CALL — non-GET on a self-integrated API requires human review before first use' };
}

export async function ensureBankFeed(run: Run): Promise<BankFeed> {
  if (run.boot.bank) return run.boot.bank;
  run.boot.bank = await discoverBankFeed(run);
  return run.boot.bank;
}

async function discoverBankFeed(run: Run): Promise<BankFeed> {
  const { bankUrl, tenantId, tenantRoot, vault } = run.boot;

  const spec = await run.act('DISCOVER_API_FETCH_SPEC', { url: `${bankUrl}/openapi.json`, given: 'base URL only — no pre-built client' }, async () => {
    const response = await fetch(`${bankUrl}/openapi.json`, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new ToolError(`spec fetch failed: HTTP ${response.status}`);
    return (await response.json()) as Record<string, unknown>;
  });

  const info = (spec.info ?? {}) as { title?: string; version?: string; description?: string };
  const endpoints: DiscoveredEndpoint[] = [];
  for (const [endpointPath, methods] of Object.entries((spec.paths as Record<string, unknown>) ?? {})) {
    for (const [method, op] of Object.entries(methods as Record<string, unknown>)) {
      const operation = op as {
        operationId?: string;
        summary?: string;
        parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
        responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
      };
      const okResponse = operation.responses?.['200']?.content?.['application/json']?.schema ?? null;
      endpoints.push({
        method: method.toUpperCase(),
        path: endpointPath,
        operationId: operation.operationId ?? `${method}_${endpointPath}`,
        summary: operation.summary ?? '(no summary in spec)',
        params: (operation.parameters ?? []).map((p) => ({ name: p.name, in: p.in, required: p.required ?? false, schema: p.schema })),
        responseSchema: okResponse,
        ...classifyEndpoint(method, endpointPath),
      });
    }
  }

  // Runtime tool definitions: zod validators generated from the spec.
  const tools = new Map<string, { endpoint: DiscoveredEndpoint; response: z.ZodType }>();
  for (const endpoint of endpoints) {
    if (!endpoint.callable) continue;
    tools.set(endpoint.operationId, { endpoint, response: zodFromOpenApi(endpoint.responseSchema) });
  }
  run.log('DISCOVER_API_TOOLS_GENERATED', { spec: `${info.title} v${info.version}` }, {
    endpoints_found: endpoints.length,
    tools_generated: [...tools.keys()],
    excluded: endpoints.filter((e) => !e.callable).map((e) => `${e.method} ${e.path}`),
  });

  // Human-readable integration report — into the audit trail and reports/.
  const report = renderReport(bankUrl, info, endpoints);
  await run.act('API_INTEGRATION_REPORT', { api: info.title ?? bankUrl }, () => {
    const reportDir = path.join(tenantRoot, 'reports');
    mkdirSync(reportDir, { recursive: true });
    const reportPath = path.join(reportDir, 'bank-integration.md');
    writeFileSync(reportPath, report);
    return { report_path: path.relative(tenantRoot, reportPath), report };
  });

  const listTransactions = tools.get('listTransactions');
  const getBalance = tools.get('getBalance');
  if (!listTransactions) throw new ToolError('discovery: no listTransactions-shaped GET endpoint found in spec');

  const call = async (tool: { endpoint: DiscoveredEndpoint; response: z.ZodType }, query: Record<string, string | number>): Promise<unknown> => {
    const qs = Object.entries(query)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join('&');
    const url = `${bankUrl}${tool.endpoint.path}${qs ? `?${qs}` : ''}`;
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${vault.get(`tenant/${tenantId}/bank-api`)}` },
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new ToolError(`${tool.endpoint.operationId}: HTTP ${response.status}`);
    const body: unknown = await response.json();
    const parsed = tool.response.safeParse(body);
    if (!parsed.success) {
      // Out-of-schema API response: reject and surface — never trust blindly.
      throw new ToolError(`${tool.endpoint.operationId}: response failed generated schema: ${parsed.error.message.slice(0, 200)}`);
    }
    return parsed.data;
  };

  return {
    origin: 'discovered',
    async pullSince(cursor: string | null) {
      const transactions: TransactionRecord[] = [];
      let next = cursor;
      let lastCursor = cursor;
      do {
        const query: Record<string, string | number> = { limit: 100 };
        if (next) query.cursor = next;
        const page = (await call(listTransactions, query)) as { transactions: TransactionRecord[]; next_cursor: string | null };
        transactions.push(...page.transactions);
        if (page.next_cursor !== null) lastCursor = page.next_cursor;
        next = page.next_cursor;
      } while (next !== null);
      return { transactions, lastCursor };
    },
    async balance() {
      if (!getBalance) throw new ToolError('discovery: no balance endpoint in spec');
      return (await call(getBalance, {})) as { balance: number; currency: string; as_of: string | null };
    },
  };
}

function renderReport(bankUrl: string, info: { title?: string; version?: string; description?: string }, endpoints: DiscoveredEndpoint[]): string {
  const lines: string[] = [
    `# Bank API integration report (written by Sam at discovery time)`,
    ``,
    `- **Given:** base URL only (\`${bankUrl}\`) — no pre-built client exists for this API.`,
    `- **Spec:** \`GET /openapi.json\` → ${info.title ?? 'untitled'} v${info.version ?? '?'}`,
    `- **Spec description:** ${info.description ?? '(none)'}`,
    ``,
    `## What I found, what I decided each endpoint does, and what I will call`,
    ``,
  ];
  for (const e of endpoints) {
    lines.push(`### ${e.method} ${e.path} (\`${e.operationId}\`)`);
    lines.push(`- Purpose (from spec): ${e.summary}`);
    if (e.params.length > 0) {
      lines.push(`- Parameters: ${e.params.map((p) => `${p.name}${p.required ? '' : '?'} (${p.in})`).join(', ')}`);
    }
    lines.push(`- Policy decision: ${e.policyNote}`);
    lines.push('');
  }
  lines.push(
    `## Validation`,
    ``,
    `Responses from every callable endpoint are validated against zod schemas generated from the spec at runtime. ` +
      `An out-of-schema response is rejected and logged — it is never passed downstream. ` +
      `Credentials come from the vault key \`tenant/<id>/bank-api\` at call time and appear nowhere in this report or the logs.`,
  );
  return lines.join('\n');
}
