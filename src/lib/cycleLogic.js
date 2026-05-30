import { supabase } from './supabase'

function parseDateLocal(dateStr) {
  return new Date(dateStr + 'T00:00:00')
}

function toDateStr(date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Identify the "main income" transaction (cycle trigger).
 *
 * Main income is any recurring biweekly income (not labeled as gig/variable).
 * If multiple exist, use the one with the earliest start date (most established).
 *
 * This design is future-proof:
 * - Does not hardcode "Esly" or any name
 * - Works if Esly's job changes to a different amount or label
 * - Works if the user gets a new stable job
 * - For complex scenarios (multiple co-earners with separate cycles),
 *   future enhancement: add `is_main_income` boolean to transactions schema
 */
export function findMainIncomeTransaction(transactions) {
  const biweeklyIncomes = transactions.filter(tx =>
    tx.type === 'income' &&
    tx.recurrence === 'biweekly'
  )

  if (biweeklyIncomes.length === 0) return null
  if (biweeklyIncomes.length === 1) return biweeklyIncomes[0]

  // Multiple biweekly incomes: use earliest start date (most established)
  return biweeklyIncomes.reduce((earliest, tx) =>
    tx.date < earliest.date ? tx : earliest
  )
}

/**
 * Detect when main income is marked as 'Approved'.
 *
 * Scans the main income transaction for the most recent approved instance
 * within ±14 days of its regular recurrence schedule.
 */
export function findApprovedMainIncome(transactions, overrides) {
  const mainIncome = findMainIncomeTransaction(transactions)
  if (!mainIncome) return null

  // Scan for most recent 'approved' instance within ±14 days of schedule
  const d = parseDateLocal(mainIncome.date)
  let latestApproved = null

  for (let offset = -14; offset <= 14; offset += 14) {
    const checkDate = new Date(d)
    checkDate.setDate(checkDate.getDate() + offset)
    const checkStr = toDateStr(checkDate)

    const override = overrides.find(
      o => String(o.transaction_id) === String(mainIncome.id) &&
           o.instance_date === checkStr &&
           o.action === 'approved'
    )

    if (override && (!latestApproved || checkStr > latestApproved.date)) {
      latestApproved = { tx: mainIncome, date: checkStr }
    }
  }

  return latestApproved
}

// Alias for backward compatibility
export const findApprovedPaycheck = findApprovedMainIncome

// Calculate 14-day window: paycheck date to day before next expected paycheck
export function calculateCycleWindow(paycheckDate) {
  const start = parseDateLocal(paycheckDate)
  const end = new Date(start)
  end.setDate(end.getDate() + 13)

  return {
    startDate: toDateStr(start),
    endDate: toDateStr(end),
  }
}

// Expand transaction dates in a range (matches App.jsx pattern)
function expandTx(tx, startDate, endDate) {
  const ws = parseDateLocal(startDate)
  const we = parseDateLocal(endDate)
  const txStart = parseDateLocal(tx.date)
  const txEnd = tx.end_date ? parseDateLocal(tx.end_date) : null
  const out = []

  if (!tx.recurrence || tx.recurrence === 'once') {
    if (txStart >= ws && txStart <= we) out.push(tx.date)
    return out
  }

  let cur = new Date(txStart)
  let safety = 0
  while (cur <= we && safety++ < 500) {
    if (txEnd && cur > txEnd) break
    if (cur >= ws) out.push(toDateStr(cur))
    if (tx.recurrence === 'weekly') cur.setDate(cur.getDate() + 7)
    else if (tx.recurrence === 'biweekly') cur.setDate(cur.getDate() + 14)
    else if (tx.recurrence === 'monthly') cur.setMonth(cur.getMonth() + 1)
    else break
  }
  return out
}

// Query fixed bills strictly within 14-day window
export function identifyFixedBillsInWindow(transactions, startDate, endDate) {
  const bills = []
  const seen = new Set()

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue
    const dates = expandTx(tx, startDate, endDate)

    for (const date of dates) {
      const key = `${tx.id}:${date}`
      if (!seen.has(key)) {
        seen.add(key)
        bills.push({
          id: tx.id,
          label: tx.label,
          amount: parseFloat(tx.amount) || 0,
          date,
        })
      }
    }
  }

  return bills.sort((a, b) => a.date.localeCompare(b.date))
}

