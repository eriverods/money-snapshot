-- BUG #2 (assignment doesn't persist on shared books): guarantee that anyone
-- with book access can UPDATE a transaction — including assigning envelope_id /
-- assigned_at. A pre-existing owner-only UPDATE policy silently updates 0 rows
-- (no error) for a shared partner, which reads in the UI as "it didn't save".
--
-- Permissive policies are OR'd, so this can only broaden access for legitimate
-- book members; it never loosens cross-book isolation (user_has_book_access
-- gates both owner and book_members). WITH CHECK keeps the row in-book after
-- the update.
--
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

alter table cashflow_transactions enable row level security;

drop policy if exists cashflow_tx_book_access on cashflow_transactions;
create policy cashflow_tx_book_access on cashflow_transactions
  for all
  using (user_has_book_access(book_id))
  with check (user_has_book_access(book_id));
