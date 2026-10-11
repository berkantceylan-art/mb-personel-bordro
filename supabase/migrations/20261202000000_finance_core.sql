-- =====================================================================
-- FİNANS ÇEKİRDEĞİ
--  module_permissions / module_level() / can_module() : modül bazlı yetki (0 yok, 1 görüntüle, 2 düzenle, 3 yönet)
--  fx_rates / fx_rate()          : TCMB döviz kurları (günlük cron + elle giriş)
--  fin_parties                   : cari kartlar (tedarikçi, müşteri, ikisi, diğer); para birimi, açılış bakiyesi;
--                                  her hekim / hastane kartına (lab_customers) otomatik bağlı cari açılır
--  fin_categories                : gelir / gider / KDV / stok / özkaynak hesapları
--  fin_accounts                  : kasa, banka, kredi kartı, kredi, ortak, avans, çek portföyü
--  fin_txns + fin_moves          : çift taraflı kayıt (her işlem satırlarının TL karşılığı toplamı 0)
--  fin_post()                    : tek kayıt yolu (dengesizse kur farkı satırı ekler, yetki kontrolü)
-- Tutarlar kuruş / cent (bigint). İşaret: hesap (+) para girişi; cari (+) bize borçlu (alacağımız);
-- kategori (+) gider / borç tarafı, (−) gelir / alacak tarafı.
-- Tekrar çalıştırılabilir. Önce 20261124 (kargo), 20261125 (iş kayıt), 20261126, 20261127 çalıştırılmış olmalı.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Modül yetkileri
-- ---------------------------------------------------------------------
create table if not exists module_permissions (
  company_id uuid not null references companies (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  module text not null check (module in ('finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users')),
  level smallint not null check (level between 0 and 3),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid(),
  primary key (company_id, user_id, module)
);
alter table module_permissions enable row level security;

-- Rol varsayılanı (satır yoksa): sahip her şey; muhasebe finans/alış/satış/masraf/demirbaş yönetir, stok düzenler;
-- şef stok + üretim düzenler; "Laboratuvar / kargo" yetkilisi stok + üretim düzenler
create or replace function module_default_level(p_role text, p_logistics boolean, p_module text) returns smallint
language sql immutable as $$
  select greatest(
    case p_role
      when 'owner' then 3
      when 'accountant' then case when p_module in ('finance', 'sales', 'purchases', 'expenses', 'assets') then 3 when p_module in ('stock') then 2 when p_module = 'production' then 1 else 0 end
      when 'branch_manager' then case when p_module in ('stock', 'production') then 2 when p_module in ('sales', 'purchases', 'expenses', 'assets') then 1 else 0 end
      when 'hr' then case when p_module in ('assets', 'expenses') then 1 else 0 end
      else 0 end,
    case when coalesce(p_logistics, false) and p_module in ('stock', 'production') then 2 else 0 end
  )::smallint;
$$;

create or replace function module_level(p_module text) returns smallint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select p.level from module_permissions p join memberships m on m.company_id = p.company_id and m.user_id = p.user_id
     where p.user_id = auth.uid() and p.module = p_module order by m.created_at limit 1),
    (select module_default_level(m.role::text, m.logistics_access, p_module) from memberships m where m.user_id = auth.uid() order by m.created_at limit 1),
    0::smallint);
$$;
grant execute on function module_level(text) to authenticated;

create or replace function can_module(p_module text, p_level int default 1) returns boolean
language sql stable as $$ select module_level(p_module) >= p_level $$;
grant execute on function can_module(text, int) to authenticated;

-- Oturum için tüm modüller tek seferde
create or replace function my_module_levels() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(m, module_level(m))
  from unnest(array['finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users']) as m;
$$;
grant execute on function my_module_levels() to authenticated;

drop policy if exists module_permissions_read on module_permissions;
create policy module_permissions_read on module_permissions for select to authenticated
  using (user_id = auth.uid() or module_level('users') >= 1);
drop policy if exists module_permissions_write on module_permissions;
create policy module_permissions_write on module_permissions for all to authenticated
  using (module_level('users') >= 3) with check (module_level('users') >= 3);
grant select, insert, update, delete on module_permissions to authenticated;

