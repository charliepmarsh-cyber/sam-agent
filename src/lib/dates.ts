/** Date helpers over ISO YYYY-MM-DD strings (the only date format in the data). */

export function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isBusinessDay(iso: string): boolean {
  const day = toDate(iso).getUTCDay();
  return day !== 0 && day !== 6;
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addBusinessDays(iso: string, businessDays: number): string {
  let current = iso;
  let remaining = businessDays;
  while (remaining > 0) {
    current = addDays(current, 1);
    if (isBusinessDay(current)) remaining--;
  }
  return current;
}

/** Whole business days strictly between two dates (order-insensitive). */
export function businessDaysBetween(a: string, b: string): number {
  let [from, to] = a <= b ? [a, b] : [b, a];
  let count = 0;
  while (from < to) {
    from = addDays(from, 1);
    if (from <= to && isBusinessDay(from)) count++;
  }
  return count;
}

/** Calendar days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000);
}
