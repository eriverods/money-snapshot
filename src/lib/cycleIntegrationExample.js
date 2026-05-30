// ─── COMPLETE CYCLETAB INTEGRATION EXAMPLE ────────────────────────────────
// Copy this into CyclesTab.jsx to enable auto-create from approved paycheck

import {
  findApprovedPaycheck,
  identifyFixedBillsInWindow,
  calculateCycleWindow,
  calculateVariableAmount,
  suggestEnvelopeAllocations,
  createCycleFromApprovedPaycheck,
} from './lib/cycleLogic'

/**
 * ADD THIS HOOK AT TOP OF CyclesTab COMPONENT
 *
 * const { autoPaycheck, autoSuggestion } = useCycleAutoCreate(transactions, overrides, accounts, templates)
 */
function useCycleAutoCreate(transactions, overrides, accounts, templates) {
  const [autoPaycheck, setAutoPaycheck] = useState(null)
  const [autoSuggestion, setAutoSuggestion] = useState(null)

  useEffect(() => {
    const paycheck = findApprovedPaycheck(transactions, overrides)
    setAutoPaycheck(paycheck)

    if (paycheck) {
      const { startDate, endDate } = calculateCycleWindow(paycheck.date)
      const bills = identifyFixedBillsInWindow(transactions, startDate, endDate)
      const totalBills = bills.reduce((sum, b) => sum + b.amount, 0)

      const primaryAcct = accounts.find(a => a.name?.toLowerCase().includes('simplii')) ||
        accounts.find(a => a.type !== 'credit') ||
        accounts[0]
      const startBal = parseFloat(primaryAcct?.balance || 0)
      const income = parseFloat(paycheck.tx.amount) || 0
      const variable = calculateVariableAmount(startBal, income, totalBills)

      setAutoSuggestion({
        cycleStart: startDate,
        cycleEnd: endDate,
        bills,
        totalBills,
        startBal,
        income,
        variable,
        envelopeSuggestions: suggestEnvelopeAllocations(variable, templates),
      })
    }
  }, [transactions, overrides, accounts, templates])

  return { autoPaycheck, autoSuggestion }
}

/**
 * REPLACE THE "No active pay cycle" SECTION WITH THIS:
 */
function NoCycleState({ autoSuggestion, bookId, accounts, transactions, templates, overrides, onLoad }) {
  const [creating, setCreating] = useState(false)

  async function handleAutoCreate() {
    setCreating(true)
    const result = await createCycleFromApprovedPaycheck(
      bookId, accounts, transactions, templates, overrides
    )
    setCreating(false)

    if (result.success) {
      // Show success message and reload
      onLoad()
    } else {
      // Show error toast
      alert(`Failed to create cycle: ${result.error}`)
    }
  }

  return (
    <div style={{ textAlign: 'center', padding: '48px 0' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>⊙</div>
      <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>No active pay cycle</div>

      {autoSuggestion ? (
        <>
          <div style={{ fontSize: 13, color: C.green, marginBottom: 24, lineHeight: 1.6 }}>
            ✓ Approved paycheck found ({new Date(autoSuggestion.cycleStart).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })})
            <br />
            <span style={{ fontSize: 11, color: C.textLow }}>
              Variable available: <strong>{fmt(autoSuggestion.variable)}</strong>
            </span>
          </div>
          <button
            style={{ ...S.btn(C.green), marginBottom: 16 }}
            onClick={handleAutoCreate}
            disabled={creating}
          >
            {creating ? 'Creating…' : 'Auto-create cycle from paycheck'}
          </button>
          <div style={{ fontSize: 11, color: C.textLow, marginBottom: 16 }}>or</div>
        </>
      ) : (
        <div style={{ fontSize: 13, color: C.textLow, marginBottom: 24, lineHeight: 1.5 }}>
          Set up your first cycle to start tracking envelopes and safe-to-spend
        </div>
      )}

      <button style={{ ...S.btn(C.purple), marginBottom: 16 }} onClick={() => setShowCreate(true)}>
        Start new cycle (manual)
      </button>

      <div>
        <button
          style={{ fontSize: 12, color: C.textLow, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit' }}
          onClick={() => setShowTemplates(true)}
        >
          Manage envelope templates first
        </button>
      </div>
    </div>
  )
}

/**
 * IN THE MAIN COMPONENT RETURN, UPDATE:
 *
 *   Before:
 *     {!cycle ? (
 *       <div style={{ textAlign: 'center', padding: '48px 0' }}>
 *         <div style={{ fontSize: 36, marginBottom: 12 }}>⊙</div>
 *         ...
 *       </div>
 *     ) : (
 *
 *   After:
 *     {!cycle ? (
 *       <NoCycleState
 *         autoSuggestion={autoSuggestion}
 *         bookId={bookId}
 *         accounts={accounts}
 *         transactions={transactions}
 *         templates={templates}
 *         overrides={overrides}
 *         onLoad={load}
 *       />
 *     ) : (
 */

/**
 * OPTIONAL: ADD ANALYSIS DISPLAY IN ACTIVE CYCLE
 *
 * To show what bills are coming next, add this in the active cycle section:
 */
function CycleAnalysisCard({ cycle, transactions }) {
  const analysisData = useMemo(() => {
    const bills = identifyFixedBillsInWindow(transactions, cycle.start_date, cycle.end_date)
    const groups = {}
    bills.forEach(b => {
      if (!groups[b.label]) groups[b.label] = 0
      groups[b.label] += b.amount
    })
    return { bills, groups }
  }, [cycle, transactions])

  return (
    <div style={S.card}>
      <div style={{ fontSize: 12, fontWeight: 700, color: C.textLow, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
        Fixed bills this cycle
      </div>
      {Object.entries(analysisData.groups).map(([label, total]) => (
        <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: `1px solid ${C.border}` }}>
          <span>{label}</span>
          <span style={{ fontWeight: 700, color: C.red }}>−{fmt(total)}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * QUICK START:
 *
 * 1. Import cycleLogic functions:
 *    import { findApprovedPaycheck, ... } from './lib/cycleLogic'
 *
 * 2. Add the hook to detect auto-create:
 *    const { autoPaycheck, autoSuggestion } = useCycleAutoCreate(transactions, overrides, accounts, templates)
 *
 * 3. Replace the no-cycle UI with NoCycleState component
 *
 * 4. User approves a paycheck in Agenda tab
 *
 * 5. Auto-create button appears in Cycles tab with suggested allocation
 *
 * 6. One click creates the full cycle with auto-scaled envelopes
 */
