-- =====================================================================
-- Laboratuvar iş kaydı (DentalSIS iş kayıt ekranı mantığında)
--
-- lab_customers        : hekim / hastane / klinik / aracı (cari); portal hesabına bağlanabilir
-- lab_customer_doctors : müşteri altındaki doktorlar
-- lab_products         : protez / ürün kartları ve fiyatları (TL / €)
-- lab_options          : teslim şekli, prova türü gibi düzenlenebilir listeler
-- jobs                 : iş kaydı (hasta, renk, diş şeması, gelen malzeme, tarihler)
-- job_items            : protez / ürün satırları (üye, fiyat, tutar, ücretli / rpt / tamir / düzeltme / ücretsiz)
-- job_steps            : prova / teslim adımları (giriş-çıkış tarihi, teslim şekli, saat, prova türü)
-- job_files            : iş fotoğrafları (job-files deposu)
--
-- Yetki: can_logistics() (sahip, muhasebe, İK, şef ya da "Laboratuvar / kargo" yetkisi).
-- Tekrar çalıştırılabilir. Önce 20261124000000_shipments.sql çalıştırılmış olmalı.
-- =====================================================================

create table if not exists lab_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  kind text not null default 'doctor_tr' check (kind in ('doctor_tr', 'doctor_foreign', 'clinic', 'hospital', 'agency')),
  portal_account_id uuid unique references portal_accounts (id) on delete set null,
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  country text not null default 'TR' check (length(country) <= 60),
  city text check (city is null or length(city) <= 80),
  address text check (address is null or length(address) <= 400),
  tax_office text check (tax_office is null or length(tax_office) <= 80),
  tax_no text check (tax_no is null or length(tax_no) <= 20),
  discount_pct numeric(5, 2) not null default 0 check (discount_pct between 0 and 100),
  note text check (note is null or length(note) <= 2000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists lab_customers_name_idx on lab_customers (lower(name));

create table if not exists lab_customer_doctors (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references lab_customers (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  phone text check (phone is null or length(phone) <= 40),
  created_at timestamptz not null default now()
);
create index if not exists lab_customer_doctors_idx on lab_customer_doctors (customer_id);

create table if not exists lab_products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade,
  code text check (code is null or length(code) <= 30),
  name text not null check (length(name) between 1 and 160),
  material text check (material is null or length(material) <= 30),   -- diş şeması malzemesi (zirkon, porselen...)
  price_try bigint check (price_try is null or price_try >= 0),        -- kuruş
  price_eur bigint check (price_eur is null or price_eur >= 0),        -- cent
  per_unit boolean not null default true,                                -- üye (diş) başına mı
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lab_options (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('delivery', 'tryin')),
  value text not null check (length(value) between 1 and 80),
  sort int not null default 0,
  unique (kind, value)
);
do $seed$ begin
  if not exists (select 1 from lab_options) then
    insert into lab_options (kind, value, sort) values
      ('delivery', 'Bizim kurye', 1), ('delivery', 'Hekimin kuryesi', 2), ('delivery', 'Elden', 3), ('delivery', 'DHL', 4), ('delivery', 'UPS', 5), ('delivery', 'Kargo', 6),
      ('tryin', 'Metal prova', 1), ('tryin', 'Alt yapı prova', 2), ('tryin', 'Dentin prova', 3), ('tryin', 'Bisküvi prova', 4), ('tryin', 'Mum prova', 5), ('tryin', 'Diş dizimi prova', 6), ('tryin', 'Teslim', 9);
  end if;
end $seed$;

create sequence if not exists job_no start 1;

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  no bigint not null unique default nextval('job_no'),
  company_id uuid references companies (id) on delete cascade,
  slip_no text check (slip_no is null or length(slip_no) <= 40),
  customer_id uuid references lab_customers (id) on delete restrict,
  doctor_name text check (doctor_name is null or length(doctor_name) <= 120),
  patient text check (patient is null or length(patient) <= 120),
  shade text check (shade is null or length(shade) <= 30),
  shade_cervical text check (shade_cervical is null or length(shade_cervical) <= 30),
  shade_incisal text check (shade_incisal is null or length(shade_incisal) <= 30),
  description text check (description is null or length(description) <= 4000),
  invoice_note text check (invoice_note is null or length(invoice_note) <= 500),
  print_note text check (print_note is null or length(print_note) <= 500),
  metal_band text check (metal_band is null or metal_band in ('circumferential', 'yes', 'no')),
  received text[] not null default '{}',                 -- isirik, model, olcu, kasik, mum
  teeth jsonb not null default '{}'::jsonb,                -- {"11":"zirkon","21":"zirkon"}
  in_date date not null default current_date,
  due_date date,                                           -- teslim (çıkış) tarihi
  delivery_method text check (delivery_method is null or length(delivery_method) <= 80),
  delivery_time text check (delivery_time is null or length(delivery_time) <= 10),
  status text not null default 'open' check (status in ('open', 'tryin', 'ready', 'delivered', 'cancelled')),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  total bigint not null default 0,                          -- kuruş / cent (satırlardan)
  shipment_id uuid references shipments (id) on delete set null,
  portal_case_id uuid references portal_cases (id) on delete set null,
  delivered_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jobs_customer_idx on jobs (customer_id, in_date desc);
create index if not exists jobs_status_idx on jobs (status, due_date);
create index if not exists jobs_patient_idx on jobs (lower(patient));

create table if not exists job_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  product_id uuid references lab_products (id) on delete set null,
  name text not null check (length(name) between 1 and 160),
  qty int not null default 1 check (qty between 1 and 99),
  unit_price bigint not null default 0 check (unit_price >= 0),
  amount bigint not null default 0,
  kind text not null default 'paid' check (kind in ('paid', 'rpt', 'repair', 'adjust', 'free')),
  sort int not null default 0
);
create index if not exists job_items_idx on job_items (job_id, sort);

