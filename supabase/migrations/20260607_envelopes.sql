-- Standalone Envelopes feature.
-- Envelopes become first-class (their own tab) and can be:
--   • linked to a pay cycle  (link_type = 'cycle', cycle_id set)
--   • linked to a fixed time period (link_type = 'time', period = weekly/biweekly/monthly)
--   • unlinked / always-on    (link_type = 'none')
-- When a linked (cycle or time) period ends, leftover money can:
--   • roll over into the next period   (rollover_mode = 'rollover')
--   • move to a savings goal           (rollover_mode = 'savings', rollover_goal_id set)
--   • simply reset                     (rollover_mode = 'none')
--
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

create table if not exists envelopes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  name text not null,
  color text,
  emoji text,
  allocated_amount numeric not null default 0,   -- base budget per period
  spent_amount numeric not null default 0,       -- spent in the current period
  carryover_amount numeric not null default 0,   -- leftover rolled in from last period
  link_type text not null default 'none',        -- 'cycle' | 'time' | 'none'
  period text,                                   -- 'weekly' | 'biweekly' | 'monthly' (time-based)
  period_start date,                             -- current period window start
  period_end date,                               -- current period window end
  cycle_id uuid references pay_cycles(id) on delete set null,        -- when link_type = 'cycle'
  rollover_mode text not null default 'rollover',                    -- 'rollover' | 'savings' | 'none'
  rollover_goal_id uuid references savings_goals(id) on delete set null,
  display_order int default 0,
  archived boolean default false,
  created_at timestamptz default now()
);

-- History of closed-out periods. Powers behaviour learning / suggestions.
create table if not exists envelope_period_history (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references envelopes(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  name text,
  period_start date,
  period_end date,
  allocated_amount numeric,   -- base + carryover available that period
  spent_amount numeric,
  leftover numeric,           -- allocated - spent (may be negative if overspent)
  rollover_mode text,
  closed_at timestamptz default now()
);

create index if not exists idx_envelopes_book on envelopes(book_id);
create index if not exists idx_envelopes_cycle on envelopes(cycle_id);
create index if not exists idx_env_history_book on envelope_period_history(book_id);
create index if not exists idx_env_history_env on envelope_period_history(envelope_id);

-- RLS
alter table envelopes enable row level security;
alter table envelope_period_history enable row level security;

drop policy if exists envelopes_access on envelopes;
create policy envelopes_access on envelopes
  for all using (user_has_book_access(book_id)) with check (user_has_book_access(book_id));

drop policy if exists env_history_access on envelope_period_history;
create policy env_history_access on envelope_period_history
  for all using (user_has_book_access(book_id)) with check (user_has_book_access(book_id));

-- Fold the new tables into the "Start from Scratch" reset.
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
