# Project Memory

Instructions here apply to this project and are shared with team members.

## Context

## Project Overview
React PWA (Vite) + Supabase. Inline styles with a shared `C` (colors) and `S` (style objects) theme. All tabs live in `src/App.jsx` except `CyclesTab` (`src/CyclesTab.jsx`) and `GoalsTab` (`src/GoalsTab.jsx`). Bottom tab bar has 3 primary tabs (Now, Ahead, Flow) + a StackMenu (☰ in header) for secondary navigation.

## i18n System
- `src/i18n.jsx` — `LangProvider`, `useT()`, `LANGUAGES` array, full `DICT` for 5 languages
- Languages: `en_CA` (default), `en_US`, `fr_CA`, `fr_EU`, `es_MX` (all LTR)
- `useT()` returns `{ t, lang, setLang, locale, dir, LANGUAGES }`
- `t(key, vars)` interpolates `{varName}` placeholders; falls back to `en_CA`
- Language persisted in `localStorage` key `lt_lang` (unknown/legacy values fall back to `en_CA`)
- **Currency is language-independent**: `fmt()` / `fmtAmt()` always format with a fixed `$` symbol via `Intl.NumberFormat('en-CA', { currency: 'CAD', currencyDisplay: 'narrowSymbol' })` — only text translates, money formatting never changes with language and shows no currency letters (no `CAD`/`CA$`/`US$`). `fmtDateLabel(ds, t, locale)` / `fmtMonthDay(ds, locale)` still localize dates.
- Language item in StackMenu → opens `LanguageSheet` bottom sheet
- App root wrapped in `LangProvider` via `AppWithLang` default export

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

## Add Transaction Form
- Date and Repeats fields are on separate rows (not side-by-side) to prevent overlap on mobile

## Accounts Tab
- `type` column on `cashflow_accounts` — migration in `supabase/migrations/20260531_add_account_type.sql`
- `track_only` boolean column — migration in `supabase/migrations/20260531_add_account_track_only.sql`
- `include_in_safe_to_spend` boolean (default true) + `classification` text — migration in `supabase/migrations/20260604_account_safe_to_spend_and_classification.sql`
- **Credit accounts**: balance is stored as negative (debt). UI negates the entered value automatically when type=credit
- **Tracking-only accounts**: excluded from running balance in Ahead/Calendar projections (still uses `a.type !== 'credit' && !a.track_only`). Independent of Safe to Spend.
- **Safe to Spend**: now driven exclusively by `include_in_safe_to_spend` flag (OverviewTab `totalCash`). Toggle per card ("✓ In Safe to Spend" / "✗ Not in Safe to Spend"). Default true; migration sets false for existing credit/track-only accounts.
- **Classification**: optional free-form label (e.g. "Income", "Bills", "Fun money"). Shown on card and in OverviewTab account list. Editable in the rename/edit panel.
- `initAdd` / `onInitAddDone` props trigger the add form open from parent (used by FAB)

## Multiple Books Feature
- Users can own multiple books; book picker always visible under "Lighthouse Trail" header title
- Inline new book creation: text field + Create button inside the picker dropdown
- `switchBook(b)` in App root adds new books to `allBooks` list if not already present, then sets active book
- On load, App queries both `books` (owned) and `book_members` (shared) and merges into `allBooks`
- First book in `allBooks` is selected by default

## Bottom Navigation
- 3 main tabs: Now (⌂), Ahead (→), Flow (≡)
- Header ☰ button → opens `StackMenu` bottom sheet
- `StackMenu` lists: Cycles ⊙, Goals ◈, Accounts ◎, ─ divider, Appearance, Notifications, Share Book, Start from Scratch, Sign Out (no decorative emojis — menu labels are plain text)
- Tapping Cycles/Goals/Accounts navigates to those full-screen tabs (activeTab state)
- `activeTab` is persisted to `localStorage` key `lt_active_tab` and restored on load, so a refresh / PWA reopen returns the user to the tab they left
- Header also has ⓘ (opens HelpSheet)

## Start from Scratch
- 🧹 in StackMenu → opens `StartFromScratchSheet`
- Two branches: **Create a new book** (opens book picker, nothing deleted) or **Delete everything in this book** (destructive, two-tap confirm)
- Delete calls `reset_book_data(p_book_id)` RPC — wipes accounts, transactions, overrides, cycles, envelopes, templates, goals, contributions, categories for the current book. Book itself remains.
- Migration: `supabase/migrations/20260604_reset_book_data.sql`
- After reset, `loadData()` is called to refresh the UI to empty state

