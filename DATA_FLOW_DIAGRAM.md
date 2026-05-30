# Cycle Creation: Data Flow Diagram

## Overview: From Approval to Cycle

```
┌─────────────────────────────────────────────────────────────────────┐
│  AGENDA TAB: User approves main income transaction (Esly's paycheck) │
│  ├─ Paycheck transaction found                                       │
│  ├─ Override created: { action: 'approved', instance_date: '2026-05-29' } │
│  └─ Saved to cashflow_overrides table                               │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  CYCLES TAB: Auto-create button appears                             │
│  ├─ findApprovedMainIncome() detects approval ✓                    │
│  └─ Button shows: "Auto-create cycle from paycheck"                │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼ User clicks button
┌─────────────────────────────────────────────────────────────────────┐
│  createCycleFromApprovedPaycheck(bookId, accounts, tx, templates...)│
│                                                                      │
│  Step 1: Identify Main Income                                       │
│  ├─ findMainIncomeTransaction(transactions)                         │
│  ├─ Filter: type='income', recurrence='biweekly'                   │
│  └─ Return: Esly's paycheck transaction (earliest date)            │
│                                                                      │
│  Step 2: Find Approval                                              │
│  ├─ findApprovedMainIncome(transactions, overrides)                │
│  ├─ Scan for: transaction_id=Esly_id, action='approved'           │
│  └─ Return: { tx, date: '2026-05-29' }                            │
│                                                                      │
│  Step 3: Calculate Window                                           │
│  ├─ calculateCycleWindow('2026-05-29')                             │
│  ├─ startDate = '2026-05-29'                                        │
│  └─ endDate = '2026-06-11' (14 days)                               │
│                                                                      │
│  Step 4: Query Fixed Bills IN WINDOW                               │
│  ├─ identifyFixedBillsInWindow(transactions, start, end)           │
│  ├─ Find ALL expenses between 2026-05-29 and 2026-06-11           │
│  ├─ Mercor income (type='income') ❌ NOT in bills                 │
│  └─ Return: [Rent $500, Groceries $50, Groceries $50]             │
│     (Total bills: $600)                                             │
│                                                                      │
│  Step 5: Calculate Variable Available                               │
│  ├─ Starting balance (Simplii): $500                               │
│  ├─ Main income (Esly): $2,000                                     │
│  ├─ Fixed bills: $600                                              │
│  ├─ Formula: 500 + 2000 - 600 = 1900                               │
│  └─ ❌ Mercor $350 NOT added (separate transaction)               │
│                                                                      │
│  Step 6: Suggest Envelope Allocations                              │
│  ├─ Templates: Groceries $400, Fun $300, Buffer $200 (total $900)│
│  ├─ Scale: min(1, 1900/900) = 1 (100%, can allocate all)          │
│  └─ Allocations: Groceries $400, Fun $300, Buffer $200            │
│                                                                      │
│  Step 7: Create Database Records                                    │
│  ├─ INSERT pay_cycles:                                              │
│  │  ├─ start_date: 2026-05-29                                      │
│  │  ├─ end_date: 2026-06-11                                        │
│  │  ├─ starting_balance: 500                                       │
│  │  ├─ income_actual: 2000  ← ONLY main income               │
│  │  └─ (NO Mercor, NO gig income field)                           │
│  │                                                                  │
│  └─ INSERT cycle_envelopes (3 rows):                               │
│     ├─ Groceries: allocated $400                                   │
│     ├─ Fun: allocated $300                                         │
│     └─ Buffer: allocated $200                                      │
│                                                                      │
│  Return: {                                                          │
│    success: true,                                                   │
│    variableAmount: 1900,                                            │
│    bills: [Rent, Groceries×2],                                      │
│    note: 'Gig income (Mercor) can be added manually to Buffer'    │
│  }                                                                  │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UI UPDATES                                                          │
│  ├─ Success toast: "Cycle created for May 29 - Jun 11"             │
│  ├─ Show cycle with:                                                │
│  │  ├─ Starting balance: $500                                       │
│  │  ├─ Income this cycle: $2,000                                    │
│  │  ├─ Fixed bills: $600                                            │
│  │  ├─ Safe to spend: $1,900                                        │
│  │  └─ Envelopes: Groceries, Fun, Buffer (allocated above)        │
│  │                                                                  │
│  └─ Reminder: "Add Mercor income manually when it arrives"         │
│                                                                      │
│  LATER: When Mercor income arrives ($350)                           │
│  ├─ User adds to Buffer envelope manually                           │
│  ├─ Buffer available: $200 + $350 = $550                           │
│  └─ NOT counted in cycle creation (as designed)                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: What's Included vs Excluded

```
╔═══════════════════════════════════════════════════════════════════╗
║ DURING CYCLE AUTO-CREATE: Main Income Triggers                    ║
╠═══════════════════════════════════════════════════════════════════╣
║                                                                   ║
║ ✓ INCLUDED:                          ✗ EXCLUDED:                ║
║ ├─ Esly's biweekly paycheck          ├─ Mercor gig income       ║
║ │  (triggers cycle)                   │  (manual add-on)         ║
║ ├─ Fixed bills in window              ├─ Variable income        ║
║ │  (affects variable available)       │  (not part of math)     ║
║ ├─ Starting account balance           ├─ Income outside window  ║
║ ├─ Template envelope defaults         └─ Transfers/other       ║
║ └─ Scale allocations to variable          │
║                                           │
║ pay_cycles.income_actual = $2,000         No impact on cycle
║                           (Esly only)     math or allocation
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
```

---

## Database Schema: What Gets Stored

```sql
-- BEFORE auto-create (user approves paycheck):
cashflow_overrides
├─ transaction_id: 1 (Esly's paycheck)
├─ instance_date: 2026-05-29
└─ action: 'approved'

-- AFTER auto-create:
pay_cycles
├─ id: uuid_123
├─ book_id: user_book
├─ start_date: 2026-05-29
├─ end_date: 2026-06-11
├─ starting_balance: 500
├─ income_actual: 2000  ← Only Esly, NOT Mercor
└─ created_at: now

cycle_envelopes
├─ { cycle_id: uuid_123, name: "Groceries", allocated: 400, spent: 0 }
├─ { cycle_id: uuid_123, name: "Fun", allocated: 300, spent: 0 }
└─ { cycle_id: uuid_123, name: "Buffer", allocated: 200, spent: 0 }

-- Mercor stays in cashflow_transactions, NOT tied to this cycle
cashflow_transactions
└─ { id: 2, label: "Mercor Income", type: "income", amount: 350, recurrence: "once", date: "2026-06-03" }
   (Can be manually routed to Buffer envelope later via cycle_envelopes update)
```

---

## Future Enhancement: Multiple Main Incomes

If Mercor becomes biweekly recurring (or multiple co-earners):

```javascript
// Current behavior:
const incomes = [
  { id: 1, label: "Esly", recurrence: "biweekly", date: "2026-05-15" },
  { id: 2, label: "Mercor", recurrence: "biweekly", date: "2026-05-20" },
]

const mainIncome = findMainIncomeTransaction(incomes)
// → Returns id: 1 (earliest date wins)

// Future option A: Add is_main_income flag to schema
const mainIncomes = incomes.filter(tx => tx.is_main_income === true)

// Future option B: Accept parameter
const main = findMainIncomeTransaction(incomes, 'esly')  // explicit

// Future option C: Return array, let caller decide
const allBiweekly = [id: 1, id: 2]
// Create separate cycles for each? Or combined cycle?
```

---

## Key Principle: Separation of Concerns

```
┌─────────────────────────────┐
│ Main Income Cycle Trigger   │ ← Stable, predictable, triggers auto-create
│ (Esly's biweekly paycheck)  │   - Regular amount
│                             │   - Fixed schedule
│                             │   - Drives envelope allocation
└─────────────────────────────┘
           │
           └─→ pay_cycles.income_actual = $2,000

┌─────────────────────────────┐
│ Gig Income Buffer            │ ← Variable, manual, added during cycle
│ (Mercor, freelance, etc.)   │   - Unpredictable amount
│ (Other side income)          │   - Irregular schedule
│                             │   - Bonus allocation only
└─────────────────────────────┘
           │
           └─→ cycle_envelopes[Buffer].allocated_amount += $350

Result: Predictable base budget + flexible overflow handling
```

---

## Error Handling Paths

```
findMainIncomeTransaction()
├─ No biweekly income transactions
│  └─ Returns: null
│     └─ createCycleFromApprovedPaycheck() returns: 
│        { success: false, error: "No approved main income found..." }
│        └─ UI shows: Error message, directs user to set up recurring income

findApprovedMainIncome()
├─ Main income exists, but NOT marked approved
│  └─ Returns: null
│     └─ UI shows: "Approve your paycheck in Agenda to auto-create"
│
└─ Main income exists AND approved
   └─ Returns: { tx, date }
      └─ Proceeds to cycle creation

createCycleFromApprovedPaycheck()
├─ Success: returns { success: true, cycle, bills, envelopes, variableAmount }
│  └─ UI: Shows cycle, displays bills, shows envelope allocations
│
└─ Failure: returns { success: false, error: "..." }
   └─ UI: Shows error message, offers manual cycle creation fallback
```
