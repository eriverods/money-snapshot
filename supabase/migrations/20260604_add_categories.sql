-- Categories table (book-scoped, stores available spending categories)
create table if not exists public.categories (
  id          uuid default gen_random_uuid() primary key,
  book_id     uuid references public.books(id) on delete cascade not null,
  name        text not null,
  color       text,
  sort_order  int default 0,
  is_default  boolean default false,
  archived    boolean default false,
  created_at  timestamptz default now()
);

alter table public.categories enable row level security;

create policy "categories_select" on public.categories
  for select using (user_has_book_access(book_id));
create policy "categories_insert" on public.categories
  for insert with check (user_has_book_access(book_id));
create policy "categories_update" on public.categories
  for update using (user_has_book_access(book_id));
create policy "categories_delete" on public.categories
  for delete using (user_has_book_access(book_id));

-- Category column on transactions (text name, consistent with `account` field pattern)
alter table public.cashflow_transactions
  add column if not exists category text;
