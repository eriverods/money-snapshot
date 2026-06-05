-- "Start from Scratch": wipe all data in a single book, keeping the book itself.
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

create or replace function reset_book_data(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not user_has_book_access(p_book_id) then
    raise exception 'Not authorized for this book';
  end if;

  delete from cashflow_overrides
    where transaction_id in (select id from cashflow_transactions where book_id = p_book_id);
  delete from cashflow_transactions where book_id = p_book_id;

  delete from cycle_envelopes
    where cycle_id in (select id from pay_cycles where book_id = p_book_id);
  delete from pay_cycles where book_id = p_book_id;
  delete from envelope_templates where book_id = p_book_id;

  delete from savings_contributions
    where goal_id in (select id from savings_goals where book_id = p_book_id);
  delete from savings_goals where book_id = p_book_id;

  delete from categories where book_id = p_book_id;
  delete from cashflow_accounts where book_id = p_book_id;
end;
$$;

grant execute on function reset_book_data(uuid) to authenticated;
