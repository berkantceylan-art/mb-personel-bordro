-- =====================================================================
-- SİTE KONTROL MERKEZİ: çerezsiz, kişisel veri tutmayan site istatistiği
--  site_hits : sayfa görüntüleme (view), olay (event: form, WhatsApp, telefon, randevu…), arama / yapay zekâ
--              botu ziyareti (bot). IP saklanmaz; ziyaretçi = günlük değişen anonim özet (hash).
--              Konum Vercel'in IP→il / şehir başlıklarından gelir. Giriş yapmış kullanıcıda user_id tutulur.
--  site_track()   : siteden kayıt (giriş gerektirmez, kötüye kullanım sınırlı)
--  site_report()  : yönetim paneli raporu (can_manage_site)
-- 13 aydan eski kayıtlar kendiliğinden silinir. Tekrar çalıştırılabilir.
-- =====================================================================
create table if not exists site_hits (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null check (kind in ('view', 'event', 'bot')),
  name text check (name is null or length(name) <= 60),
  path text not null check (length(path) <= 300),
  locale text check (locale is null or length(locale) <= 5),
  ref_host text check (ref_host is null or length(ref_host) <= 120),
  source text check (source is null or length(source) <= 30),
  utm_source text check (utm_source is null or length(utm_source) <= 80),
  utm_campaign text check (utm_campaign is null or length(utm_campaign) <= 80),
  country text check (country is null or length(country) <= 4),
  region text check (region is null or length(region) <= 10),
  city text check (city is null or length(city) <= 80),
  device text check (device is null or device in ('mobile', 'tablet', 'desktop')),
  browser text check (browser is null or length(browser) <= 30),
  os text check (os is null or length(os) <= 30),
  visitor text check (visitor is null or length(visitor) <= 32),
  session text check (session is null or length(session) <= 32),
  user_id uuid,
  ms int check (ms is null or ms between 0 and 86400000)
);
create index if not exists site_hits_at_idx on site_hits (at desc);
create index if not exists site_hits_kind_idx on site_hits (kind, at desc);
create index if not exists site_hits_user_idx on site_hits (user_id, at desc) where user_id is not null;
alter table site_hits enable row level security;
drop policy if exists site_hits_read on site_hits;
create policy site_hits_read on site_hits for select to authenticated using (can_manage_site());
grant select on site_hits to authenticated;
revoke insert, update, delete on site_hits from anon, authenticated;

create or replace function site_source(p_ref text, p_utm text) returns text language sql immutable as $$
  select case
    when coalesce(p_utm, '') ~* 'chatgpt|openai' or coalesce(p_ref, '') ~* '(^|\.)(chatgpt\.com|chat\.openai\.com)$' then 'chatgpt'
    when coalesce(p_utm, '') ~* 'perplexity' or coalesce(p_ref, '') ~* 'perplexity\.ai$' then 'perplexity'
    when coalesce(p_ref, '') ~* '(gemini|bard)\.google\.com$' then 'gemini'
    when coalesce(p_utm, '') ~* 'copilot' or coalesce(p_ref, '') ~* 'copilot\.microsoft\.com$' then 'copilot'
    when coalesce(p_ref, '') ~* 'claude\.ai$' then 'claude'
    when coalesce(p_ref, '') ~* '(^|\.)google\.' then 'google'
    when coalesce(p_ref, '') ~* '(^|\.)bing\.com$' then 'bing'
    when coalesce(p_ref, '') ~* 'yandex\.' then 'yandex'
    when coalesce(p_ref, '') ~* 'duckduckgo' then 'duckduckgo'
    when coalesce(p_ref, '') ~* 'instagram' or coalesce(p_utm, '') ~* 'instagram|^ig$' then 'instagram'
    when coalesce(p_ref, '') ~* 'facebook|fb\.' or coalesce(p_utm, '') ~* 'facebook|^fb$' then 'facebook'
    when coalesce(p_ref, '') ~* 'linkedin|lnkd' then 'linkedin'
    when coalesce(p_ref, '') ~* 'youtube|youtu\.be' then 'youtube'
    when coalesce(p_ref, '') ~* '(^|\.)(t\.co|x\.com|twitter\.com)$' then 'x'
    when coalesce(p_ref, '') ~* 'whatsapp|wa\.me' or coalesce(p_utm, '') ~* 'whatsapp' then 'whatsapp'
    when coalesce(p_ref, '') ~* 'mbdentaire|mbdental' then 'internal'
    when nullif(p_utm, '') is not null then 'campaign'
    when nullif(p_ref, '') is null then 'direct'
    else 'other' end;
$$;

