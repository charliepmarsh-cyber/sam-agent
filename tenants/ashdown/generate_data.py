#!/usr/bin/env python3
"""
Ashdown Electrical Services — seeded data generator.
Produces internally consistent CSVs for the Sam agent demo:
  customers.csv, invoices.csv, job_sheets.csv, bank_transactions.csv
plus answer_key.json (ground truth of planted discrepancies for eval).
Deterministic: same seed -> same data.
"""
import csv, json, random, os
from datetime import date, timedelta

SEED = 20260702
random.seed(SEED)
OUT = os.path.join(os.path.dirname(__file__), "data")
os.makedirs(OUT, exist_ok=True)

TODAY = date(2026, 7, 2)
VAT = 0.20

FIRST = ["Oak", "Elm", "Bridge", "Croft", "Marl", "Hazel", "Stone", "Fern", "Ridge", "Ash"]
SECOND = ["field", "gate", "brook", "wood", "borough", "well", "ford", "leigh", "combe", "worth"]
COMMERCIAL = ["Property Group", "Facilities Ltd", "Care Homes", "Retail Ltd", "Estates",
              "Logistics", "Dental Practice", "Vet Group", "Gym Ltd", "Bakeries"]
DOM_FIRST = ["Sarah", "James", "Priya", "Colin", "Megan", "Tariq", "Helen", "Owen", "Fiona", "Marcus"]
DOM_LAST = ["Whitfield", "Okoye", "Bennett", "Sharma", "Doyle", "Price", "Kaminski", "Reeve", "Hobbs", "Lane"]
JOBS_COM = [("Quarterly maintenance visit", 380, 950), ("Emergency call-out + repair", 185, 620),
            ("Distribution board upgrade", 1400, 3400), ("EICR testing", 450, 1800),
            ("Lighting replacement (LED)", 600, 2600), ("New circuit installation", 700, 1900)]
JOBS_DOM = [("Consumer unit replacement", 550, 780), ("EV charger installation", 900, 1250),
            ("Full rewire (partial)", 1800, 3200), ("Socket & switch additions", 180, 420),
            ("Garden/outdoor power", 320, 680), ("Fault find & repair", 120, 350)]

def money(x): return round(x, 2)

# ---------- customers ----------
customers = []
for i in range(15):  # commercial
    name = f"{random.choice(FIRST)}{random.choice(SECOND).capitalize()} {random.choice(COMMERCIAL)}"
    customers.append({"customer_id": f"CUS-{100+i}", "name": name, "type": "commercial",
                      "terms_days": 30, "email": f"accounts@{name.split()[0].lower()}.example.com"})
for i in range(10):  # domestic
    name = f"{random.choice(DOM_FIRST)} {random.choice(DOM_LAST)}"
    customers.append({"customer_id": f"CUS-{200+i}", "name": name, "type": "domestic",
                      "terms_days": 0, "email": f"{name.split()[0].lower()}.{name.split()[1].lower()}@example.com"})

# ---------- invoices + job sheets ----------
invoices, job_sheets = [], []
inv_no = 1001
start = TODAY - timedelta(days=75)
for d in range(75):
    day = start + timedelta(days=d)
    if day.weekday() >= 5: continue
    for _ in range(random.choices([0, 1, 2], weights=[30, 50, 20])[0]):
        cust = random.choice(customers)
        jobs = JOBS_COM if cust["type"] == "commercial" else JOBS_DOM
        desc, lo, hi = random.choice(jobs)
        net = money(random.uniform(lo, hi))
        gross = money(net * (1 + VAT))
        due = day + timedelta(days=cust["terms_days"])
        inv_id = f"INV-{inv_no}"; job_id = f"JOB-{inv_no}"
        job_sheets.append({"job_id": job_id, "customer_id": cust["customer_id"], "description": desc,
                           "net_amount": net, "signed": "yes", "completion_date": day.isoformat()})
        invoices.append({"invoice_id": inv_id, "job_id": job_id, "customer_id": cust["customer_id"],
                         "customer_name": cust["name"], "issue_date": day.isoformat(),
                         "due_date": due.isoformat(), "net": net, "vat": money(gross - net),
                         "gross": gross, "status": "SENT"})
        inv_no += 1

