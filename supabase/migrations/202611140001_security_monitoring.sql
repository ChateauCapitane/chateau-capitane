-- ADR-0004: security monitoring, incident records and owner-approved response; audit SEC-08 (site-wide cap on
-- click beacons). Everything here is written only by the functions below, callable with the server key.
-- Events are per-minute counts (no request text, no IP, no account name). `subject` is an HMAC of the client
-- network computed by the website, or '-' when unattributed. Staff membership is never written here
-- (staff_members stays read-only).
-- Recovery if an owner is locked out by a block (Supabase SQL editor, with Anthony's approval):
--   update inquiry_private.security_actions set lifted_at = now() where lifted_at is null;
-- Or set SECURITY_ACTIONS_DISABLED=1 in Vercel: every action stops applying at once.

-- ---------------------------------------------------------------------------------------------------------
-- Tables
create table inquiry_private.security_event_counts (
  minute timestamptz not null,
  code text not null check (code in ('login_failed', 'login_limited', 'staff_denied', 'webhook_bad_signature',
    'cron_bad_secret', 'contact_limited', 'contact_honeypot', 'track_limited', 'upload_refused', 'blocked_request')),
  subject text not null check (subject = '-' or subject ~ '^[0-9a-f]{64}$'),
  count integer not null default 1 check (count between 1 and 1000000000),
  primary key (minute, code, subject)
);
create index security_event_counts_subject on inquiry_private.security_event_counts (minute, subject);

create table inquiry_private.security_incidents (
  id text primary key check (id ~ '^INC-[0-9]{8}-[0-9]{4}$'),
  schema_version integer not null default 1 check (schema_version = 1),
  environment text not null check (environment in ('production', 'preview', 'local')),
  status text not null default 'open'
    check (status in ('open', 'investigating', 'contained', 'resolved', 'false_positive')),
  rule text not null check (rule in ('R0_synthetic', 'R1_password_guessing', 'R2_login_lockout', 'R3_non_staff_admin',
    'R4_forged_webhook', 'R5_secret_probing', 'R6_spam_wave', 'R7_disguised_upload')),
  severity text not null check (severity in ('info', 'low', 'medium', 'high')),
  confidence text not null check (confidence in ('low', 'medium', 'high')),
  test boolean not null default false,
  dedup_key text not null check (dedup_key ~ '^R[0-7]_[a-z_]+:(-|overflow|[0-9a-f]{64})$'),
  subject text not null check (subject = '-' or subject ~ '^[0-9a-f]{64}$'),
  first_seen timestamptz not null,
  last_seen timestamptz not null,
  event_count integer not null check (event_count >= 0),
  evidence jsonb not null,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One active incident per rule and subject; repeats update it.
create unique index security_incidents_active_key on inquiry_private.security_incidents (dedup_key)
  where status in ('open', 'investigating', 'contained');
create index security_incidents_created on inquiry_private.security_incidents (created_at desc);

create table inquiry_private.security_actions (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('block_subject', 'pause_contact')),
  subject text check (subject ~ '^[0-9a-f]{64}$'),
  check ((kind = 'block_subject') = (subject is not null)),
  -- Copied from the incident's rule by the function, never typed by a person: records carry no free text.
  reason text not null check (reason ~ '^R[0-7]_[a-z_]+$'),
  incident_id text not null references inquiry_private.security_incidents (id),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at and expires_at <= created_at + interval '24 hours'),
  lifted_at timestamptz
);
create index security_actions_active on inquiry_private.security_actions (expires_at) where lifted_at is null;

create table inquiry_private.security_heartbeat (
  id integer primary key check (id = 1),
  last_run timestamptz not null
);

create table inquiry_private.security_alert_log (
  id bigint generated always as identity primary key,
  band text not null check (band in ('high', 'other')),
  sent_at timestamptz not null default now()
);
create index security_alert_log_sent on inquiry_private.security_alert_log (band, sent_at);

alter table inquiry_private.security_event_counts enable row level security;
alter table inquiry_private.security_incidents enable row level security;
alter table inquiry_private.security_actions enable row level security;
alter table inquiry_private.security_heartbeat enable row level security;
alter table inquiry_private.security_alert_log enable row level security;
revoke all on inquiry_private.security_event_counts, inquiry_private.security_incidents,
  inquiry_private.security_actions, inquiry_private.security_heartbeat, inquiry_private.security_alert_log
  from public, anon, authenticated, service_role;