-- Kayıt (giriş gerektirmez). p: { kind, name, path, locale, ref, utm_source, utm_campaign, country, region, city, device, browser, os, visitor, session }
create or replace function site_track(p jsonb) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_kind text := p->>'kind'; v_vis text := left(nullif(p->>'visitor', ''), 32); v_ref text := lower(left(nullif(p->>'ref', ''), 120)); v_utm text := left(nullif(p->>'utm_source', ''), 80);
begin
  if v_kind not in ('view', 'event', 'bot') then return null; end if;
  if coalesce(p->>'path', '') = '' then return null; end if;
  if v_vis is not null and v_kind <> 'bot' and (select count(*) from site_hits where visitor = v_vis and at > now() - interval '1 hour') > 400 then return null; end if;
  if v_kind = 'bot' and (select count(*) from site_hits where kind = 'bot' and at > now() - interval '1 minute') > 300 then return null; end if;
  insert into site_hits (kind, name, path, locale, ref_host, source, utm_source, utm_campaign, country, region, city, device, browser, os, visitor, session, user_id)
  values (v_kind, left(nullif(p->>'name', ''), 60), left(p->>'path', 300), left(nullif(p->>'locale', ''), 5), v_ref,
          case when v_kind = 'bot' then null else site_source(v_ref, v_utm) end, v_utm, left(nullif(p->>'utm_campaign', ''), 80),
          upper(left(nullif(p->>'country', ''), 4)), left(nullif(p->>'region', ''), 10), left(nullif(p->>'city', ''), 80),
          case when p->>'device' in ('mobile', 'tablet', 'desktop') then p->>'device' end, left(nullif(p->>'browser', ''), 30), left(nullif(p->>'os', ''), 30),
          v_vis, left(nullif(p->>'session', ''), 32), case when v_kind = 'bot' then null else auth.uid() end)
  returning id into v_id;
  if random() < 0.001 then delete from site_hits where at < now() - interval '400 days'; end if;
  return v_id;
end $$;
revoke execute on function site_track(jsonb) from public;
grant execute on function site_track(jsonb) to anon, authenticated;

-- Sayfada kalma süresi (sayfadan çıkarken)
create or replace function site_track_ms(p_id bigint, p_visitor text, p_ms int) returns void
language sql security definer set search_path = public as $$
  update site_hits set ms = least(greatest(p_ms, 0), 3600000)
  where id = p_id and visitor = p_visitor and kind = 'view' and ms is null and at > now() - interval '6 hours';
$$;
revoke execute on function site_track_ms(bigint, text, int) from public;
grant execute on function site_track_ms(bigint, text, int) to anon, authenticated;

