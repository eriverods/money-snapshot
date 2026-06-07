-- Fix: "permission denied for table users" when sharing a book.
--
-- Cause: the RLS policies for the sharing tables matched the invitee by their
-- email via a subquery against `auth.users` (e.g.
-- `email = (select email from auth.users where id = auth.uid())`).
-- The `authenticated` role has no SELECT grant on `auth.users`, so any time a
-- policy evaluated that subquery Postgres raised "permission denied for table
-- users". This fired the moment an owner upserted an invite, because PostgREST
-- re-selects the returned row and runs the SELECT policy.
--
-- Fix: read the caller's email from the JWT (`auth.jwt() ->> 'email'`) instead
-- of querying `auth.users`. This also redefines `user_has_book_access` as a
-- SECURITY DEFINER function so it can read `book_members` without recursing
-- through that table's own RLS.
--
-- Run in Supabase -> SQL Editor. (RLS changes take effect immediately; a
-- schema cache reload is not required. If desired: NOTIFY pgrst, 'reload schema';)

-- ---------------------------------------------------------------------------
-- Drop EVERY existing policy on the sharing tables first. The original
-- dashboard-created policies may have different names than ours, and a single
-- leftover policy that references auth.users will keep throwing "permission
-- denied for table users" even after we add the corrected policies (a hard
-- error in any OR'd permissive policy fails the whole query).
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select policyname, tablename
    from pg_policies
    where schemaname = 'public'
      and tablename in ('book_invites', 'book_members')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Shared access helper (owner OR accepted member). SECURITY DEFINER so the
-- book_members lookup bypasses RLS and never recurses.
-- ---------------------------------------------------------------------------
create or replace function public.user_has_book_access(p_book_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.books b
    where b.id = p_book_id and b.owner_user_id = auth.uid()
  ) or exists (
    select 1 from public.book_members m
    where m.book_id = p_book_id and m.user_id = auth.uid()
  );
$$;

grant execute on function public.user_has_book_access(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- book_invites
-- ---------------------------------------------------------------------------
alter table public.book_invites enable row level security;

-- Owner of the book sees all its invites; an invitee sees invites addressed to
-- their own email (matched via the JWT, NOT auth.users).
drop policy if exists "book_invites_select" on public.book_invites;
create policy "book_invites_select" on public.book_invites
  for select using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
    or email = (auth.jwt() ->> 'email')
  );

-- Only the book owner can create invites.
drop policy if exists "book_invites_insert" on public.book_invites;
create policy "book_invites_insert" on public.book_invites
  for insert with check (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
  );

-- Owner can manage invites; invitee can update (accept/decline) their own.
drop policy if exists "book_invites_update" on public.book_invites;
create policy "book_invites_update" on public.book_invites
  for update using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
    or email = (auth.jwt() ->> 'email')
  );

-- Only the book owner can cancel/delete invites.
drop policy if exists "book_invites_delete" on public.book_invites;
create policy "book_invites_delete" on public.book_invites
  for delete using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- book_members
-- ---------------------------------------------------------------------------
alter table public.book_members enable row level security;

-- Anyone with access to the book (owner or member) can see the member list.
drop policy if exists "book_members_select" on public.book_members;
create policy "book_members_select" on public.book_members
  for select using (user_has_book_access(book_id));

-- The owner can add members directly; an invitee can add themselves when they
-- have a pending invite addressed to their email (the accept-invite flow).
drop policy if exists "book_members_insert" on public.book_members;
create policy "book_members_insert" on public.book_members
  for insert with check (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
    or (
      user_id = auth.uid()
      and exists (
        select 1 from public.book_invites i
        where i.book_id = book_members.book_id
          and i.email = (auth.jwt() ->> 'email')
          and i.status = 'pending'
      )
    )
  );

-- The owner can remove members; a member can remove themselves.
drop policy if exists "book_members_delete" on public.book_members;
create policy "book_members_delete" on public.book_members
  for delete using (
    exists (
      select 1 from public.books b
      where b.id = book_id and b.owner_user_id = auth.uid()
    )
    or user_id = auth.uid()
  );
