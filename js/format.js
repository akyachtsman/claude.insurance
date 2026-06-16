// format.js — display formatting per the design directive.
// Pure functions, no DOM access, so they are unit-testable.

// Percentages: whole numbers only (53%, not 53.2%).
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Math.round(value)}%`;
}

// Large numbers: K/M suffix above 999 (1.2K, 2.4M).
export function formatCount(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const n = Number(value);
  if (Math.abs(n) <= 999) return String(n);
  if (Math.abs(n) < 1_000_000) return `${trim(n / 1000)}K`;
  return `${trim(n / 1_000_000)}M`;
}

// Currency, US dollars, using the same K/M suffix convention for large amounts.
export function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const n = Number(value);
  if (Math.abs(n) <= 999) return `$${n}`;
  if (Math.abs(n) < 1_000_000) return `$${trim(n / 1000)}K`;
  return `$${trim(n / 1_000_000)}M`;
}

// Dates: "Jun 4" format — not "06/04", not "June 4th".
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function formatDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

// One decimal at most, with trailing ".0" stripped (1.2K, not 1.20K; 2K, not 2.0K).
function trim(n) {
  return String(Math.round(n * 10) / 10);
}
