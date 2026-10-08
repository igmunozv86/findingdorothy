-- Account data for Supabase Auth. The page never stores a password.
-- Apply with the Supabase CLI against the project whose anon key the build reads.

create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  handle text,
  home_city text,
  updated_at timestamptz not null default now()
);

create table if not exists public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('venue', 'city')),
  ref text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, ref)
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id text not null,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create table if not exists public.alert_prefs (
  user_id uuid not null references auth.users (id) on delete cascade,
  scope text not null check (scope in ('venue', 'city')),
  ref text not null,
  enabled boolean not null default true,
  primary key (user_id, scope, ref)
);

create table if not exists public.reward_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id text not null,
  visited_on date not null default current_date,
  points integer not null default 1 check (points > 0)
);

alter table public.profiles enable row level security;
alter table public.favorites enable row level security;
alter table public.reviews enable row level security;
alter table public.alert_prefs enable row level security;
alter table public.reward_visits enable row level security;

create policy profiles_own on public.profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy favorites_own on public.favorites
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy reviews_own on public.reviews
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy alerts_own on public.alert_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy rewards_own on public.reward_visits
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  delete from public.reward_visits where user_id = uid;
  delete from public.alert_prefs where user_id = uid;
  delete from public.reviews where user_id = uid;
  delete from public.favorites where user_id = uid;
  delete from public.profiles where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;