// Calculate remaining variable amount after fixed bills
export function calculateVariableAmount(startingBalance, incomeAmount, fixedBillsTotal) {
  return startingBalance + incomeAmount - fixedBillsTotal
}

// Auto-suggest envelope allocations proportionally from templates
export function suggestEnvelopeAllocations(variableAmount, templates) {
  if (!templates || templates.length === 0) return []

  const templateTotal = templates.reduce(
    (sum, t) => sum + (parseFloat(t.default_amount) || 0),
    0
  )

  if (templateTotal === 0) return []

  const scale = Math.min(1, variableAmount / templateTotal)

  return templates.map(t => ({
    template_id: t.id,
    name: t.name,
    allocated_amount: Math.round((parseFloat(t.default_amount) * scale) * 100) / 100,
    color: t.color || null,
  }))
}

/**
 * Create a pay cycle from approved main income.
 *
 * Process:
 * 1. Detect approved main income transaction (e.g., Esly's biweekly paycheck)
 * 2. Calculate 14-day cycle window from that income date
 * 3. Query fixed bills within the window
 * 4. Calculate variable amount: starting_balance + main_income - fixed_bills
 * 5. Auto-suggest envelope allocations scaled to variable amount
 * 6. Create pay_cycles and cycle_envelopes records
 *
 * NOTE: Only main income triggers the cycle. Gig income (Mercor, etc.) are
 * manual add-ons routed to Buffer envelope and do NOT affect income_actual.
 */
export async function createCycleFromApprovedPaycheck(bookId, accounts, transactions, templates, overrides) {
  const approvedMainIncome = findApprovedMainIncome(transactions, overrides)
  if (!approvedMainIncome) {
    return { success: false, error: 'No approved main income found. Set up biweekly recurring income first.' }
  }

  const { startDate, endDate } = calculateCycleWindow(approvedMainIncome.date)
  const bills = identifyFixedBillsInWindow(transactions, startDate, endDate)
  const totalBills = bills.reduce((sum, b) => sum + b.amount, 0)

  const primaryAcct = accounts.find(a => a.name?.toLowerCase().includes('simplii')) ||
    accounts.find(a => a.type !== 'credit') ||
    accounts[0]
  const startBal = parseFloat(primaryAcct?.balance || 0)

  // Only count main income; gig income is manual
  const mainIncome = parseFloat(approvedMainIncome.tx.amount) || 0
  const variable = calculateVariableAmount(startBal, mainIncome, totalBills)
  const allocations = suggestEnvelopeAllocations(variable, templates)

  const { data: cycle, error: cycleErr } = await supabase
    .from('pay_cycles')
    .insert({
      book_id: bookId,
      start_date: startDate,
      end_date: endDate,
      starting_balance: startBal,
      income_actual: mainIncome,
    })
    .select()
    .single()

  if (cycleErr || !cycle) {
    return { success: false, error: cycleErr?.message || 'Failed to create cycle' }
  }

  const envRows = allocations
    .filter(a => a.allocated_amount > 0)
    .map(a => ({
      cycle_id: cycle.id,
      template_id: a.template_id,
      name: a.name,
      allocated_amount: a.allocated_amount,
      spent_amount: 0,
      color: a.color,
    }))

  if (envRows.length > 0) {
    await supabase.from('cycle_envelopes').insert(envRows)
  }

  return {
    success: true,
    cycle,
    bills,
    envelopes: envRows,
    variableAmount: variable,
    note: 'Gig income (Mercor, etc.) can be added manually to Buffer envelope during the cycle',
  }
}
