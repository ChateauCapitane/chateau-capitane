-- ADR-0006: guests call or book on OpenTable; the site keeps no guest messages. Drops the inquiry data and the
-- functions only it used. Kept: staff_members, staff_role, require_staff, audit_events (role changes), rate_limit_hits /
-- hit_rate_limit, the login and track limits, security monitoring and the inquiry_private schema name.
-- Irreversible: the dropped rows cannot be restored from the database (backups hold them until they expire).

-- Redefine, without the dropped tables, the functions that read them. (Must come first.)
create or replace function public.ops_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'loginHitsNow', (select coalesce(sum(hits), 0)::int from inquiry_private.rate_limit_hits
      where bucket like 'login:%' and expires_at > now()),
    'securityHighOpen', (select count(*)::int from inquiry_private.security_incidents
      where severity = 'high' and status in ('open', 'investigating', 'contained')),
    'securityLastRunSeconds', (select floor(extract(epoch from now() - last_run))::int
      from inquiry_private.security_heartbeat where id = 1)
  );
$$;

create or replace function public.run_retention(p_limit integer default 200) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  audits integer; sec_events integer; sec_actions integer; sec_incidents integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid limit';
  end if;

  with doomed as (
    select id from inquiry_private.audit_events where created_at < now() - interval '24 months' limit p_limit)
  delete from inquiry_private.audit_events where id in (select id from doomed);
  get diagnostics audits = row_count;

  with doomed as (
    select c.minute, c.code, c.subject from inquiry_private.security_event_counts c
     where c.minute < now() - interval '30 days' limit p_limit)
  delete from inquiry_private.security_event_counts c using doomed d
   where c.minute = d.minute and c.code = d.code and c.subject = d.subject;
  get diagnostics sec_events = row_count;

  with doomed as (
    select id from inquiry_private.security_actions where created_at < now() - interval '12 months' limit p_limit)
  delete from inquiry_private.security_actions where id in (select id from doomed);
  get diagnostics sec_actions = row_count;

  with doomed as (
    select i.id from inquiry_private.security_incidents i
     where i.status in ('resolved', 'false_positive') and i.updated_at < now() - interval '12 months'
       and not exists (select 1 from inquiry_private.security_actions a where a.incident_id = i.id)
     limit p_limit)
  delete from inquiry_private.security_incidents where id in (select id from doomed);
  get diagnostics sec_incidents = row_count;

  return jsonb_build_object('auditEvents', audits, 'securityRecords', sec_events + sec_actions + sec_incidents);
end;
$$;

-- The click summary no longer counts inquiries or banquet requests.
drop function public.staff_click_summary(uuid, integer);
create function public.staff_click_summary(p_staff uuid, p_months integer)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
begin
  perform inquiry_private.require_staff(p_staff);
  if p_months is null or p_months not between 1 and 24 then
    raise exception using errcode = '22023', message = 'invalid month count';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'month', to_char(m.month, 'YYYY-MM'),
      'bookEn', coalesce((select sum(c.count) from inquiry_private.click_counts c
        where c.target = 'book' and c.lang = 'en' and date_trunc('month', c.day) = m.month), 0),
      'bookRu', coalesce((select sum(c.count) from inquiry_private.click_counts c
        where c.target = 'book' and c.lang = 'ru' and date_trunc('month', c.day) = m.month), 0),
      'callEn', coalesce((select sum(c.count) from inquiry_private.click_counts c
        where c.target = 'call' and c.lang = 'en' and date_trunc('month', c.day) = m.month), 0),
      'callRu', coalesce((select sum(c.count) from inquiry_private.click_counts c
        where c.target = 'call' and c.lang = 'ru' and date_trunc('month', c.day) = m.month), 0))
      order by m.month desc)
    from (select date_trunc('month', now() at time zone 'America/New_York') - make_interval(months => n) as month
            from generate_series(0, p_months - 1) n) m), '[]'::jsonb);
end;
$$;
revoke all on function public.staff_click_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.staff_click_summary(uuid, integer) to service_role;

-- Public functions that only the inquiry system used.
drop function public.record_contact_inquiry(jsonb, uuid, jsonb);
drop function public.claim_notification_jobs(integer, integer);
drop function public.complete_notification_job(uuid, uuid, text, text, text);
drop function public.record_delivery_event(text, text, text, uuid, timestamptz);
drop function public.check_contact_limit(text, uuid, integer, integer, integer, integer);
drop function public.staff_list_inquiries(uuid, text, text, timestamptz, uuid, integer);
drop function public.staff_get_inquiry(uuid, uuid);
drop function public.staff_set_inquiry_status(uuid, text, uuid, integer, text);
drop function public.staff_add_inquiry_note(uuid, text, uuid, text);

-- Audit rows about inquiries go; role-change rows stay. The inquiry link column goes with the table.
delete from inquiry_private.audit_events where inquiry_id is not null;
alter table inquiry_private.audit_events drop column inquiry_id;

-- Tables, view and their helpers (child tables first).
drop view inquiry_private.job_delivery_status;
drop function inquiry_private.notification_summary(uuid);
drop table inquiry_private.inquiry_notes;
drop table inquiry_private.delivery_events;
drop table inquiry_private.notification_jobs;
drop table inquiry_private.submission_keys;
drop table inquiry_private.inquiries;
drop function inquiry_private.protect_notification_payload();
drop function inquiry_private.delivery_rank(text);
drop function inquiry_private.is_calendar_date(text);
