-- Envelope system spec: categories→envelopes, the permanent "Whatever" catchall,
-- and composting-nudge dismissals.
--
--   • envelopes.is_catchall    — the one permanent, never-deletable system envelope
--                                per book. No allocation, no fill bar, no shame.
--   • categories.envelope_id   — many categories → one envelope. Nullable: a NULL
--                                category is simply "not yet mapped" (still optional),
--                                so lazy category seeding and the interactive starter
--                                flow keep working. Orphaned categories that need a
--                                home use the Unsorted holding envelope (see below).
--   • merchant_catchall_dismissals — "No thanks" memory for the composting nudge, so
--                                we never re-ask about a merchant the user waved off.
--
-- Run in Supabase → SQL Editor, then Settings → API → "Reload schema cache".

-- ── Schema additions ─────────────────────────────────────────────────────────
alter table envelopes
  add column if not exists is_catchall boolean not null default false;

-- Only one catchall per book.
create unique index if not exists uniq_envelope_catchall_per_book
  on envelopes(book_id) where is_catchall;

alter table categories
  add column if not exists envelope_id uuid references envelopes(id) on delete set null;

create index if not exists idx_categories_envelope on categories(envelope_id);

-- Composting-nudge dismissals — per book, so both partners share the memory.
create table if not exists merchant_catchall_dismissals (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references books(id) on delete cascade,
  merchant_normalized text not null,
  dismissed_at timestamptz default now(),
  unique (book_id, merchant_normalized)
);

create index if not exists idx_mcd_book on merchant_catchall_dismissals(book_id);

alter table merchant_catchall_dismissals enable row level security;
drop policy if exists mcd_access on merchant_catchall_dismissals;
create policy mcd_access on merchant_catchall_dismissals
  for all using (user_has_book_access(book_id)) with check (user_has_book_access(book_id));

-- ── Catchall provisioning ────────────────────────────────────────────────────
-- Idempotently ensure a book has its permanent "Whatever" catchall envelope.
create or replace function ensure_catchall_envelope(p_book_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_order int;
begin
  select id into v_id from envelopes where book_id = p_book_id and is_catchall limit 1;
  if v_id is not null then
    return v_id;
  end if;
  select coalesce(max(display_order), 0) + 100 into v_order from envelopes where book_id = p_book_id;
  insert into envelopes (book_id, name, emoji, color, is_catchall, link_type,
                         allocated_amount, spent_amount, carryover_amount, display_order, archived)
  values (p_book_id, 'Whatever', '🌀', '#9b8fc9', true, 'none', 0, 0, 0, v_order, false)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function ensure_catchall_envelope(uuid) to authenticated;

-- Backfill: every existing book gets its catchall.
do $$
declare r record;
begin
  for r in select id from books loop
    perform ensure_catchall_envelope(r.id);
  end loop;
end $$;

-- Every future book gets its catchall on creation.
create or replace function trg_books_create_catchall()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform ensure_catchall_envelope(new.id);
  return new;
end;
$$;

drop trigger if exists books_create_catchall on books;
create trigger books_create_catchall
  after insert on books
  for each row execute function trg_books_create_catchall();

-- ── Reassign a category's transactions when its envelope changes ──────────────
-- Keeps envelope-via-category a single source of truth: editing a category's
-- envelope moves every transaction carrying that category to the new envelope.
create or replace function apply_category_envelope(p_category_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_book uuid;
  v_name text;
  v_env uuid;
begin
  select book_id, name, envelope_id into v_book, v_name, v_env
    from categories where id = p_category_id;
  if v_book is null then return; end if;
  if not user_has_book_access(v_book) then
    raise exception 'Not authorized for this book';
  end if;
  if v_env is null then return; end if;

  update cashflow_transactions
     set envelope_id = v_env,
         assigned_at = coalesce(assigned_at, now())
   where book_id = v_book
     and category = v_name
     and type = 'expense'
     and (envelope_id is distinct from v_env);
end;
$$;

grant execute on function apply_category_envelope(uuid) to authenticated;

-- ── Fold everything into the "Start from Scratch" reset ──────────────────────
-- After wiping a book we recreate its permanent catchall so the book is never
-- left without one.
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

  delete from merchant_catchall_dismissals where book_id = p_book_id;
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

  perform ensure_catchall_envelope(p_book_id);
end;
$$;

grant execute on function reset_book_data(uuid) to authenticated;
