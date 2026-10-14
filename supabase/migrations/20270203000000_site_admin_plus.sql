-- Site büyüme · Paket 3: Site yönetimi
--  site_weekly_summary()  : haftalık site raporu (ERP zamanlanmış görevi pazartesi sabahı bildirim gönderir)
--  cms_lead_status        : formlar, canlı destek, randevular ve portal kayıtları tek "aday" listesinde: durum, sorumlu, not
--  cms_content_plan       : içerik takvimi (blog, Instagram, LinkedIn, bülten)
--  cms_ab_tests           : A/B testi (ana sayfa düğme metni vb.); görüntülenme / tıklama site_hits olaylarından
-- Tekrar çalıştırılabilir.

create table if not exists cms_lead_status (
  source text not null check (source in ('message', 'chat', 'visit', 'portal')),
  ref_id uuid not null,
  status text not null default 'new' check (status in ('new', 'contacted', 'quoted', 'won', 'lost')),
  owner uuid references auth.users (id) on delete set null,
  note text check (note is null or length(note) <= 1000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (source, ref_id)
);
alter table cms_lead_status enable row level security;
drop policy if exists cms_lead_status_editor on cms_lead_status;
create policy cms_lead_status_editor on cms_lead_status for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select, insert, update, delete on cms_lead_status to authenticated;

-- Aday listesi: son 180 gün
create or replace function site_leads() returns jsonb
language sql stable security definer set search_path = public as $$
  with l as (
    select 'message'::text src, m.id, m.created_at at_, m.name, m.company, m.email, m.phone, m.country, m.topic::text topic, left(m.message, 240) body, m.page
    from cms_messages m where m.created_at > now() - interval '180 days'
    union all
    select 'chat', c.id, c.created_at, c.name, null, c.email, null, null, 'chat', null, c.page from cms_chats c where c.created_at > now() - interval '180 days'
    union all
    select 'visit', v.id, v.created_at, v.visitor_name, v.visitor_company, v.visitor_email, v.phone, null, coalesce(v.visitor_type, 'visit'), v.purpose, null
    from vis_visits v where v.source in ('site', 'walkin') and v.created_at > now() - interval '180 days'
    union all
    select 'portal', a.id, a.created_at, a.name, a.company, a.email, a.phone, a.country, a.type::text, null, null
    from portal_accounts a where a.created_at > now() - interval '180 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object('source', l.src, 'id', l.id, 'at', l.at_, 'name', l.name, 'company', l.company, 'email', l.email, 'phone', l.phone, 'country', l.country,
           'topic', l.topic, 'body', l.body, 'page', l.page, 'status', coalesce(s.status, 'new'), 'owner', s.owner, 'note', s.note, 'updated_at', s.updated_at) order by l.at_ desc), '[]')
  from l left join cms_lead_status s on s.source = l.src and s.ref_id = l.id
  where can_manage_site();
$$;
revoke execute on function site_leads() from public, anon;
grant execute on function site_leads() to authenticated;

