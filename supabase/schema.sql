-- JANSETU: Run once in Supabase Dashboard > SQL Editor > New Query.
-- Production-ready baseline: Auth users, row-level security, public evidence images,
-- moderator-only report status changes, and live report notifications.
-- IMPORTANT: Run in a NEW Supabase project or inspect conflicts before re-running.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  constraint profile_name_length check (char_length(full_name) <= 80)
);

create table if not exists public.admins (
  id uuid primary key references auth.users(id) on delete cascade,
  granted_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  address_text text not null,
  latitude double precision,
  longitude double precision,
  image_path text not null,
  status text not null default 'Reported',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint valid_title check (char_length(trim(title)) between 8 and 110),
  constraint valid_description check (char_length(trim(description)) between 20 and 2500),
  constraint valid_location check (char_length(trim(address_text)) between 5 and 200),
  constraint valid_category check (category in ('Roads','Streetlights','Waste','Water','Public Safety','Infrastructure','Other')),
  constraint valid_status check (status in ('Reported','In Review','In Progress','Resolved','Verified')),
  constraint valid_latitude check (latitude is null or (latitude between -90 and 90)),
  constraint valid_longitude check (longitude is null or (longitude between -180 and 180)),
  constraint paired_coordinates check ((latitude is null) = (longitude is null)),
  constraint valid_image_path check (image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
);

create table if not exists public.report_supports (
  report_id uuid not null references public.reports(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (report_id, user_id)
);

create table if not exists public.report_status_events (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.reports(id) on delete cascade,
  status text not null,
  created_at timestamptz not null default now(),
  constraint valid_event_status check (status in ('Reported','In Review','In Progress','Resolved','Verified'))
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  report_id uuid references public.reports(id) on delete cascade,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists reports_created_idx on public.reports(created_at desc);
create index if not exists reports_author_idx on public.reports(author_id,created_at desc);
create index if not exists supports_user_idx on public.report_supports(user_id);
create index if not exists supports_report_idx on public.report_supports(report_id);
create index if not exists events_report_idx on public.report_status_events(report_id,created_at);
create index if not exists notifications_user_idx on public.notifications(user_id,created_at desc);

-- Auth registrations (email/password, Google and phone OTP) all create a profile.
create or replace function public.on_auth_user_created()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id,full_name)
  values (new.id, left(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),nullif(new.raw_user_meta_data->>'name',''), ''),80))
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists jan_auth_user_created on auth.users;
create trigger jan_auth_user_created after insert on auth.users for each row execute function public.on_auth_user_created();
-- If project already contains users, create missing profiles without overwriting existing.
insert into public.profiles(id,full_name)
select id,left(coalesce(raw_user_meta_data->>'full_name',raw_user_meta_data->>'name',''),80)
from auth.users on conflict (id) do nothing;

-- Automatically generate audit events and notify reporters when moderators change statuses.
create or replace function public.report_state_changes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.report_status_events (report_id,status) values(new.id,new.status);
  elsif old.status is distinct from new.status then
    insert into public.report_status_events (report_id,status) values(new.id,new.status);
    insert into public.notifications (user_id, report_id, message)
    values (new.author_id, new.id, 'Your report "' || left(new.title,70) || '" is now ' || new.status || '.');
  end if;
  return new;
end;
$$;
drop trigger if exists jan_report_state on public.reports;
create trigger jan_report_state after insert or update of status on public.reports
for each row execute function public.report_state_changes();

create or replace function public.set_report_updated_at()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
drop trigger if exists jan_report_timestamp on public.reports;
create trigger jan_report_timestamp before update on public.reports for each row execute function public.set_report_updated_at();

-- RLS: private accounts, public-to-members community feed, strict authorship.
alter table public.profiles enable row level security;
alter table public.admins enable row level security;
alter table public.reports enable row level security;
alter table public.report_supports enable row level security;
alter table public.report_status_events enable row level security;
alter table public.notifications enable row level security;

create policy "read my profile" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "edit my profile" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
create policy "see my moderator access" on public.admins for select to authenticated using (id = (select auth.uid()));
create policy "members read community reports" on public.reports for select to authenticated using (true);
create policy "members submit own new reports" on public.reports for insert to authenticated
  with check (author_id = (select auth.uid()) and status = 'Reported' and split_part(image_path,'/',1) = (select auth.uid())::text);