create table if not exists job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  kind text not null check (length(kind) between 1 and 80),   -- prova türü ya da "Teslim"
  out_date date,                                               -- laboratuvardan çıkış
  back_date date,                                              -- dönüş / giriş
  delivery_method text check (delivery_method is null or length(delivery_method) <= 80),
  delivery_time text check (delivery_time is null or length(delivery_time) <= 10),
  done boolean not null default false,
  note text check (note is null or length(note) <= 500),
  sort int not null default 0
);
create index if not exists job_steps_idx on job_steps (job_id, sort);
create index if not exists job_steps_due_idx on job_steps (out_date) where not done;

create table if not exists job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  path text not null,
  name text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists job_files_idx on job_files (job_id);

-- Zaman damgaları
create or replace function lab_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'jobs' and new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  return new;
end $$;
drop trigger if exists lab_customers_touch on lab_customers;
create trigger lab_customers_touch before update on lab_customers for each row execute function lab_touch();
drop trigger if exists lab_products_touch on lab_products;
create trigger lab_products_touch before update on lab_products for each row execute function lab_touch();
drop trigger if exists jobs_touch on jobs;
create trigger jobs_touch before insert or update on jobs for each row execute function lab_touch();

drop trigger if exists audit_jobs on jobs;
create trigger audit_jobs after insert or update or delete on jobs for each row execute function audit_trigger();
drop trigger if exists audit_lab_customers on lab_customers;
create trigger audit_lab_customers after insert or update or delete on lab_customers for each row execute function audit_trigger();
drop trigger if exists audit_lab_products on lab_products;
create trigger audit_lab_products after insert or update or delete on lab_products for each row execute function audit_trigger();

-- RLS
do $rls$
declare t text;
begin
  foreach t in array array['lab_customers', 'lab_customer_doctors', 'lab_products', 'lab_options', 'jobs', 'job_items', 'job_steps', 'job_files'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_lab', t);
    execute format('create policy %I on %I for all to authenticated using (can_logistics()) with check (can_logistics())', t || '_lab', t);
  end loop;
end $rls$;

-- Portal hesabı kendi müşteri kaydını ve işlerini görebilsin (ileride portalda iş takibi)
drop policy if exists lab_customers_portal on lab_customers;
create policy lab_customers_portal on lab_customers for select to authenticated
  using (portal_account_id is not null and is_portal_member(portal_account_id));
drop policy if exists jobs_portal on jobs;
create policy jobs_portal on jobs for select to authenticated
  using (exists (select 1 from lab_customers c where c.id = customer_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id)));

-- Depo
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('job-files', 'job-files', false, 20971520, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists "job_files_obj_read" on storage.objects;
create policy "job_files_obj_read" on storage.objects for select to authenticated using (bucket_id = 'job-files' and can_logistics());
drop policy if exists "job_files_obj_write" on storage.objects;
create policy "job_files_obj_write" on storage.objects for insert to authenticated with check (bucket_id = 'job-files' and can_logistics());
drop policy if exists "job_files_obj_delete" on storage.objects;
create policy "job_files_obj_delete" on storage.objects for delete to authenticated using (bucket_id = 'job-files' and can_logistics());

-- Elle verilen iş numarası sayaçtan büyükse sayaç ileri alınır (sonraki otomatik numara çakışmasın)
create or replace function jobs_sync_no() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.no >= (select last_value from job_no) then perform setval('job_no', new.no); end if;
  return new;
end $$;
drop trigger if exists jobs_sync_no on jobs;
create trigger jobs_sync_no after insert on jobs for each row execute function jobs_sync_no();

-- İş numarasını eski sistemden devam ettirmek için: select setval('job_no', 539339);
-- Portal hesapları için müşteri kartı yoksa oluştur (aktif hesaplar)
insert into lab_customers (company_id, name, kind, portal_account_id, currency, phone, email, country, city)
select (select id from companies order by created_at limit 1), coalesce(a.company, a.name),
       case a.type when 'doctor_tr' then 'doctor_tr' when 'doctor_foreign' then 'doctor_foreign' when 'clinic' then 'clinic' else 'agency' end,
       a.id, case when a.country in ('TR', 'Türkiye') then 'TRY' else 'EUR' end, a.phone, a.email, a.country, a.city
from portal_accounts a
where a.status = 'active' and not exists (select 1 from lab_customers c where c.portal_account_id = a.id);

notify pgrst, 'reload schema';
