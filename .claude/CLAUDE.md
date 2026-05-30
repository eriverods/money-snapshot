# Project Memory

Instructions here apply to this project and are shared with team members.

## Context

## Project Overview
React PWA (Vite) + Supabase. Inline styles with a shared `C` (colors) and `S` (style objects) theme. All tabs live in `src/App.jsx` except `CyclesTab` (`src/CyclesTab.jsx`). Bottom tab bar with 6 tabs: Home, Cycles, Agenda, Cal, Accounts, Manage.

## Tech Stack
- React (Vite), inline styles only — no CSS files or Tailwind
- Supabase (auth + Postgres)
- DM Mono / Courier New font, dark theme (`#0a0f1a` bg)
- Currency: CAD, formatted via `fmt()` / `fmtAmt()`

## DB Tables
- `books`, `cashflow_accounts`, `cashflow_transactions`, `cashflow_overrides`
- `pay_cycles`, `envelope_templates`, `cycle_envelopes`
- `savings_goals`, `savings_contributions` ← Phase 3 (not yet created)

## Current Phase: Phase 3 — Savings Goals
**Status: In Progress (started 2026-05-30)**

Goals:
- Create and track named savings goals (e.g. "Emergency Fund", "Vacation")
- Log contributions toward each goal
- Progress bars per goal
- New tab "Goals" added to the bottom tab bar

### DB schema to create in Supabase:
```sql
create table savings_goals (
  id uuid primary key default gen_random_uuid(),
  book_id uuid references books(id) on delete cascade,
  name text not null,
  target_amount numeric not null,
  current_amount numeric not null default 0,
  emoji text,
  color text,
  created_at timestamptz default now()
);

create table savings_contributions (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid references savings_goals(id) on delete cascade,
  amount numeric not null,
  note text,
  date date not null default current_date,
  created_at timestamptz default now()
);
```

### UI Plan:
- New `GoalsTab` component in `src/GoalsTab.jsx`
- Goal card: name + emoji, progress bar, current/target amounts, "+ Add Funds" button
- Add Goal form: name, emoji, target amount, optional starting balance
- Contribution modal: amount, note, date
- Goals tab icon: `◈`, label: `Goals`

