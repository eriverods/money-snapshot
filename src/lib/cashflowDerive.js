// ─── CASHFLOW DERIVATION (shared) ────────────────────────────────────────────
// Pure helpers for projecting recurring transactions and deriving the bills due
// before the next income. Shared by the Now tab and the Envelopes "unallocated"
// card so safe-to-spend math has a single source of truth.

// Local calendar date as YYYY-MM-DD (avoids the UTC off-by-one that
// toISOString() introduces in the evening / non-UTC timezones).
export function toDateStr(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseDateLocal(ds) { return new Date(ds + 'T00:00:00') }

// Every occurrence of a (possibly recurring) transaction within [startDate,endDate].
export function expandTx(tx, startDate, endDate) {
  const ws = parseDateLocal(startDate)
  const we = parseDateLocal(endDate)
  const txStart = parseDateLocal(tx.date)
  const txEnd = tx.end_date ? parseDateLocal(tx.end_date) : null
  const out = []
  if (!tx.recurrence || tx.recurrence === 'once') {
    if (txStart >= ws && txStart <= we) out.push(tx.date)
    return out
  }
  let cur = new Date(txStart), safety = 0
  while (cur <= we && safety++ < 500) {
    if (txEnd && cur > txEnd) break
    if (cur >= ws) out.push(toDateStr(cur))
    if (tx.recurrence === 'weekly')        cur.setDate(cur.getDate() + 7)
    else if (tx.recurrence === 'biweekly') cur.setDate(cur.getDate() + 14)
    else if (tx.recurrence === 'monthly')  cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return out
}

export function getOverride(overrides, txId, instanceDate) {
  return (overrides || []).find(o => String(o.transaction_id) === String(txId) && o.instance_date === instanceDate) || null
}

// The next income occurrence within the lookahead window (or null).
export function nextIncomeDate(transactions, today, lookaheadDays = 14) {
  const end = new Date(parseDateLocal(today)); end.setDate(end.getDate() + lookaheadDays)
  const endStr = toDateStr(end)
  const dates = []
  for (const tx of (transactions || []).filter(t => t.type === 'income')) {
    dates.push(...expandTx(tx, today, endStr))
  }
  dates.sort()
  return dates[0] || null
}

// Bills (expense occurrences) strictly before the next income — the committed
// outflow this cycle. Returns { nextIncomeDate, bills, billsTotal }.
export function billsBeforeNextIncome(transactions, overrides, today, lookaheadDays = 14) {
  const end = new Date(parseDateLocal(today)); end.setDate(end.getDate() + lookaheadDays)
  const endStr = toDateStr(end)
  const nextInc = nextIncomeDate(transactions, today, lookaheadDays)
  const cutoff = nextInc || endStr
  const bills = []
  for (const tx of (transactions || []).filter(t => t.type === 'expense')) {
    for (const d of expandTx(tx, today, cutoff)) {
      if (nextInc && d >= nextInc) continue
      const ov = getOverride(overrides, tx.id, d)
      if (ov?.action === 'skipped') continue
      const amt = ov?.action === 'modified' ? (parseFloat(ov.modified_amount) || 0) : (parseFloat(tx.amount) || 0)
      bills.push({ tx, date: d, amt })
    }
  }
  bills.sort((a, b) => a.date.localeCompare(b.date))
  const billsTotal = bills.reduce((s, i) => s + i.amt, 0)
  return { nextIncomeDate: nextInc, bills, billsTotal }
}
