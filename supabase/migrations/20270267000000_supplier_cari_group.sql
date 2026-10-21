-- =====================================================================
-- TEDARİKÇİ CARİ GRUBU: bir firmanın dört carisi (ör. Gözde Diş Deposu)
--  Faturalı (resmi) cari  : firmanın asıl cari kartı (TL). Resmi faturalar + banka ödemeleri.
--  Fişli cari             : slip_of = asıl, sub_kind boş. Fişler liste fiyatıyla yazılır; firmanın iskontosu
--                           (discount_pct) ödeme / kapanışta ayrı "İskonto" satırıyla düşülür. Para birimi asıl
--                           cariden farklı olabilir (EUR): asıl cariye girilen ödeme TCMB döviz satış kuruyla
--                           çevrilerek buraya yansır.
--  İskontosuz fişli cari  : slip_of = asıl, sub_kind 'nodisc'. Bazı ürünler hep buraya yazılır (ürün bazlı kural).
--                           Ödemeler bu cariye yansımaz; kendi ödemesi doğrudan girilir.
--  KDV carisi             : slip_of = asıl, sub_kind 'vat'. Asıl cariye işlenen alış faturasının KDV'si buraya borç
--                           yazılır; nakit KDV ödemesi buradan düşer. Yansımaz.
--
--  sup_item_prices : firmanın ürün adı → stok kartı, liste fiyatı ve hangi fişli cariye gideceği (ürün bazlı kural)
--  sup_slip_lines  : kalemli fiş satırları (fiş girişinden ya da ekstre aktarımından)
--  sup_import_keys : ekstre aktarımında aynı satır iki kez işlenmesin
--
-- Düzeltme: ödeme yansıtması para birimi farkını artık çevirir (önceden TL ödeme EUR cariye TL tutarıyla yazılıyordu).
-- Yansıtma, KDV carisi ve ekstre aktarımı karşılık hesapları muhasebe (GL) dışıdır.
-- Tekrar çalıştırılabilir. Önce 20270266000000_outsource_statements.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Cari kart alanları
-- ---------------------------------------------------------------------
alter table fin_parties add column if not exists sub_kind text;
alter table fin_parties add column if not exists discount_pct numeric(5, 2) not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_parties_sub_kind_chk') then
    alter table fin_parties add constraint fin_parties_sub_kind_chk check (sub_kind is null or (sub_kind in ('nodisc', 'vat') and slip_of is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_parties_discount_chk') then
    alter table fin_parties add constraint fin_parties_discount_chk check (discount_pct >= 0 and discount_pct <= 100);
  end if;
end $$;
-- Bir firmanın tek (klasik) fişli carisi olur; iskontosuz ve KDV carileri ayrıca birer tane
drop index if exists fin_parties_slip_uidx;
create unique index if not exists fin_parties_slip_main_uidx on fin_parties (slip_of) where slip_of is not null and sub_kind is null;
create unique index if not exists fin_parties_slip_sub_uidx on fin_parties (slip_of, sub_kind) where sub_kind is not null;

alter table sup_slips add column if not exists add_to_stock boolean;

-- ---------------------------------------------------------------------
-- 2) Sistem kategorileri (muhasebe dışı karşılıklar + iskonto)
-- ---------------------------------------------------------------------
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, x.code, x.name, x.kind, true, x.sort
  from companies c
 cross join (values ('purchase_discount', 'Tedarikçi iskontosu (fişli cari)', 'income', 98),
                    ('vat_cari', 'KDV carisi karşılığı', 'other', 99),
                    ('stmt_import', 'Tedarikçi ekstresi aktarımı (geçmiş)', 'other', 99)) as x(code, name, kind, sort)
 where not exists (select 1 from fin_categories f where f.company_id = c.id and f.code = x.code);

alter table gl_settings alter column exclude_codes set default array['internal_collection', 'slip_mirror', 'vat_cari', 'stmt_import'];
update gl_settings set exclude_codes = exclude_codes || array['vat_cari'] where not ('vat_cari' = any (exclude_codes));
update gl_settings set exclude_codes = exclude_codes || array['stmt_import'] where not ('stmt_import' = any (exclude_codes));

-- ---------------------------------------------------------------------
-- 3) Tablolar
-- ---------------------------------------------------------------------
create table if not exists sup_item_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  party_id uuid not null references fin_parties (id) on delete cascade,      -- asıl (faturalı) cari
  item_id uuid references stk_items (id) on delete set null,
  supplier_name text not null check (length(supplier_name) between 1 and 200),
  unit text check (unit is null or length(unit) <= 20),
  route text not null default 'slip' check (route in ('slip', 'nodisc')),
  price bigint check (price is null or price >= 0),                          -- liste fiyatı (kuruş / cent)
  currency text not null default 'EUR' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  price_date date,
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);
create unique index if not exists sup_item_prices_name_uidx on sup_item_prices (party_id, lower(supplier_name));
create index if not exists sup_item_prices_item_idx on sup_item_prices (party_id, item_id);

create table if not exists sup_slip_lines (
  id uuid primary key default gen_random_uuid(),
  slip_id uuid not null references sup_slips (id) on delete cascade,
  sort int not null default 0,
  item_id uuid references stk_items (id) on delete set null,
  name text not null check (length(name) between 1 and 200),
  qty numeric(14, 3) not null check (qty <> 0),
  unit text check (unit is null or length(unit) <= 20),
  price bigint not null default 0,                                           -- birim fiyat, fişin para biriminde
  currency text not null default 'TRY',
  amount bigint not null,
  stk_move_id bigint
);
create index if not exists sup_slip_lines_slip_idx on sup_slip_lines (slip_id, sort);

