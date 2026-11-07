-- JanSetu production upgrade v6: private support votes + owner-only deletion
-- Run ONCE in Supabase SQL Editor for the EXISTING JanSetu project.
-- Does not delete existing reports or support votes. Transaction is all-or-nothing.
begin;

-- Existing policy allowed any signed-in user to read every (report_id,user_id) pair.
-- Replace it so members can only inspect their OWN vote records.
drop policy if exists "members read support counts" on public.report_supports;
drop policy if exists "members read their own supports" on public.report_supports;
create policy "members read their own supports" on public.report_supports
  for select to authenticated using (user_id = (select auth.uid()));

-- Security-definer COUNT sees all votes, but exposes only an integer (never user IDs).
-- Since the view uses security_invoker, the caller still needs RLS access to reports.
create or replace function public.report_support_total(p_report_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.report_supports s where s.report_id = p_report_id;
$$;
revoke all on function public.report_support_total(uuid) from public,anon;
grant execute on function public.report_support_total(uuid) to authenticated;

-- Preserve the current view column names/order for backwards compatibility.
create or replace view public.report_feed with (security_invoker = true) as
select r.*,
       public.report_support_total(r.id) as support_count,
       exists (select 1 from public.report_supports s
               where s.report_id=r.id and s.user_id=(select auth.uid())) as supported_by_me
from public.reports r;
revoke all on public.report_feed from anon,public;
grant select on public.report_feed to authenticated;

-- Require ownership in BOTH browser query and Postgres RLS.
drop policy if exists "authors delete own reports" on public.reports;
create policy "authors delete own reports" on public.reports
  for delete to authenticated using (author_id = (select auth.uid()));
grant delete on public.reports to authenticated;

-- Existing foreign keys cascade related supports, status events and notifications.
-- Existing storage.objects DELETE policy permits author to remove photo AFTER its
-- report row has been removed. It blocks removing photos still used by reports.
commit;