## Categories Feature
- `categories` table: `id, book_id, name, sort_order, is_default, archived`
- RLS via `user_has_book_access(book_id)`
- `cashflow_transactions.category` column (text, stores category name)
- Default categories seeded lazily in `MainApp.loadData()` when `categories` table is empty for the book
- Default list: Income, Housing, Transport, Groceries, Dining, Health, Subscriptions, Personal Care, Clothing, Entertainment, Savings Transfer, Debt Payment, Kids, Pets, Gifts, Other
- Category filter available in Flow tab

## Theme System
- 3 palettes × 2 modes applied via `data-palette` + `data-mode` on `<html>` element
- **Still Water** (default, `still_water`) — muted blue-greens, calm
- **Warm Dusk** (`warm_dusk`) — earthy, grounding, warm taupes and sage
- **Soft Earth** (`soft_earth`) — warm stone, dusty rose, olive
- Modes: `dark` / `light`
- Accessibility: `none` / `high_contrast` / `colorblind_safe` (applied via `data-accessibility` on `<html>`)
- Persisted in `user_preferences` Supabase table (palette, mode, accessibility columns)
- Cached in `localStorage` key `lt_prefs` as JSON `{palette, mode, a11y}`
- `applyThemeAttrs({palette, mode, a11y})` sets all three HTML attributes
- `savePrefs(newPrefs)` in MainApp updates state + localStorage + upserts to DB
- ThemePicker is a bottom sheet, accessed via 🎨 Appearance in StackMenu
- Negative amounts NEVER use clinical red — all palettes use warm tones (dusty orange, terracotta, amber) for `--c-negative`

## Safe Area (iOS)
- Header padding: `calc(14px + env(safe-area-inset-top))` to clear Dynamic Island / status bar
- `viewport-fit=cover` + `apple-mobile-web-app-status-bar-style: black-translucent` already in index.html

## Floating Action Button (FAB)
- `FAB` component in `src/App.jsx`, fixed position above tab bar (`bottom: calc(76px + env(safe-area-inset-bottom))`, `right: 16px`, `z-index: 150`)
- Tapping `+` opens 4 action buttons: Add Transaction, Add Bill, Save to Goal, New Book (opens book picker)
- Backdrop div closes menu on outside tap

## Tab Descriptions
- **Now (⌂)**: OverviewTab — safe-to-spend hero, accounts, today's activity, tight envelopes, upcoming bills
- **Ahead (→)**: AheadTab — pay cycle countdown, next 30-day timeline grouped by date, tap to approve/skip/edit amount
- **Flow (≡)**: TransactionsTab — full instance list past 90d + future 30d, sort by date/amount with asc/desc toggle (default: date desc), filter by type/account/category, tap to edit via EditTxSheet
- **Cycles (⊙)**: CyclesTab (via StackMenu) — pay cycle management and envelope budgets
- **Goals (◈)**: GoalsTab (via StackMenu) — savings goals with progress bars
- **Accounts (◎)**: AccountsTab (via StackMenu) — account management and reconcile

## HelpSheet (ⓘ)
- Opens from ⓘ icon in header (`id="guide-help"`)
- Plain-language explanations of each feature (ADHD-friendly, calm friend tone)
- No jargon, warm language
- "↻ Replay the walkthrough" button at top → calls `onReplayGuide` prop → closes sheet + opens `FirstRunGuide`

## First-Run Guide (coachmarks)
- `FirstRunGuide` component in `src/App.jsx` — spotlight tour with highlight ring + tooltip card
- 5 steps: Safe to Spend hero, tab bar, FAB, ☰ menu, ⓘ help
- Target elements tagged with ids: `guide-safe-to-spend`, `guide-tabs`, `guide-fab`, `guide-menu`, `guide-help`
- Spotlight via `boxShadow: '0 0 0 9999px rgba(0,0,0,0.72), ...'` on a fixed-position highlight div
- Tooltip positions below target if in top half of screen, above if in bottom half; clamped to viewport
- Next/Back/Skip/Done buttons + progress dot row
- Persisted in `localStorage` key `lt_guide_seen` — never shows again after first completion/skip
- Triggered in `MainApp.loadData()` on the very first data load (via `firstLoad` ref); suppressed while guide is open (`showCheckin && !showGuide`)
- Replayable from HelpSheet via `onReplayGuide` prop

## Mobile Layout
- `S.root` paddingBottom: `calc(80px + env(safe-area-inset-bottom))` — accounts for tab bar + home indicator
- Body content wrapper: `padding: 14px 16px 0`
- Tab bar: compact padding (`8px 0 6px`), 8px labels, `env(safe-area-inset-bottom)` on bar itself