-- ---------------------------------------------------------------------
-- Döviz kurları
-- ---------------------------------------------------------------------
create table if not exists fx_rates (
  rate_date date not null,
  currency text not null check (currency in ('USD', 'EUR', 'GBP', 'CHF')),
  buying numeric(18, 6),
  selling numeric(18, 6) not null check (selling > 0),
  source text not null default 'tcmb' check (source in ('tcmb', 'manual')),
  created_at timestamptz not null default now(),
  primary key (rate_date, currency)
);
alter table fx_rates enable row level security;
drop policy if exists fx_rates_read on fx_rates;
create policy fx_rates_read on fx_rates for select to authenticated using (true);
drop policy if exists fx_rates_write on fx_rates;
create policy fx_rates_write on fx_rates for all to authenticated using (can_module('finance', 2)) with check (can_module('finance', 2));
grant select, insert, update, delete on fx_rates to authenticated;

-- 1 birim döviz = ? TL (o tarihteki ya da önceki son kur; TL için 1)
create or replace function fx_rate(p_currency text, p_date date default current_date) returns numeric
language sql stable as $$
  select case when p_currency = 'TRY' then 1::numeric
    else (select selling from fx_rates where currency = p_currency and rate_date <= coalesce(p_date, current_date) order by rate_date desc limit 1) end;
$$;
grant execute on function fx_rate(text, date) to authenticated;

-- ---------------------------------------------------------------------
-- Cari kartlar
-- ---------------------------------------------------------------------
create table if not exists fin_parties (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  code text check (code is null or length(code) <= 30),
  name text not null check (length(name) between 1 and 200),
  kind text not null default 'supplier' check (kind in ('customer', 'supplier', 'both', 'other')),
  person_type text not null default 'company' check (person_type in ('company', 'person')),
  tax_office text check (tax_office is null or length(tax_office) <= 80),
  tax_no text check (tax_no is null or tax_no ~ '^[0-9]{10,11}$'),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  website text check (website is null or length(website) <= 200),
  contact_name text check (contact_name is null or length(contact_name) <= 120),
  address text check (address is null or length(address) <= 400),
  district text check (district is null or length(district) <= 80),
  city text check (city is null or length(city) <= 80),
  country text not null default 'TR' check (length(country) <= 60),
  iban text check (iban is null or length(iban) <= 40),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  opening_balance bigint not null default 0,          -- (+) bize borçlu, (−) biz borçluyuz
  opening_date date,
  payment_term_days int not null default 0 check (payment_term_days between 0 and 365),
  credit_limit bigint check (credit_limit is null or credit_limit >= 0),
  credit_sales boolean not null default false,        -- veresiye defterinde göster
  is_einvoice boolean not null default false,
  einvoice_alias text check (einvoice_alias is null or length(einvoice_alias) <= 120),
  lab_customer_id uuid unique references lab_customers (id) on delete set null,
  note text check (note is null or length(note) <= 2000),
  is_active boolean not null default true,
  source text not null default 'manual' check (source in ('manual', 'lab', 'einvoice', 'import')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_parties_name_idx on fin_parties (lower(name));
create unique index if not exists fin_parties_tax_uidx on fin_parties (company_id, tax_no) where tax_no is not null;
drop trigger if exists fin_parties_touch on fin_parties;
create trigger fin_parties_touch before update on fin_parties for each row execute function lab_touch();
drop trigger if exists audit_fin_parties on fin_parties;
create trigger audit_fin_parties after insert or update or delete on fin_parties for each row execute function audit_trigger();
alter table fin_parties enable row level security;
drop policy if exists fin_parties_read on fin_parties;
create policy fin_parties_read on fin_parties for select to authenticated
  using (can_module('finance') or can_module('sales') or can_module('purchases') or can_module('expenses') or can_logistics());
drop policy if exists fin_parties_write on fin_parties;
create policy fin_parties_write on fin_parties for all to authenticated
  using (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2))
  with check (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2));
grant select, insert, update, delete on fin_parties to authenticated;

