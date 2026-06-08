-- Permanently delete a whole book (owner only): wipes all of its data, its
-- membership/invite rows, then the book itself.
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".
create or replace function delete_book(p_book_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the owner may delete a book (members can only leave).
  if not exists (
    select 1 from books where id = p_book_id and owner_user_id = auth.uid()
  ) then
    raise exception 'Only the owner can delete this book';
  end if;

  -- Erase all content (accounts, transactions, cycles, envelopes, goals, …).
  perform reset_book_data(p_book_id);

  delete from book_invites where book_id = p_book_id;
  delete from book_members where book_id = p_book_id;

  -- Per-book notification settings are optional; ignore if the table/column
  -- doesn't exist in this environment.
  begin
    delete from notification_settings where book_id = p_book_id;
  exception when undefined_table or undefined_column then null;
  end;

  delete from books where id = p_book_id;
end;
$$;

grant execute on function delete_book(uuid) to authenticated;
