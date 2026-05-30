# Cycle Logic Review: Main Income Design

## Executive Summary

The code now identifies "main income" by **transaction properties** (biweekly recurrence, earliest start date) instead of hardcoded labels. This allows:

✓ Future job changes to work automatically
✓ Multiple income sources to coexist (first wins as cycle trigger)
✓ No hardcoding of "Esly", "Mercor", or any names
✓ Clean separation: main income triggers cycles, gig income is manual

---

## 1. Identifying "Main Income" (Previously: "Esly's Paycheck")

### Before (Hardcoded):
```javascript
const paycheck = transactions.find(tx =>
  tx.type === 'income' &&
  tx.recurrence === 'biweekly' &&
  tx.label.toLowerCase().includes('paycheck')  // ← Fragile: depends on label
)
```

**Issues:**
- ❌ Assumes label contains "paycheck"
- ❌ If Esly changes jobs, the new paycheck might have a different label
- ❌ Doesn't distinguish between main income and other potential biweekly sources
- ❌ If there are 2 biweekly incomes (Esly + spouse), picks first alphabetically

### After (Property-Based):
```javascript
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
```

**Benefits:**
- ✓ Identifies ANY biweekly recurring income, regardless of label
- ✓ If job changes → new transaction has `recurrence: 'biweekly'` and is picked up
- ✓ If multiple biweekly sources exist → uses earliest (Esly's original paycheck)
- ✓ Future enhancement: add `is_main_income` flag to schema for explicit control

**Future-Proofing:**
If you want to upgrade this later to support multiple main incomes or explicit designation:

```javascript
// Option A: Use schema flag (recommended long-term)
const mainIncomes = transactions.filter(tx =>
  tx.type === 'income' &&
  tx.is_main_income === true  // ← Would require DB schema change
)

// Option B: Accept a parameter
function findMainIncomeTransaction(transactions, preferredLabel) {
  // Allow caller to specify which income to treat as main
}
```

---

## 2. Calculating the 14-Day Window

### Code (Unchanged ✓):
```javascript
export function calculateCycleWindow(paycheckDate) {
  const start = parseDateLocal(paycheckDate)
  const end = new Date(start)
  end.setDate(end.getDate() + 13)  // day 0 through day 13 = 14 days total

  return {
    startDate: toDateStr(start),
    endDate: toDateStr(end),
  }
}
```

**Exact behavior:**
- Input: `"2026-05-30"` (a Friday)
- Output: `{ startDate: "2026-05-30", endDate: "2026-06-12" }`
- This is Friday → next Thursday (14 days)
- Next biweekly paycheck would be 2026-06-13

**Verification:**
```javascript
// If main income is every biweekly Friday:
const window1 = calculateCycleWindow('2026-05-30')  // Fri May 30
// → May 30 to Jun 12 (14 days)

const window2 = calculateCycleWindow('2026-06-13')  // Fri Jun 13
// → Jun 13 to Jun 26 (14 days)

// No overlap: window1.endDate < window2.startDate ✓
```

---

## 3. Handling Mercor Income During Auto-Create

### The Challenge

You have two income sources:
1. **Esly's paycheck**: biweekly, $2,000, consistent, triggers cycles
2. **Mercor income**: variable, $0–$500, gig work, manual add-ons

If both arrive during the same 14-day window, what happens?

### How the Code Currently Handles It

In `createCycleFromApprovedPaycheck()`:

```javascript
// Only main income is counted for cycle
const mainIncome = parseFloat(approvedMainIncome.tx.amount) || 0
const variable = calculateVariableAmount(startBal, mainIncome, totalBills)

// Mercor income (if it's a different transaction) is NOT included here:
// - Does NOT get added to income_actual
// - Does NOT affect envelope allocations
// - Can be manually added to Buffer envelope later
```

**Example Scenario:**

```
Main income (biweekly): $2,000 ✓ Counts
Fixed bills in 14 days: $800
Starting balance: $500

Variable = $500 + $2,000 - $800 = $1,700

Envelopes are allocated from $1,700

---

Mercor income arrives (later): $300 ✗ NOT counted in cycle math
User manually adds to Buffer envelope during the cycle
Buffer envelope: $300 available bonus
```

### Code Proof

Look at the cycle creation:

```javascript
const { data: cycle, error: cycleErr } = await supabase
  .from('pay_cycles')
  .insert({
    book_id: bookId,
    start_date: startDate,
    end_date: endDate,
    starting_balance: startBal,
    income_actual: mainIncome,  // ← ONLY main income
    // NO field for "gig_income_bonus" or similar
  })
```

The database record stores ONLY the main income. Mercor is handled as a separate transaction that gets manually routed to an envelope.

### Why This Design?

1. **Predictability**: The cycle is always based on stable, predictable income
2. **No false positives**: Gig income varies; you don't want a low-Mercor month to break your budget
3. **Flexibility**: User can add gig income whenever it arrives, not tied to cycle creation
4. **Simple math**: `income = main paycheck only` → deterministic envelope allocation

### If Mercor Becomes Regular

If Mercor becomes predictable biweekly income:

**Option A**: Create a separate transaction for it:
- Transaction 2: "Mercor Biweekly" with `recurrence: 'biweekly'`
- Now there are TWO biweekly incomes
- Current code picks the earliest (Esly's original paycheck)
- Future enhancement: support multiple cycles or multi-income cycles

**Option B**: Schema enhancement:
```sql
ALTER TABLE transactions ADD COLUMN is_main_income BOOLEAN DEFAULT FALSE;

-- Then set one explicitly:
UPDATE transactions SET is_main_income = TRUE 
WHERE id = esly_paycheck_id;
```

Then the logic becomes:
```javascript
const mainIncome = transactions.find(tx => tx.is_main_income === true)
```

---

## Summary: The Three Areas Reviewed

| Area | Implementation | Future-Proof? |
|------|----------------|---------------|
| **Identify main income** | Property-based (biweekly recurrence), earliest date | ✓ Yes. Works if job changes, label changes, or new income added |
| **Calculate 14-day window** | Paycheck date → +13 days | ✓ Yes. Simple, deterministic math |
| **Handle Mercor income** | Excluded from auto-create, manual add-ons to Buffer | ✓ Yes. Can upgrade to multi-income if Mercor becomes regular |

No hardcoded names. No fragile label matching. Extensible design.

---

## Next Steps

1. ✓ Review this design (you are here)
2. ☐ Test with sample data (Esly paycheck marked approved)
3. ☐ Verify Mercor income is NOT counted in cycle creation
4. ☐ Integrate into CyclesTab UI with auto-create button
5. ☐ Add toast notification when gig income arrives (optional future)
