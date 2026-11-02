-- UoFC Funding Tracker — initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.app_role as enum ('admin', 'officer', 'viewer');
create type public.upload_status as enum ('accepted', 'superseded');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.app_role not null default 'viewer',
  created_at  timestamptz not null default now()
);

create table public.funding_sources (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  short_name  text,
  created_at  timestamptz not null default now()
);

-- Which funding sources an officer may upload for.
create table public.officer_sources (
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  source_id   uuid not null references public.funding_sources (id) on delete cascade,
  primary key (profile_id, source_id)
);

create table public.clubs (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- Every spelling of a club name we have ever seen, normalized, pointing at the canonical club.
create table public.club_aliases (
  alias       text primary key,           -- normalized (see normalize_name)
  display     text not null,              -- as it appeared in a spreadsheet
  club_id     uuid not null references public.clubs (id) on delete cascade,
  created_at  timestamptz not null default now()
);
create index club_aliases_club_id_idx on public.club_aliases (club_id);

create table public.uploads (
  id             uuid primary key default gen_random_uuid(),
  source_id      uuid not null references public.funding_sources (id),
  uploaded_by    uuid references public.profiles (id),
  academic_year  text not null,           -- e.g. '2026-27'
  period         text not null,           -- e.g. 'Round 4', 'Fall', 'Spring'
  file_name      text,
  storage_path   text,
  mapping        jsonb,                   -- the column mapping that was confirmed
  row_count      integer not null default 0,
  total_amount   numeric(12,2) not null default 0,
  status         public.upload_status not null default 'accepted',
  superseded_by  uuid references public.uploads (id),
  created_at     timestamptz not null default now()
);
create index uploads_source_period_idx on public.uploads (source_id, academic_year, period);

create table public.allocations (
  id             uuid primary key default gen_random_uuid(),
  upload_id      uuid not null references public.uploads (id) on delete cascade,
  source_id      uuid not null references public.funding_sources (id),
  club_id        uuid not null references public.clubs (id),
  academic_year  text not null,
  period         text not null,
  amount         numeric(12,2) not null,
  purpose        text,
  raw_row        jsonb,                   -- the original spreadsheet row, never lost
  created_at     timestamptz not null default now()
);
create index allocations_club_idx on public.allocations (club_id);
create index allocations_source_idx on public.allocations (source_id);
create index allocations_upload_idx on public.allocations (upload_id);
create index allocations_year_idx on public.allocations (academic_year);

-- ---------------------------------------------------------------------------
-- Helper functions
-- ---------------------------------------------------------------------------

-- Must match normalizeName() in src/lib/parse/normalize.ts
create or replace function public.normalize_name(p text)
returns text language sql immutable as $$
  select trim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.current_app_role()
returns public.app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.can_write_source(p_source uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (
        select 1 from public.officer_sources os
        join public.profiles p on p.id = os.profile_id
        where os.profile_id = auth.uid() and os.source_id = p_source and p.role in ('officer', 'admin')
      );
$$;

create or replace function public.can_edit_clubs()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'officer') from public.profiles where id = auth.uid()), false);
$$;

-- Create a profile row for every new auth user. The very first user becomes admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_role public.app_role := 'viewer';
begin
  if not exists (select 1 from public.profiles where role = 'admin') then
    v_role := 'admin';
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- commit_upload: atomically record one reviewed spreadsheet.
--   p_rows is a jsonb array of objects:
--     { "club_id": uuid | null, "club_name": text, "amount": number, "purpose": text|null, "raw": object }
--   If club_id is null the club is looked up by alias, then created if still unknown.
--   The raw club_name is always saved as an alias for the resolved club.
--   Any previously accepted upload for the same (source, year, period) is marked superseded.
-- ---------------------------------------------------------------------------
create or replace function public.commit_upload(
  p_source_id     uuid,
  p_academic_year text,
  p_period        text,
  p_file_name     text,
  p_storage_path  text,
  p_mapping       jsonb,
  p_rows          jsonb
) returns uuid
language plpgsql security invoker set search_path = public as $$
declare
  v_upload_id uuid;
  v_row       jsonb;
  v_club_id   uuid;
  v_name      text;
  v_norm      text;
  v_amount    numeric(12,2);
  v_count     integer := 0;
  v_total     numeric(12,2) := 0;
