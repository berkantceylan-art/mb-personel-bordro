-- Site büyüme · Paket 4: Yeni sayfalar
--  cms_materials   : malzeme kütüphanesi (/malzemeler)
--  cms_events      : hekim eğitimleri / webinarlar (/egitim) · cms_event_regs + event_register(): kayıt formu
--  cms_credentials : sertifikalar, belgeler, basında biz, ödüller (/belgeler)
-- Tekrar çalıştırılabilir.

create table if not exists cms_materials (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  category text not null default 'ceramic' check (category in ('ceramic', 'zirconia', 'metal', 'polymer', 'implant', 'other')),
  name jsonb not null default '{}',
  summary jsonb not null default '{}',
  body jsonb not null default '{}',
  indications jsonb not null default '{}',
  props jsonb not null default '[]',              -- [{ "k": {"tr":"Bükülme dayanımı"}, "v": "1200 MPa" }]
  brands text check (brands is null or length(brands) <= 300),
  product_slugs text[] not null default '{}',
  image_path text,
  is_active boolean not null default true,
  sort int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cms_materials_touch on cms_materials;
create trigger cms_materials_touch before update on cms_materials for each row execute function cms_touch();

create table if not exists cms_events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,80}$'),
  title jsonb not null default '{}',
  summary jsonb not null default '{}',
  body jsonb not null default '{}',
  starts_at timestamptz not null,
  duration_min int not null default 60 check (duration_min between 15 and 1440),
  mode text not null default 'online' check (mode in ('online', 'onsite', 'hybrid')),
  location text check (location is null or length(location) <= 200),
  join_url text check (join_url is null or length(join_url) <= 300),
  speaker text check (speaker is null or length(speaker) <= 160),
  capacity int check (capacity is null or capacity between 1 and 5000),
  image_path text,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cms_events_touch on cms_events;
create trigger cms_events_touch before update on cms_events for each row execute function cms_touch();

create table if not exists cms_event_regs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references cms_events (id) on delete cascade,
  name text not null check (length(name) between 2 and 120),
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 200),
  phone text check (phone is null or length(phone) <= 40),
  clinic text check (clinic is null or length(clinic) <= 160),
  city text check (city is null or length(city) <= 80),
  created_at timestamptz not null default now(),
  unique (event_id, email)
);