-- Hekim / hastane kartı → cari (açılır, adı / vergi bilgisi eşitlenir)
create or replace function lab_customer_to_party() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_tax text;
begin
  v_tax := nullif(regexp_replace(coalesce(new.tax_no, ''), '\D', '', 'g'), '');
  if v_tax is not null and length(v_tax) not in (10, 11) then v_tax := null; end if;
  if tg_op = 'INSERT' or not exists (select 1 from fin_parties where lab_customer_id = new.id) then
    insert into fin_parties (company_id, name, kind, person_type, tax_office, tax_no, phone, email, address, city, country, currency, lab_customer_id, source)
    values (coalesce(new.company_id, lab_company()), left(new.name, 200), 'customer',
            case when new.kind in ('doctor_tr', 'doctor_foreign') then 'person' else 'company' end,
            new.tax_office,
            case when v_tax is not null and not exists (select 1 from fin_parties p where p.tax_no = v_tax) then v_tax end,
            new.phone, new.email, new.address, new.city, coalesce(new.country, 'TR'),
            case when new.currency in ('TRY', 'EUR', 'USD') then new.currency else 'TRY' end, new.id, 'lab')
    on conflict (lab_customer_id) do nothing;
  else
    update fin_parties set
      name = left(new.name, 200), tax_office = coalesce(new.tax_office, tax_office),
      tax_no = coalesce(case when v_tax is not null and not exists (select 1 from fin_parties p where p.tax_no = v_tax and p.lab_customer_id is distinct from new.id) then v_tax end, tax_no),
      phone = coalesce(new.phone, phone), email = coalesce(new.email, email), address = coalesce(new.address, address),
      city = coalesce(new.city, city), currency = case when new.currency in ('TRY', 'EUR', 'USD') then new.currency else currency end,
      is_active = new.is_active
    where lab_customer_id = new.id;
  end if;
  return new;
exception when others then
  raise warning 'lab_customer_to_party: %', sqlerrm;
  return new;
end $$;
drop trigger if exists lab_customer_to_party on lab_customers;
create trigger lab_customer_to_party after insert or update on lab_customers for each row execute function lab_customer_to_party();

insert into fin_parties (company_id, name, kind, person_type, tax_office, phone, email, address, city, country, currency, lab_customer_id, source)
select coalesce(c.company_id, lab_company()), left(c.name, 200), 'customer',
       case when c.kind in ('doctor_tr', 'doctor_foreign') then 'person' else 'company' end,
       c.tax_office, c.phone, c.email, c.address, c.city, coalesce(c.country, 'TR'), c.currency, c.id, 'lab'
from lab_customers c
where not exists (select 1 from fin_parties p where p.lab_customer_id = c.id);

-- ---------------------------------------------------------------------
-- Gelir / gider / KDV kategorileri
-- ---------------------------------------------------------------------
create table if not exists fin_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  code text not null check (code ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (length(name) between 1 and 120),
  kind text not null check (kind in ('income', 'expense', 'vat_in', 'vat_out', 'stock', 'equity', 'other')),
  parent_id uuid references fin_categories (id) on delete set null,
  is_system boolean not null default false,
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (company_id, code)
);
alter table fin_categories enable row level security;
drop policy if exists fin_categories_read on fin_categories;
create policy fin_categories_read on fin_categories for select to authenticated
  using (can_module('finance') or can_module('expenses') or can_module('sales') or can_module('purchases'));
drop policy if exists fin_categories_write on fin_categories;
create policy fin_categories_write on fin_categories for all to authenticated
  using (can_module('finance', 3) and not is_system) with check (can_module('finance', 3));
grant select, insert, update, delete on fin_categories to authenticated;

