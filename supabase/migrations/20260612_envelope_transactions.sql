-- Envelopes-first tab: assign transactions to envelopes + merchant learning.
--
-- Transactions gain an optional envelope_id. NULL = the transaction lives in the
-- "Needs a home" inbox. When an envelope is deleted, its transactions return to
-- the inbox (on delete set null) rather than being orphaned, and any merchant
-- hints pointing at it are removed (on delete cascade).
--
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

alter table cashflow_transactions
  add column if not exists envelope_id uuid references envelopes(id) on delete set null,
  add column if not exists assigned_at timestamptz;

create index if not exists idx_cf_tx_envelope on cashflow_transactions(envelope_id);

-- Merchant → envelope learning. One row per (book, normalized merchant, envelope).
-- assignment_count powers the suggestion confidence floor (>= 2 to suggest).
create table if not exists merchant_envelope_hints (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  merchant_normalized text not null,
  envelope_id uuid not null references envelopes(id) on delete cascade,
  assignment_count int not null default 1,
  last_assigned_at timestamptz default now(),
  unique (book_id, merchant_normalized, envelope_id)
);

create index if not exists idx_meh_book_merchant on merchant_envelope_hints(book_id, merchant_normalized);

-- RLS — hints are per-book so both partners in a shared book benefit.
alter table merchant_envelope_hints enable row level security;
drop policy if exists meh_access on merchant_envelope_hints;
create policy meh_access on merchant_envelope_hints
  for all using (user_has_book_access(book_id)) with check (user_has_book_access(book_id));

-- Inbox nudge bookkeeping (max one push per 3 days, opt-out per book).
alter table notification_settings
  add column if not exists inbox_reminders boolean default true,
  add column if not exists last_inbox_nudge_at timestamptz;

-- Fold merchant hints into the "Start from Scratch" reset. Transactions are
-- already deleted below, which clears their envelope assignment implicitly.
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

  delete from merchant_envelope_hints where book_id = p_book_id;
  delete from envelope_period_history where book_id = p_book_id;
  delete from envelopes where book_id = p_book_id;

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
