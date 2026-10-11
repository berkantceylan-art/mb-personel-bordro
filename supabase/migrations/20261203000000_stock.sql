-- =====================================================================
-- STOK: ürün / malzeme kartları, depolar, hareketler, transfer, sayım, lot ve son kullanma, reçete
--  stk_items       : malzeme, hammadde, sarf, ürün, hizmet, ticari mal (barkod, min stok, lot / SKT takibi)
--  stk_warehouses  : ana depo, üretim, karantina, konsinye, araç
--  stk_moves       : tüm stok hareketleri (işaretli miktar, birim maliyet TL kuruş, lot, SKT, belge / iş bağlantısı)
--  stk_transfers   : iki aşamalı depo transferi (gönder → yolda → teslim al), eksik teslim kaydı
--  stk_counts      : sayım (kör sayım, barkodla okutma, kapatınca fark kaydı)
--  stk_boms        : protez ürünü başına malzeme reçetesi (üretimde otomatik tüketim)
--  fin_post_sys()  : yetki kontrolsüz iç kayıt (stok / üretim / fatura tetikleyicileri kullanır)
-- Tekrar çalıştırılabilir. Önce 20261202000000_finance_core.sql çalıştırılmış olmalı.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Finans: iç kayıt fonksiyonu (fin_post yetki kontrolü + bunu çağırır)
-- ---------------------------------------------------------------------
create or replace function fin_post_sys(p_header jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_date date := coalesce(nullif(p_header->>'txn_date', '')::date, current_date);
  l jsonb; v_amount bigint; v_cur text; v_rate numeric; v_try bigint;
  v_sum bigint := 0; v_curs text[] := '{}'; v_count int := 0;
begin
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
    v_sum := v_sum + v_try; v_count := v_count + 1;
    if not v_cur = any (v_curs) then v_curs := v_curs || v_cur; end if;
  end loop;
  if v_count < 2 then
    -- tüm satırlar 0 ise boş işlem tutulmaz
    delete from fin_txns where id = v_id;
    return null;
  end if;
  if v_sum <> 0 then
    if array_length(v_curs, 1) > 1 or abs(v_sum) <= 5 then
      insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
      values (v_id, v_date, fin_category(case when v_sum > 0 then 'fx_gain' else 'fx_loss' end), -v_sum, 'TRY', 1, -v_sum, 'Kur farkı');
    else
      raise exception 'unbalanced:%', v_sum;
    end if;
  end if;
  return v_id;
end $$;
revoke execute on function fin_post_sys(jsonb, jsonb) from public, anon, authenticated;

create or replace function fin_post(p_header jsonb, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_module text := coalesce(p_header->>'module', 'finance'); v_kind text := p_header->>'kind';
begin
  -- finans yetkisi her kaydı girer; diğer modüller yalnız kendi işlem türlerini
  if not (can_module('finance', 2)
          or (v_module = 'sales' and can_module('sales', 2) and v_kind in ('credit_sale'))
          or (v_module = 'expenses' and can_module('expenses', 2) and v_kind in ('expense', 'advance_close', 'card_spend'))) then
    raise exception 'not_allowed';
  end if;
  return fin_post_sys(p_header, p_lines);
end $$;
revoke execute on function fin_post(jsonb, jsonb) from public, anon;
grant execute on function fin_post(jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Kartlar
-- ---------------------------------------------------------------------
create table if not exists stk_categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  name text not null check (length(name) between 1 and 80),
  parent_id uuid references stk_categories (id) on delete set null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists stk_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  code text not null check (length(code) between 1 and 40),
  barcode text check (barcode is null or length(barcode) <= 64),
  name text not null check (length(name) between 1 and 200),
  kind text not null default 'material' check (kind in ('material', 'raw', 'consumable', 'product', 'goods', 'service', 'packaging')),
  category_id uuid references stk_categories (id) on delete set null,
  unit text not null default 'adet' check (length(unit) between 1 and 20),
  brand text check (brand is null or length(brand) <= 80),
  supplier_party_id uuid references fin_parties (id) on delete set null,
  purchase_price bigint check (purchase_price is null or purchase_price >= 0),
  purchase_currency text not null default 'TRY' check (purchase_currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  sale_price bigint check (sale_price is null or sale_price >= 0),
  sale_currency text not null default 'TRY' check (sale_currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  vat_rate smallint not null default 20 check (vat_rate in (0, 1, 10, 20)),
  min_qty numeric(14, 3) check (min_qty is null or min_qty >= 0),
  max_qty numeric(14, 3) check (max_qty is null or max_qty >= 0),
  reorder_qty numeric(14, 3) check (reorder_qty is null or reorder_qty >= 0),
  track_lot boolean not null default false,
  track_expiry boolean not null default false,
  shelf text check (shelf is null or length(shelf) <= 40),
  lab_product_id uuid references lab_products (id) on delete set null,
  default_warehouse_id uuid,
  note text check (note is null or length(note) <= 2000),
  is_active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists stk_items_code_uidx on stk_items (company_id, lower(code));
create unique index if not exists stk_items_barcode_uidx on stk_items (company_id, barcode) where barcode is not null;
create index if not exists stk_items_name_idx on stk_items (lower(name));

create table if not exists stk_warehouses (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  code text check (code is null or length(code) <= 20),
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'main' check (kind in ('main', 'production', 'quarantine', 'consignment', 'vehicle', 'other')),
  address text check (address is null or length(address) <= 300),
  responsible text check (responsible is null or length(responsible) <= 120),
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists stk_warehouses_default_uidx on stk_warehouses (company_id) where is_default;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'stk_items_default_wh_fk') then
    alter table stk_items add constraint stk_items_default_wh_fk foreign key (default_warehouse_id) references stk_warehouses (id) on delete set null;
  end if;
end $$;

-- Varsayılan depolar
insert into stk_warehouses (company_id, code, name, kind, is_default)
select lab_company(), 'ANA', 'Ana depo', 'main', true
where lab_company() is not null and not exists (select 1 from stk_warehouses where company_id = lab_company());
insert into stk_warehouses (company_id, code, name, kind)
select lab_company(), 'URT', 'Üretim', 'production'
where lab_company() is not null and not exists (select 1 from stk_warehouses where company_id = lab_company() and kind = 'production');

create table if not exists stk_moves (
  id bigint generated by default as identity primary key,
  company_id uuid references companies (id) on delete cascade default lab_company(),
  move_date date not null default current_date,
  item_id uuid not null references stk_items (id) on delete restrict,
  warehouse_id uuid not null references stk_warehouses (id) on delete restrict,
  qty numeric(14, 3) not null check (qty <> 0),
  unit_cost bigint not null default 0,                -- TL kuruş, birim başına
  lot_no text check (lot_no is null or length(lot_no) <= 60),
  expiry_date date,
  kind text not null check (kind in ('opening', 'purchase', 'purchase_return', 'sale', 'sale_return', 'transfer_out', 'transfer_in',
                                      'count_adjust', 'consume', 'produce', 'waste', 'adjust')),
  doc_type text check (doc_type is null or length(doc_type) <= 30),
  doc_id uuid,
  job_id uuid references jobs (id) on delete set null,
  party_id uuid references fin_parties (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists stk_moves_item_idx on stk_moves (item_id, warehouse_id, move_date);
create index if not exists stk_moves_doc_idx on stk_moves (doc_type, doc_id);
create index if not exists stk_moves_job_idx on stk_moves (job_id) where job_id is not null;

create table if not exists stk_boms (
  id uuid primary key default gen_random_uuid(),
  lab_product_id uuid not null references lab_products (id) on delete cascade,
  item_id uuid not null references stk_items (id) on delete cascade,
  qty numeric(14, 4) not null check (qty > 0),        -- ürün birimi (diş / adet) başına
  waste_pct numeric(5, 2) not null default 0 check (waste_pct between 0 and 100),
  note text check (note is null or length(note) <= 200),
  unique (lab_product_id, item_id)
);

-- RLS
alter table stk_categories enable row level security;
alter table stk_items enable row level security;
alter table stk_warehouses enable row level security;
alter table stk_moves enable row level security;
alter table stk_boms enable row level security;
do $$
declare t text;
begin
  foreach t in array array['stk_categories', 'stk_items', 'stk_warehouses', 'stk_boms'] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format('create policy %I on %I for select to authenticated using (can_module(''stock'') or can_module(''production'') or can_module(''purchases'') or can_module(''sales''))', t || '_read', t);
    execute format('drop policy if exists %I on %I', t || '_write', t);
    execute format('create policy %I on %I for all to authenticated using (can_module(''stock'', 2)) with check (can_module(''stock'', 2))', t || '_write', t);
    execute format('grant select, insert, update, delete on %I to authenticated', t);
  end loop;
end $$;
drop policy if exists stk_moves_read on stk_moves;
create policy stk_moves_read on stk_moves for select to authenticated using (can_module('stock') or can_module('production') or can_module('purchases') or can_module('sales'));
grant select on stk_moves to authenticated;

drop trigger if exists stk_items_touch on stk_items;
create trigger stk_items_touch before update on stk_items for each row execute function lab_touch();
drop trigger if exists audit_stk_items on stk_items;
create trigger audit_stk_items after insert or update or delete on stk_items for each row execute function audit_trigger();
drop trigger if exists audit_stk_moves on stk_moves;
create trigger audit_stk_moves after insert or update or delete on stk_moves for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- Stok durumu ve maliyet
-- ---------------------------------------------------------------------
create or replace view stk_stock with (security_invoker = true) as
select m.item_id, m.warehouse_id, m.lot_no, max(m.expiry_date) as expiry_date, sum(m.qty) as qty
from stk_moves m
group by m.item_id, m.warehouse_id, m.lot_no
having sum(m.qty) <> 0;
grant select on stk_stock to authenticated;

-- Ağırlıklı ortalama maliyet: girişlerin (alış, açılış, üretim, pozitif sayım farkı, gelen transfer hariç) ortalaması
create or replace function stk_avg_cost(p_item uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select round(sum(qty * unit_cost) / nullif(sum(qty), 0))::bigint from stk_moves
     where item_id = p_item and qty > 0 and kind in ('opening', 'purchase', 'produce', 'count_adjust', 'adjust', 'sale_return') and unit_cost > 0),
    (select round(coalesce(purchase_price, 0) * coalesce(fx_rate(purchase_currency, current_date), 1))::bigint from stk_items where id = p_item),
    0);
$$;
grant execute on function stk_avg_cost(uuid) to authenticated;

create or replace view stk_item_totals with (security_invoker = true) as
select i.id as item_id, coalesce(sum(m.qty), 0) as qty, stk_avg_cost(i.id) as avg_cost,
       round(coalesce(sum(m.qty), 0) * stk_avg_cost(i.id))::bigint as value
from stk_items i left join stk_moves m on m.item_id = i.id
group by i.id;
grant select on stk_item_totals to authenticated;

create or replace function stk_default_warehouse() returns uuid
language sql stable security definer set search_path = public as $$
  select id from stk_warehouses where company_id = lab_company() and is_active order by is_default desc, created_at limit 1;
$$;

-- İç hareket yazıcı (yetki kontrolü çağırandadır)
create or replace function stk_move_sys(
  p_item uuid, p_warehouse uuid, p_qty numeric, p_kind text, p_unit_cost bigint default null, p_lot text default null, p_expiry date default null,
  p_date date default current_date, p_doc_type text default null, p_doc_id uuid default null, p_job uuid default null, p_party uuid default null, p_note text default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if p_qty is null or p_qty = 0 then return null; end if;
  insert into stk_moves (move_date, item_id, warehouse_id, qty, unit_cost, lot_no, expiry_date, kind, doc_type, doc_id, job_id, party_id, note)
  values (coalesce(p_date, current_date), p_item, coalesce(p_warehouse, stk_default_warehouse()), p_qty,
          coalesce(p_unit_cost, case when p_qty < 0 or p_kind in ('transfer_in') then stk_avg_cost(p_item) else 0 end),
          nullif(trim(coalesce(p_lot, '')), ''), p_expiry, p_kind, p_doc_type, p_doc_id, p_job, p_party, nullif(left(coalesce(p_note, ''), 300), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function stk_move_sys(uuid, uuid, numeric, text, bigint, text, date, date, text, uuid, uuid, uuid, text) from public, anon, authenticated;

-- Elle stok girişi / düzeltme / fire / tüketim
create or replace function stk_adjust(
  p_item uuid, p_warehouse uuid, p_qty numeric, p_kind text, p_unit_cost bigint, p_lot text, p_expiry date, p_date date, p_note text, p_job uuid default null
) returns bigint language plpgsql security definer set search_path = public as $$
declare it stk_items;
begin
  if not (can_module('stock', 2) or (p_kind = 'consume' and can_module('production', 2))) then raise exception 'not_allowed'; end if;
  if p_kind not in ('opening', 'adjust', 'waste', 'consume') then raise exception 'bad_kind'; end if;
  select * into it from stk_items where id = p_item;
  if it.id is null then raise exception 'not_found'; end if;
  if it.track_lot and nullif(trim(coalesce(p_lot, '')), '') is null and p_qty > 0 then raise exception 'lot_required'; end if;
  if it.track_expiry and p_expiry is null and p_qty > 0 then raise exception 'expiry_required'; end if;
  return stk_move_sys(p_item, p_warehouse,
    case when p_kind in ('waste', 'consume') then -abs(p_qty) else p_qty end, p_kind,
    case when p_qty > 0 and p_kind in ('opening', 'adjust') then coalesce(p_unit_cost, stk_avg_cost(p_item)) end,
    p_lot, p_expiry, p_date, 'manual', null, p_job, null, p_note);
end $$;
revoke execute on function stk_adjust(uuid, uuid, numeric, text, bigint, text, date, date, text, uuid) from public, anon;
grant execute on function stk_adjust(uuid, uuid, numeric, text, bigint, text, date, date, text, uuid) to authenticated;

-- FIFO / ilk SKT tüketim: lotlardan sırayla düşer; lot yoksa lotsuz düşer. Dönen: kullanılan lotlar
create or replace function stk_consume_fifo(p_item uuid, p_warehouse uuid, p_qty numeric, p_kind text, p_date date, p_doc_type text, p_doc_id uuid, p_job uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_left numeric := p_qty; v_take numeric; v_used jsonb := '[]'::jsonb; v_wh uuid := coalesce(p_warehouse, stk_default_warehouse());
begin
  if p_qty is null or p_qty <= 0 then return v_used; end if;
  for r in
    select lot_no, max(expiry_date) as expiry_date, sum(qty) as qty
    from stk_moves where item_id = p_item and warehouse_id = v_wh and lot_no is not null
    group by lot_no having sum(qty) > 0
    order by max(expiry_date) nulls last, min(move_date), lot_no
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    perform stk_move_sys(p_item, v_wh, -v_take, p_kind, null, r.lot_no, r.expiry_date, p_date, p_doc_type, p_doc_id, p_job, null, p_note);
    v_used := v_used || jsonb_build_object('lot', r.lot_no, 'expiry', r.expiry_date, 'qty', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    perform stk_move_sys(p_item, v_wh, -v_left, p_kind, null, null, null, p_date, p_doc_type, p_doc_id, p_job, null, p_note);
    v_used := v_used || jsonb_build_object('lot', null, 'qty', v_left);
  end if;
  return v_used;
end $$;
revoke execute on function stk_consume_fifo(uuid, uuid, numeric, text, date, text, uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Transfer (gönder → yolda → teslim al)
-- ---------------------------------------------------------------------
create table if not exists stk_transfers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  no bigint generated by default as identity,
  transfer_date date not null default current_date,
  from_warehouse_id uuid not null references stk_warehouses (id) on delete restrict,
  to_warehouse_id uuid not null references stk_warehouses (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'in_transit', 'received', 'cancelled')),
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  sent_at timestamptz, sent_by uuid,
  received_at timestamptz, received_by uuid,
  check (from_warehouse_id <> to_warehouse_id)
);
create table if not exists stk_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references stk_transfers (id) on delete cascade,
  item_id uuid not null references stk_items (id) on delete restrict,
  qty numeric(14, 3) not null check (qty > 0),
  lot_no text check (lot_no is null or length(lot_no) <= 60),
  expiry_date date,
  received_qty numeric(14, 3) check (received_qty is null or received_qty >= 0),
  note text check (note is null or length(note) <= 200)
);
create index if not exists stk_transfer_lines_idx on stk_transfer_lines (transfer_id);
alter table stk_transfers enable row level security;
alter table stk_transfer_lines enable row level security;
drop policy if exists stk_transfers_read on stk_transfers;
create policy stk_transfers_read on stk_transfers for select to authenticated using (can_module('stock') or can_module('production'));
drop policy if exists stk_transfers_write on stk_transfers;
create policy stk_transfers_write on stk_transfers for all to authenticated using (can_module('stock', 2) and status = 'draft') with check (can_module('stock', 2) and status = 'draft');
drop policy if exists stk_transfer_lines_read on stk_transfer_lines;
create policy stk_transfer_lines_read on stk_transfer_lines for select to authenticated using (can_module('stock') or can_module('production'));
drop policy if exists stk_transfer_lines_write on stk_transfer_lines;
create policy stk_transfer_lines_write on stk_transfer_lines for all to authenticated
  using (can_module('stock', 2) and exists (select 1 from stk_transfers t where t.id = transfer_id and t.status = 'draft'))
  with check (can_module('stock', 2) and exists (select 1 from stk_transfers t where t.id = transfer_id and t.status = 'draft'));
grant select, insert, update, delete on stk_transfers, stk_transfer_lines to authenticated;

-- Gönder: çıkış deposundan düşer (lot belirtilmediyse FIFO); p_receive = true ise hemen teslim alınır
create or replace function stk_transfer_send(p_transfer uuid, p_receive boolean default false) returns void
language plpgsql security definer set search_path = public as $$
declare t stk_transfers; l stk_transfer_lines; v_avail numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into t from stk_transfers where id = p_transfer for update;
  if t.id is null or t.status <> 'draft' then raise exception 'bad_status'; end if;
  if not exists (select 1 from stk_transfer_lines where transfer_id = t.id) then raise exception 'no_lines'; end if;
  for l in select * from stk_transfer_lines where transfer_id = t.id loop
    select coalesce(sum(qty), 0) into v_avail from stk_moves
    where item_id = l.item_id and warehouse_id = t.from_warehouse_id and (l.lot_no is null or lot_no = l.lot_no);
    if v_avail < l.qty then raise exception 'insufficient:%', (select name from stk_items where id = l.item_id); end if;
    if l.lot_no is not null then
      perform stk_move_sys(l.item_id, t.from_warehouse_id, -l.qty, 'transfer_out', null, l.lot_no, l.expiry_date, t.transfer_date, 'transfer', t.id, null, null, 'Transfer #' || t.no);
    else
      perform stk_consume_fifo(l.item_id, t.from_warehouse_id, l.qty, 'transfer_out', t.transfer_date, 'transfer', t.id, null, 'Transfer #' || t.no);
    end if;
  end loop;
  update stk_transfers set status = 'in_transit', sent_at = now(), sent_by = auth.uid() where id = t.id;
  if p_receive then perform stk_transfer_receive(t.id, null); end if;
end $$;

-- Teslim al: çıkıştaki lotlarıyla giriş deposuna eklenir; eksik gelen miktar kayıp (fire) olarak işaretlenir
create or replace function stk_transfer_receive(p_transfer uuid, p_received jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t stk_transfers; r record; l stk_transfer_lines; v_got numeric; v_ratio numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into t from stk_transfers where id = p_transfer for update;
  if t.id is null or t.status <> 'in_transit' then raise exception 'bad_status'; end if;
  for l in select * from stk_transfer_lines where transfer_id = t.id loop
    v_got := coalesce(nullif(p_received->>l.id::text, '')::numeric, l.qty);
    if v_got < 0 or v_got > l.qty then raise exception 'bad_qty'; end if;
    update stk_transfer_lines set received_qty = v_got where id = l.id;
    v_ratio := v_got / l.qty;
    -- çıkış hareketlerini lot bazında aynalayarak giriş yap
    for r in
      select lot_no, max(expiry_date) as expiry_date, -sum(qty) as qty, max(unit_cost) as unit_cost
      from stk_moves where doc_type = 'transfer' and doc_id = t.id and item_id = l.item_id and kind = 'transfer_out'
        and (l.lot_no is null or lot_no is not distinct from l.lot_no)
      group by lot_no
    loop
      perform stk_move_sys(l.item_id, t.to_warehouse_id, round(r.qty * v_ratio, 3), 'transfer_in', r.unit_cost, r.lot_no, r.expiry_date, current_date, 'transfer', t.id, null, null, 'Transfer #' || t.no);
    end loop;
  end loop;
  update stk_transfers set status = 'received', received_at = now(), received_by = auth.uid() where id = t.id;
end $$;
revoke execute on function stk_transfer_send(uuid, boolean) from public, anon;
grant execute on function stk_transfer_send(uuid, boolean) to authenticated;
revoke execute on function stk_transfer_receive(uuid, jsonb) from public, anon;
grant execute on function stk_transfer_receive(uuid, jsonb) to authenticated;

create or replace function stk_transfer_cancel(p_transfer uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t stk_transfers;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into t from stk_transfers where id = p_transfer for update;
  if t.id is null or t.status not in ('draft', 'in_transit') then raise exception 'bad_status'; end if;
  -- yoldaysa çıkış hareketleri geri alınır
  delete from stk_moves where doc_type = 'transfer' and doc_id = t.id;
  update stk_transfers set status = 'cancelled' where id = t.id;
end $$;
revoke execute on function stk_transfer_cancel(uuid) from public, anon;
grant execute on function stk_transfer_cancel(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Sayım
-- ---------------------------------------------------------------------
create table if not exists stk_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  no bigint generated by default as identity,
  warehouse_id uuid not null references stk_warehouses (id) on delete restrict,
  count_date date not null default current_date,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  blind boolean not null default false,
  category_id uuid references stk_categories (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz, closed_by uuid
);
create table if not exists stk_count_lines (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references stk_counts (id) on delete cascade,
  item_id uuid not null references stk_items (id) on delete restrict,
  lot_no text check (lot_no is null or length(lot_no) <= 60),
  expiry_date date,
  expected numeric(14, 3) not null default 0,
  counted numeric(14, 3) check (counted is null or counted >= 0),
  counted_by uuid,
  counted_at timestamptz,
  note text check (note is null or length(note) <= 200)
);
create unique index if not exists stk_count_lines_uidx on stk_count_lines (count_id, item_id, coalesce(lot_no, ''));
alter table stk_counts enable row level security;
alter table stk_count_lines enable row level security;
drop policy if exists stk_counts_read on stk_counts;
create policy stk_counts_read on stk_counts for select to authenticated using (can_module('stock'));
drop policy if exists stk_count_lines_read on stk_count_lines;
create policy stk_count_lines_read on stk_count_lines for select to authenticated using (can_module('stock'));
grant select on stk_counts, stk_count_lines to authenticated;

create or replace function stk_count_start(p_warehouse uuid, p_category uuid, p_blind boolean, p_note text, p_all_items boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  insert into stk_counts (warehouse_id, category_id, blind, note) values (p_warehouse, p_category, coalesce(p_blind, false), nullif(left(coalesce(p_note, ''), 500), ''))
  returning id into v_id;
  insert into stk_count_lines (count_id, item_id, lot_no, expiry_date, expected)
  select v_id, s.item_id, s.lot_no, s.expiry_date, s.qty
  from stk_stock s join stk_items i on i.id = s.item_id
  where s.warehouse_id = p_warehouse and i.kind <> 'service' and (p_category is null or i.category_id = p_category);
  if p_all_items then
    insert into stk_count_lines (count_id, item_id, expected)
    select v_id, i.id, 0 from stk_items i
    where i.is_active and i.kind <> 'service' and (p_category is null or i.category_id = p_category)
      and not exists (select 1 from stk_count_lines l where l.count_id = v_id and l.item_id = i.id)
    on conflict do nothing;
  end if;
  return v_id;
end $$;

-- Satır sayımı (p_add: okutmada miktarı üzerine ekle)
create or replace function stk_count_set(p_line uuid, p_counted numeric, p_add boolean default false) returns numeric
language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  update stk_count_lines l set
    counted = case when p_add then coalesce(l.counted, 0) + p_counted else p_counted end,
    counted_by = auth.uid(), counted_at = now()
  where l.id = p_line and exists (select 1 from stk_counts c where c.id = l.count_id and c.status = 'open')
  returning counted into v;
  return v;
end $$;

-- Barkod / kodla okut: satır yoksa beklenen 0 olarak eklenir
create or replace function stk_count_scan(p_count uuid, p_code text, p_qty numeric default 1, p_lot text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare it stk_items; v_line uuid; v_total numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from stk_counts where id = p_count and status = 'open') then raise exception 'closed'; end if;
  select * into it from stk_items where (barcode = trim(p_code) or lower(code) = lower(trim(p_code))) and company_id = lab_company() limit 1;
  if it.id is null then raise exception 'item_not_found'; end if;
  select id into v_line from stk_count_lines where count_id = p_count and item_id = it.id and coalesce(lot_no, '') = coalesce(nullif(trim(coalesce(p_lot, '')), ''), '')
  limit 1;
  if v_line is null and nullif(trim(coalesce(p_lot, '')), '') is null then
    select id into v_line from stk_count_lines where count_id = p_count and item_id = it.id order by expected desc limit 1;
  end if;
  if v_line is null then
    insert into stk_count_lines (count_id, item_id, lot_no, expected) values (p_count, it.id, nullif(trim(coalesce(p_lot, '')), ''), 0) returning id into v_line;
  end if;
  v_total := stk_count_set(v_line, coalesce(p_qty, 1), true);
  return jsonb_build_object('line', v_line, 'item', it.name, 'code', it.code, 'counted', v_total, 'unit', it.unit);
end $$;

create or replace function stk_count_close(p_count uuid, p_zero_uncounted boolean default false) returns int
language plpgsql security definer set search_path = public as $$
declare c stk_counts; l record; v_n int := 0; v_diff numeric;
begin
  if not can_module('stock', 3) then raise exception 'not_allowed'; end if;
  select * into c from stk_counts where id = p_count for update;
  if c.id is null or c.status <> 'open' then raise exception 'bad_status'; end if;
  for l in select * from stk_count_lines where count_id = c.id loop
    if l.counted is null and not p_zero_uncounted then continue; end if;
    -- sayım süresince oluşan hareketler hesaba katılır: güncel stok − sayılan
    select coalesce(l.counted, 0) - coalesce(sum(qty), 0) into v_diff from stk_moves
    where item_id = l.item_id and warehouse_id = c.warehouse_id and lot_no is not distinct from l.lot_no;
    if v_diff <> 0 then
      perform stk_move_sys(l.item_id, c.warehouse_id, v_diff, 'count_adjust', stk_avg_cost(l.item_id), l.lot_no, l.expiry_date, c.count_date, 'count', c.id, null, null, 'Sayım #' || c.no);
      v_n := v_n + 1;
    end if;
  end loop;
  update stk_counts set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = c.id;
  return v_n;
end $$;

create or replace function stk_count_cancel(p_count uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  update stk_counts set status = 'cancelled' where id = p_count and status = 'open';
end $$;

do $$
declare f text;
begin
  foreach f in array array['stk_count_start(uuid, uuid, boolean, text, boolean)', 'stk_count_set(uuid, numeric, boolean)', 'stk_count_scan(uuid, text, numeric, text)', 'stk_count_close(uuid, boolean)', 'stk_count_cancel(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Kart açılışında varsayılan kod: M00001
create or replace function stk_next_code(p_prefix text default 'M') returns text
language sql stable security definer set search_path = public as $$
  select p_prefix || lpad((coalesce(max(nullif(regexp_replace(code, '\D', '', 'g'), '')::bigint) filter (where code ~ ('^' || p_prefix || '[0-9]+$')), 0) + 1)::text, 5, '0')
  from stk_items where company_id = lab_company();
$$;
grant execute on function stk_next_code(text) to authenticated;

notify pgrst, 'reload schema';
