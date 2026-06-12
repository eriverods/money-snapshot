// ─── ENVELOPE INBOX + MERCHANT LEARNING ──────────────────────────────────────
// Pure helpers for the "Needs a home" triage inbox and merchant→envelope hints.

// Normalize a transaction label into a stable merchant key:
// lowercase, strip store numbers / locations / punctuation, collapse whitespace.
export function normalizeMerchant(label) {
  if (!label) return ''
  return String(label)
    .toLowerCase()
    .replace(/#\s*\d+/g, ' ')        // "#1234" store numbers
    .replace(/\bstore\s*\d+\b/g, ' ')
    .replace(/\b\d{2,}\b/g, ' ')      // long standalone numbers (store/location ids)
    .replace(/[^a-z0-9\s]/g, ' ')     // punctuation / symbols
    .replace(/\s+/g, ' ')
    .trim()
}

// Suggest the best envelope for a label given the learned hints.
// Returns an envelope_id only when confidence is sufficient (count >= floor).
// Wrong suggestions are worse than none, so below the floor we return null.
export function suggestEnvelopeId(label, hints, floor = 2) {
  const norm = normalizeMerchant(label)
  if (!norm) return null
  let best = null
  for (const h of hints || []) {
    if (h.merchant_normalized !== norm) continue
    if ((h.assignment_count || 0) < floor) continue
    if (!best || h.assignment_count > best.assignment_count) best = h
  }
  return best ? best.envelope_id : null
}

// Which transactions belong in the inbox: real spending that hasn't been
// assigned to an envelope yet. We never surface future, income, or transfer
// rows — only money that's already gone out and needs a home.
export function inboxTransactions(transactions, today, lookbackDays = 90) {
  const cutoff = new Date(today + 'T00:00:00')
  cutoff.setDate(cutoff.getDate() - lookbackDays)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  return (transactions || [])
    .filter(t =>
      t.type === 'expense' &&
      !t.envelope_id &&
      t.date && t.date <= today && t.date >= cutoffStr
    )
    .sort((a, b) => b.date.localeCompare(a.date))
}

// Friendly relative-time label for a YYYY-MM-DD date string.
export function relativeDay(dateStr, today, t) {
  if (!dateStr) return ''
  const a = new Date(today + 'T00:00:00')
  const b = new Date(dateStr + 'T00:00:00')
  const days = Math.round((a - b) / 86400000)
  if (days <= 0) return t ? t('env.inbox.today') : 'today'
  if (days === 1) return t ? t('env.inbox.yesterday') : 'yesterday'
  if (days < 7) return t ? t('env.inbox.days_ago', { n: days }) : `${days}d ago`
  if (days < 14) return t ? t('env.inbox.last_week') : 'last week'
  const weeks = Math.round(days / 7)
  return t ? t('env.inbox.weeks_ago', { n: weeks }) : `${weeks}w ago`
}