create table if not exists cms_content_plan (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  channel text not null default 'blog' check (channel in ('blog', 'instagram', 'linkedin', 'facebook', 'newsletter', 'youtube')),
  title text not null check (length(title) between 2 and 200),
  notes text check (notes is null or length(notes) <= 4000),
  status text not null default 'idea' check (status in ('idea', 'draft', 'scheduled', 'published')),
  post_id uuid references cms_posts (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cms_content_plan_date_idx on cms_content_plan (plan_date);
alter table cms_content_plan enable row level security;
drop policy if exists cms_content_plan_editor on cms_content_plan;
create policy cms_content_plan_editor on cms_content_plan for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select, insert, update, delete on cms_content_plan to authenticated;

create table if not exists cms_ab_tests (
  key text primary key check (key ~ '^[a-z0-9_]{2,30}$'),
  label text not null check (length(label) <= 120),
  variant_a jsonb not null default '{}',
  variant_b jsonb not null default '{}',
  is_active boolean not null default false,
  started_at timestamptz,
  winner text check (winner is null or winner in ('A', 'B')),
  updated_at timestamptz not null default now()
);
alter table cms_ab_tests enable row level security;
drop policy if exists cms_ab_tests_read on cms_ab_tests;
create policy cms_ab_tests_read on cms_ab_tests for select to anon, authenticated using (true);
drop policy if exists cms_ab_tests_editor on cms_ab_tests;
create policy cms_ab_tests_editor on cms_ab_tests for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_ab_tests to anon;
grant select, insert, update, delete on cms_ab_tests to authenticated;
insert into cms_ab_tests (key, label, variant_a, variant_b)
select 'home_cta', 'Ana sayfa ana düğme metni',
  '{"tr":"Vaka gönder","en":"Send a case","fr":"Envoyer un cas"}',
  '{"tr":"Ücretsiz ilk vakanızı gönderin","en":"Send your first case","fr":"Envoyez votre premier cas"}'
where not exists (select 1 from cms_ab_tests where key = 'home_cta');

-- A/B sonuçları (site_hits olayları: ab:<key>:<A|B>:view / click)
create or replace function site_ab_results() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(k, v), '{}') from (
    select split_part(name, ':', 2) || ':' || split_part(name, ':', 3) k,
           jsonb_build_object('views', count(*) filter (where split_part(name, ':', 4) = 'view'), 'clicks', count(*) filter (where split_part(name, ':', 4) = 'click'),
                              'visitors', count(distinct visitor) filter (where split_part(name, ':', 4) = 'view')) v
    from site_hits where kind = 'event' and name like 'ab:%' and can_manage_site() group by 1) x;
$$;
revoke execute on function site_ab_results() from public, anon;
grant execute on function site_ab_results() to authenticated;

-- Haftalık site raporu (son 7 gün, önceki 7 güne göre) → site yöneticilerine bildirim
create or replace function site_weekly_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v int; pv int; vw int; ev jsonb; src text; top text; ai int; leads int; body text; tgt uuid[]; nf int;
begin
  select count(distinct visitor), count(*) into v, vw from site_hits where kind = 'view' and at > now() - interval '7 days';
  select count(distinct visitor) into pv from site_hits where kind = 'view' and at between now() - interval '14 days' and now() - interval '7 days';
  select string_agg(s || ' ' || n, ', ' order by n desc) into src from (select coalesce(source, 'direct') s, count(distinct visitor) n from site_hits where kind = 'view' and at > now() - interval '7 days' and coalesce(source, '') <> 'internal' group by 1 order by 2 desc limit 3) x;
  select string_agg(path, ', ' order by n desc) into top from (select path, count(*) n from site_hits where kind = 'view' and at > now() - interval '7 days' group by 1 order by 2 desc limit 3) x;
  select count(*) into ai from site_hits where kind = 'bot' and name ~* '(-User|SearchBot)' and at > now() - interval '7 days';
  select count(*) into nf from site_hits where kind = 'event' and name = '404' and at > now() - interval '7 days';
  select count(*) into leads from site_hits where kind = 'event' and name in ('contact_form', 'visit_request', 'chat_start', 'portal_signup') and at > now() - interval '7 days';
  body := v || ' ziyaretçi (' || case when pv > 0 then case when v >= pv then '+' else '' end || round(100.0 * (v - pv) / pv) || '%' else 'yeni' end || '), ' || vw || ' görüntüleme · '
       || leads || ' form / randevu / kayıt · yapay zekâ ' || ai || ' kez okudu'
       || coalesce(' · kaynak: ' || src, '') || coalesce(' · en çok: ' || top, '') || case when nf > 0 then ' · ⚠ ' || nf || ' bulunamayan sayfa (404)' else '' end;
  tgt := array(select m.user_id from memberships m where m.company_id = lab_company() and (m.role in ('owner', 'site_editor') or m.site_access));
  if cardinality(tgt) > 0 then perform deliver(lab_company(), tgt, '🌐 Haftalık site raporu', left(body, 900), '/site-icerik'); end if;
  return jsonb_build_object('visitors', v, 'prev', pv, 'views', vw, 'leads', leads, 'ai', ai, 'not_found', nf, 'sent_to', cardinality(tgt), 'body', body);
end $$;
revoke execute on function site_weekly_report() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function site_weekly_report() to service_role; end if;
end $$;

notify pgrst, 'reload schema';
