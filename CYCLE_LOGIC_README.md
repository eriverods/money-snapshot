# Cycle Creation Logic - Implementation Guide

## Overview

The core cycle creation logic is now available in `src/lib/cycleLogic.js`. It handles:

1. **Identifying main income** — finds the primary recurring biweekly income (future-proof, no hardcoding)
2. **Detecting approval** — finds when main income is marked 'Approved'
3. **Calculating 14-day windows** — exact date range from income date through day 13
4. **Querying fixed bills** — identifies all expenses falling strictly within the window
5. **Computing variable amount** — starting balance + main income − fixed bills (gig income handled separately)
6. **Auto-suggesting allocations** — scales template defaults proportionally to variable amount

## Core Functions

### `findMainIncomeTransaction(transactions)`
Identifies the "main income" transaction — the primary cycle trigger.

**Design (future-proof, no hardcoding):**
- Finds all biweekly recurring income transactions (not gig work)
- If multiple exist, uses the earliest start date (most established income)
- Returns `null` if none found

**Why this design:** Works regardless of job changes. If Esly changes jobs but keeps biweekly pay, the new transaction works. If a new co-earner joins with biweekly income, their transaction is available (future: schema enhancement for multi-income support).

**Returns:** Transaction object or `null`

```javascript
const mainIncome = findMainIncomeTransaction(transactions)
if (mainIncome) {
  console.log(`Main income: ${mainIncome.label} (${mainIncome.amount}/biweekly)`)
}
```

---

### `findApprovedMainIncome(transactions, overrides)`
Detects the most recent approved instance of the main income (within ±14 days of schedule).

**Returns:** `{ tx, date }` or `null`

```javascript
const approvedIncome = findApprovedMainIncome(transactions, overrides)
if (approvedIncome) {
  console.log(`Found approved main income on ${approvedIncome.date}`)
}
```

**Note:** Gig income (Mercor, etc.) with variable recurrence is NOT detected here. It must be added manually to a Buffer envelope during the cycle.

---

### `calculateCycleWindow(paycheckDate)`
Calculates exact 14-day window: from paycheck date through day 13 (14 days total).

**Returns:** `{ startDate, endDate }` (both YYYY-MM-DD)

```javascript
const { startDate, endDate } = calculateCycleWindow('2026-05-30')
// startDate: '2026-05-30', endDate: '2026-06-12'
```

---

### `identifyFixedBillsInWindow(transactions, startDate, endDate)`
Queries all expenses (type='expense') that fall strictly within the window. Handles recurrence properly.

**Returns:** Array of `{ id, label, amount, date }` sorted by date

```javascript
const bills = identifyFixedBillsInWindow(transactions, '2026-05-30', '2026-06-12')
bills.forEach(b => {
  console.log(`${b.label} on ${b.date}: $${b.amount}`)
})
```

---

### `calculateVariableAmount(startingBalance, incomeAmount, fixedBillsTotal)`
Simple math: starting balance + income − fixed bills = variable available.

**Returns:** Number

```javascript
const variable = calculateVariableAmount(500, 2000, 800)
// variable: 1700
```

---

### `suggestEnvelopeAllocations(variableAmount, templates)`
Scales template defaults proportionally so they sum to `variableAmount` (or less if templates exceed available).

**Returns:** Array of `{ template_id, name, allocated_amount, color }`

```javascript
const suggestions = suggestEnvelopeAllocations(1700, templates)
// If templates are [Groceries $500, Fun $300, Savings $200],
// and variable is 1700, they scale to [585, 351, 234] (maintain ratio)
```

---

### `createCycleFromApprovedPaycheck(bookId, accounts, transactions, templates, overrides)`
**Orchestration function** — does everything in one call:

1. Finds approved paycheck
2. Calculates cycle window
3. Queries fixed bills
4. Computes variable amount
5. Suggests allocations
6. Creates `pay_cycles` record
7. Creates `cycle_envelopes` records

**Returns:** `{ success, cycle?, bills?, envelopes?, variableAmount?, error? }`

```javascript
const result = await createCycleFromApprovedPaycheck(
  bookId, accounts, transactions, templates, overrides
)

if (result.success) {
  console.log(`Cycle created: ${result.cycle.id}`)
  console.log(`Bills: ${result.bills.length}, Envelopes: ${result.envelopes.length}`)
  console.log(`Variable available: $${result.variableAmount}`)
} else {
  console.error(result.error)
}
```

---

## Data Requirements

### Transactions
Must have these fields:
- `id` (int)
- `type` ('income' | 'expense' | 'transfer')
- `label` (string)
- `amount` (number)
- `date` (YYYY-MM-DD string)
- `recurrence` ('once' | 'weekly' | 'biweekly' | 'monthly')
- `end_date` (YYYY-MM-DD string or null)

