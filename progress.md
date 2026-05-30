# Money Snapshot — Build Progress

## Phase 1 — Core app ✅ Complete
- Email/password auth, multi-book support
- Accounts (checking, savings, credit), transactions (income/expense/transfer)
- Recurring transaction expansion (once/weekly/biweekly/monthly)
- Overrides, reconciliation modal
- Overview, Agenda, Calendar, Accounts, Manage tabs
- PWA
- DB tables: `books`, `cashflow_accounts`, `cashflow_transactions`, `cashflow_overrides`

## Phase 2 — Pay cycles + envelope tracking ✅ Complete
- Pay cycle creation wizard (date range, starting balance)
- Envelope templates (reusable budget categories)
- Envelope progress bars with inline spent editor
- Cycle stats: days left, allocated, spent, safe-to-spend
- Bills remaining in cycle
- DB tables: `pay_cycles`, `envelope_templates`, `cycle_envelopes`

## Phase 3 — Savings goals ❌ Not started
- Create/track savings goals (e.g. "Emergency fund", "Vacation")
- Log contributions toward each goal
- Progress bars per goal
- DB tables: `savings_goals`, `savings_contributions`

## Phase 4 — Push notifications ❌ Not started
- Bill reminders, low balance alerts
- Supabase Edge Functions + web push

## Misc / Ongoing
- [ ] Clean up `index.html` debug overlays (JS error banner, "Starting up…" text)
- [ ] Update Supabase site URL to Vercel domain for auth redirects
- [ ] Book/household sharing (deferred)
