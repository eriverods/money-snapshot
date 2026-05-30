// ─── CYCLE LOGIC INTEGRATION GUIDE ────────────────────────────────────────
// Usage examples for cycleLogic.js functions

import {
  findApprovedPaycheck,
  calculateCycleWindow,
  identifyFixedBillsInWindow,
  calculateVariableAmount,
  suggestEnvelopeAllocations,
  createCycleFromApprovedPaycheck,
} from './cycleLogic'

/**
 * PATTERN 1: Check if an approved paycheck exists (to show auto-create button)
 */
export function hasApprovedPaycheck(transactions, overrides) {
  return findApprovedPaycheck(transactions, overrides) !== null
}

/**
 * PATTERN 2: Manual step-by-step (for UI showing intermediate results)
 */
export function analyzeApprovedPaycheck(transactions, overrides, accounts, templates) {
  const paycheck = findApprovedPaycheck(transactions, overrides)
  if (!paycheck) return null

  const { startDate, endDate } = calculateCycleWindow(paycheck.date)
  const bills = identifyFixedBillsInWindow(transactions, startDate, endDate)
  const totalBills = bills.reduce((sum, b) => sum + b.amount, 0)

  const primaryAcct = accounts.find(a => a.name?.toLowerCase().includes('simplii')) ||
    accounts.find(a => a.type !== 'credit') ||
    accounts[0]
  const startBal = parseFloat(primaryAcct?.balance || 0)
  const income = parseFloat(paycheck.tx.amount) || 0
  const variable = calculateVariableAmount(startBal, income, totalBills)
  const suggestions = suggestEnvelopeAllocations(variable, templates)

  return {
    paycheckDate: paycheck.date,
    paycheckAmount: income,
    cycleStart: startDate,
    cycleEnd: endDate,
    fixedBills: bills,
    totalBills,
    startingBalance: startBal,
    variableAmount: variable,
    envelopeSuggestions: suggestions,
  }
}

/**
 * PATTERN 3: One-shot auto-create (call from a button)
 * Usage:
 *   const result = await autoCreateCycleFromPaycheck(bookId, accounts, transactions, templates, overrides)
 *   if (result.success) {
 *     // Show success toast
 *     // Reload cycles data
 *   } else {
 *     // Show error: result.error
 *   }
 */
export const autoCreateCycleFromPaycheck = createCycleFromApprovedPaycheck

/**
 * PATTERN 4: Add an auto-create button to CyclesTab
 *
 * In CyclesTab, add this check after loading cycles:
 *
 *   const canAutoCreate = hasApprovedPaycheck(transactions, overrides)
 *
 *   Then in the "no cycle" state UI:
 *
 *   {canAutoCreate && (
 *     <button onClick={async () => {
 *       const result = await autoCreateCycleFromPaycheck(
 *         bookId, accounts, transactions, templates, overrides
 *       )
 *       if (result.success) {
 *         // success toast
 *         load() // reload
 *       }
 *     }}>
 *       Auto-create from paycheck
 *     </button>
 *   )}
 */

/**
 * REACT HOOK INTEGRATION
 *
 * Add this to CyclesTab component:
 */
export function useCycleAutoCreate(transactions, overrides, accounts, templates, bookId) {
  const [autoSuggestion, setAutoSuggestion] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const suggestion = analyzeApprovedPaycheck(transactions, overrides, accounts, templates)
    setAutoSuggestion(suggestion)
  }, [transactions, overrides, accounts, templates])

  async function executeAutoCreate() {
    if (!autoSuggestion) return
    setLoading(true)
    const result = await createCycleFromApprovedPaycheck(bookId, accounts, transactions, templates, overrides)
    setLoading(false)
    return result
  }

  return { autoSuggestion, loading, executeAutoCreate }
}

/**
 * SUPABASE FUNCTIONS (PostgreSQL)
 *
 * If you want to move logic to the backend, you could create a DB function:
 *
 * CREATE OR REPLACE FUNCTION create_cycle_from_paycheck(
 *   p_book_id uuid,
 *   p_paycheck_tx_id int,
 *   p_paycheck_date date
 * ) RETURNS TABLE (cycle_id uuid, envelope_count int) AS $$
 * BEGIN
 *   -- Insert cycle
 *   INSERT INTO pay_cycles (...) VALUES (...)
 *   RETURNING id INTO cycle_id;
 *
 *   -- Insert envelopes based on templates scaled to variable amount
 *   INSERT INTO cycle_envelopes (...) SELECT ...;
 *
 *   -- Return results
 *   SELECT cycle_id, COUNT(*) as envelope_count FROM cycle_envelopes
 *     WHERE cycle_id = cycle_id;
 * END;
 * $$ LANGUAGE plpgsql;
 */