create table if not exists sup_import_keys (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  key text not null,
  party_id uuid references fin_parties (id) on delete cascade,
  txn_id uuid references fin_txns (id) on delete cascade,
  slip_id uuid references sup_slips (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (company_id, key)
);

alter table sup_item_prices enable row level security;
alter table sup_slip_lines enable row level security;
alter table sup_import_keys enable row level security;
drop policy if exists sup_item_prices_read on sup_item_prices;
create policy sup_item_prices_read on sup_item_prices for select to authenticated
  using (company_id = lab_company() and (can_module('finance') or can_module('purchases') or can_module('stock')));
drop policy if exists sup_slip_lines_read on sup_slip_lines;
create policy sup_slip_lines_read on sup_slip_lines for select to authenticated
  using (exists (select 1 from sup_slips s where s.id = slip_id and s.company_id = lab_company()) and (can_module('finance') or can_module('purchases')));
grant select on sup_item_prices, sup_slip_lines to authenticated;

-- ---------------------------------------------------------------------
-- 4) Tek fişli cari varsayan fonksiyonlar: yalnız klasik (sub_kind boş) fişli cariyi görsün
-- ---------------------------------------------------------------------
create or replace function _mig_patch(p_sig text, p_old text, p_new text) returns void language plpgsql as $$
declare d text;
begin
  select pg_get_functiondef(p_sig::regprocedure) into d;
  if position(p_new in d) > 0 then return; end if;                 -- zaten yamalı
  if position(p_old in d) = 0 then raise exception 'Yama uygulanamadı: %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

select _mig_patch('fin_party_twin(uuid)',
  $x$  select id into v from fin_parties where slip_of = m.id;$x$,
  $x$  select id into v from fin_parties where slip_of = m.id and sub_kind is null;$x$);
select _mig_patch('pay_items_raw(uuid)',
  $x$(select t.id from fin_parties t where t.slip_of = p.id limit 1) twin$x$,
  $x$(select t.id from fin_parties t where t.slip_of = p.id and t.sub_kind is null limit 1) twin$x$);
select _mig_patch('sup_party_balances(uuid)',
  $x$from fin_parties t2 where t2.slip_of = p.id limit 1)$x$,
  $x$from fin_parties t2 where t2.slip_of = p.id and t2.sub_kind is null limit 1)$x$);
select _mig_patch('sup_pairs()',
  $x$join fin_parties t on t.slip_of = m.id$x$,
  $x$join fin_parties t on t.slip_of = m.id and t.sub_kind is null$x$);
-- tedarikçi portalı fiş ekstresi: fişli carinin kendi para birimiyle
select _mig_patch('sup_portal_ledger(uuid, text, date)',
  $x$  select opening_balance into v_open from fin_parties where id = v_id;$x$,
  $x$  select opening_balance into v_open from fin_parties where id = v_id;
  select * into v_p from fin_parties where id = v_id;  -- fişli cari para birimi$x$);
drop function _mig_patch(text, text, text);

create or replace function sup_twin_of(p_main uuid) returns uuid language sql stable security definer set search_path = public as $$
  select id from fin_parties where slip_of = p_main and sub_kind is null limit 1;
$$;
revoke execute on function sup_twin_of(uuid) from public, anon, authenticated;

-- Grubun asıl (faturalı) carisi
create or replace function sup_main_of(p_party uuid) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(slip_of, id) from fin_parties where id = p_party and company_id = lab_company();
$$;
revoke execute on function sup_main_of(uuid) from public, anon, authenticated;

-- Grubun bir carisi: 'slip' (iskontolu fişli), 'nodisc' (iskontosuz fişli), 'vat' (KDV)
create or replace function sup_group_member(p_main uuid, p_role text) returns uuid language sql stable security definer set search_path = public as $$
  select id from fin_parties
   where slip_of = p_main and case when p_role = 'slip' then sub_kind is null else sub_kind = p_role end
   limit 1;
