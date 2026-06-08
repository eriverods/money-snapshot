-- Add a per-user text size preference (used by the Appearance sheet).
-- 'default' keeps the current sizing; large/larger/largest scale the whole UI
-- proportionally via CSS zoom so boxes never clip.
alter table public.user_preferences
  add column if not exists font_size text not null default 'default'
    check (font_size in ('default', 'large', 'larger', 'largest'));
