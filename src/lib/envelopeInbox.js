// ─── ENVELOPE INBOX + MERCHANT LEARNING ──────────────────────────────────────
// Pure helpers for the "Needs a home" triage inbox and merchant→envelope hints.

import { sanitizeEnvelopeName } from './envelopeName'

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
//
// The catchall ("Whatever") is never a suggestion: it is always a choice the
// user makes deliberately, never a default destination. Hints pointing at any
// id in opts.excludeIds (the catchall) are ignored here.
export function suggestEnvelopeId(label, hints, opts = {}) {
  const floor = opts.floor ?? 2
  const exclude = new Set((opts.excludeIds || []).map(String))
  const norm = normalizeMerchant(label)
  if (!norm) return null
  let best = null
  for (const h of hints || []) {
    if (h.merchant_normalized !== norm) continue
    if (exclude.has(String(h.envelope_id))) continue
    if ((h.assignment_count || 0) < floor) continue
    if (!best || h.assignment_count > best.assignment_count) best = h
  }
  return best ? best.envelope_id : null
}

// ─── CATCHALL ("WHATEVER") COMPOSTING NUDGE ───────────────────────────────────
// If one normalized merchant lands in the catchall COMPOST_FLOOR+ times, gently
// suggest giving it a real home. At most one suggestion surfaces at a time, and
// a dismissed merchant is never raised again.
export const COMPOST_FLOOR = 3

export function buildCompostingSuggestion(hints, dismissals, catchallId, floor = COMPOST_FLOOR) {
  if (!catchallId) return null
  const dismissed = new Set((dismissals || []).map(d => d.merchant_normalized))
  let best = null
  for (const h of hints || []) {
    if (String(h.envelope_id) !== String(catchallId)) continue
    if ((h.assignment_count || 0) < floor) continue
    if (dismissed.has(h.merchant_normalized)) continue
    if (!h.merchant_normalized) continue
    if (!best || h.assignment_count > best.assignment_count) best = h
  }
  if (!best) return null
  return { merchantNormalized: best.merchant_normalized, count: best.assignment_count }
}

// Title-case a normalized merchant key for friendly display ("tim hortons" → "Tim Hortons").
export function prettyMerchant(norm) {
  if (!norm) return ''
  return String(norm).replace(/\b\w/g, c => c.toUpperCase())
}

// ─── STARTER ENVELOPES ────────────────────────────────────────────────────────
// Offered to brand-new books (and existing books with no real envelopes yet)
// instead of a blank screen. "Whatever" is the catchall and is provisioned
// separately (never part of this editable set). `optional: true` items start
// unchecked. Allocation is asked once, later, and may be skipped entirely.
export const STARTER_ENVELOPES = [
  { key: 'food',    name: 'Food',          emoji: '🍎', color: '#8fb98a' },
  { key: 'home',    name: 'Home',          emoji: '🏠', color: '#7aa2c9' },
  { key: 'getabout',name: 'Getting around',emoji: '🚌', color: '#caa46f' },
  { key: 'fun',     name: 'Fun',           emoji: '🎮', color: '#c98f8f' },
  { key: 'pets',    name: 'Pets',          emoji: '🐾', color: '#6fc9bf', optional: true },
]

// Build the envelope rows for the chosen starter set. `allocated_amount` is
// ALWAYS a number — 0 when amounts are skipped ("decide later") — so the NOT NULL
// allocation column is never handed a null. Only toggled-on, non-empty names are
// included; names are sanitized (any UTF-8 kept, capped by grapheme count).
export function buildStarterRows(items, bookId, withAmounts) {
  return (items || [])
    .filter(it => it.on && sanitizeEnvelopeName(it.name))
    .map((it, i) => ({
      book_id: bookId,
      name: sanitizeEnvelopeName(it.name),
      emoji: it.emoji || null,
      color: it.color || null,
      allocated_amount: withAmounts ? (parseFloat(it.amount) || 0) : 0,
      spent_amount: 0,
      carryover_amount: 0,
      link_type: 'none',
      rollover_mode: 'rollover',
      display_order: i,
    }))
}

// Persist the chosen starter envelopes and guarantee the permanent "Whatever"
// catchall exists for the book. Surfaces any failure instead of pretending to
// succeed: a 0-rows / mismatched-rows result (RLS, schema-cache miss) is treated
// as failure so the UI can offer a calm retry rather than a button that lies.
// Returns { ok: true } or { ok: false, error }.
export async function saveStarterEnvelopes(client, { items, bookId, withAmounts, failMsg }) {
  const rows = buildStarterRows(items, bookId, withAmounts)
  if (rows.length) {
    const { data, error } = await client.from('envelopes').insert(rows).select('id')
    if (error || !data || data.length !== rows.length) {
      return { ok: false, error: error?.message || failMsg || 'Save failed' }
    }
  }
  // A brand-new book gets its catchall from a books-insert trigger, but provision
  // it idempotently here too so first setup never lands without a "Whatever".
  const { error: cErr } = await client.rpc('ensure_catchall_envelope', { p_book_id: bookId })
  if (cErr) return { ok: false, error: cErr.message }
  return { ok: true }
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