**Main income transactions** (cycle triggers):
- Type: 'income'
- Recurrence: 'biweekly' (e.g., Esly's paycheck, future stable job)
- Consistent amount
- System picks the earliest-start (most established) if multiple exist

**Gig income transactions** (NOT cycle triggers):
- Type: 'income'
- Recurrence: 'once', 'weekly', or variable frequency (e.g., Mercor)
- Added manually to a Buffer or dedicated envelope during the cycle
- Does NOT affect `pay_cycles.income_actual`

### Overrides
For detecting approved paycheck:
- `transaction_id` (int)
- `instance_date` (YYYY-MM-DD string)
- `action` ('approved' | 'skipped' | 'modified' | null)

### Templates
For envelope suggestions:
- `id` (uuid)
- `name` (string)
- `default_amount` (number)
- `color` (hex string or null)

### Accounts
For starting balance:
- `name` (string)
- `balance` (number)
- `type` ('checking' | 'credit' | etc.)

Logic prefers: account with 'simplii' in name → first non-credit → accounts[0]

---

## Integration Steps

### 1. Test the functions (Node/REPL)
```javascript
import {
  findApprovedPaycheck,
  calculateCycleWindow,
  identifyFixedBillsInWindow,
  calculateVariableAmount,
  suggestEnvelopeAllocations,
} from './src/lib/cycleLogic.js'

// Load your data
const transactions = [...] // from Supabase
const overrides = [...]
const accounts = [...]
const templates = [...]

// Step through
const paycheck = findApprovedPaycheck(transactions, overrides)
if (!paycheck) console.log('No approved paycheck')

const window = calculateCycleWindow(paycheck.date)
const bills = identifyFixedBillsInWindow(transactions, window.startDate, window.endDate)
const variable = calculateVariableAmount(
  parseFloat(accounts[0].balance),
  parseFloat(paycheck.tx.amount),
  bills.reduce((s, b) => s + b.amount, 0)
)
const suggestions = suggestEnvelopeAllocations(variable, templates)
console.log(suggestions)
```

### 2. Add to CyclesTab component
See `cycleIntegrationExample.js` for full implementation. Key steps:

```javascript
import { findApprovedPaycheck, createCycleFromApprovedPaycheck } from './lib/cycleLogic'

// In CyclesTab component:
const autoPaycheck = findApprovedPaycheck(transactions, overrides)

// In "no cycle" state UI:
{autoPaycheck && (
  <button onClick={async () => {
    const result = await createCycleFromApprovedPaycheck(
      bookId, accounts, transactions, templates, overrides
    )
    if (result.success) {
      load() // reload cycles
    }
  }}>
    Auto-create cycle from paycheck
  </button>
)}
```

### 3. Test end-to-end
1. Create a biweekly paycheck transaction labeled "Paycheck"
2. Add some fixed bills (expenses) in the next 14 days
3. Go to Agenda tab and mark the paycheck as "Approved"
4. Go to Cycles tab and click "Auto-create cycle from paycheck"
5. Verify cycle created with auto-scaled envelopes

---

## Crucial Constraints

### Gig Income (Mercor) is NOT included in cycle auto-create

When a main income is approved and a cycle is created:
- ✓ Cycle `income_actual` = main income amount ONLY
- ✗ Gig income (Mercor, etc.) is NOT added to `income_actual`
- ✗ Gig income does NOT affect envelope allocations
- **What to do**: User manually adds gig income to a Buffer/overflow envelope during the cycle

This design keeps cycles predictable and tied to stable income. Variable gig income is a bonus allocation, not part of the base cycle math.

---

## Edge Cases Handled

✓ No approved main income → returns error with helpful message
✓ No bills in window → variable = starting balance + main income
✓ No templates → empty envelopes array
✓ Multiple biweekly incomes → uses the earliest start date (most established)
✓ Variable < 0 → allocations still created, all amounts set proportionally (may be zero)
✓ Overlapping transactions → de-duplicated by `id + date` combo
✓ Recurring transactions → properly expanded within window
✓ Gig income during window → ignored for cycle math (manual add-on only)

---

## Testing Checklist

**Main Income Detection:**
- [ ] System identifies biweekly recurring income correctly
- [ ] System picks earliest-start biweekly income if multiple exist
- [ ] No hardcoded "Esly" or specific labels in the detection logic

**Approval & Window:**
- [ ] Approval detection finds 'approved' override on income transaction
- [ ] Window is exactly 14 days (start to start+13)
- [ ] Window calculation from different start dates is correct

**Bills & Variable:**
- [ ] Bills correctly expand recurring expenses within window
- [ ] Variable amount = starting + main income − bills (NOT including gig income)
- [ ] Gig income (Mercor, etc.) is explicitly excluded from variable calculation

**Allocations & Envelopes:**
- [ ] Allocations scale proportionally to variable amount
- [ ] Allocations maintain template proportions
- [ ] Allocations handle variable < 0 gracefully

**Full Cycle Creation:**
- [ ] Cycle created in DB with correct dates and starting_balance
- [ ] `income_actual` field = main income amount only
- [ ] Gig income not included in cycle creation
- [ ] Envelopes created with scaled amounts
- [ ] Result includes bill list and success message

---

## Files Created

- `src/lib/cycleLogic.js` — Core functions
- `src/lib/cycleIntegration.js` — React hook & patterns
- `src/lib/cycleIntegrationExample.js` — Complete CyclesTab example
- This file — Documentation

---

## Next Steps

1. Copy cycle creation logic into CyclesTab
2. Test with sample data
3. Add success/error toast notifications
4. Consider adding "preview" mode to show calculations before committing
5. Optional: Move complex logic to Supabase functions for performance