insert into fin_categories (company_id, code, name, kind, is_system, sort)
select lab_company(), v.code, v.name, v.kind, v.sys, v.sort
from (values
  ('sales_prosthesis', 'Protez / laboratuvar satışları', 'income', true, 10),
  ('sales_goods', 'Ticari mal / malzeme satışları', 'income', true, 11),
  ('income_other', 'Diğer gelirler', 'income', false, 19),
  ('income_interest', 'Faiz gelirleri', 'income', false, 18),
  ('fx_gain', 'Kur farkı geliri', 'income', true, 17),
  ('exp_material', 'Malzeme / sarf giderleri', 'expense', true, 20),
  ('exp_rent', 'Kira', 'expense', false, 21),
  ('exp_electric', 'Elektrik', 'expense', false, 22),
  ('exp_water', 'Su', 'expense', false, 23),
  ('exp_gas', 'Doğalgaz / ısınma', 'expense', false, 24),
  ('exp_telecom', 'İnternet / telefon', 'expense', false, 25),
  ('exp_salary', 'Personel giderleri', 'expense', false, 26),
  ('exp_food', 'Yemek', 'expense', false, 27),
  ('exp_fuel', 'Yakıt / ulaşım', 'expense', false, 28),
  ('exp_cargo', 'Kargo / kurye', 'expense', false, 29),
  ('exp_maintenance', 'Bakım / onarım', 'expense', false, 30),
  ('exp_accounting', 'Muhasebe / müşavirlik', 'expense', false, 31),
  ('exp_bank', 'Banka masrafları / komisyon', 'expense', true, 32),
  ('exp_interest', 'Kredi faizi', 'expense', true, 33),
  ('exp_tax', 'Vergi / harç / ceza', 'expense', false, 34),
  ('exp_marketing', 'Reklam / tanıtım', 'expense', false, 35),
  ('exp_office', 'Kırtasiye / ofis', 'expense', false, 36),
  ('exp_cleaning', 'Temizlik', 'expense', false, 37),
  ('exp_software', 'Yazılım / abonelik', 'expense', false, 38),
  ('exp_depreciation', 'Amortisman', 'expense', true, 39),
  ('exp_other', 'Diğer giderler', 'expense', false, 49),
  ('fx_loss', 'Kur farkı gideri', 'expense', true, 48),
  ('cogs', 'Satılan malın maliyeti', 'expense', true, 40),
  ('vat_in', 'İndirilecek KDV', 'vat_in', true, 60),
  ('vat_out', 'Hesaplanan KDV', 'vat_out', true, 61),
  ('stock', 'Stoklar', 'stock', true, 70),
  ('fixed_assets', 'Demirbaşlar', 'stock', true, 71),
  ('opening', 'Açılış bakiyeleri', 'equity', true, 80),
  ('capital', 'Sermaye', 'equity', true, 81),
  ('suspense', 'Mahsup / ara hesap', 'other', true, 90)
) as v(code, name, kind, sys, sort)
where lab_company() is not null
  and not exists (select 1 from fin_categories c where c.company_id = lab_company() and c.code = v.code);

