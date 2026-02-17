-- Table qui stocke exactement les mêmes payloads que le localStorage,
-- mais par utilisateur (auth Supabase) pour accéder à l'historique depuis n'importe quel appareil.

create table if not exists public.workout_entries (
  user_id uuid not null references auth.users (id) on delete cascade,
  week integer not null,
  day text not null,
  exo_id text not null,
  payload jsonb not null,
  updated_at_ms bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, week, day, exo_id)
);

alter table public.workout_entries enable row level security;

create policy "workout_entries_select_own"
on public.workout_entries for select
to authenticated
using (auth.uid() = user_id);

create policy "workout_entries_insert_own"
on public.workout_entries for insert
to authenticated
with check (auth.uid() = user_id);

create policy "workout_entries_update_own"
on public.workout_entries for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy "workout_entries_delete_own"
on public.workout_entries for delete
to authenticated
using (auth.uid() = user_id);