-- Read only for the server key (invoker-rights reads); every write goes through a definer function below.
grant select on inquiry_private.security_event_counts, inquiry_private.security_incidents,
  inquiry_private.security_actions, inquiry_private.security_heartbeat to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Recording. Best-effort from the website; at most 200 distinct subjects per minute, the rest fold into '-'.
create function public.record_security_event(p_code text, p_subject text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  this_minute timestamptz := date_trunc('minute', now());
  subject_key text := coalesce(p_subject, '-');
begin
  if p_code is null or p_code not in ('login_failed', 'login_limited', 'staff_denied', 'webhook_bad_signature',
      'cron_bad_secret', 'contact_limited', 'contact_honeypot', 'track_limited', 'upload_refused', 'blocked_request') then
    raise exception using errcode = '22023', message = 'invalid security event';
  end if;
  if subject_key <> '-' and subject_key !~ '^[0-9a-f]{64}$' then subject_key := '-'; end if;
  if subject_key <> '-'
     and not exists (select 1 from inquiry_private.security_event_counts e
                      where e.minute = this_minute and e.subject = subject_key)
     and (select count(distinct e.subject) from inquiry_private.security_event_counts e
           where e.minute = this_minute) >= 200 then
    subject_key := '-';
  end if;
  insert into inquiry_private.security_event_counts as e (minute, code, subject)
    values (this_minute, p_code, subject_key)
    on conflict (minute, code, subject) do update set count = least(e.count + 1, 1000000000);
  return true;
end;
$$;
revoke all on function public.record_security_event(text, text) from public, anon, authenticated;
grant execute on function public.record_security_event(text, text) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Detection. The two helpers run only inside security_detect, which holds an advisory lock, so incident ids
-- and the 50-incident cap cannot race.
create function inquiry_private.security_raise(p_rule text, p_severity text, p_confidence text, p_subject text,
  p_counts jsonb, p_total integer, p_first timestamptz, p_latest timestamptz, p_window integer,
  p_environment text, p_test boolean) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  live constant text[] := array['open', 'investigating', 'contained'];
  dkey text := p_rule || ':' || p_subject;
  subj text := p_subject;
  ev jsonb := jsonb_build_object('provenance', 'db:security_event_counts', 'window_minutes', p_window,
    'counts', p_counts, 'log_refs', '[]'::jsonb);
  found_id text;
  seq integer;
  today text := to_char(now() at time zone 'utc', 'YYYYMMDD');
begin
  update inquiry_private.security_incidents i
     set last_seen = greatest(i.last_seen, p_latest), updated_at = now(),
         evidence = case when p_total >= i.event_count then ev else i.evidence end,
         event_count = greatest(i.event_count, p_total)
   where i.dedup_key = dkey and i.status = any(live) returning i.id into found_id;
  if found_id is not null then return; end if;

  -- A closed incident is not reopened by the same events: only newer ones raise a new one.
  if exists (select 1 from inquiry_private.security_incidents c
              where c.dedup_key = dkey and c.status in ('resolved', 'false_positive') and c.last_seen >= p_latest) then
    return;
  end if;

  if (select count(*) from inquiry_private.security_incidents c where c.status = any(live)) >= 50 then
    dkey := p_rule || ':overflow';
    subj := '-';
    ev := jsonb_set(ev, '{overflow}', 'true'::jsonb);
    update inquiry_private.security_incidents i
       set last_seen = greatest(i.last_seen, p_latest), updated_at = now(),
           event_count = least(i.event_count + 1, 1000000000)
     where i.dedup_key = dkey and i.status = any(live) returning i.id into found_id;
    if found_id is not null then return; end if;
  end if;

  select coalesce(max(substr(c.id, 14)::integer), 0) + 1 into seq
    from inquiry_private.security_incidents c where c.id like 'INC-' || today || '-%';
  if seq > 9999 then return; end if;
  insert into inquiry_private.security_incidents (id, environment, rule, severity, confidence, test, dedup_key,
      subject, first_seen, last_seen, event_count, evidence)
    values ('INC-' || today || '-' || lpad(seq::text, 4, '0'), p_environment, p_rule, p_severity, p_confidence,
      p_test, dkey, subj, p_first, p_latest, p_total, ev);
end;
$$;
revoke all on function inquiry_private.security_raise(text, text, text, text, jsonb, integer, timestamptz, timestamptz,
  integer, text, boolean) from public, anon, authenticated, service_role;

-- Applies one rule. Per-subject thresholds first; the site-wide thresholds only when no single subject crossed,
-- so one noisy network yields one incident, not two. A rule fires when any listed code reaches its threshold.
create function inquiry_private.security_scan(p_rule text, p_severity text, p_confidence text, p_minutes integer,
  p_subject_thresholds jsonb, p_site_thresholds jsonb, p_environment text) returns void
language plpgsql volatile security definer set search_path = '' as $$
declare
  codes text[] := array(select jsonb_object_keys(coalesce(p_subject_thresholds, p_site_thresholds)));
  since timestamptz := now() - make_interval(mins => p_minutes);
  raised boolean := false;
  hit record;
  site_counts jsonb;
  site_total integer;
  site_first timestamptz;
  site_last timestamptz;
  crossed boolean;
begin
  if p_subject_thresholds is not null then
    for hit in
      select s.subject, jsonb_object_agg(s.code, s.n) as counts, sum(s.n)::integer as total,
             min(s.first_minute) as first_minute, max(s.last_minute) as last_minute
        from (select e.subject, e.code, sum(e.count)::integer as n,
                     min(e.minute) as first_minute, max(e.minute) as last_minute
                from inquiry_private.security_event_counts e
               where e.minute > since and e.code = any(codes) group by e.subject, e.code) s
       group by s.subject
      having bool_or(s.n >= (p_subject_thresholds ->> s.code)::integer)
       order by sum(s.n) desc, s.subject limit 60
    loop
      perform inquiry_private.security_raise(p_rule, p_severity, p_confidence, hit.subject, hit.counts, hit.total,
        hit.first_minute, hit.last_minute, p_minutes, p_environment, false);
      raised := true;
    end loop;
  end if;
  if not raised and p_site_thresholds is not null then
    select jsonb_object_agg(s.code, s.n), sum(s.n)::integer, min(s.first_minute), max(s.last_minute),
           coalesce(bool_or(s.n >= (p_site_thresholds ->> s.code)::integer), false)
      into site_counts, site_total, site_first, site_last, crossed
      from (select e.code, sum(e.count)::integer as n, min(e.minute) as first_minute, max(e.minute) as last_minute
              from inquiry_private.security_event_counts e
             where e.minute > since and e.code = any(codes) group by e.code) s;
    if crossed then
      perform inquiry_private.security_raise(p_rule, p_severity, p_confidence, '-', site_counts, site_total,
        site_first, site_last, p_minutes, p_environment, false);
    end if;
  end if;
end;
$$;
revoke all on function inquiry_private.security_scan(text, text, text, integer, jsonb, jsonb, text)
  from public, anon, authenticated, service_role;

-- The cron entry point (every 5 minutes). Writes the heartbeat, applies the rules, optionally creates the
-- synthetic R0 test incident and, when p_claim_alerts is true, claims the alerts that fit the hourly budget
-- (10 for low/medium/info, a separate 10 for high). The caller sends the emails for the returned alerts.
create function public.security_detect(p_environment text, p_synthetic boolean default false,
  p_claim_alerts boolean default false) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  alerts jsonb := '[]'::jsonb;
  rec record;
  which text;
  used integer;
begin
  if p_environment is null or p_environment not in ('production', 'preview', 'local') then
    raise exception using errcode = '22023', message = 'invalid environment';
  end if;
  perform pg_advisory_xact_lock(hashtext('security_detect'));
  insert into inquiry_private.security_heartbeat (id, last_run) values (1, now())
    on conflict (id) do update set last_run = now();
  delete from inquiry_private.security_alert_log where sent_at < now() - interval '1 day';

  perform inquiry_private.security_scan('R1_password_guessing', 'high', 'medium', 15,
    '{"login_failed": 10}'::jsonb, '{"login_failed": 30}'::jsonb, p_environment);
  perform inquiry_private.security_scan('R2_login_lockout', 'medium', 'medium', 15,
    '{"login_limited": 3}'::jsonb, null, p_environment);
  perform inquiry_private.security_scan('R3_non_staff_admin', 'medium', 'high', 15,
    '{"staff_denied": 1}'::jsonb, null, p_environment);
  perform inquiry_private.security_scan('R4_forged_webhook', 'medium', 'medium', 15,
    null, '{"webhook_bad_signature": 5}'::jsonb, p_environment);
  perform inquiry_private.security_scan('R5_secret_probing', 'medium', 'medium', 15,
    null, '{"cron_bad_secret": 5}'::jsonb, p_environment);
  perform inquiry_private.security_scan('R6_spam_wave', 'low', 'medium', 60,
    '{"contact_limited": 20, "contact_honeypot": 50}'::jsonb, '{"contact_limited": 20, "contact_honeypot": 50}'::jsonb,
    p_environment);
  perform inquiry_private.security_scan('R7_disguised_upload', 'medium', 'medium', 60,
    '{"upload_refused": 3}'::jsonb, null, p_environment);

  if p_synthetic then
    perform inquiry_private.security_raise('R0_synthetic', 'info', 'high', '-', '{}'::jsonb, 0, now(), now(), 0,
      p_environment, true);
    -- A repeat test call re-arms its alert so the email path can be checked again.
    update inquiry_private.security_incidents set alerted_at = null
     where rule = 'R0_synthetic' and status in ('open', 'investigating', 'contained');
  end if;

  if p_claim_alerts then
    for rec in
      select i.id, i.rule, i.severity, i.event_count, i.test, i.evidence
        from inquiry_private.security_incidents i
       where i.alerted_at is null and i.status in ('open', 'investigating', 'contained')
         and (i.test or i.created_at > now() - interval '2 hours')
       order by (i.severity = 'high') desc, i.created_at, i.id
    loop
      which := case when rec.severity = 'high' then 'high' else 'other' end;
      select count(*) into used from inquiry_private.security_alert_log l
       where l.band = which and l.sent_at > now() - interval '1 hour';
      if used < 10 then
        insert into inquiry_private.security_alert_log (band) values (which);
        update inquiry_private.security_incidents set alerted_at = now() where id = rec.id;
        alerts := alerts || jsonb_build_array(jsonb_build_object('id', rec.id, 'rule', rec.rule,
          'severity', rec.severity, 'eventCount', rec.event_count, 'test', rec.test,
          'counts', coalesce(rec.evidence -> 'counts', '{}'::jsonb)));
      end if;
    end loop;
  end if;
  return jsonb_build_object('ranAt', now(), 'alerts', alerts);
end;
$$;
revoke all on function public.security_detect(text, boolean, boolean) from public, anon, authenticated;
grant execute on function public.security_detect(text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Read access for the investigating agent (MONITOR_TOKEN route) and the owner page. Newest first.
create function public.security_incidents_read(p_id text default null, p_limit integer default 50) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(x.j order by x.created_at desc, x.id desc), '[]'::jsonb)
    from (select i.id, i.created_at, jsonb_build_object(
            'id', i.id, 'schema_version', i.schema_version, 'environment', i.environment, 'status', i.status,
            'rule', i.rule, 'severity', i.severity, 'confidence', i.confidence, 'test', i.test,
            'subject', i.subject, 'first_seen', i.first_seen, 'last_seen', i.last_seen,
            'event_count', i.event_count, 'evidence', i.evidence,
            'created_at', i.created_at, 'updated_at', i.updated_at,
            'actions', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind,
                'created_at', a.created_at, 'expires_at', a.expires_at, 'lifted_at', a.lifted_at) order by a.id)
              from inquiry_private.security_actions a where a.incident_id = i.id), '[]'::jsonb)) as j
            from inquiry_private.security_incidents i
           where p_id is null or i.id = p_id
           order by i.created_at desc, i.id desc
           limit least(greatest(coalesce(p_limit, 50), 1), 100)) x;
