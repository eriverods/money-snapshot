-- Per-account control over Safe to Spend inclusion + free-form classification label.
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

ALTER TABLE cashflow_accounts
  ADD COLUMN IF NOT EXISTS include_in_safe_to_spend boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS classification text;

-- Preserve current behavior for existing accounts: credit and tracking-only
-- accounts were previously excluded from Safe to Spend, so keep them excluded.
UPDATE cashflow_accounts
  SET include_in_safe_to_spend = false
  WHERE type = 'credit' OR track_only = true;
