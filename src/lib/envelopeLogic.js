// ─── ENVELOPE LOGIC ──────────────────────────────────────────────────────────
// Pure helpers for the Envelopes tab: period-window math, period close-out
// (rollover / move-to-savings / reset), and behaviour-learning suggestions.

export function todayStr() {
  const d = new Date()
  return d.toISOString().slice(0, 10)
}

export function parseDateLocal(dateStr) {
  return new Date(dateStr + 'T00:00:00')
}

export function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

export function addDays(dateStr, n) {
  const d = parseDateLocal(dateStr)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

// Given a period kind and its start date, return the inclusive end date.
export function periodEndFor(period, startStr) {
  const d = parseDateLocal(startStr)
  if (period === 'weekly') d.setDate(d.getDate() + 6)
  else if (period === 'biweekly') d.setDate(d.getDate() + 13)
  else if (period === 'monthly') { d.setMonth(d.getMonth() + 1); d.setDate(d.getDate() - 1) }
  else d.setDate(d.getDate() + 13) // sensible default
  return toDateStr(d)
}

// The next period window that immediately follows the given one.
export function nextWindow(period, prevEndStr) {
  const start = addDays(prevEndStr, 1)
  return { start, end: periodEndFor(period, start) }
}

// Is this envelope's current period over (today is past period_end)?
export function isPeriodOver(env, today = todayStr()) {
  if (env.link_type === 'none') return false
  if (!env.period_end) return false
  return today > env.period_end
}

// Days remaining in the current period (>= 0).
export function daysLeftIn(env, today = todayStr()) {
  if (!env.period_end) return null
  const end = parseDateLocal(env.period_end)
  const now = parseDateLocal(today)
  return Math.max(0, Math.round((end - now) / 86400000) + 1)
}

// Total available this period = base allocation + anything carried over.
export function availableFor(env) {
  return (parseFloat(env.allocated_amount) || 0) + (parseFloat(env.carryover_amount) || 0)
}

// Spent this period, derived from assigned expense transactions. For time/cycle
// envelopes only transactions inside the current window count, so spend resets
// naturally when the window rolls forward. Falls back to the legacy manual
// `spent_amount` for envelopes that have no assigned transactions yet (so
// pre-existing envelopes keep working until they're wired to real spending).
export function computeEnvelopeSpent(env, transactions, today = todayStr()) {
  const assigned = (transactions || []).filter(
    t => String(t.envelope_id) === String(env.id) && t.type === 'expense'
  )
  if (!assigned.length) return parseFloat(env.spent_amount) || 0
  let total = 0
  for (const t of assigned) {
    const d = t.date
    if (!d || d > today) continue // don't count the future
    if (env.link_type !== 'none') {
      if (env.period_start && d < env.period_start) continue
      if (env.period_end && d > env.period_end) continue
    }
    total += parseFloat(t.amount) || 0
  }
  return total
}

export function spentFor(env) {
  return parseFloat(env.spent_amount) || 0
}

// ─── CATCHALL ("WHATEVER") ────────────────────────────────────────────────────
export function isCatchall(env) {
  return !!(env && env.is_catchall)
}

// Real (allocatable) envelopes — everything except the catchall.
export function realEnvelopes(envelopes) {
  return (envelopes || []).filter(e => !isCatchall(e))
}

// Remaining money "reserved" by an envelope, for the unallocated calculation.
// The catchall reserves nothing (no allocation ever). A real envelope reserves
// what's left of its allocation; overspend doesn't claw money back (floor at 0).
export function envelopeReserved(env, spent) {
  if (isCatchall(env)) return 0
  return Math.max(0, availableFor(env) - spent)
}

// Money flowed THROUGH an envelope this cycle (neutral catchall framing). For
// the catchall (link_type 'none', no window) we scope to the cycle window when
// one is given, else all assigned expenses.
export function flowThrough(env, transactions, cycleWindow, today = todayStr()) {
  let total = 0
  for (const t of transactions || []) {
    if (String(t.envelope_id) !== String(env.id)) continue
    if (t.type !== 'expense') continue
    const d = t.date
    if (!d || d > today) continue
    if (cycleWindow && cycleWindow.start && d < cycleWindow.start) continue
    if (cycleWindow && cycleWindow.end && d > cycleWindow.end) continue
    total += parseFloat(t.amount) || 0
  }
  return total
}

// ─── UNALLOCATED ("money not yet given a job") ────────────────────────────────
// unallocated = sum(account balances) − sum(envelope remaining) − upcoming bills.
// Safe-to-spend derives from envelope remainders, not raw bank balance, so money
// already promised to an envelope isn't double-counted as spendable.
export function computeUnallocated({ totalCash = 0, envelopes = [], spentByEnv = {}, billsTotal = 0 }) {
  let reserved = 0
  for (const env of envelopes) {
    if (isCatchall(env)) continue
    const spent = spentByEnv[env.id] ?? 0
    reserved += envelopeReserved(env, spent)
  }
  return (parseFloat(totalCash) || 0) - reserved - (parseFloat(billsTotal) || 0)
}

export function leftoverFor(env, spent) {
  const s = spent != null ? spent : (parseFloat(env.spent_amount) || 0)
  return availableFor(env) - s
}

// Compute the patch + history row for closing out one ended period and opening
// the next. `nextStart`/`nextEnd` let cycle-linked envelopes adopt a fresh
// cycle window; time-based envelopes roll their own window forward.
export function computeCloseOut(env, opts = {}) {
  const spent = opts.spent != null ? opts.spent : (parseFloat(env.spent_amount) || 0)
  const leftover = availableFor(env) - spent
  const base = parseFloat(env.allocated_amount) || 0

  let nextStart = opts.nextStart || null
  let nextEnd = opts.nextEnd || null
  if (!nextStart && env.link_type === 'time' && env.period && env.period_end) {
    const w = nextWindow(env.period, env.period_end)
    nextStart = w.start
    nextEnd = w.end
  }

  // Carryover only when rolling over and there's money left.
  const carryover = env.rollover_mode === 'rollover' ? Math.max(0, leftover) : 0
  // Move-to-savings only when there's a positive leftover and a goal target.
  const toSavings = env.rollover_mode === 'savings' && leftover > 0 && env.rollover_goal_id
    ? leftover : 0

  const history = {
    envelope_id: env.id,
    book_id: env.book_id,
    name: env.name,
    period_start: env.period_start,
    period_end: env.period_end,
    allocated_amount: availableFor(env),
    spent_amount: spent,
    leftover,
    rollover_mode: env.rollover_mode,
  }

  const patch = {
    spent_amount: 0,
    carryover_amount: carryover,
    period_start: nextStart,
    period_end: nextEnd,
  }

  return { patch, history, toSavings, leftover, base }
}

// ─── BEHAVIOUR LEARNING ──────────────────────────────────────────────────────
// Suggestions are derived from closed-period history + the live envelope state.
// Each suggestion: { id, kind, envelopeId?, title, body, action? }

const SAMPLE_MIN = 2 // need at least this many closed periods to trust a trend

function avg(nums) {
  if (!nums.length) return 0
  return nums.reduce((s, n) => s + n, 0) / nums.length
}

// Suggest allocation tweaks when an envelope consistently under/over-spends.
export function buildEnvelopeSuggestions(envelopes, history) {
  const out = []
  const byEnv = {}
  for (const h of history) {
    (byEnv[h.envelope_id] = byEnv[h.envelope_id] || []).push(h)
  }

  for (const env of envelopes) {
    if (env.archived) continue
    const rows = (byEnv[env.id] || []).slice(-6) // last 6 periods
    if (rows.length < SAMPLE_MIN) continue

    const spends = rows.map(r => parseFloat(r.spent_amount) || 0)
    const base = parseFloat(env.allocated_amount) || 0
    if (base <= 0) continue
    const avgSpend = avg(spends)
    const ratio = avgSpend / base

    if (ratio <= 0.7) {
      const suggested = Math.max(0, Math.round(avgSpend / 5) * 5)
      out.push({
        id: `lower-${env.id}`,
        kind: 'lower',
        envelopeId: env.id,
        suggestedAmount: suggested,
        avgSpend,
        periods: rows.length,
      })
    } else if (ratio >= 1.1) {
      const suggested = Math.ceil(avgSpend / 5) * 5
      out.push({
        id: `raise-${env.id}`,
        kind: 'raise',
        envelopeId: env.id,
        suggestedAmount: suggested,
        avgSpend,
        periods: rows.length,
      })
    }
  }
  return out
}

// Detect cycle-related nudges:
//   • a new pay cycle covers today that 'time'/'none' envelopes could link to
//   • cycle-linked envelopes whose linked cycle has ended and a newer one exists
export function buildCycleSuggestions(envelopes, cycles, today = todayStr()) {
  const out = []
  const active = envelopes.filter(e => !e.archived)
  if (!active.length) return out

  const currentCycle = (cycles || []).find(c => today >= c.start_date && today <= c.end_date)

  // A new cycle is active and some envelopes aren't riding it yet.
  if (currentCycle) {
    const unlinked = active.filter(e => e.link_type !== 'cycle')
    const stale = active.filter(e => e.link_type === 'cycle' && e.cycle_id !== currentCycle.id)
    if (unlinked.length || stale.length) {
      out.push({
        id: `cycle-started-${currentCycle.id}`,
        kind: 'cycle_started',
        cycleId: currentCycle.id,
        cycle: currentCycle,
        unlinkedCount: unlinked.length,
        staleCount: stale.length,
      })
    }
  } else if (active.some(e => e.link_type === 'time' || e.link_type === 'none')) {
    // No active cycle but the user clearly budgets in periods → suggest creating one.
    out.push({ id: 'create-cycle', kind: 'create_cycle' })
  }

  return out
}
