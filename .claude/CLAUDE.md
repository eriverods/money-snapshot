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

## Envelopes Feature ✓ Complete
- `EnvelopesTab` in `src/EnvelopesTab.jsx`, StackMenu icon `✉`. Standalone, first-class envelopes (separate from the old cycle-bound `cycle_envelopes` used inside CyclesTab, which still works).
- Tables (migration `supabase/migrations/20260607_envelopes.sql`):
  - `envelopes` — `book_id, name, color, emoji, allocated_amount` (base/period), `spent_amount`, `carryover_amount` (rolled-in leftover), `link_type` ('cycle'|'time'|'none'), `period` ('weekly'|'biweekly'|'monthly'), `period_start`, `period_end`, `cycle_id` → pay_cycles, `rollover_mode` ('rollover'|'savings'|'none'), `rollover_goal_id` → savings_goals, `display_order`, `archived`
  - `envelope_period_history` — one row per closed-out period (allocated/spent/leftover); powers behaviour-learning suggestions
  - RLS via `user_has_book_access(book_id)`; both folded into `reset_book_data`
- **Link options**: each envelope refreshes by a fixed **time** period, rides a **pay cycle**, or is **always-on** (none).
- **Available** = `allocated_amount + carryover_amount`; usage bar = `spent / available`.
- **Period close-out**: when `today > period_end`, the tab shows a "close out & refresh" prompt. Leftover (`available − spent`) either rolls over (→ next period `carryover_amount`), moves to a savings goal (inserts `savings_contributions` + bumps `savings_goals.current_amount`), or resets. Logic in `src/lib/envelopeLogic.js` (`computeCloseOut`, `periodEndFor`, `nextWindow`, `isPeriodOver`).
- **Behaviour learning** (`buildEnvelopeSuggestions`, `buildCycleSuggestions`): from history, suggests lowering/raising allocations for consistent under/over-spend; detects a new pay cycle started (offers to link envelopes) or, when none exists, suggests creating one.
- i18n keys under `env.*` (en_CA; other languages fall back to en_CA per `t()` design).

## Envelopes-First Tab Restructure ✓ Complete
The Envelopes tab is now **transaction-driven** and answers "what's left?" at a glance.
- **Data model** (migration `supabase/migrations/20260612_envelope_transactions.sql`):
  - `cashflow_transactions` gains `envelope_id uuid NULL REFERENCES envelopes(id) ON DELETE SET NULL` + `assigned_at`. NULL `envelope_id` = lives in the inbox. Envelope delete → its transactions return to inbox (set null), hints cascade-deleted.
  - `merchant_envelope_hints` (`book_id, merchant_normalized, envelope_id, assignment_count, last_assigned_at`, unique on the triple) — per-book so both partners benefit. RLS via `user_has_book_access`.
  - `notification_settings` gains `inbox_reminders bool` + `last_inbox_nudge_at` (powers the push-nudge 3-day cap). Hints folded into `reset_book_data`.