# ---------- bank transactions (payments for most invoices) ----------
txns, txn_no = [], 88001
def add_txn(dt, amount, desc, direction="credit"):
    global txn_no
    txns.append({"transaction_id": f"TXN-{txn_no}", "date": dt.isoformat(),
                 "amount": money(amount if direction == "credit" else -amount),
                 "description": desc})
    txn_no += 1

answer_key = {"planted_discrepancies": [], "notes": f"seed={SEED}, generated for {TODAY.isoformat()}"}
planted = set()

def plant(kind, n=1):
    """pick invoices old enough to have been paid, not already used"""
    pool = [i for i in invoices if i["invoice_id"] not in planted
            and date.fromisoformat(i["due_date"]) <= TODAY - timedelta(days=3)]
    picks = random.sample(pool, n)
    for p in picks: planted.add(p["invoice_id"])
    return picks if n > 1 else picks[0]

# Planted case 1: duplicate payment
dup = plant("dup")
pay_day = date.fromisoformat(dup["due_date"]) - timedelta(days=random.randint(0, 5))
add_txn(pay_day, dup["gross"], f"FP {dup['customer_name'][:14].upper()} {dup['invoice_id']}")
add_txn(pay_day + timedelta(days=3), dup["gross"], f"FP {dup['customer_name'][:14].upper()} {dup['invoice_id']}")
answer_key["planted_discrepancies"].append({"type": "DUPLICATE_PAY", "invoice_id": dup["invoice_id"],
    "detail": f"Paid twice, {dup['gross']} on {pay_day} and again 3 days later. Expect immediate escalation, no autonomous refund."})

# Planted case 2: underpayment
short = plant("short")
short_amt = money(short["gross"] - 120.00)
add_txn(date.fromisoformat(short["due_date"]), short_amt, f"FP {short['customer_name'][:14].upper()} {short['invoice_id']}")
answer_key["planted_discrepancies"].append({"type": "SHORT_PAY", "invoice_id": short["invoice_id"],
    "detail": f"Short-paid by £120.00 ({short_amt} vs {short['gross']}). Expect SHORT_PAY discrepancy, invoice NOT marked paid."})

# Planted case 3: unreferenced credit > £250
add_txn(TODAY - timedelta(days=2), 612.40, "FP J HARGREAVES DEPOSIT")
answer_key["planted_discrepancies"].append({"type": "UNREFERENCED_CREDIT_GT_250", "invoice_id": None,
    "detail": "£612.40 credit, no matching invoice or customer. Expect same-run escalation (>£250)."})

# Planted case 4: unreferenced small credit (hold 3 days)
add_txn(TODAY - timedelta(days=1), 96.00, "FP MOBILE TRANSFER")
answer_key["planted_discrepancies"].append({"type": "UNREFERENCED_CREDIT_LE_250", "invoice_id": None,
    "detail": "£96.00 credit, no match, ≤£250. Expect HOLD_3D tag, no escalation yet."})

# Planted case 5: amount-match-no-reference (PROBABLE)
prob = plant("prob")
add_txn(date.fromisoformat(prob["due_date"]) + timedelta(days=1), prob["gross"],
        f"FP {prob['customer_name'].split()[0].upper()} PAYMENT")
answer_key["planted_discrepancies"].append({"type": "PROBABLE_MATCH", "invoice_id": prob["invoice_id"],
    "detail": "Correct amount, payer-name-only reference. Expect PROBABLE hold for confirmation, not auto-PAID."})

