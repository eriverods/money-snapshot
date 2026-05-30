# Cycle Logic: Concrete Test Scenarios

## Scenario 1: Happy Path (Main Income Approved)

### Setup
```javascript
transactions = [
  {
    id: 1,
    label: "Esly's Paycheck",
    type: "income",
    amount: 2000,
    recurrence: "biweekly",
    date: "2026-05-15",  // ← First Friday (started May 15)
  },
  {
    id: 2,
    label: "Mercor Income",
    type: "income",
    amount: 350,
    recurrence: "once",
    date: "2026-06-03",  // ← Will arrive during cycle window
  },
  {
    id: 3,
    label: "Rent",
    type: "expense",
    amount: 500,
    recurrence: "monthly",
    date: "2026-06-01",
  },
]

overrides = [
  {
    transaction_id: 1,
    instance_date: "2026-05-29",  // ← Esly's paycheck approved on this date
    action: "approved",
  },
]

accounts = [
  { id: 1, name: "Simplii Checking", type: "checking", balance: 500 },
]

templates = [
  { id: 1, name: "Groceries", default_amount: 400 },
  { id: 2, name: "Fun", default_amount: 300 },
  { id: 3, name: "Buffer", default_amount: 200 },
]
```

### Execution
```javascript
const mainIncome = findMainIncomeTransaction(transactions)
// → Returns: { id: 1, label: "Esly's Paycheck", amount: 2000, recurrence: "biweekly", date: "2026-05-15" }

const approved = findApprovedMainIncome(transactions, overrides)
// → Returns: { tx: {...}, date: "2026-05-29" }

const window = calculateCycleWindow("2026-05-29")
// → Returns: { startDate: "2026-05-29", endDate: "2026-06-11" }

const bills = identifyFixedBillsInWindow(transactions, "2026-05-29", "2026-06-11")
// → Returns: [{ id: 3, label: "Rent", date: "2026-06-01", amount: 500 }]

const variable = calculateVariableAmount(500, 2000, 500)
// → Returns: 2000  (500 starting + 2000 income - 500 bills)

const allocations = suggestEnvelopeAllocations(2000, templates)
// Template total: 400 + 300 + 200 = 900
// Scale: min(1, 2000/900) = 1 (can allocate full)
// → Returns: [
//     { template_id: 1, name: "Groceries", allocated_amount: 400 },
//     { template_id: 2, name: "Fun", allocated_amount: 300 },
//     { template_id: 3, name: "Buffer", allocated_amount: 200 },
//   ]
```

### Key Assertion: Mercor Income NOT Included
```javascript
// ❌ Mercor income (id: 2) is NOT included:
bills.some(b => b.id === 2)  // false ✓

// Verify it's outside the cycle math:
// - Not in bills array (it's income, not expense)
// - Not added to income_actual
// - Variable amount = 500 + 2000 - 500 = 2000 (Mercor's $350 not counted)
```

### Expected Database Result
```sql
-- pay_cycles record:
{
  start_date: "2026-05-29",
  end_date: "2026-06-11",
  starting_balance: 500,
  income_actual: 2000  -- ONLY main income, NOT Mercor
}

-- cycle_envelopes records:
{
  name: "Groceries",
  allocated_amount: 400,
  spent_amount: 0,
},
{
  name: "Fun",
  allocated_amount: 300,
  spent_amount: 0,
},
{
  name: "Buffer",
  allocated_amount: 200,
  spent_amount: 0,
}

-- Later, user manually adds Mercor income when it arrives
```

---

## Scenario 2: Multiple Biweekly Incomes (Future-Proof Test)

### Setup
```javascript
transactions = [
  {
    id: 1,
    label: "Esly's Paycheck",
    type: "income",
    amount: 2000,
    recurrence: "biweekly",
    date: "2026-05-15",  // ← Started first (earliest date)
  },
  {
    id: 2,
    label: "Partner's Paycheck",
    type: "income",
    amount: 1800,
    recurrence: "biweekly",
    date: "2026-05-20",  // ← Started later
  },
]

overrides = [
  {
    transaction_id: 1,
    instance_date: "2026-05-29",
    action: "approved",  // ← Esly's approved
  },
  {
    transaction_id: 2,
    instance_date: "2026-05-27",
    action: "approved",  // ← Partner's also approved
  },
]
```

### Execution
```javascript
const mainIncome = findMainIncomeTransaction(transactions)
// → Returns id: 1 (Esly's, earliest start date "2026-05-15")
//   NOT id: 2 (Partner's, later start date "2026-05-20")

const approved = findApprovedMainIncome(transactions, overrides)
// → Returns: { tx: id: 1, date: "2026-05-29" }
//   Uses Esly's approved instance, not Partner's
```

### Key Assertion: Earliest Wins
```javascript
mainIncome.id === 1  // ✓ Esly's paycheck (started first)
mainIncome.id !== 2  // ✓ NOT Partner's (started later)

// System picks Esly's as main cycle trigger
// Partner's income must be handled separately (future: separate cycle or multi-income support)
```

---

## Scenario 3: No Approved Main Income

### Setup
```javascript
transactions = [
  {
    id: 1,
    label: "Esly's Paycheck",
    type: "income",
    amount: 2000,
    recurrence: "biweekly",
    date: "2026-05-15",
  },
]

overrides = [
  // Empty: paycheck NOT approved yet
]
```