$$;
revoke execute on function sup_group_member(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5) Ödeme yansıtma: para birimi çevrimi + yalnız asıl ↔ klasik fişli cari arasında
-- ---------------------------------------------------------------------
create or replace function sup_mirror_move() returns trigger language plpgsql security definer set search_path = public as $$
declare t fin_txns; p fin_parties; tw fin_parties; v_twin uuid; v_cat uuid; v_id uuid; v_amt bigint; v_rate numeric;
begin
  if new.party_id is null then return null; end if;
  if coalesce(current_setting('app.skip_mirror', true), '') = 'on' then return null; end if;
  select * into t from fin_txns where id = new.txn_id;
  if t.id is null or t.voided_at is not null or coalesce(t.ref_type, '') in ('mirror', 'stmt_import', 'vat_cari') or not sup_mirror_kind(t.kind) then return null; end if;
  select * into p from fin_parties where id = new.party_id;
  -- iskontosuz ve KDV carisi ödemeleri yansımaz
  if p.sub_kind is not null then return null; end if;
  v_twin := coalesce(p.slip_of, (select id from fin_parties where slip_of = p.id and sub_kind is null));
  if v_twin is null then return null; end if;
  -- aynı işlem içinde öbür cari zaten varsa (ör. elle ikisine birden) yansıtma yapılmaz
  if exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = v_twin) then return null; end if;
  if exists (select 1 from fin_txns x join fin_moves m on m.txn_id = x.id where x.ref_type = 'mirror' and x.ref_id = t.id and m.party_id = v_twin) then return null; end if;
  v_cat := fin_category('slip_mirror');
  if v_cat is null then return null; end if;
  select * into tw from fin_parties where id = v_twin;
  -- öbür cari başka para birimindeyse TL karşılığı o günün kuruyla (TCMB döviz satış) çevrilir
  if tw.currency = new.currency then
    v_amt := new.amount; v_rate := new.rate;
  else
    v_rate := case when tw.currency = 'TRY' then 1 else fx_rate(tw.currency, new.move_date) end;
    if v_rate is null or v_rate <= 0 then raise exception 'rate_missing:%', tw.currency; end if;
    v_amt := round(new.amount_try / v_rate);
  end if;
  if v_amt = 0 then return null; end if;
  insert into fin_txns (company_id, txn_date, kind, description, doc_no, amount, currency, party_id, category_id, ref_type, ref_id, created_by)
  values (t.company_id, t.txn_date, t.kind, left('↔ ' || coalesce(t.description, '') || ' (' || p.name || ' carisinden yansıma'
          || case when tw.currency <> new.currency then ' · kur ' || trim(to_char(v_rate, 'FM999990.0000')) else '' end || ')', 500),
          t.doc_no, abs(v_amt), tw.currency, v_twin, v_cat, 'mirror', t.id, t.created_by)
  returning id into v_id;
  insert into fin_moves (txn_id, move_date, party_id, amount, currency, rate, amount_try, description)
  values (v_id, new.move_date, v_twin, v_amt, tw.currency, v_rate, new.amount_try, 'Yansıma: ' || left(p.name, 200));
  insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
  values (v_id, new.move_date, v_cat, -v_amt, tw.currency, v_rate, -new.amount_try, 'Yansıma');
  return null;
end $$;

-- ---------------------------------------------------------------------
-- 6) Fiş kaydı: stoğa giren fiş "stok" hesabına, girmeyen "malzeme gideri"ne
-- ---------------------------------------------------------------------
create or replace function sup_slip_post(p_slip uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sup_slips; pt fin_parties; v_txn uuid; v_rate numeric; v_cat uuid; v_stock boolean;
begin
  select * into s from sup_slips where id = p_slip;
  if s.id is null or s.cancelled or s.fin_txn_id is not null then return s.fin_txn_id; end if;
  select * into pt from fin_parties where id = s.party_id;
  v_stock := coalesce(s.add_to_stock, (select add_to_stock from stk_receipts where id = s.receipt_id), false);
  v_cat := coalesce(fin_category(case when v_stock then 'stock' else 'exp_material' end), fin_category('exp_material'), fin_category('exp_other'));
  v_rate := case when pt.currency = 'TRY' then 1 else coalesce(fx_rate(pt.currency, s.slip_date), 1) end;
  insert into fin_txns (company_id, txn_date, kind, description, doc_no, amount, currency, party_id, category_id, ref_type, ref_id, created_by)
  values (s.company_id, s.slip_date, 'purchase_slip', left(coalesce(s.note, 'Fişli alım'), 500), s.doc_no, s.amount, pt.currency, pt.id, v_cat, 'sup_slip', s.id, s.created_by)
  returning id into v_txn;
  insert into fin_moves (txn_id, move_date, party_id, amount, currency, rate, amount_try, description)
  values (v_txn, s.slip_date, pt.id, -s.amount, pt.currency, v_rate, -round(s.amount * v_rate), 'Fişli alım');
  insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
  values (v_txn, s.slip_date, v_cat, s.amount, pt.currency, v_rate, round(s.amount * v_rate), 'Fişli alım');
  update sup_slips set fin_txn_id = v_txn where id = s.id;
  return v_txn;
end $$;
revoke execute on function sup_slip_post(uuid) from public, anon, authenticated;

-- Stoğa girmiş kalemli fiş iptal edilince stok geri alınır
create or replace function sup_slip_stock_undo() returns trigger language plpgsql security definer set search_path = public as $$
declare l record;
begin
  if new.cancelled and not old.cancelled then
    for l in select sl.id, mv.item_id, mv.warehouse_id, mv.qty, mv.unit_cost from sup_slip_lines sl join stk_moves mv on mv.id = sl.stk_move_id
              where sl.slip_id = new.id loop
      perform stk_move_sys(l.item_id, l.warehouse_id, -l.qty, 'adjust', l.unit_cost, null, null, current_date, 'sup_slip_cancel', new.id, null, new.party_id, 'Fiş iptali');
      update sup_slip_lines set stk_move_id = null where id = l.id;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists sup_slips_stock_undo on sup_slips;
create trigger sup_slips_stock_undo after update of cancelled on sup_slips for each row execute function sup_slip_stock_undo();

-- ---------------------------------------------------------------------
-- 7) Grup bilgisi ve kurulum
-- ---------------------------------------------------------------------
create or replace function sup_party_bal(p_party uuid) returns bigint language sql stable security definer set search_path = public as $$
  select p.opening_balance + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)
    from fin_parties p where p.id = p_party;
$$;
revoke execute on function sup_party_bal(uuid) from public, anon, authenticated;

