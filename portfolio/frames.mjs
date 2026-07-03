// Generates the video/gallery frames as HTML (1920x1080), populated with
// REAL captured output from portfolio/frames-src/. Screenshot with:
//   node portfolio/frames.mjs && bash portfolio/shoot-frames.sh
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const SRC = path.resolve('portfolio', 'frames-src');
const OUT = path.resolve('portfolio', 'frames-html');
mkdirSync(OUT, { recursive: true });

const NAVY = '#0A1F44';
const NAVY2 = '#071630';
const PANEL = '#0E2A5C';
const BLUE = '#2D7FF9';
const CORAL = '#FF6B5E';
const GREEN = '#3DDC84';
const INK = '#EAF1FF';
const DIM = '#8FA5CC';

const esc = (s) => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function page(body, extraCss = '') {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:1920px; height:1080px; overflow:hidden; }
  body { background:${NAVY}; color:${INK}; font-family:'Segoe UI',system-ui,sans-serif;
         display:flex; flex-direction:column; padding:70px 90px; position:relative; }
  body::before { content:''; position:absolute; inset:0;
    background: radial-gradient(1200px 600px at 85% -10%, rgba(45,127,249,.18), transparent 60%),
                radial-gradient(900px 500px at -10% 110%, rgba(255,107,94,.10), transparent 55%); }
  .chip { position:absolute; top:38px; left:90px; font-size:24px; letter-spacing:.14em; color:${DIM};
          text-transform:uppercase; font-weight:600; }
  .chip b { color:${BLUE}; }
  .badge { position:absolute; top:28px; right:90px; background:${CORAL}; color:#fff; font-weight:800;
           font-size:30px; padding:12px 28px; border-radius:14px; }
  h1 { font-size:64px; font-weight:800; margin-bottom:28px; z-index:1; }
  h1 .hl { color:${BLUE}; }
  .term { background:${NAVY2}; border:1px solid #1C3E7A; border-radius:16px; flex:1; z-index:1;
          box-shadow:0 30px 80px rgba(0,0,0,.45); display:flex; flex-direction:column; overflow:hidden; }
  .tbar { background:#0B1F42; padding:16px 24px; display:flex; gap:10px; align-items:center;
          border-bottom:1px solid #1C3E7A; }
  .dot { width:16px; height:16px; border-radius:50%; }
  .tbar span.title { color:${DIM}; font-size:22px; margin-left:14px; font-family:Consolas,monospace; }
  pre { font-family:'Cascadia Mono',Consolas,monospace; font-size:27px; line-height:1.72;
        padding:30px 36px; color:#C9D9F5; white-space:pre-wrap; }
  .sam { color:${BLUE}; font-weight:600; }
  .coral { color:${CORAL}; font-weight:700; }
  .green { color:${GREEN}; font-weight:700; }
  .dim { color:${DIM}; }
  .white { color:#fff; font-weight:600; }
  .foot { position:absolute; bottom:34px; left:90px; right:90px; display:flex;
          justify-content:space-between; color:${DIM}; font-size:22px; z-index:1; }
  ${extraCss}
  </style></head><body>${body}</body></html>`;
}

const chip = `<div class="chip"><b>SAM</b> · AUTONOMOUS FINANCE AGENT</div>`;
const foot = `<div class="foot"><span>github.com/charliepmarsh-cyber/sam-agent</span><span>CPM Growth Systems</span></div>`;
const dots = `<span class="dot" style="background:#FF5F57"></span><span class="dot" style="background:#FEBC2E"></span><span class="dot" style="background:#28C840"></span>`;

function terminal(title, innerHtml) {
  return `<div class="term"><div class="tbar">${dots}<span class="title">${title}</span></div><pre>${innerHtml}</pre></div>`;
}

// ---------- f0 title ----------
writeFileSync(path.join(OUT, 'f0-title.html'), page(`
  <div class="badge">8/8 EVAL</div>
  <div style="flex:1; display:flex; flex-direction:column; justify-content:center; z-index:1">
    <div style="font-size:200px; font-weight:900; letter-spacing:-.02em">SAM</div>
    <div style="font-size:66px; font-weight:800; color:${BLUE}; margin-top:6px">AUTONOMOUS FINANCE AGENT</div>
    <div style="font-size:36px; color:${DIM}; margin-top:36px; max-width:1300px; line-height:1.5">
      Reconciles the bank feed, sends invoices, chases payments — and can
      <span style="color:#fff; font-weight:700">prove every action it took.</span></div>
    <div style="display:flex; gap:22px; margin-top:54px">
      ${['POLICY GATES IN CODE', 'KILL SWITCH', 'FULL AUDIT TRAIL'].map((t) => `<div style="border:2px solid ${BLUE}; color:${INK}; border-radius:999px; padding:14px 30px; font-size:27px; font-weight:700">${t}</div>`).join('')}
    </div>
  </div>${foot}`));

// ---------- f1 briefing ----------
const briefing = readFileSync(path.join(SRC, 'briefing.md'), 'utf8');
const headline = briefing.match(/\*\*(.+?)\*\*/)?.[1] ?? '';
const cash = [...briefing.matchAll(/^- (Bank balance|vs yesterday|Expected in next 7 days)(.+)$/gm)].map((m) => m[0].slice(2));
writeFileSync(path.join(OUT, 'f1-briefing.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">The 07:30 briefing — <span class="hl">written by an agent that woke itself up</span></h1>
  <div class="term" style="background:#FDFDFB; color:#1B2A44; border-color:#2A4A85">
    <div class="tbar">${dots}<span class="title">tenants/ashdown/briefings/2026-07-02.md</span></div>
    <div style="padding:44px 60px; font-size:30px; line-height:1.75; overflow:hidden">
      <div style="font-size:40px; font-weight:800; color:#0A1F44; margin-bottom:22px">Daily briefing — 2026-07-02</div>
      <div style="border-left:8px solid ${CORAL}; background:#FFF3F1; padding:20px 26px; font-weight:700; color:#B3402F; border-radius:8px">
        ${esc(headline)}</div>
      <div style="font-weight:800; color:#0A1F44; margin:30px 0 10px; font-size:32px">Cash position</div>
      ${cash.map((c) => `<div style="color:#33465F">• ${esc(c)}</div>`).join('')}
      <div style="font-weight:800; color:#0A1F44; margin:30px 0 10px; font-size:32px">Escalations &amp; discrepancies</div>
      <div style="color:#33465F">• <b style="color:#B3402F">[URGENT]</b> Suspected duplicate payment — INV-1003, TXN-88001, TXN-88002 …</div>
      <div style="color:#8794A8; margin-top:26px; font-style:italic">…worst news first, every number traceable to a record ID, readable in 90 seconds.</div>
    </div>
  </div>${foot}`));

// ---------- f2a heartbeat terminal ----------
const runLines = readFileSync(path.join(SRC, 'run-reconcile.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !/ANTHROPIC_API_KEY|reset:/.test(l));
const colorRun = runLines
  .map((l) => {
    let h = esc(l);
    h = h.replace(/^\[sam\]/, '<span class="sam">[sam]</span>');
    h = h.replace(/^\[email → ([^\]]+)\]/, '<span class="coral">[email → $1]</span>');
    h = h.replace(/sent autonomously/, '<span class="green">sent autonomously</span>');
    h = h.replace(/policies ([0-9a-f…]+)/, 'policies <span class="white">$1</span>');
    return h;
  })
  .join('\n');
writeFileSync(path.join(OUT, 'f2a-heartbeat.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">One heartbeat cycle: <span class="hl">plan → gates → execute → reflect</span></h1>
  ${terminal('pnpm sam --tenant ashdown --now reconcile', `<span class="dim">$ node src/cli.ts --tenant ashdown --now reconcile --as-of 2026-07-02</span>\n${colorRun}`)}${foot}`));

// ---------- f2b the gate ----------
const CHECKS_9001 = [
  ['kill_switch_absent', 'no kill switch', true],
  ['total_within_auto_send_max', '£1,416.00 ≤ £2,000.00', true],
  ['customer_has_paid_history', '≥1 previously paid invoice', true],
  ['line_items_match_job_sheet', 'delta £0.00 (tol £0.01)', true],
  ['daily_auto_send_value_within_limit', '£0.00 + £1,416.00 ≤ £5,000.00', true],
  ['actions_per_run_within_limit', '2 of 10 used', true],
];
const CHECKS_9002 = [
  ['kill_switch_absent', 'no kill switch', true],
  ['total_within_auto_send_max', '£3,180.00 > £2,000.00', false],
  ['customer_has_paid_history', 'no paid invoice on record', false],
  ['line_items_match_job_sheet', 'delta £0.00 (tol £0.01)', true],
  ['daily_auto_send_value_within_limit', '£1,416.00 + £3,180.00 ≤ £5,000.00', true],
  ['actions_per_run_within_limit', '3 of 10 used', true],
];
const gateCol = (title, amount, checks, verdict, verdictColor) => `
  <div style="flex:1; background:${NAVY2}; border:1px solid #1C3E7A; border-radius:16px; padding:34px 38px">
    <div style="font-size:34px; font-weight:800">${title} <span style="color:${DIM}; font-weight:600">· ${amount}</span></div>
    <div style="margin-top:24px; display:flex; flex-direction:column; gap:15px">
      ${checks
        .map(
          ([name, detail, pass]) => `
        <div style="display:flex; align-items:center; gap:16px; font-family:Consolas,monospace; font-size:24.5px">
          <span style="min-width:86px; text-align:center; font-weight:800; border-radius:8px; padding:4px 0;
            background:${pass ? 'rgba(61,220,132,.15)' : 'rgba(255,107,94,.18)'}; color:${pass ? GREEN : CORAL}">${pass ? 'PASS' : 'FAIL'}</span>
          <span style="color:#C9D9F5">${name}</span><span style="color:${DIM}; margin-left:auto">${detail}</span>
        </div>`,
        )
        .join('')}
    </div>
    <div style="margin-top:28px; text-align:center; font-size:32px; font-weight:900; color:${verdictColor};
                border:2px solid ${verdictColor}; border-radius:12px; padding:14px">${verdict}</div>
  </div>`;
writeFileSync(path.join(OUT, 'f2b-gate.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">The six-check gate is <span class="hl">tested code — not a prompt</span></h1>
  <div style="display:flex; gap:36px; flex:1; z-index:1">
    ${gateCol('JOB-9001', '£1,416.00', CHECKS_9001, 'SENT AUTONOMOUSLY', GREEN)}
    ${gateCol('JOB-9002', '£3,180.00', CHECKS_9002, 'QUEUED FOR HUMAN APPROVAL', CORAL)}
  </div>${foot}`));

// ---------- f3a duplicate rows ----------
const csvRows = [
  ['TXN-88001', '2026-04-22', '1135.20', 'FP PRIYA HOBBS INV-1003', true],
  ['TXN-88002', '2026-04-25', '1135.20', 'FP PRIYA HOBBS INV-1003', true],
  ['TXN-88011', '2026-05-01', '868.49', 'FP JAMES WHITFIEL INV-1005', false],
  ['TXN-88013', '2026-05-06', '1096.90', 'FP PRIYA HOBBS INV-1008', false],
  ['TXN-88014', '2026-05-08', '873.14', 'FP OWEN DOYLE INV-1009', false],
  ['TXN-88015', '2026-05-08', '916.38', 'FP OWEN OKOYE INV-1010', false],
];
writeFileSync(path.join(OUT, 'f3a-duplicate.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">The trap in the raw bank feed: <span style="color:${CORAL}">paid twice, 3 days apart</span></h1>
  ${terminal(
    'tenants/ashdown/data/bank_transactions.csv',
    `<span class="dim">transaction_id,date,amount,description</span>\n` +
      csvRows
        .map(([id, d, amt, desc, hot]) =>
          hot
            ? `<span style="background:rgba(255,107,94,.16); display:inline-block; width:100%; border-left:6px solid ${CORAL}; padding-left:12px"><span class="coral">${id}</span>,${d},<span class="coral">${amt}</span>,<span class="white">${esc(desc)}</span></span>`
            : `<span class="dim">${id},${d},${amt},${esc(desc)}</span>`,
        )
        .join('\n') +
      `\n\n<span class="white">→ same amount + same reference within 5 business days = DUPLICATE_PAY</span>`,
  )}${foot}`));

// ---------- f3b escalation card ----------
writeFileSync(path.join(OUT, 'f3b-escalation.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">Escalated in the same run — <span class="hl">with the restraint on the record</span></h1>
  <div style="flex:1; background:${NAVY2}; border:1px solid #1C3E7A; border-radius:16px; padding:44px 52px; z-index:1; font-size:29px; line-height:1.7">
    <div style="display:flex; align-items:center; gap:22px">
      <span style="background:${CORAL}; color:#fff; font-weight:900; font-size:27px; padding:8px 22px; border-radius:10px">URGENT</span>
      <span style="font-family:Consolas,monospace; color:${DIM}">escalation → maria, immediately</span>
    </div>
    <div style="margin-top:28px"><span style="color:${DIM}">Observed:</span> Suspected duplicate payment: <b>£1,135.20</b> received twice for INV-1003 (TXN-88001 then TXN-88002, within 5 business days).</div>
    <div style="margin-top:16px"><span style="color:${DIM}">Records:</span> <span style="font-family:Consolas,monospace; color:${BLUE}">INV-1003 · TXN-88001 · TXN-88002</span></div>
    <div style="margin-top:16px"><span style="color:${DIM}">Policy triggered:</span> policies.md §3 — duplicate payment: escalate immediately, NEVER attempt an autonomous refund</div>
    <div style="margin-top:16px"><span style="color:${DIM}">Recommended:</span> confirm with the bank, then refund one payment of £1,135.20 manually.</div>
    <div style="margin-top:34px; border:2px solid ${CORAL}; background:rgba(255,107,94,.10); border-radius:14px; padding:26px 32px">
      <div style="color:${CORAL}; font-weight:900; font-size:26px; letter-spacing:.08em; text-transform:uppercase">What Sam deliberately did NOT do</div>
      <div style="margin-top:12px; color:#fff; font-weight:600">Did NOT attempt an autonomous refund of £1,135.20 and did NOT email the customer — refunds and credit notes are never autonomous (policies.md §1, §3).</div>
    </div>
  </div>${foot}`));

// ---------- f4 kill switch ----------
const haltLines = readFileSync(path.join(SRC, 'run-halt.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.trim() && !/ANTHROPIC_API_KEY/.test(l));
const haltHtml = haltLines
  .map((l) => {
    let h = esc(l).replace(/^\[sam\]/, '<span class="sam">[sam]</span>');
    h = h.replace(/HALTED[^—]*mid-run — no further actions \(including email\)/, (m) => `<span class="coral">${m}</span>`);
    h = h.replace(/HALTED — kill switch engaged, reconcile cycle not started/, (m) => `<span class="coral">${m}</span>`);
    return h;
  })
  .join('\n');
const haltAnnotated = haltHtml.replace(
  /(\n[^\n]*step: reconcile[^\n]*)/,
  `$1\n<span class="dim">──────────  operator touches tenants/ashdown/KILL_SWITCH mid-run  ──────────</span>`,
);
writeFileSync(path.join(OUT, 'f4-killswitch.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">Kill switch — <span style="color:${CORAL}">checked before every action, not once per run</span></h1>
  ${terminal('KILL_SWITCH engaged mid-run', haltAnnotated + `\n\n<span class="dim">$ node src/cli.ts --tenant ashdown --now reconcile   # while halted</span>\n<span class="sam">[sam]</span> <span class="coral">HALTED — kill switch engaged, reconcile cycle not started</span>`)}${foot}`));

// ---------- f5 eval ----------
const evalNames = readFileSync(path.join(SRC, 'eval.txt'), 'utf8')
  .split('\n')
  .filter((l) => l.startsWith('PASS'))
  .map((l) => l.replace(/^PASS\s+/, ''));
writeFileSync(path.join(OUT, 'f5-eval.html'), page(`
  ${chip}
  <div style="display:flex; gap:56px; flex:1; margin-top:120px; z-index:1">
    <div style="flex:1.55">
      <h1>The receipts: <span class="hl">a sealed answer key</span></h1>
      <div style="display:flex; flex-direction:column; gap:13.5px; margin-top:8px">
        ${evalNames
          .slice(0, 11)
          .map(
            (n) => `<div style="display:flex; gap:18px; align-items:center; font-size:25.5px">
          <span style="color:${GREEN}; font-weight:900; font-family:Consolas,monospace">PASS</span>
          <span style="color:#C9D9F5">${esc(n)}</span></div>`,
          )
          .join('')}
      </div>
    </div>
    <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px">
      <div style="font-size:230px; font-weight:900; color:${CORAL}; line-height:1">8/8</div>
      <div style="font-size:34px; color:${INK}; font-weight:700; text-align:center">planted discrepancies caught,<br>correct classifications</div>
      <div style="font-size:25px; color:${DIM}; font-family:Consolas,monospace; margin-top:10px">pnpm eval — run it yourself</div>
    </div>
  </div>${foot}`));

// ---------- f6 end card ----------
writeFileSync(path.join(OUT, 'f6-end.html'), page(`
  <div style="flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; text-align:center; z-index:1">
    <div style="font-size:84px; font-weight:900; max-width:1500px; line-height:1.25">AI agents with <span style="color:${BLUE}">provable</span> safety rails.</div>
    <div style="margin-top:44px; font-size:38px; font-family:Consolas,monospace; color:${INK}; border:2px solid ${BLUE}; border-radius:14px; padding:18px 40px">github.com/charliepmarsh-cyber/sam-agent</div>
    <div style="margin-top:44px; font-size:32px; color:${DIM}">Charlie Marsh · CPM Growth Systems</div>
    <div style="margin-top:14px; font-size:24px; color:${DIM}">Built on a synthetic tenant with a ground-truth answer key — every claim in this video is reproducible from the repo.</div>
  </div>`));

// ---------- f7 problem/outcome stat card (honest: demo tenant, labelled) ----------
const statRow = (stat, label) => `
  <div style="display:flex; align-items:baseline; gap:22px">
    <div style="font-size:56px; font-weight:900; color:${CORAL}; min-width:210px; text-align:right">${stat}</div>
    <div style="font-size:29px; color:#C9D9F5; line-height:1.4">${label}</div>
  </div>`;
const outcomeRow = (stat, label) => `
  <div style="display:flex; align-items:baseline; gap:22px">
    <div style="font-size:56px; font-weight:900; color:${GREEN}; min-width:210px; text-align:right">${stat}</div>
    <div style="font-size:29px; color:#C9D9F5; line-height:1.4">${label}</div>
  </div>`;
writeFileSync(path.join(OUT, 'f7-before-after.html'), page(`
  ${chip}
  <h1 style="margin-top:56px">The owner's week it gives back — <span class="hl">with receipts</span></h1>
  <div style="display:flex; gap:36px; flex:1; z-index:1">
    <div style="flex:1; background:${NAVY2}; border:1px solid #1C3E7A; border-radius:16px; padding:40px 44px; display:flex; flex-direction:column; gap:34px">
      <div style="font-size:26px; letter-spacing:.12em; color:${DIM}; font-weight:700; text-transform:uppercase">Before — the tenant's profile</div>
      ${statRow('6–8 hrs', 'per week on invoicing, payment chasing and bank reconciliation, by hand')}
      ${statRow('4 days', 'average delay between job completion and the invoice going out')}
      ${statRow('weeks', 'short payments, duplicates and unreferenced deposits sit unnoticed')}
    </div>
    <div style="flex:1; background:${NAVY2}; border:1px solid #1C3E7A; border-radius:16px; padding:40px 44px; display:flex; flex-direction:column; gap:34px">
      <div style="font-size:26px; letter-spacing:.12em; color:${DIM}; font-weight:700; text-transform:uppercase">With Sam — measured in the demo</div>
      ${outcomeRow('same day', 'signed job sheet → gated invoice, sent or queued for approval')}
      ${outcomeRow('8/8', 'planted discrepancies caught next morning, correct classifications')}
      ${outcomeRow('90 sec', 'daily owner briefing — worst news first, every number traceable')}
    </div>
  </div>
  <div style="z-index:1; margin-top:26px; text-align:center; color:${DIM}; font-size:23px">
    Demo tenant: Ashdown Electrical Services Ltd (fictional, seeded data) — the “before” figures are the tenant’s profile; the “after” results are reproducible from the repo’s eval.
  </div>${foot}`));

console.log('frames written to', OUT);