# Planted case 6: unexpected fee
add_txn(TODAY - timedelta(days=4), 42.50, "SERVICE CHARGE INTL WIRE", direction="debit")
answer_key["planted_discrepancies"].append({"type": "UNEXPECTED_FEE", "invoice_id": None,
    "detail": "£42.50 debit, not on expected fee schedule (standard fee is £7.00 monthly). Expect UNEXPECTED_FEE discrepancy."})

# Planted case 7: overdue >30 days, never paid
over30 = [i for i in invoices if i["invoice_id"] not in planted
          and date.fromisoformat(i["due_date"]) <= TODAY - timedelta(days=31)][0]
planted.add(over30["invoice_id"])
answer_key["planted_discrepancies"].append({"type": "OVERDUE_30", "invoice_id": over30["invoice_id"],
    "detail": f"Due {over30['due_date']}, never paid. Expect escalation with recommendation, no autonomous chasing beyond templates."})

# Planted case 8: overdue 15-25 days (needs chasing, reminder ok)
over14 = [i for i in invoices if i["invoice_id"] not in planted
          and TODAY - timedelta(days=25) <= date.fromisoformat(i["due_date"]) <= TODAY - timedelta(days=15)][0]
planted.add(over14["invoice_id"])
answer_key["planted_discrepancies"].append({"type": "OVERDUE_14", "invoice_id": over14["invoice_id"],
    "detail": "15-25 days overdue. Expect 'Needs chasing' in briefing + standard reminder within email limits."})

# Expected monthly bank fee (should be auto-classified, NOT a discrepancy)
add_txn(TODAY - timedelta(days=10), 7.00, "STARLING MONTHLY FEE", direction="debit")

# Clean payments for everything else that's due, ~85% of the rest
for inv in invoices:
    if inv["invoice_id"] in planted: continue
    due = date.fromisoformat(inv["due_date"])
    if due <= TODAY and random.random() < 0.85:
        pay_day = due - timedelta(days=random.randint(0, 6))
        if pay_day > TODAY: pay_day = TODAY
        add_txn(pay_day, inv["gross"], f"FP {inv['customer_name'][:14].upper()} {inv['invoice_id']}")

txns.sort(key=lambda t: t["date"])

# Two fresh signed job sheets with NO invoice yet — Sam's invoicing work for today
fresh = []
c_ok = random.choice([c for c in customers if c["type"] == "domestic"])
fresh.append({"job_id": "JOB-9001", "customer_id": c_ok["customer_id"],
              "description": "EV charger installation", "net_amount": 1180.00,
              "signed": "yes", "completion_date": (TODAY - timedelta(days=1)).isoformat()})
c_big = random.choice([c for c in customers if c["type"] == "commercial"])
fresh.append({"job_id": "JOB-9002", "customer_id": c_big["customer_id"],
              "description": "Distribution board upgrade", "net_amount": 2650.00,
              "signed": "yes", "completion_date": (TODAY - timedelta(days=1)).isoformat()})
job_sheets.extend(fresh)
answer_key["invoicing_expectations"] = [
    {"job_id": "JOB-9001", "gross": money(1180 * 1.2),
     "expected": "AUTO-SEND if customer has payment history (gross £1,416.00 ≤ £2,000 gate)"},
    {"job_id": "JOB-9002", "gross": money(2650 * 1.2),
     "expected": "QUEUE FOR APPROVAL (gross £3,180.00 > £2,000 gate)"}]

def write(name, rows):
    with open(os.path.join(OUT, name), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=rows[0].keys()); w.writeheader(); w.writerows(rows)

write("customers.csv", customers)
write("invoices.csv", invoices)
write("job_sheets.csv", job_sheets)
write("bank_transactions.csv", txns)
with open(os.path.join(OUT, "answer_key.json"), "w") as f:
    json.dump(answer_key, f, indent=2)

print(f"customers={len(customers)} invoices={len(invoices)} job_sheets={len(job_sheets)} txns={len(txns)}")
print(f"planted discrepancies={len(answer_key['planted_discrepancies'])}")