create or replace function fin_category(p_code text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from fin_categories where code = p_code and company_id = lab_company() limit 1;
$$;

-- ---------------------------------------------------------------------
-- Hesaplar: kasa, banka, kart, kredi, ortak, avans, çek portföyü
-- ---------------------------------------------------------------------
create table if not exists fin_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  kind text not null check (kind in ('cash', 'bank', 'pos', 'credit_card', 'loan', 'partner', 'advance', 'cheque_in', 'cheque_out')),
  name text not null check (length(name) between 1 and 120),
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  bank_name text check (bank_name is null or length(bank_name) <= 80),
  branch text check (branch is null or length(branch) <= 80),
  iban text check (iban is null or length(iban) <= 40),
  account_no text check (account_no is null or length(account_no) <= 40),
  card_last4 text check (card_last4 is null or card_last4 ~ '^[0-9]{4}$'),
  card_limit bigint check (card_limit is null or card_limit >= 0),
  statement_day smallint check (statement_day is null or statement_day between 1 and 31),
  due_day smallint check (due_day is null or due_day between 1 and 31),
  holder_employee_id uuid references employees (id) on delete set null,
  holder_name text check (holder_name is null or length(holder_name) <= 120),
  share_pct numeric(5, 2) check (share_pct is null or share_pct between 0 and 100),
  opening_balance bigint not null default 0,
  opening_date date not null default current_date,
  is_active boolean not null default true,
  sort int not null default 0,
  note text check (note is null or length(note) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_accounts_kind_idx on fin_accounts (kind, is_active);
drop trigger if exists fin_accounts_touch on fin_accounts;
create trigger fin_accounts_touch before update on fin_accounts for each row execute function lab_touch();
drop trigger if exists audit_fin_accounts on fin_accounts;
create trigger audit_fin_accounts after insert or update or delete on fin_accounts for each row execute function audit_trigger();
alter table fin_accounts enable row level security;
drop policy if exists fin_accounts_read on fin_accounts;
create policy fin_accounts_read on fin_accounts for select to authenticated
  using (can_module('finance') or (kind in ('cash', 'bank', 'credit_card', 'advance') and can_module('expenses')));
drop policy if exists fin_accounts_write on fin_accounts;
create policy fin_accounts_write on fin_accounts for all to authenticated using (can_module('finance', 3)) with check (can_module('finance', 3));
grant select, insert, update, delete on fin_accounts to authenticated;

-- ---------------------------------------------------------------------
-- İşlemler ve hareketler
-- ---------------------------------------------------------------------
create table if not exists fin_txns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  no bigint generated by default as identity,
  txn_date date not null default current_date,
  kind text not null check (kind in (
    'opening', 'collection', 'payment', 'transfer', 'income', 'expense', 'exchange',
    'sale_invoice', 'purchase_invoice', 'sale_return', 'purchase_return',
    'cheque_in', 'cheque_out', 'cheque_endorse', 'cheque_collect', 'cheque_bounce', 'cheque_pay', 'cheque_deposit',
    'card_spend', 'card_payment', 'loan_draw', 'loan_payment',
    'advance_give', 'advance_close', 'advance_return', 'partner_in', 'partner_out',
    'credit_sale', 'depreciation', 'stock', 'adjust')),
  description text check (description is null or length(description) <= 500),
  doc_no text check (doc_no is null or length(doc_no) <= 60),
  amount bigint not null default 0,                    -- ekranda gösterilen ana tutar
  currency text not null default 'TRY',
  party_id uuid references fin_parties (id) on delete restrict,
  account_id uuid references fin_accounts (id) on delete restrict,
  category_id uuid references fin_categories (id) on delete restrict,
  ref_type text check (ref_type is null or length(ref_type) <= 30),
  ref_id uuid,
  attachment_path text check (attachment_path is null or length(attachment_path) <= 300),
  lab_payment_id uuid references lab_payments (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid,
  void_reason text check (void_reason is null or length(void_reason) <= 300)
);
create index if not exists fin_txns_date_idx on fin_txns (txn_date desc, no desc);
create index if not exists fin_txns_ref_idx on fin_txns (ref_type, ref_id);

create table if not exists fin_moves (
  id bigint generated by default as identity primary key,
  txn_id uuid not null references fin_txns (id) on delete cascade,
  move_date date not null,
  account_id uuid references fin_accounts (id) on delete restrict,
  party_id uuid references fin_parties (id) on delete restrict,
  category_id uuid references fin_categories (id) on delete restrict,
  amount bigint not null,                              -- işaretli, satırın para biriminde
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  rate numeric(18, 6) not null default 1 check (rate > 0),
  amount_try bigint not null,
  description text check (description is null or length(description) <= 300),
  check (num_nonnulls(account_id, party_id, category_id) = 1)
);
create index if not exists fin_moves_account_idx on fin_moves (account_id, move_date) where account_id is not null;
create index if not exists fin_moves_party_idx on fin_moves (party_id, move_date) where party_id is not null;
create index if not exists fin_moves_category_idx on fin_moves (category_id, move_date) where category_id is not null;
create index if not exists fin_moves_txn_idx on fin_moves (txn_id);

alter table fin_txns enable row level security;
alter table fin_moves enable row level security;
drop policy if exists fin_txns_read on fin_txns;
create policy fin_txns_read on fin_txns for select to authenticated using (can_module('finance') or can_module('expenses') or can_module('sales') or can_module('purchases'));
drop policy if exists fin_moves_read on fin_moves;
create policy fin_moves_read on fin_moves for select to authenticated using (can_module('finance') or can_module('expenses') or can_module('sales') or can_module('purchases'));
grant select on fin_txns, fin_moves to authenticated;
-- yazma yalnız fin_post / fin_void (security definer)

-- Tahsilat kaydına bağlantı (hekim tahsilatı finanstan girildiyse ikinci kez sayılmasın)
alter table lab_payments add column if not exists fin_txn_id uuid references fin_txns (id) on delete set null;
alter table lab_payments add column if not exists account_id uuid references fin_accounts (id) on delete set null;

-- ---------------------------------------------------------------------
-- Kayıt: fin_post(header, lines)
--   header: {kind, txn_date, description, doc_no, amount, currency, party_id, account_id, category_id, ref_type, ref_id, attachment_path, module}
--   lines : [{account_id|party_id|category_id, amount, currency, rate, description}]
-- Satırların TL karşılığı toplamı 0 olmalı; küçük fark ya da farklı para birimlerinde kur farkı satırı eklenir.
-- ---------------------------------------------------------------------
create or replace function fin_post(p_header jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_date date := coalesce(nullif(p_header->>'txn_date', '')::date, current_date);
  v_module text := coalesce(p_header->>'module', 'finance');
  l jsonb;
  v_amount bigint;
  v_cur text;
  v_rate numeric;
  v_try bigint;
  v_sum bigint := 0;
  v_curs text[] := '{}';
  v_count int := 0;
begin
  if v_module not in ('finance', 'sales', 'purchases', 'expenses', 'stock', 'assets', 'production') or not can_module(v_module, 2) then
    raise exception 'not_allowed';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then raise exception 'lines_required'; end if;

  insert into fin_txns (txn_date, kind, description, doc_no, amount, currency, party_id, account_id, category_id, ref_type, ref_id, attachment_path)
  values (v_date, p_header->>'kind', nullif(left(p_header->>'description', 500), ''), nullif(left(p_header->>'doc_no', 60), ''),
          coalesce((p_header->>'amount')::bigint, 0), coalesce(nullif(p_header->>'currency', ''), 'TRY'),
          nullif(p_header->>'party_id', '')::uuid, nullif(p_header->>'account_id', '')::uuid, nullif(p_header->>'category_id', '')::uuid,
          nullif(p_header->>'ref_type', ''), nullif(p_header->>'ref_id', '')::uuid, nullif(p_header->>'attachment_path', ''))
  returning id into v_id;

  for l in select * from jsonb_array_elements(p_lines) loop
    v_amount := (l->>'amount')::bigint;
    if v_amount is null or v_amount = 0 then continue; end if;
    v_cur := coalesce(nullif(l->>'currency', ''), 'TRY');
    v_rate := case when v_cur = 'TRY' then 1 else coalesce(nullif(l->>'rate', '')::numeric, fx_rate(v_cur, v_date)) end;
    if v_rate is null or v_rate <= 0 then raise exception 'rate_missing:%', v_cur; end if;
    v_try := round(v_amount * v_rate);
    insert into fin_moves (txn_id, move_date, account_id, party_id, category_id, amount, currency, rate, amount_try, description)
    values (v_id, v_date, nullif(l->>'account_id', '')::uuid, nullif(l->>'party_id', '')::uuid, nullif(l->>'category_id', '')::uuid,
            v_amount, v_cur, v_rate, v_try, nullif(left(l->>'description', 300), ''));
    v_sum := v_sum + v_try;
    v_count := v_count + 1;
    if not v_cur = any (v_curs) then v_curs := v_curs || v_cur; end if;
  end loop;
  if v_count < 2 then raise exception 'lines_required'; end if;

  if v_sum <> 0 then
    -- farklı para birimleri ya da kuruş yuvarlaması: kur farkı satırı
    if array_length(v_curs, 1) > 1 or abs(v_sum) <= 5 then
      insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
      values (v_id, v_date, fin_category(case when v_sum > 0 then 'fx_gain' else 'fx_loss' end), -v_sum, 'TRY', 1, -v_sum, 'Kur farkı');
    else
      raise exception 'unbalanced:%', v_sum;
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function fin_post(jsonb, jsonb) from public, anon;
grant execute on function fin_post(jsonb, jsonb) to authenticated;

-- İptal: hareketler silinmez, ters kayıt yerine işlem "iptal" işaretlenir ve hareketleri bakiyelerden düşülür
create or replace function fin_void(p_txn uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare t fin_txns;
begin
  select * into t from fin_txns where id = p_txn for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not (can_module('finance', 3) or (t.kind = 'expense' and can_module('expenses', 3))) then raise exception 'not_allowed'; end if;
  if t.voided_at is not null then return; end if;
  update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(p_reason, ''), 300) where id = p_txn;
  -- finanstan girilmiş hekim tahsilatı da silinir (hekim ekstresinden düşsün)
  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
end $$;
revoke execute on function fin_void(uuid, text) from public, anon;
grant execute on function fin_void(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Bakiyeler (iptal edilenler hariç)
-- ---------------------------------------------------------------------
create or replace view fin_account_balances with (security_invoker = true) as
select a.id as account_id, a.kind, a.name, a.currency,
       a.opening_balance + coalesce(sum(m.amount) filter (where t.voided_at is null), 0) as balance,
       coalesce(sum(m.amount_try) filter (where t.voided_at is null), 0) + round(a.opening_balance * coalesce(fx_rate(a.currency, current_date), 1))::bigint as balance_try
from fin_accounts a
left join fin_moves m on m.account_id = a.id
left join fin_txns t on t.id = m.txn_id
group by a.id;
grant select on fin_account_balances to authenticated;

-- Cari bakiye: açılış + finans hareketleri + (hekim kartıysa) işler − finanstan girilmemiş tahsilatlar
create or replace view fin_party_balances with (security_invoker = true) as
select p.id as party_id, p.name, p.kind, p.currency, p.lab_customer_id,
       p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)
       + coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status <> 'cancelled'), 0)
       - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null), 0)
       as balance
