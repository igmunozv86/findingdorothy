-- Check-ins and private reviews. Reviews stay on the author's row only.
-- Apply after 20261007040000_account.sql.

create table if not exists public.checkins (
  user_id uuid not null references auth.users (id) on delete cascade,
  venue_id text not null,
  created_at timestamptz not null default now(),
  lat double precision,
  lon double precision,
  primary key (user_id, venue_id)
);

alter table public.checkins enable row level security;

create policy checkins_own on public.checkins
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.reviews add column if not exists busyness smallint;
alter table public.reviews add column if not exists vibe_tags text[] not null default '{}';
alter table public.reviews add column if not exists note text;
alter table public.reviews alter column body drop not null;
alter table public.reviews drop constraint if exists reviews_body_check;
alter table public.reviews drop constraint if exists reviews_busyness_check;
alter table public.reviews drop constraint if exists reviews_note_check;
alter table public.reviews drop constraint if exists reviews_vibe_tags_check;
alter table public.reviews add constraint reviews_busyness_check check (busyness is null or busyness between 0 and 100);
alter table public.reviews add constraint reviews_note_check check (note is null or char_length(note) <= 500);
alter table public.reviews add constraint reviews_vibe_tags_check check (
  vibe_tags <@ array['young crowd', 'dancing', 'cruisy', 'chill', 'drag show tonight']::text[]
);

create or replace function public.check_in(p_venue text, p_lat double precision, p_lon double precision)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  prior record;
  km double precision;
  hours double precision;
  stamped timestamptz := now();
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select venue_id, created_at, lat, lon into prior
  from public.checkins
  where user_id = uid and venue_id <> p_venue
  order by created_at desc
  limit 1;
  if prior.venue_id is not null and prior.lat is not null and prior.lon is not null and p_lat is not null and p_lon is not null then
    km := 6371 * 2 * asin(sqrt(
      power(sin(radians(p_lat - prior.lat) / 2), 2)
      + cos(radians(prior.lat)) * cos(radians(p_lat)) * power(sin(radians(p_lon - prior.lon) / 2), 2)
    ));
    hours := extract(epoch from (stamped - prior.created_at)) / 3600;
    if km > 30 and hours >= 0 and km / greatest(hours, 0.0167) > 900 then
      raise exception 'too far from your last check-in';
    end if;
  end if;
  insert into public.checkins (user_id, venue_id, created_at, lat, lon)
  values (uid, p_venue, stamped, p_lat, p_lon)
  on conflict (user_id, venue_id) do update
  set created_at = excluded.created_at, lat = excluded.lat, lon = excluded.lon;
  return stamped;
end;
$$;

revoke all on function public.check_in(text, double precision, double precision) from public;
grant execute on function public.check_in(text, double precision, double precision) to authenticated;

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
  delete from public.checkins where user_id = uid;
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
