-- Add type column to cashflow_accounts if it doesn't exist.
-- Run this in Supabase → SQL Editor, then reload the PostgREST schema cache
-- (Supabase dashboard → Settings → API → "Reload schema cache").

ALTER TABLE cashflow_accounts
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'checking';