$$;
revoke all on function public.security_incidents_read(text, integer) from public, anon, authenticated;
grant execute on function public.security_incidents_read(text, integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Owner-approved actions. Each re-checks the owner role in staff_members; user metadata is never consulted.
create function inquiry_private.require_owner(p_staff uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  perform inquiry_private.require_staff(p_staff);
  if not exists (select 1 from inquiry_private.staff_members m where m.user_id = p_staff and m.role = 'owner') then
    raise exception using errcode = '42501', message = 'not owner';
  end if;
end;
$$;
revoke all on function inquiry_private.require_owner(uuid) from public, anon, authenticated, service_role;

create function public.security_owner_incidents_read(p_staff uuid, p_id text default null, p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform inquiry_private.require_owner(p_staff);
  return public.security_incidents_read(p_id, p_limit);
end;
$$;
revoke all on function public.security_owner_incidents_read(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.security_owner_incidents_read(uuid, text, integer) to service_role;

create function public.security_create_action(p_staff uuid, p_kind text, p_incident text, p_subject text,
  p_hours integer, p_actor_subject text, p_disabled boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  inc record;
  new_id bigint;
  expires timestamptz;
begin
  perform inquiry_private.require_owner(p_staff);
  if p_kind is null or p_kind not in ('block_subject', 'pause_contact') then
    raise exception using errcode = '22023', message = 'invalid action';
  end if;
  if coalesce(p_disabled, false) then return jsonb_build_object('result', 'refused', 'reason', 'disabled'); end if;
  if p_hours is null or p_hours not between 1 and 24 then
    return jsonb_build_object('result', 'refused', 'reason', 'bad_expiry');
  end if;
  select i.id, i.rule, i.subject into inc from inquiry_private.security_incidents i
   where i.id = p_incident and i.status in ('open', 'investigating', 'contained');
  if not found then return jsonb_build_object('result', 'refused', 'reason', 'incident_not_active'); end if;

  if p_kind = 'block_subject' then
    if p_subject = '-' then return jsonb_build_object('result', 'refused', 'reason', 'unattributed'); end if;
    if p_subject is null or p_subject !~ '^[0-9a-f]{64}$' then
      return jsonb_build_object('result', 'refused', 'reason', 'invalid_subject');
    end if;
    if p_subject <> inc.subject then return jsonb_build_object('result', 'refused', 'reason', 'not_incident_subject'); end if;
    if p_actor_subject is not null and p_actor_subject = p_subject then
      return jsonb_build_object('result', 'refused', 'reason', 'own_network');
    end if;
    if (select count(*) from inquiry_private.security_actions a
         where a.kind = 'block_subject' and a.lifted_at is null and a.expires_at > now()) >= 20 then
      return jsonb_build_object('result', 'refused', 'reason', 'too_many_blocks');
    end if;
  elsif exists (select 1 from inquiry_private.security_actions a
                 where a.kind = 'pause_contact' and a.lifted_at is null and a.expires_at > now()) then
    return jsonb_build_object('result', 'refused', 'reason', 'already_active');
  end if;
  if (select count(*) from inquiry_private.security_actions a where a.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('result', 'refused', 'reason', 'rate_limited');
  end if;

  expires := now() + make_interval(hours => p_hours);
  insert into inquiry_private.security_actions (kind, subject, reason, incident_id, created_by, expires_at)
    values (p_kind, case when p_kind = 'block_subject' then p_subject end, inc.rule, inc.id, p_staff, expires)
    returning id into new_id;
  update inquiry_private.security_incidents set status = 'contained', updated_at = now()
   where id = inc.id and status in ('open', 'investigating');
  return jsonb_build_object('result', 'created', 'id', new_id, 'expiresAt', expires);
end;
$$;
revoke all on function public.security_create_action(uuid, text, text, text, integer, text, boolean)
  from public, anon, authenticated;
grant execute on function public.security_create_action(uuid, text, text, text, integer, text, boolean) to service_role;

-- Lifting stays possible while the emergency stop is on (it only ever loosens).
create function public.security_lift_action(p_staff uuid, p_action bigint) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare lifted integer;
begin
  perform inquiry_private.require_owner(p_staff);
  update inquiry_private.security_actions set lifted_at = now()
   where id = p_action and lifted_at is null and expires_at > now();
  get diagnostics lifted = row_count;
  return jsonb_build_object('result', case when lifted = 1 then 'lifted' else 'not_active' end);
end;
$$;
revoke all on function public.security_lift_action(uuid, bigint) from public, anon, authenticated;
grant execute on function public.security_lift_action(uuid, bigint) to service_role;

create function public.security_set_status(p_staff uuid, p_incident text, p_status text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare changed integer;
begin
  perform inquiry_private.require_owner(p_staff);
  if p_status is null or p_status not in ('open', 'investigating', 'contained', 'resolved', 'false_positive') then
    raise exception using errcode = '22023', message = 'invalid status';
  end if;
  update inquiry_private.security_incidents set status = p_status, updated_at = now() where id = p_incident;
  get diagnostics changed = row_count;
  return jsonb_build_object('result', case when changed = 1 then 'updated' else 'not_found' end);
exception when unique_violation then
  -- Another live incident already holds this rule and subject.
  return jsonb_build_object('result', 'conflict');
end;
$$;
revoke all on function public.security_set_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.security_set_status(uuid, text, text) to service_role;

-- What the website asks before contact, sign-in and click beacons. Fails open on its own (the rate limiters
-- still fail closed). With the emergency stop on, nothing is blocked or paused. '-' is never blocked.
create function public.security_gate(p_subject text, p_surface text, p_disabled boolean default false) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  retry integer;
  paused boolean := false;
begin
  if p_surface is null or p_surface not in ('contact', 'login', 'track') then
    raise exception using errcode = '22023', message = 'invalid surface';
  end if;
  if coalesce(p_disabled, false) then return jsonb_build_object('blocked', false, 'paused', false); end if;
  if p_subject is not null and p_subject ~ '^[0-9a-f]{64}$' then
    select ceil(extract(epoch from max(a.expires_at) - now()))::integer into retry
      from inquiry_private.security_actions a
     where a.kind = 'block_subject' and a.subject = p_subject and a.lifted_at is null and a.expires_at > now();
  end if;
  if p_surface = 'contact' then
    paused := exists (select 1 from inquiry_private.security_actions a
                       where a.kind = 'pause_contact' and a.lifted_at is null and a.expires_at > now());
  end if;
  return jsonb_build_object('blocked', retry is not null, 'paused', paused,
    'retryAfter', least(greatest(coalesce(retry, 1), 1), 3600));
end;
$$;
revoke all on function public.security_gate(text, text, boolean) from public, anon, authenticated;
grant execute on function public.security_gate(text, text, boolean) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- SEC-08: a site-wide cap on click beacons next to the per-network one (same fixed-window counters).
alter table inquiry_private.rate_limit_hits drop constraint rate_limit_hits_bucket_check;
alter table inquiry_private.rate_limit_hits add constraint rate_limit_hits_bucket_check
  check (bucket ~ '^(global|subject:[0-9a-f]{64}|login:[0-9a-f]{64}|track:[0-9a-f]{64}|track-all)$');

drop function public.check_track_limit(text, integer, integer);
create function public.check_track_limit(p_subject text, p_limit integer, p_seconds integer,
  p_global_limit integer default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare retry integer;
begin
  if p_subject is null or p_subject !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 100000 or p_seconds not between 1 and 86400
     or (p_global_limit is not null and p_global_limit not between 1 and 1000000) then
    raise exception using errcode = '22023', message = 'invalid limit arguments';
  end if;
  delete from inquiry_private.rate_limit_hits where expires_at <= now();
  retry := inquiry_private.hit_rate_limit('track:' || p_subject, p_seconds, p_limit);
  if retry = 0 and p_global_limit is not null then
    retry := inquiry_private.hit_rate_limit('track-all', p_seconds, p_global_limit);
  end if;
  if retry = 0 then return jsonb_build_object('allowed', true); end if;
  return jsonb_build_object('allowed', false, 'retryAfter', retry);
end;
$$;
revoke all on function public.check_track_limit(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.check_track_limit(text, integer, integer, integer) to service_role;

-- ---------------------------------------------------------------------------------------------------------
-- Retention (ADR-0004): event counts 30 days; closed incidents and all actions 12 months. Same function, one
-- more key; every step is bounded by p_limit like the others. Open incidents are never deleted.
create or replace function public.run_retention(p_limit integer default 200) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  ids uuid[];
  events integer; keys integer; inquiries integer := 0; audits integer;
  sec_events integer; sec_actions integer; sec_incidents integer;
begin
  if p_limit is null or p_limit not between 1 and 5000 then
    raise exception using errcode = '22023', message = 'invalid limit';
  end if;

  select coalesce(array_agg(id), '{}') into ids from (
    select i.id from inquiry_private.inquiries i
     where i.status = 'resolved' and i.updated_at < now() - interval '24 months'
       and not exists (select 1 from inquiry_private.notification_jobs j
                        where j.inquiry_id = i.id and j.state in ('pending', 'leased'))
     order by i.updated_at limit p_limit for update skip locked) s;
  if cardinality(ids) > 0 then
    delete from inquiry_private.delivery_events where job_id in
      (select id from inquiry_private.notification_jobs where inquiry_id = any(ids));
    delete from inquiry_private.notification_jobs where inquiry_id = any(ids);
    delete from inquiry_private.inquiry_notes where inquiry_id = any(ids);
    delete from inquiry_private.audit_events where inquiry_id = any(ids);
    delete from inquiry_private.submission_keys where inquiry_id = any(ids);
    delete from inquiry_private.inquiries where id = any(ids);
    inquiries := cardinality(ids);
  end if;

  -- Events of a job that is still active are kept even if old (its status is still needed).
  with doomed as (
    select e.event_id from inquiry_private.delivery_events e
     where e.received_at < now() - interval '90 days'
       and not exists (select 1 from inquiry_private.notification_jobs j
                        where j.id = e.job_id and j.state in ('pending', 'leased'))
     limit p_limit)
  delete from inquiry_private.delivery_events where event_id in (select event_id from doomed);
  get diagnostics events = row_count;

  with doomed as (
    select endpoint, key from inquiry_private.submission_keys
     where created_at < now() - interval '90 days' limit p_limit)
  delete from inquiry_private.submission_keys k using doomed d where k.endpoint = d.endpoint and k.key = d.key;
  get diagnostics keys = row_count;

  with doomed as (
    select id from inquiry_private.audit_events
     where inquiry_id is null and created_at < now() - interval '24 months' limit p_limit)
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

  return jsonb_build_object('inquiries', inquiries, 'deliveryEvents', events, 'submissionKeys', keys,
    'auditEvents', audits, 'securityRecords', sec_events + sec_actions + sec_incidents);
end;
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Health: open high incidents and the age of the last detection run (null = never ran).
create or replace function public.ops_snapshot() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'jobs', coalesce((select jsonb_object_agg(state, n) from
      (select state, count(*)::int n from inquiry_private.notification_jobs group by state) s), '{}'::jsonb),
    -- Age of the oldest job that is due now (pending past its retry time, or a lease that expired).
    'oldestDueJobSeconds', (select coalesce(floor(extract(epoch from now() - min(
        case when state = 'pending' then available_at else leased_until end)))::int, 0)
      from inquiry_private.notification_jobs
      where (state = 'pending' and available_at <= now()) or (state = 'leased' and leased_until <= now())),
    'deliveryProblems7d', (select count(*)::int from inquiry_private.job_delivery_status
      where delivery_status in ('email.bounced', 'email.failed', 'email.suppressed', 'email.complained')
        and occurred_at > now() - interval '7 days'),
    'unmatchedDeliveryEvents', (select count(*)::int from inquiry_private.delivery_events where job_id is null),
    'inquiries24h', (select count(*)::int from inquiry_private.inquiries where created_at > now() - interval '24 hours'),
    'loginHitsNow', (select coalesce(sum(hits), 0)::int from inquiry_private.rate_limit_hits
      where bucket like 'login:%' and expires_at > now()),
    'securityHighOpen', (select count(*)::int from inquiry_private.security_incidents
      where severity = 'high' and status in ('open', 'investigating', 'contained')),
    'securityLastRunSeconds', (select floor(extract(epoch from now() - last_run))::int
      from inquiry_private.security_heartbeat where id = 1)
  );
$$;