-- (+) bize borçlu, (−) biz borçluyuz
create or replace function sup_group(p_party uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_main uuid := sup_main_of(p_party);
begin
  if not (can_module('finance') or can_module('purchases')) then raise exception 'not_allowed'; end if;
  if v_main is null then raise exception 'not_found'; end if;
  return (
    select jsonb_build_object(
      'main', (select jsonb_build_object('id', p.id, 'name', p.name, 'currency', p.currency, 'opening', p.opening_balance, 'balance', sup_party_bal(p.id)) from fin_parties p where p.id = v_main),
      'slip', (select jsonb_build_object('id', p.id, 'name', p.name, 'currency', p.currency, 'opening', p.opening_balance, 'discount_pct', p.discount_pct, 'balance', sup_party_bal(p.id),
                      'moves', (select count(*) from fin_moves m where m.party_id = p.id)) from fin_parties p where p.id = sup_group_member(v_main, 'slip')),
      'nodisc', (select jsonb_build_object('id', p.id, 'name', p.name, 'currency', p.currency, 'opening', p.opening_balance, 'balance', sup_party_bal(p.id),
                      'moves', (select count(*) from fin_moves m where m.party_id = p.id)) from fin_parties p where p.id = sup_group_member(v_main, 'nodisc')),
      'vat', (select jsonb_build_object('id', p.id, 'name', p.name, 'currency', p.currency, 'opening', p.opening_balance, 'balance', sup_party_bal(p.id)) from fin_parties p where p.id = sup_group_member(v_main, 'vat')),
      'items', (select count(*) from sup_item_prices i where i.party_id = v_main),
      'items_nodisc', (select count(*) from sup_item_prices i where i.party_id = v_main and i.route = 'nodisc')));
end $$;
revoke execute on function sup_group(uuid) from public, anon;
grant execute on function sup_group(uuid) to authenticated;

-- Grubu kur / güncelle: fişli carinin para birimi ve iskontosu, iskontosuz fişli cari ve KDV carisi
create or replace function sup_group_setup(p_main uuid, p_slip_currency text, p_discount numeric, p_nodisc boolean, p_vat boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m fin_parties; tw fin_parties; v uuid; v_cur text := coalesce(nullif(p_slip_currency, ''), 'TRY');
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into m from fin_parties where id = p_main and company_id = lab_company();
  if m.id is null then raise exception 'party_required'; end if;
  if m.slip_of is not null then raise exception 'main_required'; end if;
  if v_cur not in ('TRY', 'EUR', 'USD', 'GBP', 'CHF') then raise exception 'bad_currency'; end if;
  if coalesce(p_discount, 0) < 0 or coalesce(p_discount, 0) > 100 then raise exception 'bad_discount'; end if;

  v := fin_party_twin(m.id);                 -- (önce aç, sonra oku: aynı sorguda yeni satır görünmez)
  select * into tw from fin_parties where id = v;
  if tw.currency <> v_cur then
    if exists (select 1 from fin_moves where party_id = tw.id) or tw.opening_balance <> 0 then raise exception 'twin_has_moves'; end if;
    update fin_parties set currency = v_cur, updated_at = now() where id = tw.id;
  end if;
  update fin_parties set discount_pct = coalesce(p_discount, 0), updated_at = now() where id = tw.id;

  if coalesce(p_nodisc, false) then
    v := sup_group_member(m.id, 'nodisc');
    if v is null then
      insert into fin_parties (company_id, name, kind, person_type, phone, email, contact_name, address, district, city, country, iban, currency, payment_term_days, slip_of, sub_kind, note, source)
      values (m.company_id, left(m.name || ' (iskontosuz fişli)', 200), 'supplier', m.person_type, m.phone, m.email, m.contact_name, m.address, m.district, m.city, m.country, m.iban, v_cur,
              m.payment_term_days, m.id, 'nodisc', 'İskonto uygulanmayan ürünlerin fişleri. Faturalı cari: ' || left(m.name, 150), 'manual');
    elsif (select currency from fin_parties where id = v) <> v_cur then
      if exists (select 1 from fin_moves where party_id = v) or (select opening_balance from fin_parties where id = v) <> 0 then raise exception 'nodisc_has_moves'; end if;
      update fin_parties set currency = v_cur, updated_at = now() where id = v;
    end if;
  end if;

  if coalesce(p_vat, false) and sup_group_member(m.id, 'vat') is null then
    insert into fin_parties (company_id, name, kind, person_type, phone, email, contact_name, address, district, city, country, iban, currency, payment_term_days, slip_of, sub_kind, note, source)
    values (m.company_id, left(m.name || ' (KDV)', 200), 'supplier', m.person_type, m.phone, m.email, m.contact_name, m.address, m.district, m.city, m.country, m.iban, m.currency,
            m.payment_term_days, m.id, 'vat', 'Resmi faturaların nakit ödenen KDV''si. Faturalı cari: ' || left(m.name, 150), 'manual');
  end if;
  return sup_group(m.id);
end $$;
revoke execute on function sup_group_setup(uuid, text, numeric, boolean, boolean) from public, anon;
grant execute on function sup_group_setup(uuid, text, numeric, boolean, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 8) Firmaya özel ürün listesi (ürün adı, stok kartı, liste fiyatı, hangi fişli cari)
-- ---------------------------------------------------------------------
-- p: [{ id?, supplier_name, item_id?, unit?, route?, price?, currency?, price_date? , is_active? }]
create or replace function sup_item_price_save(p_main uuid, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0; v_main uuid := sup_main_of(p_main);
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if v_main is null then raise exception 'party_required'; end if;
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if coalesce(trim(r->>'supplier_name'), '') = '' then continue; end if;
    insert into sup_item_prices (party_id, item_id, supplier_name, unit, route, price, currency, price_date, is_active)
    values (v_main, nullif(r->>'item_id', '')::uuid, left(trim(r->>'supplier_name'), 200), nullif(left(r->>'unit', 20), ''),
            case when r->>'route' = 'nodisc' then 'nodisc' else 'slip' end, nullif(r->>'price', '')::bigint,
            coalesce(nullif(r->>'currency', ''), 'EUR'), nullif(r->>'price_date', '')::date, coalesce((r->>'is_active')::boolean, true))
    on conflict (party_id, lower(supplier_name)) do update set
      item_id = coalesce(excluded.item_id, sup_item_prices.item_id),
      unit = coalesce(excluded.unit, sup_item_prices.unit),
      route = case when r ? 'route' then excluded.route else sup_item_prices.route end,
      price = case when r ? 'price' and excluded.price is not null then excluded.price else sup_item_prices.price end,
      currency = case when r ? 'currency' then excluded.currency else sup_item_prices.currency end,
      price_date = coalesce(excluded.price_date, sup_item_prices.price_date),
      is_active = excluded.is_active,
      updated_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function sup_item_price_save(uuid, jsonb) from public, anon;
grant execute on function sup_item_price_save(uuid, jsonb) to authenticated;

-- Ürünü stok kartına bağla; kart yoksa açar (iç kullanım)
create or replace function sup_item_link_int(p_main uuid, p_price uuid, p_create boolean) returns uuid
language plpgsql security definer set search_path = public as $$
declare ip sup_item_prices; v uuid; v_unit text;
begin
  select * into ip from sup_item_prices where id = p_price;
  if ip.id is null then return null; end if;
  if ip.item_id is not null then return ip.item_id; end if;
  select id into v from stk_items where company_id = lab_company() and lower(trim(name)) = lower(trim(ip.supplier_name)) order by is_active desc, created_at limit 1;
  if v is null and p_create then
    v_unit := case upper(coalesce(ip.unit, '')) when 'AD' then 'adet' when 'KT' then 'kutu' when 'PK' then 'paket' when 'KG' then 'kg'
                   when 'BD' then 'bidon' when 'MT' then 'metre' when 'LT' then 'litre' when '' then 'adet' else lower(ip.unit) end;
    insert into stk_items (code, name, kind, unit, supplier_party_id, purchase_price, purchase_currency, note)
    values (stk_next_code('M'), ip.supplier_name, 'material', v_unit, p_main, ip.price, ip.currency, 'Tedarikçi ekstresinden açıldı')
    returning id into v;
  end if;
  if v is not null then update sup_item_prices set item_id = v, updated_at = now() where id = ip.id; end if;
  return v;
end $$;
revoke execute on function sup_item_link_int(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 9) Kalemli fiş girişi: satırlar ürün kuralına göre iskontolu / iskontosuz fişli cariye ayrılır
-- p: { party_id, slip_date, doc_no, note, photo, add_stock, warehouse_id,
--      lines: [{ item_id?, name, qty, unit?, price (kuruş, fiş para biriminde), currency?, route? }] }
-- ---------------------------------------------------------------------
create or replace function sup_slip_entry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_main uuid; v_date date := coalesce(nullif(p->>'slip_date', '')::date, current_date);
  v_stock boolean := coalesce((p->>'add_stock')::boolean, false); v_wh uuid := nullif(p->>'warehouse_id', '')::uuid;
  l jsonb; v_route text; v_role text; v_party uuid; pt fin_parties; v_slip uuid; v_cur text; v_qty numeric; v_price bigint; v_amt bigint; v_line_amt bigint;
  v_ip sup_item_prices; v_item uuid; v_mv bigint; v_cost bigint; v_sort int; out jsonb := '[]';
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  v_main := sup_main_of(nullif(p->>'party_id', '')::uuid);
  if v_main is null then raise exception 'party_required'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_stock and coalesce(v_wh, stk_default_warehouse()) is null then raise exception 'warehouse_required'; end if;

  foreach v_role in array array['slip', 'nodisc'] loop
    v_slip := null; v_amt := 0; v_sort := 0;
    for l in select * from jsonb_array_elements(p->'lines') loop
      v_item := nullif(l->>'item_id', '')::uuid;
      v_ip := null;
      select * into v_ip from sup_item_prices
       where party_id = v_main and ((v_item is not null and item_id = v_item) or lower(supplier_name) = lower(trim(coalesce(l->>'name', ''))))
       order by (item_id = v_item) desc nulls last limit 1;
      v_route := coalesce(nullif(l->>'route', ''), v_ip.route, 'slip');
      if v_route <> v_role then continue; end if;
      v_qty := nullif(l->>'qty', '')::numeric;
      if v_qty is null or v_qty = 0 then continue; end if;
      if coalesce(trim(l->>'name'), '') = '' and v_ip.id is null then raise exception 'line_name_required'; end if;

      if v_slip is null then
        v_party := case when v_role = 'slip' then fin_party_twin(v_main) else sup_group_member(v_main, 'nodisc') end;
        if v_party is null then raise exception 'nodisc_missing'; end if;
        select * into pt from fin_parties where id = v_party;
        insert into sup_slips (party_id, slip_date, doc_no, amount, note, photo, add_to_stock)
        values (pt.id, v_date, nullif(left(trim(p->>'doc_no'), 60), ''), 1, nullif(left(trim(p->>'note'), 300), ''),
                case when coalesce(p->>'photo', '') like 'data:image/jpeg;base64,%' and length(p->>'photo') <= 900000 then p->>'photo' end, v_stock)
        returning id into v_slip;
      end if;

      v_cur := coalesce(nullif(l->>'currency', ''), v_ip.currency, pt.currency);
      v_price := coalesce(nullif(l->>'price', '')::bigint, v_ip.price, 0);
      v_line_amt := round(v_qty * v_price);
      v_item := coalesce(v_item, v_ip.item_id);
      if v_stock and v_item is null and v_ip.id is not null then v_item := sup_item_link_int(v_main, v_ip.id, true); end if;
      v_sort := v_sort + 1;
      v_amt := v_amt + case when v_cur = pt.currency then v_line_amt else fin_conv(v_line_amt, v_cur, pt.currency, v_date) end;
      v_mv := null;
      if v_stock and v_item is not null then
        v_cost := case when v_cur = 'TRY' then v_price else round(v_price * coalesce(fx_rate(v_cur, v_date), 1)) end;
        v_mv := stk_move_sys(v_item, coalesce(v_wh, stk_default_warehouse()), v_qty, 'purchase', v_cost, null, null, v_date, 'sup_slip', v_slip, null, pt.id, left(coalesce(p->>'doc_no', ''), 300));
      end if;
      insert into sup_slip_lines (slip_id, sort, item_id, name, qty, unit, price, currency, amount, stk_move_id)
      values (v_slip, v_sort, v_item, left(coalesce(nullif(trim(l->>'name'), ''), v_ip.supplier_name), 200), v_qty,
              coalesce(nullif(left(l->>'unit', 20), ''), v_ip.unit), v_price, v_cur, v_line_amt, v_mv);
      -- son fiyat ve kural firmanın ürün listesinde kalır
      if v_price > 0 and (can_module('finance', 2) or can_module('purchases', 2)) then
        perform sup_item_price_save(v_main, jsonb_build_array(jsonb_build_object(
          'supplier_name', coalesce(nullif(trim(l->>'name'), ''), v_ip.supplier_name), 'item_id', v_item, 'unit', coalesce(nullif(l->>'unit', ''), v_ip.unit),
          'route', v_route, 'price', v_price, 'currency', v_cur, 'price_date', v_date)));
      end if;
    end loop;
    if v_slip is not null then
      if v_amt <= 0 then raise exception 'amount_required'; end if;
      update sup_slips set amount = v_amt where id = v_slip;
      perform sup_slip_post(v_slip);
      out := out || jsonb_build_array(jsonb_build_object('slip_id', v_slip, 'party_id', pt.id, 'party', pt.name, 'role', v_role, 'amount', v_amt, 'currency', pt.currency));
    end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'lines_required'; end if;
  return out;
end $$;
revoke execute on function sup_slip_entry(jsonb) from public, anon;
grant execute on function sup_slip_entry(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 10) İskonto: fişli cari bakiyesinden ayrı satırla düşülür
-- ---------------------------------------------------------------------
create or replace function sup_discount_suggest(p_party uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select greatest(round(-sup_party_bal(p.id) * p.discount_pct / 100), 0)::bigint
    from fin_parties p where p.id = p_party and p.company_id = lab_company() and (can_module('finance') or can_module('purchases'));
$$;
revoke execute on function sup_discount_suggest(uuid) from public, anon;
grant execute on function sup_discount_suggest(uuid) to authenticated;

create or replace function sup_discount_post(p_party uuid, p_date date, p_amount bigint, p_note text, p_doc text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare pt fin_parties; v_cat uuid := fin_category('purchase_discount'); v_rate numeric; v_date date := coalesce(p_date, current_date);
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into pt from fin_parties where id = p_party and company_id = lab_company();
  if pt.id is null then raise exception 'party_required'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'amount_required'; end if;
  if v_cat is null then raise exception 'category_missing'; end if;
  v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, v_date) end;
  return fin_post_sys(
    jsonb_build_object('kind', 'adjust', 'txn_date', v_date, 'description', coalesce(nullif(trim(p_note), ''), 'İskonto'), 'doc_no', p_doc,
                       'amount', p_amount, 'currency', pt.currency, 'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'sup_discount'),
    jsonb_build_array(
      jsonb_build_object('party_id', pt.id, 'amount', p_amount, 'currency', pt.currency, 'rate', v_rate, 'description', 'İskonto'),
      jsonb_build_object('category_id', v_cat, 'amount', -p_amount, 'currency', pt.currency, 'rate', v_rate, 'description', 'İskonto')));
end $$;
revoke execute on function sup_discount_post(uuid, date, bigint, text, text) from public, anon;
grant execute on function sup_discount_post(uuid, date, bigint, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- 11) KDV carisi: faturalı cariye işlenen alış faturasının KDV'si KDV carisine borç yazılır
-- ---------------------------------------------------------------------
create or replace function sup_vat_post_int(p_inv uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare i inv_invoices; v_vat uuid; pt fin_parties; v_amt bigint; v_rate numeric; v_cat uuid := fin_category('vat_cari');
begin
  select * into i from inv_invoices where id = p_inv;
  if i.id is null or i.direction <> 'purchase' or i.status <> 'posted' or i.fin_txn_id is null or coalesce(i.vat_total, 0) <= 0 then return null; end if;
  v_vat := sup_group_member(i.party_id, 'vat');
  if v_vat is null or v_cat is null then return null; end if;
  if exists (select 1 from fin_txns where ref_type = 'vat_cari' and ref_id = i.fin_txn_id and voided_at is null) then return null; end if;
  select * into pt from fin_parties where id = v_vat;
  v_amt := case when coalesce(i.currency, 'TRY') = pt.currency then i.vat_total else fin_conv(i.vat_total, i.currency, pt.currency, i.invoice_date) end;
  -- ekstreden aktarılmış aynı KDV satırı varsa tekrar yazılmaz
  if exists (select 1 from fin_txns t join fin_moves m on m.txn_id = t.id where t.ref_type = 'stmt_import' and t.voided_at is null and m.party_id = v_vat
              and t.txn_date = i.invoice_date and m.amount = -v_amt) then return null; end if;
  v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, i.invoice_date) end;
  return fin_post_sys(
    jsonb_build_object('kind', 'adjust', 'txn_date', i.invoice_date, 'description', 'KDV · fatura ' || coalesce(i.doc_no, ''), 'doc_no', i.doc_no,
                       'amount', v_amt, 'currency', pt.currency, 'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'vat_cari', 'ref_id', i.fin_txn_id),
    jsonb_build_array(
      jsonb_build_object('party_id', pt.id, 'amount', -v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Fatura KDV''si'),
      jsonb_build_object('category_id', v_cat, 'amount', v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Fatura KDV''si')));
end $$;
revoke execute on function sup_vat_post_int(uuid) from public, anon, authenticated;

create or replace function sup_vat_on_invoice() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.direction = 'purchase' and new.status = 'posted' and new.fin_txn_id is not null
     and (old.status is distinct from 'posted' or old.fin_txn_id is distinct from new.fin_txn_id) then
    perform sup_vat_post_int(new.id);
  end if;
  return new;
end $$;
drop trigger if exists inv_invoices_vat_cari on inv_invoices;
create trigger inv_invoices_vat_cari after update of status, fin_txn_id on inv_invoices for each row execute function sup_vat_on_invoice();

-- Fatura (asıl işlem) iptal edilince KDV carisi satırı da iptal
create or replace function sup_vat_void() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update fin_txns set voided_at = new.voided_at, voided_by = new.voided_by, void_reason = 'Fatura iptal edildi'
     where ref_type = 'vat_cari' and ref_id = new.id and voided_at is null;
  end if;
  return new;
end $$;
drop trigger if exists fin_txns_vat_void on fin_txns;
create trigger fin_txns_vat_void after update of voided_at on fin_txns for each row execute function sup_vat_void();

-- KDV carisi açılmadan önce işlenmiş faturaları (tarihten itibaren) KDV carisine yaz
create or replace function sup_vat_backfill(p_main uuid, p_from date) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  for r in select id from inv_invoices where party_id = sup_main_of(p_main) and direction = 'purchase' and status = 'posted' and invoice_date >= coalesce(p_from, '1900-01-01') order by invoice_date loop
    if sup_vat_post_int(r.id) is not null then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function sup_vat_backfill(uuid, date) from public, anon;
grant execute on function sup_vat_backfill(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- 12) Tedarikçi ekstresi aktarımı (Excel'den okunur, tarayıcıda ayrıştırılır)
-- p: {
--   items: [{ name, unit, route, price, currency, price_date }],  create_items: bool,
--   sections: [{ book: 'slip'|'nodisc'|'main'|'vat', opening: bool, payments: bool, invoices: bool,
--                slips: [{ date, doc, note, lines: [{ name, qty, unit, price, amount }] }],
--                moves: [{ date, tip, desc, debit, credit }] }]   -- tutarlar kuruş/cent, cari para biriminde
-- }
-- tip: DEVIR | IADE | ISKONTO | ODEME | VIRMAN | SENET_IADE | FATURA | KDV_BORC
-- ---------------------------------------------------------------------
create or replace function sup_statement_import(p_main uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_main uuid := sup_main_of(p_main); sec jsonb; r jsonb; ln jsonb; pt fin_parties; v_party uuid; v_book text;
  v_key text; v_k int; v_seen jsonb := '{}'; v_slip uuid; v_txn uuid; v_amt bigint; v_sum bigint; v_sort int; v_rate numeric;
  v_cat uuid; v_kind text; v_tip text; v_ip uuid; v_item uuid; v_desc text; v_date date;
  n_items int := 0; n_new_items int := 0; n_slips int := 0; n_lines int := 0; n_moves int := 0; n_skip int := 0; n_open int := 0;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  if v_main is null then raise exception 'party_required'; end if;
  perform set_config('app.skip_mirror', 'on', true);
  perform set_config('app.skip_audit', 'on', true);

  -- ürün listesi
  for r in select * from jsonb_array_elements(coalesce(p->'items', '[]')) loop
    perform sup_item_price_save(v_main, jsonb_build_array(r));
    select id into v_ip from sup_item_prices where party_id = v_main and lower(supplier_name) = lower(trim(r->>'supplier_name'));
    if v_ip is null then continue; end if;
    n_items := n_items + 1;
    perform sup_item_link_int(v_main, v_ip, coalesce((p->>'create_items')::boolean, false));
  end loop;
  select count(*) into n_new_items from stk_items where company_id = lab_company() and created_at = now() and note = 'Tedarikçi ekstresinden açıldı';

  for sec in select * from jsonb_array_elements(coalesce(p->'sections', '[]')) loop
    v_book := sec->>'book';
    v_party := case v_book when 'main' then v_main when 'slip' then sup_group_member(v_main, 'slip') when 'nodisc' then sup_group_member(v_main, 'nodisc') when 'vat' then sup_group_member(v_main, 'vat') end;
    if v_party is null then raise exception 'group_member_missing:%', v_book; end if;
    select * into pt from fin_parties where id = v_party;

    -- fişler (kalemli)
    for r in select * from jsonb_array_elements(coalesce(sec->'slips', '[]')) loop
      v_sum := coalesce((select sum((x->>'amount')::bigint) from jsonb_array_elements(r->'lines') x), 0);
      -- anahtar: tarih + kalemler (aynı gün birebir aynı ikinci fiş için sıra numarası)
      v_key := concat_ws('|', v_party, 'slip', r->>'date', v_sum,
                 (select string_agg(concat_ws('~', lower(x->>'name'), x->>'qty', x->>'amount'), ';' order by o) from jsonb_array_elements(r->'lines') with ordinality as e(x, o)));
      v_k := coalesce((v_seen->>v_key)::int, 0) + 1;
      v_seen := v_seen || jsonb_build_object(v_key, v_k);
      v_key := md5(v_key || '#' || v_k);
      if exists (select 1 from sup_import_keys where company_id = lab_company() and key = v_key) then n_skip := n_skip + 1; continue; end if;
      if v_sum <= 0 then continue; end if;
      insert into sup_slips (party_id, slip_date, doc_no, amount, note, add_to_stock)
      values (pt.id, (r->>'date')::date, nullif(left(r->>'doc', 60), ''), v_sum, left(coalesce(nullif(r->>'note', ''), 'Ekstreden aktarıldı'), 300), false)
      returning id into v_slip;
      v_sort := 0;
      for ln in select * from jsonb_array_elements(r->'lines') loop
        v_sort := v_sort + 1;
        insert into sup_slip_lines (slip_id, sort, item_id, name, qty, unit, price, currency, amount)
        values (v_slip, v_sort, (select item_id from sup_item_prices where party_id = v_main and lower(supplier_name) = lower(trim(ln->>'name'))),
                left(ln->>'name', 200), (ln->>'qty')::numeric, nullif(left(ln->>'unit', 20), ''), coalesce((ln->>'price')::bigint, 0), pt.currency, (ln->>'amount')::bigint);
        n_lines := n_lines + 1;
      end loop;
      perform sup_slip_post(v_slip);
      insert into sup_import_keys (key, party_id, slip_id) values (v_key, pt.id, v_slip);
      n_slips := n_slips + 1;
    end loop;

    -- diğer hareketler
    for r in select * from jsonb_array_elements(coalesce(sec->'moves', '[]')) loop
      v_tip := upper(coalesce(r->>'tip', ''));
      v_date := (r->>'date')::date;
      v_amt := coalesce((r->>'credit')::bigint, 0) - coalesce((r->>'debit')::bigint, 0);   -- (+) borcumuz azalır
      v_desc := left(coalesce(nullif(r->>'desc', ''), v_tip), 500);
      if v_tip = 'DEVIR' then
        if coalesce((sec->>'opening')::boolean, false) then
          update fin_parties set opening_balance = v_amt, opening_date = v_date, updated_at = now() where id = pt.id;
          n_open := n_open + 1;
        end if;
        continue;
      end if;
      if v_tip in ('ODEME', 'VIRMAN', 'SENET_IADE') and not coalesce((sec->>'payments')::boolean, false) then continue; end if;
      if v_tip = 'FATURA' and not coalesce((sec->>'invoices')::boolean, false) then continue; end if;
      if v_amt = 0 then continue; end if;
      v_key := concat_ws('|', v_party, 'move', v_date, v_tip, v_desc, v_amt);
      v_k := coalesce((v_seen->>v_key)::int, 0) + 1;
      v_seen := v_seen || jsonb_build_object(v_key, v_k);
      v_key := md5(v_key || '#' || v_k);
      if exists (select 1 from sup_import_keys where company_id = lab_company() and key = v_key) then n_skip := n_skip + 1; continue; end if;
      v_kind := case v_tip when 'IADE' then 'purchase_return' else 'adjust' end;
      v_cat := case v_tip when 'IADE' then coalesce(fin_category('exp_material'), fin_category('exp_other'))
                          when 'ISKONTO' then fin_category('purchase_discount')
                          when 'KDV_BORC' then fin_category('vat_cari')
                          else fin_category('stmt_import') end;
      if v_cat is null then raise exception 'category_missing'; end if;
      v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, v_date) end;
      v_txn := fin_post_sys(
        jsonb_build_object('kind', v_kind, 'txn_date', v_date, 'description', v_desc, 'amount', abs(v_amt), 'currency', pt.currency,
                           'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'stmt_import', 'ref_id', v_main),
        jsonb_build_array(
          jsonb_build_object('party_id', pt.id, 'amount', v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', left(v_desc, 300)),
          jsonb_build_object('category_id', v_cat, 'amount', -v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Ekstre aktarımı')));
      insert into sup_import_keys (key, party_id, txn_id) values (v_key, pt.id, v_txn);
      n_moves := n_moves + 1;
    end loop;
  end loop;

  return jsonb_build_object('items', n_items, 'new_items', n_new_items, 'slips', n_slips, 'lines', n_lines, 'moves', n_moves, 'openings', n_open, 'skipped', n_skip);
end $$;
revoke execute on function sup_statement_import(uuid, jsonb) from public, anon;
grant execute on function sup_statement_import(uuid, jsonb) to authenticated;

-- Aktarım önizlemesi: carilerde dönem içinde zaten kayıt var mı (çift kayıt uyarısı)
create or replace function sup_statement_overlap(p_main uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(x.role, x.n) from (
    select r.role, (select count(*) from fin_moves m join fin_txns t on t.id = m.txn_id
                     where m.party_id = case r.role when 'main' then sup_main_of(p_main) else sup_group_member(sup_main_of(p_main), r.role) end
                       and t.voided_at is null
                       and coalesce(t.ref_type, '') not in ('stmt_import', 'mirror') and t.txn_date between p_from and p_to) n
      from (values ('main'), ('slip'), ('nodisc'), ('vat')) as r(role)
  ) x where can_module('finance');
$$;
revoke execute on function sup_statement_overlap(uuid, date, date) from public, anon;
grant execute on function sup_statement_overlap(uuid, date, date) to authenticated;

notify pgrst, 'reload schema';