create table if not exists cms_credentials (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'certificate' check (kind in ('certificate', 'press', 'award', 'membership')),
  title jsonb not null default '{}',
  summary jsonb not null default '{}',
  issuer text check (issuer is null or length(issuer) <= 160),
  issued_on date,
  valid_until date,
  url text check (url is null or length(url) <= 400),
  image_path text,
  is_active boolean not null default true,
  sort int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cms_credentials_touch on cms_credentials;
create trigger cms_credentials_touch before update on cms_credentials for each row execute function cms_touch();

do $$ declare t text; begin
  foreach t in array array['cms_materials', 'cms_events', 'cms_credentials'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_public_read', t);
    execute format('create policy %I on %I for select to anon, authenticated using (deleted_at is null and is_active)', t || '_public_read', t);
    execute format('drop policy if exists %I on %I', t || '_editor_all', t);
    execute format('create policy %I on %I for all to authenticated using (can_manage_site()) with check (can_manage_site())', t || '_editor_all', t);
    execute format('grant select on %I to anon', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
alter table cms_event_regs enable row level security;
drop policy if exists cms_event_regs_editor on cms_event_regs;
create policy cms_event_regs_editor on cms_event_regs for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select, delete on cms_event_regs to authenticated;

-- Eğitim kaydı (giriş gerektirmez; kontenjan ve kötüye kullanım sınırı)
create or replace function event_register(p_event uuid, p_name text, p_email text, p_phone text default null, p_clinic text default null, p_city text default null) returns text
language plpgsql security definer set search_path = public as $$
declare e cms_events; n int;
begin
  select * into e from cms_events where id = p_event and is_active and deleted_at is null;
  if e.id is null then raise exception 'event_not_found'; end if;
  if e.starts_at < now() then raise exception 'event_past'; end if;
  if length(trim(coalesce(p_name, ''))) < 2 then raise exception 'name_required'; end if;
  if coalesce(p_email, '') !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email_required'; end if;
  select count(*) into n from cms_event_regs where event_id = e.id;
  if e.capacity is not null and n >= e.capacity then raise exception 'event_full'; end if;
  if (select count(*) from cms_event_regs where created_at > now() - interval '1 hour') > 200 then raise exception 'rate_limited'; end if;
  insert into cms_event_regs (event_id, name, email, phone, clinic, city)
  values (e.id, left(trim(p_name), 120), lower(left(trim(p_email), 200)), nullif(left(trim(coalesce(p_phone, '')), 40), ''), nullif(left(trim(coalesce(p_clinic, '')), 160), ''), nullif(left(trim(coalesce(p_city, '')), 80), ''))
  on conflict (event_id, email) do nothing;
  begin
    perform deliver(lab_company(), array(select m.user_id from memberships m where m.company_id = lab_company() and (m.role in ('owner', 'site_editor') or m.site_access)),
      '🎓 Eğitim kaydı · ' || coalesce(e.title->>'tr', ''), left(trim(p_name), 120) || coalesce(' · ' || nullif(trim(p_clinic), ''), '') || ' · ' || (n + 1) || ' kayıt', '/site-icerik');
  exception when others then null; end;
  return 'ok';
end $$;
revoke execute on function event_register(uuid, text, text, text, text, text) from public;
grant execute on function event_register(uuid, text, text, text, text, text) to anon, authenticated;

-- Malzeme kütüphanesi başlangıç kayıtları (teknik değerler yönetimden eklenir)
insert into cms_materials (slug, category, name, summary, sort)
select v.slug, v.cat, v.name::jsonb, v.summ::jsonb, v.s from (values
  ('monolitik-zirkonyum', 'zirconia', '{"tr":"Monolitik zirkonyum","en":"Monolithic zirconia","fr":"Zircone monolithique"}', '{"tr":"Yüksek dayanımlı, tek parça zirkonyum: arka bölge kron ve köprüler, bruksizm hastaları için.","en":"High-strength full-contour zirconia for posterior crowns and bridges, including bruxism patients.","fr":"Zircone monolithique très résistante pour couronnes et bridges postérieurs, y compris patients bruxomanes."}', 10),
  ('cok-katmanli-zirkonyum', 'zirconia', '{"tr":"Çok katmanlı (multilayer) zirkonyum","en":"Multilayer zirconia","fr":"Zircone multicouche"}', '{"tr":"Kesici kenara doğru artan şeffaflık: ön ve arka bölgede estetik monolitik restorasyon.","en":"Graded translucency towards the incisal edge for aesthetic full-contour restorations.","fr":"Translucidité graduelle vers le bord incisif pour des restaurations monolithiques esthétiques."}', 20),
  ('lityum-disilikat-emax', 'ceramic', '{"tr":"Lityum disilikat (E.max)","en":"Lithium disilicate (E.max)","fr":"Disilicate de lithium (E.max)"}', '{"tr":"Yüksek estetik cam seramik: ön bölge kron, laminate veneer, inley / onley.","en":"Highly aesthetic glass-ceramic for anterior crowns, veneers, inlays and onlays.","fr":"Vitrocéramique très esthétique pour couronnes antérieures, facettes, inlays et onlays."}', 30),
  ('feldspatik-porselen', 'ceramic', '{"tr":"Feldspatik porselen","en":"Feldspathic porcelain","fr":"Céramique feldspathique"}', '{"tr":"Katmanlama ve laminate için en doğal ışık geçirgenliği.","en":"The most natural light transmission for layering and veneers.","fr":"La transmission lumineuse la plus naturelle pour la stratification et les facettes."}', 40),
  ('pmma-gecici', 'polymer', '{"tr":"PMMA (geçici)","en":"PMMA (provisional)","fr":"PMMA (provisoire)"}', '{"tr":"Frezelenmiş geçici kron ve köprüler, prova ve uzun dönem geçici.","en":"Milled provisional crowns and bridges, try-ins and long-term temporaries.","fr":"Couronnes et bridges provisoires usinés, essayages et provisoires de longue durée."}', 50),
  ('peek', 'polymer', '{"tr":"PEEK","en":"PEEK","fr":"PEEK"}', '{"tr":"Metal içermeyen hafif yüksek performans polimeri: iskelet ve implant üstü altyapılar.","en":"Metal-free, lightweight high-performance polymer for frameworks and implant superstructures.","fr":"Polymère haute performance sans métal pour châssis et suprastructures implantaires."}', 60),
  ('krom-kobalt', 'metal', '{"tr":"Krom-kobalt (CoCr)","en":"Cobalt-chrome (CoCr)","fr":"Cobalt-chrome (CoCr)"}', '{"tr":"Lazer sinterleme ya da frezeleme: metal destekli porselen ve iskelet protez altyapıları.","en":"Laser-sintered or milled frameworks for porcelain-fused-to-metal and partial dentures.","fr":"Armatures frittées laser ou usinées pour céramo-métal et châssis."}', 70),
  ('titanyum', 'implant', '{"tr":"Titanyum","en":"Titanium","fr":"Titane"}', '{"tr":"Biyouyumlu: implant üstü bar, kişiye özel abutment ve hibrit altyapılar.","en":"Biocompatible: implant bars, custom abutments and hybrid frameworks.","fr":"Biocompatible : barres implantaires, piliers personnalisés et armatures hybrides."}', 80)
) v(slug, cat, name, summ, s)
where not exists (select 1 from cms_materials m where m.slug = v.slug);

notify pgrst, 'reload schema';