### Execution
```javascript
const approved = findApprovedMainIncome(transactions, overrides)
// → Returns: null

const result = await createCycleFromApprovedPaycheck(bookId, accounts, transactions, templates, overrides)
// → Returns: {
//     success: false,
//     error: "No approved main income found. Set up biweekly recurring income first."
//   }
```

### UI Behavior
```javascript
// In CyclesTab:
const autoPaycheck = findApprovedMainIncome(transactions, overrides)

{autoPaycheck ? (
  <button>Auto-create cycle from paycheck</button>  // ← NOT shown
) : (
  <div>
    <p>Approve your paycheck in Agenda to auto-create a cycle</p>
    <button>Start new cycle (manual)</button>  // ← Still available
  </div>
)}
```

---

## Scenario 4: Mercor Income Within Window (Should Be Ignored)

### Setup
```javascript
transactions = [
  {
    id: 1,
    label: "Esly's Paycheck",
    type: "income",
    amount: 2000,
    recurrence: "biweekly",
    date: "2026-05-15",
  },
  {
    id: 2,
    label: "Mercor Gig Work",
    type: "income",
    amount: 350,
    recurrence: "once",
    date: "2026-06-03",  // ← Within the 14-day window
  },
  {
    id: 3,
    label: "Groceries",
    type: "expense",
    amount: 50,
    recurrence: "weekly",
    date: "2026-05-30",
  },
]

overrides = [
  {
    transaction_id: 1,
    instance_date: "2026-05-29",
    action: "approved",
  },
]

accounts = [{ id: 1, name: "Simplii", type: "checking", balance: 500 }]
templates = [{ id: 1, name: "Everything", default_amount: 500 }]
```

### Execution
```javascript
const { startDate, endDate } = calculateCycleWindow("2026-05-29")
// → { startDate: "2026-05-29", endDate: "2026-06-11" }

const bills = identifyFixedBillsInWindow(transactions, startDate, endDate)
// Groceries on 2026-05-30: $50 ✓ In window (expense)
// Groceries on 2026-06-06: $50 ✓ In window (expense)
// Mercor on 2026-06-03: ❌ NOT in bills (it's income, not expense)
// → Returns: [
//     { id: 3, label: "Groceries", date: "2026-05-30", amount: 50 },
//     { id: 3, label: "Groceries", date: "2026-06-06", amount: 50 },
//   ]

const result = await createCycleFromApprovedPaycheck(...)
// income_actual: 2000  ← ONLY Esly's, NOT Mercor's $350
// variable: 500 + 2000 - 100 = 2400
// allocated: { "Everything": 500 * (2400/500) = 2400 }
```

### Verification
```javascript
result.cycle.income_actual === 2000  // ✓ NOT 2350
bills.length === 2                    // ✓ 2 groceries, NO Mercor
result.variableAmount === 2400        // ✓ Based on main income only

// Mercor $350 must be added manually by user later
```

---

## Scenario 5: Insufficient Variable (Negative Budget)

### Setup
```javascript
transactions = [
  {
    id: 1,
    label: "Esly's Paycheck",
    type: "income",
    amount: 1000,  // ← Low income this period
    recurrence: "biweekly",
    date: "2026-05-15",
  },
  {
    id: 2,
    label: "Rent",
    type: "expense",
    amount: 1500,  // ← Higher than income!
    recurrence: "monthly",
    date: "2026-06-01",
  },
]

overrides = [
  { transaction_id: 1, instance_date: "2026-05-29", action: "approved" },
]

accounts = [{ id: 1, name: "Simplii", type: "checking", balance: 100 }]
templates = [{ id: 1, name: "Buffer", default_amount: 500 }]
```

### Execution
```javascript
const variable = calculateVariableAmount(100, 1000, 1500)
// → -400 (negative!)

const allocations = suggestEnvelopeAllocations(-400, templates)
// Scale: min(1, -400/500) = -0.8 (clamped to NOT go negative)
// Actually: scale = 0 (amount would be $0)
// → Returns: [{ name: "Buffer", allocated_amount: 0 }]

const result = await createCycleFromApprovedPaycheck(...)
// → {
//     success: true,
//     variableAmount: -400,
//     envelopes: [],  // ← Empty (0 allocations filtered out)
//   }
```

### UI Notification
```javascript
// Show warning:
if (result.variableAmount < 0) {
  <Alert severity="error">
    Overspent this cycle! Bills exceed income by ${Math.abs(result.variableAmount)}
  </Alert>
}
```

---

## Test Commands (if using Node REPL)

```javascript
import { 
  findMainIncomeTransaction,
  findApprovedMainIncome,
  calculateCycleWindow,
  identifyFixedBillsInWindow,
  calculateVariableAmount,
  suggestEnvelopeAllocations,
} from './src/lib/cycleLogic.js'

// Run Scenario 1:
const txs = [/* ... */]
const ovs = [/* ... */]

const main = findMainIncomeTransaction(txs)
console.log('Main income:', main.label, main.amount)

const appr = findApprovedMainIncome(txs, ovs)
console.log('Approved on:', appr?.date)

const win = calculateCycleWindow(appr.date)
console.log('Window:', win.startDate, '→', win.endDate)

const bills = identifyFixedBillsInWindow(txs, win.startDate, win.endDate)
console.log('Bills:', bills.map(b => `${b.label} $${b.amount}`))

const variable = calculateVariableAmount(500, 2000, bills.reduce((s,b)=>s+b.amount,0))
console.log('Variable:', variable)

// Assert Mercor NOT included:
console.assert(!bills.some(b => b.label.includes('Mercor')), 'Mercor should not be in bills')
```
