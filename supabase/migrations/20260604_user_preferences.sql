create table if not exists public.user_preferences (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  palette       text not null default 'still_water'
                  check (palette in ('warm_dusk', 'still_water', 'soft_earth')),
  mode          text not null default 'dark'
                  check (mode in ('light', 'dark')),
  accessibility text not null default 'none'
                  check (accessibility in ('none', 'high_contrast', 'colorblind_safe')),
  updated_at    timestamptz default now()
);

alter table public.user_preferences enable row level security;

create policy "Users manage own preferences" on public.user_preferences
  for all using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