begin
  if not public.can_write_source(p_source_id) then
    raise exception 'You do not have permission to upload for this funding source';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'No rows to commit';
  end if;

  insert into public.uploads (source_id, uploaded_by, academic_year, period, file_name, storage_path, mapping)
  values (p_source_id, auth.uid(), p_academic_year, p_period, p_file_name, p_storage_path, p_mapping)
  returning id into v_upload_id;

  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_name := nullif(trim(v_row ->> 'club_name'), '');
    v_norm := public.normalize_name(v_name);
    v_club_id := nullif(v_row ->> 'club_id', '')::uuid;

    if v_club_id is null then
      select club_id into v_club_id from public.club_aliases where alias = v_norm;
    end if;
    if v_club_id is null then
      if v_name is null then
        raise exception 'Row without a club name cannot be committed';
      end if;
      insert into public.clubs (name) values (v_name)
      on conflict (name) do update set name = excluded.name
      returning id into v_club_id;
    end if;

    if v_norm <> '' then
      insert into public.club_aliases (alias, display, club_id)
      values (v_norm, v_name, v_club_id)
      on conflict (alias) do nothing;
    end if;

    v_amount := (v_row ->> 'amount')::numeric(12,2);
    insert into public.allocations (upload_id, source_id, club_id, academic_year, period, amount, purpose, raw_row)
    values (v_upload_id, p_source_id, v_club_id, p_academic_year, p_period, v_amount,
            nullif(trim(v_row ->> 'purpose'), ''), v_row -> 'raw');

    v_count := v_count + 1;
    v_total := v_total + v_amount;
  end loop;

  update public.uploads set row_count = v_count, total_amount = v_total where id = v_upload_id;

  update public.uploads
     set status = 'superseded', superseded_by = v_upload_id
   where source_id = p_source_id
     and academic_year = p_academic_year
     and period = p_period
     and status = 'accepted'
     and id <> v_upload_id;

  return v_upload_id;
end;
$$;

-- Merge one club into another (admin only). Keeps every alias so the name resolves next time.
create or replace function public.merge_clubs(p_from uuid, p_into uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare
  v_from_name text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can merge clubs';
  end if;
  if p_from = p_into then return; end if;
  select name into v_from_name from public.clubs where id = p_from;
  update public.allocations set club_id = p_into where club_id = p_from;
  update public.club_aliases set club_id = p_into where club_id = p_from;
  insert into public.club_aliases (alias, display, club_id)
  values (public.normalize_name(v_from_name), v_from_name, p_into)
  on conflict (alias) do update set club_id = p_into;
  delete from public.clubs where id = p_from;
end;
$$;

-- ---------------------------------------------------------------------------
-- Master view: only allocations from currently accepted uploads.
-- ---------------------------------------------------------------------------
create or replace view public.master_allocations
with (security_invoker = true) as
select
  a.id,
  a.club_id,
  c.name            as club_name,
  a.source_id,
  s.name            as source_name,
  s.short_name      as source_short_name,
  a.academic_year,
  a.period,
  a.amount,
  a.purpose,
  a.upload_id,
  u.created_at      as uploaded_at
from public.allocations a
join public.uploads u on u.id = a.upload_id and u.status = 'accepted'
join public.clubs c on c.id = a.club_id
join public.funding_sources s on s.id = a.source_id;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.funding_sources enable row level security;
alter table public.officer_sources enable row level security;
alter table public.clubs           enable row level security;
alter table public.club_aliases    enable row level security;
alter table public.uploads         enable row level security;
alter table public.allocations     enable row level security;

-- profiles
create policy "profiles: signed-in users can read"   on public.profiles for select to authenticated using (true);
create policy "profiles: admins update any"          on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- funding_sources
create policy "sources: signed-in users can read"    on public.funding_sources for select to authenticated using (true);
create policy "sources: admins manage"               on public.funding_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- officer_sources
create policy "officer_sources: signed-in read"      on public.officer_sources for select to authenticated using (true);
create policy "officer_sources: admins manage"       on public.officer_sources for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- clubs / aliases
create policy "clubs: signed-in read"                on public.clubs for select to authenticated using (true);
create policy "clubs: officers+admins insert"        on public.clubs for insert to authenticated with check (public.can_edit_clubs());
create policy "clubs: admins update/delete"          on public.clubs for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "clubs: admins delete"                 on public.clubs for delete to authenticated using (public.is_admin());

create policy "aliases: signed-in read"              on public.club_aliases for select to authenticated using (true);
create policy "aliases: officers+admins insert"      on public.club_aliases for insert to authenticated with check (public.can_edit_clubs());
create policy "aliases: admins update"               on public.club_aliases for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "aliases: admins delete"               on public.club_aliases for delete to authenticated using (public.is_admin());

-- uploads
create policy "uploads: signed-in read"              on public.uploads for select to authenticated using (true);
create policy "uploads: write own sources"           on public.uploads for insert to authenticated with check (public.can_write_source(source_id));
create policy "uploads: update own sources"          on public.uploads for update to authenticated using (public.can_write_source(source_id)) with check (public.can_write_source(source_id));
create policy "uploads: admins delete"               on public.uploads for delete to authenticated using (public.is_admin());

-- allocations
create policy "allocations: signed-in read"          on public.allocations for select to authenticated using (true);
create policy "allocations: write own sources"       on public.allocations for insert to authenticated with check (public.can_write_source(source_id));
create policy "allocations: admins delete"           on public.allocations for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for the original files
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', false)
on conflict (id) do nothing;

create policy "uploads bucket: signed-in read"
  on storage.objects for select to authenticated using (bucket_id = 'uploads');
create policy "uploads bucket: officers+admins write"
  on storage.objects for insert to authenticated with check (bucket_id = 'uploads' and public.can_edit_clubs());

-- ---------------------------------------------------------------------------
-- Starter data (edit freely)
-- ---------------------------------------------------------------------------
insert into public.funding_sources (name, short_name) values
  ('Undergraduate Organizations Funding Committee', 'UOFC')
on conflict (name) do nothing;
