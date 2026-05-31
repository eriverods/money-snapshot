-- Add track_only flag to cashflow_accounts.
-- Tracking-only accounts show in the UI but are excluded from safe-to-spend,
-- running balance projections, and calendar balance calculations.
-- Run in Supabase → SQL Editor, then Settings → API → Reload schema cache.

ALTER TABLE cashflow_accounts
  ADD COLUMN IF NOT EXISTS track_only boolean NOT NULL DEFAULT false;
