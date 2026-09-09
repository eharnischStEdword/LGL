// Topping the exported report up with gifts from the API, and the one thing
// that has to be right about it: a Sunday basket is ninety-odd envelopes and
// plenty of them are for the same amount.
//
// The merge deduped on date|amount|fund through a Set, so the SECOND $20.00
// gift dated to a Sunday looked like a copy of the first and was dropped, and
// so was the third. On 2026-09-04 the v2 page showed the 30 August basket as
// $3,512.00 across 21 gifts while LGL's own exit answered $8,169.50 across 97,
// and the survivors averaged $167 against a real $84 a gift, which is what is
// left when the repeated small amounts collapse and the unique large ones do
// not. It was badged Complete, because the badge reads the live API and the
// figures beside it came through here.
//
// The key still cannot identify a gift: the report carries no gift id, only
// date, amount and fund. So the report is counted rather than merely seen, and
// each API gift consumes one of its own key. A gift the report already holds
// stays out exactly once; every other one comes through. Where keys are unique
// this is the old behaviour, gift for gift.

// Normalize any date value to YYYY-MM-DD for consistent dedup
export function normalizeDateForDedup(val) {
  if (!val) return "";
  // Excel serial number (e.g. 46093)
  const num = typeof val === "number" ? val : parseFloat(val);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    const d = new Date(1899, 11, 30 + Math.round(num));
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  // Try parsing as date string
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(val).trim();
}

// Build a dedup key from a row
export function deduplicateKey(row, dateCol, amountCol, fundCol) {
  const dateStr = normalizeDateForDedup(row[dateCol]);
  const amount = parseFloat(String(row[amountCol] || "0").replace(/[$,]/g, "")) || 0;
  const fund = String(row[fundCol] || "").trim().toLowerCase();
  return `${dateStr}|${amount.toFixed(2)}|${fund}`;
}

// Convert an LGL API gift object to a row matching the spreadsheet columns
export function apiGiftToRow(gift, dateCol, amountCol, fundCol, paymentCol) {
  const row = {};
  row[dateCol] = gift.received_date || "";
  row[amountCol] = gift.received_amount || 0;
  row[fundCol] = gift.fund_name || "";
  // Carried when the report has the column, so a topped-up gift splits into
  // basket, mail or online on v2 like the rows around it. v1 ignores it.
  if (paymentCol) row[paymentCol] = gift.payment_type_name || (gift.payment_type && gift.payment_type.name) || "";
  return row;
}

// The report's rows, plus every API gift the report does not already hold.
// `rows` is mutated in place, as the caller's own code did.
export function mergeApiGifts(rows, apiGifts, cols) {
  const { dateCol, amountCol, fundCol, paymentCol } = cols;
  const held = new Map();
  for (const row of rows) {
    const key = deduplicateKey(row, dateCol, amountCol, fundCol);
    held.set(key, (held.get(key) || 0) + 1);
  }
  let added = 0;
  for (const gift of apiGifts) {
    const newRow = apiGiftToRow(gift, dateCol, amountCol, fundCol, paymentCol);
    const key = deduplicateKey(newRow, dateCol, amountCol, fundCol);
    const copies = held.get(key) || 0;
    // One of the report's own, so this gift is that row rather than a new one.
    if (copies > 0) {
      held.set(key, copies - 1);
      continue;
    }
    rows.push(newRow);
    added++;
  }
  return added;
}
