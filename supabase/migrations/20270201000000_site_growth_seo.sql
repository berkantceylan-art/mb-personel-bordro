-- Site büyüme · Paket 1: Google ve yapay zekâ görünürlüğü
--  cms_faqs.product_slug / area_slug : ürün ve bölge sayfasına özel soru-cevap (FAQPage şeması)
--  cms_areas      : şehir / ülke hizmet sayfaları (/bolge/…)
--  cms_ai_prompts : yapay zekâ görünürlük testi soruları · cms_ai_checks : aylık test sonuçları
-- Tekrar çalıştırılabilir.

alter table cms_faqs add column if not exists product_slug text check (product_slug is null or length(product_slug) <= 80);
alter table cms_faqs add column if not exists area_slug text check (area_slug is null or length(area_slug) <= 80);
create index if not exists cms_faqs_product_idx on cms_faqs (product_slug) where product_slug is not null;
create index if not exists cms_faqs_area_idx on cms_faqs (area_slug) where area_slug is not null;

create table if not exists cms_areas (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  kind text not null default 'city' check (kind in ('city', 'country')),
  name jsonb not null default '{}',
  title jsonb not null default '{}',
  intro jsonb not null default '{}',
  body jsonb not null default '{}',
  delivery jsonb not null default '{}',
  shipping_days int check (shipping_days is null or shipping_days between 0 and 60),
  is_active boolean not null default true,
  sort int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
drop trigger if exists cms_areas_touch on cms_areas;
create trigger cms_areas_touch before update on cms_areas for each row execute function cms_touch();
alter table cms_areas enable row level security;
drop policy if exists cms_areas_public_read on cms_areas;
create policy cms_areas_public_read on cms_areas for select to anon, authenticated using (deleted_at is null and is_active);
drop policy if exists cms_areas_editor_all on cms_areas;
create policy cms_areas_editor_all on cms_areas for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_areas to anon;
grant select, insert, update, delete on cms_areas to authenticated;

insert into cms_areas (slug, kind, name, shipping_days, sort)
select v.slug, v.kind, v.name::jsonb, v.d, v.s from (values
  ('istanbul', 'city', '{"tr":"İstanbul","en":"Istanbul","fr":"Istanbul"}', 1, 10),
  ('ankara', 'city', '{"tr":"Ankara","en":"Ankara","fr":"Ankara"}', 1, 20),
  ('izmir', 'city', '{"tr":"İzmir","en":"Izmir","fr":"Izmir"}', 0, 5),
  ('bursa', 'city', '{"tr":"Bursa","en":"Bursa","fr":"Bursa"}', 1, 30),
  ('antalya', 'city', '{"tr":"Antalya","en":"Antalya","fr":"Antalya"}', 1, 40),
  ('manisa', 'city', '{"tr":"Manisa","en":"Manisa","fr":"Manisa"}', 1, 45),
  ('aydin', 'city', '{"tr":"Aydın","en":"Aydin","fr":"Aydin"}', 1, 46),
  ('denizli', 'city', '{"tr":"Denizli","en":"Denizli","fr":"Denizli"}', 1, 47),
  ('fransa', 'country', '{"tr":"Fransa","en":"France","fr":"France"}', 4, 100),
  ('belcika', 'country', '{"tr":"Belçika","en":"Belgium","fr":"Belgique"}', 4, 110),
  ('isvicre', 'country', '{"tr":"İsviçre","en":"Switzerland","fr":"Suisse"}', 5, 120),
  ('almanya', 'country', '{"tr":"Almanya","en":"Germany","fr":"Allemagne"}', 4, 130),
  ('hollanda', 'country', '{"tr":"Hollanda","en":"Netherlands","fr":"Pays-Bas"}', 4, 140),
  ('ingiltere', 'country', '{"tr":"Birleşik Krallık","en":"United Kingdom","fr":"Royaume-Uni"}', 5, 150)
) v(slug, kind, name, d, s)
where not exists (select 1 from cms_areas a where a.slug = v.slug);

create table if not exists cms_ai_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt text not null check (length(prompt) between 5 and 300),
  locale text not null default 'tr' check (locale in ('tr', 'en', 'fr')),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create table if not exists cms_ai_checks (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references cms_ai_prompts (id) on delete cascade,
  engine text not null check (engine in ('chatgpt', 'perplexity', 'gemini', 'claude', 'copilot', 'google_ai')),
  checked_on date not null default current_date,
  mentioned boolean not null default false,
  position int check (position is null or position between 1 and 50),
  cited boolean not null default false,
  cited_url text check (cited_url is null or length(cited_url) <= 300),
  competitors text check (competitors is null or length(competitors) <= 300),
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cms_ai_checks_idx on cms_ai_checks (prompt_id, engine, checked_on desc);
alter table cms_ai_prompts enable row level security;
alter table cms_ai_checks enable row level security;
drop policy if exists cms_ai_prompts_editor on cms_ai_prompts;
create policy cms_ai_prompts_editor on cms_ai_prompts for all to authenticated using (can_manage_site()) with check (can_manage_site());
drop policy if exists cms_ai_checks_editor on cms_ai_checks;
create policy cms_ai_checks_editor on cms_ai_checks for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select, insert, update, delete on cms_ai_prompts, cms_ai_checks to authenticated;

insert into cms_ai_prompts (prompt, locale, sort)
select v.p, v.l, v.s from (values
  ('İzmir''de en iyi diş protez laboratuvarı hangisi?', 'tr', 10),
  ('Türkiye''de zirkonyum kron yaptırabileceğim diş laboratuvarı önerir misin?', 'tr', 20),
  ('Diş hekimleri için dijital vaka kabul eden laboratuvarlar (STL, intraoral tarama)', 'tr', 30),
  ('İmplant üstü protez yapan güvenilir dental laboratuvar', 'tr', 40),
  ('E.max ve zirkon kron fiyatları laboratuvar', 'tr', 50),
  ('Best dental laboratory in Turkey for zirconia crowns', 'en', 60),
  ('Turkish dental lab that ships crowns to Europe', 'en', 70),
  ('Laboratoire dentaire en Turquie pour couronnes zircone', 'fr', 80),
  ('Prothésiste dentaire Turquie travail pour cabinets français', 'fr', 90),
  ('MB Dental İzmir hakkında bilgi', 'tr', 100)
) v(p, l, s)
where not exists (select 1 from cms_ai_prompts);

notify pgrst, 'reload schema';
