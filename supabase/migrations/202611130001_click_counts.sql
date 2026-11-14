-- ADR-0003: first-party Book now / Call tap counts. One row per (day, target, language) holds a
-- running total: no IP, user agent, referrer, cookie or any per-visitor row is stored. The
-- website's server key can only add one tap through record_click and read through the staff
-- summary below; it cannot write the table directly. Taps are indicative, not confirmed bookings.
-- Recovery (stop counting): as the database owner,
--   revoke execute on function public.record_click(text, text) from service_role;
-- The route still answers 204 and the dashboard keeps showing what was stored.
create table inquiry_private.click_counts (
  day date not null,
  target text not null check (target in ('book', 'call')),
  lang text not null check (lang in ('en', 'ru')),
  count integer not null default 1 check (count between 1 and 1000000000),
  primary key (day, target, lang)
);
alter table inquiry_private.click_counts enable row level security;
revoke all on inquiry_private.click_counts from public, anon, authenticated, service_role;
grant select on inquiry_private.click_counts to service_role;

-- Beacon limits share the fixed-window counters under their own bucket prefix.
alter table inquiry_private.rate_limit_hits drop constraint rate_limit_hits_bucket_check;
alter table inquiry_private.rate_limit_hits add constraint rate_limit_hits_bucket_check
  check (bucket ~ '^(global|subject:[0-9a-f]{64}|login:[0-9a-f]{64}|track:[0-9a-f]{64})$');

create function public.check_track_limit(p_subject text, p_limit integer, p_seconds integer)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare retry integer;
begin
  if p_subject is null or p_subject !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 100000 or p_seconds not between 1 and 86400 then
    raise exception using errcode = '22023', message = 'invalid limit arguments';
  end if;
  delete from inquiry_private.rate_limit_hits where expires_at <= now();
  retry := inquiry_private.hit_rate_limit('track:' || p_subject, p_seconds, p_limit);
  if retry = 0 then return jsonb_build_object('allowed', true); end if;
  return jsonb_build_object('allowed', false, 'retryAfter', retry);
end;
$$;
revoke all on function public.check_track_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_track_limit(text, integer, integer) to service_role;

-- Adds one tap to today's total (America/New_York, the restaurant's day).
create function public.record_click(p_target text, p_lang text)
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_target is null or p_target not in ('book', 'call') or p_lang is null or p_lang not in ('en', 'ru') then
    raise exception using errcode = '22023', message = 'invalid click';
  end if;
  insert into inquiry_private.click_counts as c (day, target, lang)
    values ((now() at time zone 'America/New_York')::date, p_target, p_lang)
    on conflict (day, target, lang) do update set count = least(c.count + 1, 1000000000);
end;
$$;
revoke all on function public.record_click(text, text) from public, anon, authenticated;
grant execute on function public.record_click(text, text) to service_role;

-- Newest month first, for the last p_months calendar months (America/New_York), zeros included.
-- Inquiries are counted by kind (contact | event); they have no language column.
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
        where c.target = 'call' and c.lang = 'ru' and date_trunc('month', c.day) = m.month), 0),
      'inquiries', (select count(*) from inquiry_private.inquiries i
        where i.kind = 'contact' and date_trunc('month', i.created_at at time zone 'America/New_York') = m.month),
      'events', (select count(*) from inquiry_private.inquiries i
        where i.kind = 'event' and date_trunc('month', i.created_at at time zone 'America/New_York') = m.month))
      order by m.month desc)
    from (select date_trunc('month', now() at time zone 'America/New_York') - make_interval(months => n) as month
            from generate_series(0, p_months - 1) n) m), '[]'::jsonb);
end;
$$;
revoke all on function public.staff_click_summary(uuid, integer) from public, anon, authenticated;
grant execute on function public.staff_click_summary(uuid, integer) to service_role;