create policy "authors delete own reports" on public.reports for delete to authenticated
  using (author_id = (select auth.uid()));
create policy "members read their own supports" on public.report_supports for select to authenticated using (user_id = (select auth.uid()));
create policy "members support reports" on public.report_supports for insert to authenticated with check (user_id = (select auth.uid()));
create policy "members retract support" on public.report_supports for delete to authenticated using (user_id = (select auth.uid()));
create policy "members read report timeline" on public.report_status_events for select to authenticated using (true);
create policy "members see their notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "members mark their notifications" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Restrict writes at both the GRANT and RLS layers.
revoke all on public.profiles,public.admins,public.reports,public.report_supports,public.report_status_events,public.notifications from anon;
revoke all on public.profiles,public.admins,public.reports,public.report_supports,public.report_status_events,public.notifications from authenticated;
grant select on public.profiles,public.admins,public.reports,public.report_supports,public.report_status_events,public.notifications to authenticated;
grant update(full_name) on public.profiles to authenticated;
grant insert,delete on public.reports to authenticated;
grant insert,delete on public.report_supports to authenticated;
grant update(is_read) on public.notifications to authenticated;

-- Return only total support count. Public API cannot read other supporters' user IDs.
create or replace function public.report_support_total(p_report_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.report_supports s where s.report_id = p_report_id;
$$;
revoke all on function public.report_support_total(uuid) from public,anon;
grant execute on function public.report_support_total(uuid) to authenticated;

-- Per-row counts + supported-by-me are calculated server-side in Postgres.
-- SECURITY INVOKER on the view keeps reports RLS active for every request.
create or replace view public.report_feed with (security_invoker = true) as
select r.*,
       public.report_support_total(r.id) as support_count,
       exists (select 1 from public.report_supports s where s.report_id=r.id and s.user_id=(select auth.uid())) as supported_by_me
from public.reports r;
revoke all on public.report_feed from anon,public;
grant select on public.report_feed to authenticated;

-- Only moderators (added manually in the SQL editor) can update report status.
create or replace function public.moderator_set_status(p_report_id uuid,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not exists (select 1 from public.admins a where a.id=(select auth.uid())) then
    raise exception 'Moderator permission required';
  end if;
  if p_status not in ('Reported','In Review','In Progress','Resolved') then
    raise exception 'Invalid moderator status';
  end if;
  update public.reports set status=p_status where id=p_report_id;
  if not found then raise exception 'Report not found'; end if;
end;
$$;

-- Only the author can certify a moderator-resolved issue as actually verified.
create or replace function public.verify_resolution(p_report_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign-in required'; end if;
  update public.reports set status='Verified'
  where id=p_report_id and author_id=(select auth.uid()) and status='Resolved';
  if not found then raise exception 'Only the author can verify a resolved report'; end if;
end;
$$;
revoke all on function public.moderator_set_status(uuid,text) from public,anon;
revoke all on function public.verify_resolution(uuid) from public,anon;
grant execute on function public.moderator_set_status(uuid,text),public.verify_resolution(uuid) to authenticated;

-- Public evidence bucket: uploaded images are accessible to anyone with the photo URL.
-- UI discloses this before submission; don't upload faces, IDs or private addresses.
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('issue-photos','issue-photos',true,8388608,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=excluded.public,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
create policy "signed-in members can inspect photo metadata" on storage.objects for select to authenticated
  using (bucket_id='issue-photos');
create policy "authenticated photo uploads in own folder" on storage.objects for insert to authenticated
  with check (bucket_id='issue-photos' and (storage.foldername(name))[1]=(select auth.uid())::text and lower(storage.extension(name)) in ('jpg','jpeg','png','webp'));
create policy "delete my abandoned uploads" on storage.objects for delete to authenticated
  using (bucket_id='issue-photos' and (storage.foldername(name))[1]=(select auth.uid())::text
    and not exists(select 1 from public.reports r where r.image_path=name));

-- Enable live updates for report state changes and private notifications.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='reports') then
    alter publication supabase_realtime add table public.reports;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
exception when undefined_object then
  raise notice 'Realtime publication not present. Rest endpoints will still work.';
end $$;

-- OPTIONAL: To give a trusted individual moderator access, AFTER that user signs up:
-- insert into public.admins (id) select id from auth.users where email='trusted-moderator@example.com';
-- Do NOT expose a self-register-as-admin control in the browser.
