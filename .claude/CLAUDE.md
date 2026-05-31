# Project Memory

Instructions here apply to this project and are shared with team members.

## Context

## Project Overview
React PWA (Vite) + Supabase. Inline styles with a shared `C` (colors) and `S` (style objects) theme. All tabs live in `src/App.jsx` except `CyclesTab` (`src/CyclesTab.jsx`) and `GoalsTab` (`src/GoalsTab.jsx`). Bottom tab bar with 7 tabs: Home, Cycles, Goals, Agenda, Cal, Accounts, Manage.

## Tech Stack
- React (Vite), inline styles only — no CSS files or Tailwind
- Supabase (auth + Postgres)
- DM Mono / Courier New font, dark theme (`#0a0f1a` bg)
- Currency: CAD, formatted via `fmt()` / `fmtAmt()`

## DB Tables (all created)
- `books` — owner_user_id field
- `cashflow_accounts`, `cashflow_transactions`, `cashflow_overrides` — Phase 1
- `pay_cycles`, `envelope_templates`, `cycle_envelopes` — Phase 2
- `savings_goals`, `savings_contributions` — Phase 3
- `push_subscriptions`, `notification_settings` — Phase 4
- `book_members`, `book_invites` — Sharing feature

## RLS Access Pattern
All cashflow tables use a shared helper function:
```sql
user_has_book_access(p_book_id uuid) → boolean
```
Checks if `auth.uid()` is either the book owner OR in `book_members`. Tables without direct `book_id` use a subquery (e.g. `cashflow_overrides` via `transaction_id`).

## Phase 3 — Savings Goals ✓ Complete
- `GoalsTab` in `src/GoalsTab.jsx`, tab icon `◈`
- Per-goal progress bars, emoji + color picker, contribution logging

## Phase 4 — Push Notifications ✓ Complete
- SW handles push + notificationclick
- Edge Function `supabase/functions/send-notifications/index.ts` runs hourly
- 🔔 bell in header → `NotificationSheet` (per-device toggle + per-book settings)
- `VITE_VAPID_PUBLIC_KEY` required in Netlify env vars
- Cron: `0 * * * *` → send-notifications Edge Function

## Sharing Feature ✓ Complete
- 👥 icon in header → `ShareSheet`
- Owner invites by email → stored in `book_invites` (status: pending/accepted/declined)
- Invitee sees banner at login to accept/decline
- Accepted → row inserted into `book_members`, shared book appears in book switcher
- Book loading queries both owned books and `book_members` rows

## Home Tab (OverviewTab) ✓ Redesigned
`OverviewTab` in `src/App.jsx` accepts `{ accounts, transactions, overrides, onReconcile, bookId, onGoToCycles }`.
- **Safe to spend** hero card: `totalCash − bills before next income occurrence` (14d lookahead)
- **Accounts** list: tap any row to open ReconcileModal for that account
- **14-day calendar grid**: 7-col × 2-row, each cell shows day net flow; payday cell highlighted green, today purple
- **Bills til next payday**: expenses due before the next income transaction, with running total
- **Tight envelopes**: loads active `cycle_envelopes` from Supabase (cycle covering today), shows any at ≥90% usage with "Reassign →" → navigates to Cycles tab

## Reconcile Flow
- `ReconcileModal` (`src/ReconcileModal.jsx`): "Add transaction to explain difference" rows now include a **date field** (default today); date is saved per-transaction (not pinned to baseline date)
- **Multi-account picker**: `CheckInBanner` "Reconcile balance" now shows an account picker bottom sheet when there are 2+ accounts; single account still opens directly
  - State: `showAccountPicker` in `MainApp`