from fin_parties p;
grant select on fin_party_balances to authenticated;

-- ---------------------------------------------------------------------
-- Hazır işlemler (formlar bunları çağırır)
-- ---------------------------------------------------------------------
-- Tahsilat / ödeme: cari ↔ kasa / banka. Hekim kartına bağlı caride hekim ekstresine de tahsilat yazılır.
create or replace function fin_collect_or_pay(
  p_kind text, p_party uuid, p_account uuid, p_date date, p_amount bigint, p_party_amount bigint,
  p_rate numeric, p_description text, p_doc_no text, p_method text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a fin_accounts; pt fin_parties; v_txn uuid; v_lp uuid; s int;
begin
  if p_kind not in ('collection', 'payment') then raise exception 'bad_kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount'; end if;
  select * into a from fin_accounts where id = p_account;
  select * into pt from fin_parties where id = p_party;
  if a.id is null or pt.id is null then raise exception 'not_found'; end if;
  s := case when p_kind = 'collection' then 1 else -1 end;
  v_txn := fin_post(
    jsonb_build_object('kind', p_kind, 'txn_date', p_date, 'description', p_description, 'doc_no', p_doc_no,
                       'amount', p_amount, 'currency', a.currency, 'party_id', p_party, 'account_id', p_account),
    jsonb_build_array(
      jsonb_build_object('account_id', p_account, 'amount', s * p_amount, 'currency', a.currency, 'rate', case when a.currency = 'TRY' then 1 else coalesce(p_rate, fx_rate(a.currency, p_date)) end),
      jsonb_build_object('party_id', p_party, 'amount', -s * coalesce(p_party_amount, p_amount), 'currency', pt.currency,
                         'rate', case when pt.currency = 'TRY' then 1
                                      when pt.currency = a.currency then coalesce(p_rate, fx_rate(pt.currency, p_date))
                                      -- farklı para birimi ve iki tutar da girildiyse: cari kuru = hesap TL karşılığı / cari tutarı (kur farkı oluşmaz)
                                      when p_party_amount is not null and p_party_amount > 0 then
                                        round(p_amount * (case when a.currency = 'TRY' then 1 else coalesce(p_rate, fx_rate(a.currency, p_date)) end) / p_party_amount, 6)
                                      else fx_rate(pt.currency, p_date) end)
    ));
  if p_kind = 'collection' and pt.lab_customer_id is not null and pt.currency in ('TRY', 'EUR', 'USD') then
    insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, fin_txn_id, account_id)
    values (pt.lab_customer_id, coalesce(p_date, current_date), coalesce(p_party_amount, p_amount), pt.currency,
            coalesce(p_method, case a.kind when 'cash' then 'cash' when 'credit_card' then 'card' when 'pos' then 'card' else 'bank' end),
            nullif(left(coalesce(p_doc_no, ''), 80), ''), nullif(left(coalesce(p_description, ''), 500), ''), v_txn, p_account)
    returning id into v_lp;
    update fin_txns set lab_payment_id = v_lp where id = v_txn;
  end if;
  return v_txn;
end $$;
revoke execute on function fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text) from public, anon;
grant execute on function fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text) to authenticated;

notify pgrst, 'reload schema';