- **Spent is derived** from assigned expense transactions (`computeEnvelopeSpent` in `src/lib/envelopeLogic.js`), windowed by `period_start/period_end` for time/cycle envelopes (resets naturally when the window rolls). Falls back to legacy manual `spent_amount` only when no transactions are assigned. Hero number is **always amount left**, never spent.
- **Inbox logic** in `src/lib/envelopeInbox.js`: `normalizeMerchant` (lowercase, strip store #s/locations/punct), `suggestEnvelopeId` (highest `assignment_count` for the merchant, confidence floor ≥ 2 — below floor shows no suggestion), `inboxTransactions` (unassigned recent expenses), `relativeDay`.
- **EnvelopesTab** (`src/EnvelopesTab.jsx`) views: list (header w/ days-to-payday + ⋯ overflow → All activity / manage), "Needs a home" inbox (dashed border, accept-all, swipe-right-to-assign ~110px + toast, "other…" chip picker, empty/cleared/no-envelopes states, collapses to summary >15), envelope hero cards ($ left + animated fill bar in envelope color, neutral low/overspent copy — never red), envelope detail (day-grouped tx, tap → `TxEditSheet` reassign/edit/delete), All-activity (day-grouped, color dot per envelope / hollow if unassigned). `useReducedMotion()` disables swipe + bar animation. Receives `transactions` + `onRefresh` from `MainApp`.
- **Integration**: Now tab shows a "N transactions need a home" card (badge capped 9+) → deep-links to inbox; AddTxModal has an optional envelope picker (preselected from merchant hint, skipping → inbox); merchant hints upserted via exported `upsertMerchantHint`. Push nudge in `send-notifications` Edge Function: inbox ≥ 5, max one per 3 days, neutral copy, respects `inbox_reminders` pref.
- **No-shame rule**: all copy neutral/reassuring; color dots always paired with text labels.

## Envelope System Spec ✓ Complete (categories↔envelopes, catchall, envelope-derived safe-to-spend, starter set)
**Design rules (apply to every envelope feature):** (1) no shame language — never red for overspend/backlog/catchall; low-balance copy is reassuring. (2) Hero number is always amount LEFT. (3) Every flow completable in <2 min with batch escape hatches. (4) Theme tokens only, color never the sole signal. (5) Respect `prefers-reduced-motion`. (6) RLS parity (`user_has_book_access`) on every new table.
- **Migrations**: `supabase/migrations/20260613_envelope_system.sql` (catchall + categories↔envelopes + composting dismissals), `20260613_tx_rls_parity.sql` (shared-book UPDATE policy on `cashflow_transactions`).
- **Name sanitization** (`src/lib/envelopeName.js`): `sanitizeEnvelopeName` allows ANY UTF-8 (emoji/accents), trims + caps by **grapheme** count (`Intl.Segmenter`, max 40). Merchant normalization is NEVER applied to names. Column stays `text`.
- **Assignment persistence (BUG #2 fix)**: all envelope-assign writes (`commitAssign`, `TxEditSheet.save`) use `.update(...).select('id')`, set BOTH `envelope_id` + `assigned_at`, surface errors, and treat 0-rows-no-error as failure (RLS) with a neutral toast. Merchant-hint upsert + derived spent run only after a confirmed write. RLS parity migration guarantees shared-book partners can assign.
- **Categories → envelopes** (many→one): `categories.envelope_id` (nullable; NULL = unmapped/optional, keeps lazy seeding + starter flow working — Unsorted is the conceptual holding state). On a transaction, setting a category auto-sets its envelope; picking an envelope with exactly one category auto-sets that category (`pickCategory`/`pickEnvelope` in `AddTxModal`). Editing a category's envelope in `EnvelopeSheet` (category chips) calls `apply_category_envelope(p_category_id)` RPC to reassign that category's transactions — envelope-via-category is the single source of truth; no flow sets category+envelope to conflicting values.
- **Safe-to-spend from envelopes** (`computeUnallocated` in `envelopeLogic.js`): `unallocated = totalCash − Σ envelope remaining (floored at 0, catchall excluded) − bills before next income`. Bills via shared `billsBeforeNextIncome` (`src/lib/cashflowDerive.js`, which now owns `toDateStr`/`parseDateLocal`/`expandTx`/`getOverride` — App.jsx imports them). Now-tab hero derives from envelope remainders (shows a setup prompt when no accounts). Envelopes tab shows an **unallocated card** ("$X not yet given a job" + "Give it a job" → new envelope). Remainders are reactive (derived from assigned transactions).
- **Starter envelopes** (`STARTER_ENVELOPES` in `envelopeInbox.js`, `StarterSetup` in `EnvelopesTab.jsx`): shown when zero real (non-catchall) envelopes. Food 🍎 / Home 🏠 / Getting around 🚌 / Fun 🎮 / optional Pets 🐾 — editable names + toggles, then an allocation step with a prominent "Decide amounts later" skip (creates them unallocated). No-allocation envelopes render with no fill bar, just activity (`env.spent_no_alloc`).
- **The "Whatever" catchall** (`is_catchall`): one permanent, never-deletable system envelope per book — created by `ensure_catchall_envelope` (backfill + `books` insert trigger + recreated in `reset_book_data`). Renameable, no allocation/bar/low-state; card shows only "$X flowed through here this cycle" (`flowThrough`, cycle-windowed). Always the final chip in every picker/inbox row (`EnvChips`, AddTxModal, TxEditSheet). Never a suggestion (`suggestEnvelopeId` `excludeIds`), never an "Accept all" target, never auto-dumped into. **Composting nudge** (`buildCompostingSuggestion`, floor 3): when a merchant lands in the catchall 3+ times, one inline suggestion offers a real home → Accept reassigns that merchant's catchall txns + relearns the hint + drops the catchall hint; "No thanks" writes a `merchant_catchall_dismissals` row (per-book, never re-asked). Max one nudge at a time.
- **Tests**: `src/lib/__tests__/envelopeSystem.test.js` (vitest; `npm test`) covers emoji name save, grapheme cap, unallocated math, catchall exclusion, composting fire/dismiss/no-stack, starter set shape.

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
- **Accounts** box: grouped into Debit / Savings / Credit sections (only groups with accounts shown), each with its own subtotal — no combined grand total. Tap any row to open ReconcileModal for that account
- **14-day calendar grid**: 7-col × 2-row, each cell shows day net flow; payday cell highlighted green, today purple. Tap a day to open a bottom sheet listing that date's transactions + day net. All calendar date strings use local time via `toDateStr()` (not UTC `toISOString`) so amounts land on the correct day in every timezone
- **Bills til next payday**: expenses due before the next income transaction, with running total
- **Envelopes**: loads active standalone `envelopes` from Supabase (non-archived), shows every one with a usage bar (tight ones at ≥90% go orange/red) → tap or "Go to Envelopes →" navigates to the Envelopes tab (`onGoToEnvelopes`)

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
- `StackMenu` lists: Envelopes ✉, Cycles ⊙, Goals ◈, Accounts ◎, ─ divider, Appearance, Notifications, Share Book, Start from Scratch, Sign Out (no decorative emojis — menu labels are plain text)
- Tapping Envelopes/Cycles/Goals/Accounts navigates to those full-screen tabs (activeTab state)
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
- **Now (⌂)**: OverviewTab — safe-to-spend hero, accounts, today's activity, envelopes (direct visibility), upcoming bills
- **Ahead (→)**: AheadTab — pay cycle countdown, next 30-day timeline grouped by date, tap to approve/skip/edit amount. Per-day running balance is seeded from spendable accounts only (`include_in_safe_to_spend`) and always shows 2 decimals (`fmt`, not `fmtAmt`)
- **Flow (≡)**: TransactionsTab — full instance list past 90d + future 30d, sort by date/amount with asc/desc toggle (default: date desc), filter by type/account/category, tap to edit via EditTxSheet
- **Cycles (⊙)**: CyclesTab (via StackMenu) — pay cycle management and (legacy) per-cycle envelope budgets
- **Envelopes (✉)**: EnvelopesTab (via StackMenu) — standalone budget envelopes; see "Envelopes Feature" above
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