-- Rapor (site yöneticisi)
create or replace function site_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f timestamptz; t timestamptz; pf timestamptz; r jsonb; v_len int;
begin
  if not can_manage_site() then raise exception 'not_allowed'; end if;
  if p_to < p_from then p_to := p_from; end if;
  v_len := p_to - p_from + 1;
  f := (p_from::timestamp at time zone 'Europe/Istanbul');
  t := ((p_to + 1)::timestamp at time zone 'Europe/Istanbul');
  pf := f - (t - f);
  with h as (select * from site_hits where at >= f and at < t),
       v as (select * from h where kind = 'view'),
       pv as (select * from site_hits where kind = 'view' and at >= pf and at < f)
  select jsonb_build_object(
    'views', (select count(*) from v),
    'visitors', (select count(distinct visitor) from v),
    'sessions', (select count(distinct session) from v),
    'avg_ms', (select round(avg(ms)) from v where ms between 1000 and 1800000),
    'prev_views', (select count(*) from pv),
    'prev_visitors', (select count(distinct visitor) from pv),
    'bounce', (select round(100.0 * count(*) filter (where n = 1) / nullif(count(*), 0)) from (select session, count(*) n from v where session is not null group by session) s),
    'events', coalesce((select jsonb_object_agg(name, n) from (select name, count(*) n from h where kind = 'event' group by name) e), '{}'),
    'series', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'views', coalesce(x.vw, 0), 'visitors', coalesce(x.vi, 0), 'ai', coalesce(x.ai, 0)) order by d) from
        generate_series(p_from, p_to, '1 day') d left join (
          select (at at time zone 'Europe/Istanbul')::date dd, count(*) filter (where kind = 'view') vw, count(distinct visitor) filter (where kind = 'view') vi, count(*) filter (where kind = 'bot') ai
          from h group by 1) x on x.dd = d), '[]'),
    'pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'views', n, 'visitors', u, 'avg_ms', a, 'conv', c) order by n desc) from (
        select v.path, count(*) n, count(distinct v.visitor) u, round(avg(v.ms) filter (where v.ms between 1000 and 1800000)) a,
               (select count(*) from h e where e.kind = 'event' and e.path = v.path) c
        from v group by v.path order by count(*) desc limit 25) x), '[]'),
    'sources', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'visitors', u, 'views', n) order by u desc) from (
        select coalesce(source, 'direct') source, count(distinct visitor) u, count(*) n from v where coalesce(source, '') <> 'internal' group by 1) x), '[]'),
    'refs', coalesce((select jsonb_agg(jsonb_build_object('ref', ref_host, 'n', n) order by n desc) from (
        select ref_host, count(distinct visitor) n from v where ref_host is not null and coalesce(source, '') <> 'internal' group by 1 order by 2 desc limit 15) x), '[]'),
    'campaigns', coalesce((select jsonb_agg(jsonb_build_object('utm', utm_source, 'campaign', utm_campaign, 'n', n) order by n desc) from (
        select utm_source, utm_campaign, count(distinct visitor) n from v where utm_source is not null group by 1, 2 order by 3 desc limit 15) x), '[]'),
    'regions', coalesce((select jsonb_agg(jsonb_build_object('region', region, 'city', city, 'n', n) order by n desc) from (
        select region, max(city) city, count(distinct visitor) n from v where country = 'TR' and (region is not null or city is not null) group by region order by 3 desc limit 81) x), '[]'),
    'cities', coalesce((select jsonb_agg(jsonb_build_object('city', city, 'country', country, 'n', n) order by n desc) from (
        select city, country, count(distinct visitor) n from v where city is not null group by 1, 2 order by 3 desc limit 20) x), '[]'),
    'countries', coalesce((select jsonb_agg(jsonb_build_object('country', country, 'n', n) order by n desc) from (
        select coalesce(country, '?') country, count(distinct visitor) n from v group by 1 order by 2 desc limit 20) x), '[]'),
    'devices', coalesce((select jsonb_object_agg(coalesce(device, '?'), n) from (select device, count(distinct visitor) n from v group by 1) x), '{}'),
    'browsers', coalesce((select jsonb_agg(jsonb_build_object('k', coalesce(browser, '?'), 'n', n) order by n desc) from (select browser, count(distinct visitor) n from v group by 1 order by 2 desc limit 8) x), '[]'),
    'locales', coalesce((select jsonb_object_agg(coalesce(locale, '?'), n) from (select locale, count(*) n from v group by 1) x), '{}'),
    'hours', coalesce((select jsonb_agg(coalesce(x.n, 0) order by g) from generate_series(0, 23) g left join (
        select extract(hour from at at time zone 'Europe/Istanbul')::int hh, count(*) n from v group by 1) x on x.hh = g), '[]'),
    'bots', coalesce((select jsonb_agg(jsonb_build_object('bot', name, 'n', n, 'last', l, 'pages', p) order by n desc) from (
        select name, count(*) n, max(at) l, count(distinct path) p from h where kind = 'bot' group by name) x), '[]'),
    'bot_pages', coalesce((select jsonb_agg(jsonb_build_object('path', path, 'n', n, 'bots', b) order by n desc) from (
        select path, count(*) n, string_agg(distinct name, ', ') b from h where kind = 'bot' and name !~* '^(googlebot|bingbot|yandex|applebot|duckduck)' group by path order by 2 desc limit 15) x), '[]'),
    'ai_refs', coalesce((select jsonb_agg(jsonb_build_object('source', source, 'n', n, 'views', vw) order by n desc) from (
        select source, count(distinct visitor) n, count(*) vw from v where source in ('chatgpt', 'perplexity', 'gemini', 'copilot', 'claude') group by 1) x), '[]'),
    'users', coalesce((select jsonb_agg(jsonb_build_object('user', u.user_id, 'name', coalesce(pa.name, nullif(m.display_name, ''), split_part(au.email, '@', 1)), 'kind', case when pa.id is not null then pa.type::text when m.user_id is not null then 'staff' else 'user' end,
          'company', pa.company, 'views', u.n, 'last', u.l, 'city', u.city, 'pages', u.pages, 'last_sign_in', au.last_sign_in_at) order by u.l desc) from (
        select user_id, count(*) n, max(at) l, (array_agg(city order by at desc) filter (where city is not null))[1] city,
               (array_agg(path order by at desc))[1:6] pages
        from v where user_id is not null group by user_id order by max(at) desc limit 60) u
        left join auth.users au on au.id = u.user_id
        left join portal_members pm on pm.user_id = u.user_id
        left join portal_accounts pa on pa.id = pm.account_id
        left join lateral (select * from memberships mm where mm.user_id = u.user_id limit 1) m on true), '[]'),
    'live', (select count(distinct visitor) from site_hits where kind = 'view' and at > now() - interval '5 minutes'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'name', name, 'path', path, 'city', city, 'country', country, 'device', device, 'source', source, 'user', user_id is not null) order by at desc) from (
        select * from site_hits where at > now() - interval '24 hours' order by at desc limit 40) x), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function site_report(date, date) from public, anon;
grant execute on function site_report(date, date) to authenticated;

notify pgrst, 'reload schema';
