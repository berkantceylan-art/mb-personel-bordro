-- =====================================================================
-- BARKOD İŞLEMLERİ: mal kabul, personele okutarak teslim, demirbaş sayımı
--  stk_receipts / stk_receipt_lines : mal kabul (MK-). Satın alma siparişinden ya da serbest; ürün okutulur, adet yazılır.
--      Onayda "stoğa eklensin mi?" sorulur:
--        add_to_stock = false → faturalı mal (e-fatura gelince stoğa girer); fatura ile sonradan eşleştirilir
--        add_to_stock = true  → faturasız mal, okutulan adet anında stoğa girer
--  stk_issue_direct(...)              : depo personele okutarak teslim eder; istek yoksa malzeme isteği kaydı
--      kendiliğinden açılır ve iki imzalı teslim tutanağı oluşur (malzeme isteği altyapısı)
--  ast_counts / ast_count_items       : demirbaş sayımı (QR / barkod okut, konum ve durum), sonuçları kartlara işle
-- Tekrar çalıştırılabilir. Önce 20270105000000_request_kinds.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Ortak: barkod / kodla ürün bul (depo ve satın alma)
-- ---------------------------------------------------------------------
create or replace function stk_item_lookup(p_code text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('stock') or can_module('purchases') then (
    select jsonb_build_object('id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit, 'barcode', i.barcode, 'track_lot', i.track_lot, 'track_expiry', i.track_expiry,
                              'on_hand', coalesce((select sum(s.qty) from stk_stock s where s.item_id = i.id), 0))
    from stk_items i
    where i.company_id = lab_company() and (i.barcode = trim(p_code) or lower(i.code) = lower(trim(p_code)))
    order by (i.barcode = trim(p_code)) desc limit 1) end;
$$;
revoke execute on function stk_item_lookup(text) from public, anon;
grant execute on function stk_item_lookup(text) to authenticated;

-- ---------------------------------------------------------------------
-- MAL KABUL
-- ---------------------------------------------------------------------
create table if not exists stk_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  po_id uuid references pur_orders (id) on delete set null,
  party_id uuid references fin_parties (id) on delete set null,
  supplier_doc text check (supplier_doc is null or length(supplier_doc) <= 60),     -- irsaliye / fiş no
  warehouse_id uuid references stk_warehouses (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'confirmed', 'cancelled')),
  add_to_stock boolean,
  invoice_id uuid references inv_invoices (id) on delete set null,
  note text check (note is null or length(note) <= 500),
  signer_name text check (signer_name is null or length(signer_name) <= 160),
  signature text check (signature is null or (signature like 'data:image/png;base64,%' and length(signature) <= 400000)),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  confirmed_by uuid, confirmed_at timestamptz,
  matched_by uuid, matched_at timestamptz,
  unique (company_id, year, no)
);
create index if not exists stk_receipts_status_idx on stk_receipts (company_id, status, created_at desc);
create index if not exists stk_receipts_party_idx on stk_receipts (party_id, created_at desc);

create table if not exists stk_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references stk_receipts (id) on delete cascade,
  sort int not null default 0,
  po_line_id uuid references pur_order_lines (id) on delete set null,
  item_id uuid references stk_items (id) on delete set null,
  name text not null check (length(name) between 1 and 300),
  unit text not null default 'adet' check (length(unit) <= 20),
  expected numeric(14, 3) not null default 0 check (expected >= 0),
  qty numeric(14, 3) not null default 0 check (qty >= 0),
  damaged numeric(14, 3) not null default 0 check (damaged >= 0),
  lot_no text check (lot_no is null or length(lot_no) <= 60),
  expiry_date date,
  unit_cost bigint check (unit_cost is null or unit_cost >= 0),       -- TL kuruş (siparişten)
  note text check (note is null or length(note) <= 200),
  scanned_at timestamptz
);
create index if not exists stk_receipt_lines_idx on stk_receipt_lines (receipt_id, sort);

alter table stk_receipts enable row level security;
alter table stk_receipt_lines enable row level security;
drop policy if exists stk_receipts_read on stk_receipts;
create policy stk_receipts_read on stk_receipts for select to authenticated using (company_id = lab_company() and (can_module('stock') or can_module('purchases')));
drop policy if exists stk_receipt_lines_read on stk_receipt_lines;
create policy stk_receipt_lines_read on stk_receipt_lines for select to authenticated using (exists (select 1 from stk_receipts r where r.id = receipt_id));
grant select on stk_receipts, stk_receipt_lines to authenticated;

create or replace function stk_rcv_no(r stk_receipts) returns text language sql immutable as $$
  select 'MK-' || r.year || '-' || lpad(r.no::text, 4, '0');
$$;

-- Başlat: { po_id?, party_id?, warehouse_id?, supplier_doc?, note? } — siparişten başlarsa kalan miktarlar beklenen olarak gelir
create or replace function stk_rcv_start(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_year int := extract(year from now())::int; o pur_orders;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if nullif(p ->> 'po_id', '') is not null then
    select * into o from pur_orders where id = (p ->> 'po_id')::uuid and company_id = lab_company();
    if o.id is null or o.status not in ('approved', 'sent', 'partial') then raise exception 'po_not_open'; end if;
  end if;
  insert into stk_receipts (year, no, po_id, party_id, supplier_doc, warehouse_id, note)
  values (v_year, lab_next_no('mk', v_year), o.id, coalesce(o.party_id, nullif(p ->> 'party_id', '')::uuid), nullif(left(trim(p ->> 'supplier_doc'), 60), ''),
          coalesce(nullif(p ->> 'warehouse_id', '')::uuid, o.warehouse_id, stk_default_warehouse()), nullif(left(trim(p ->> 'note'), 500), ''))
  returning id into v_id;
  if o.id is not null then
    insert into stk_receipt_lines (receipt_id, sort, po_line_id, item_id, name, unit, expected, unit_cost)
    select v_id, l.sort, l.id, l.item_id, l.name, l.unit, greatest(l.qty - l.received_qty, 0),
           case when o.currency = 'TRY' then l.unit_price else round(l.unit_price * fin_rate(o.currency, current_date)) end
    from pur_order_lines l where l.order_id = o.id and l.qty > l.received_qty order by l.sort;
  end if;
  return v_id;
end $$;
revoke execute on function stk_rcv_start(jsonb) from public, anon;
grant execute on function stk_rcv_start(jsonb) to authenticated;

-- Okut: ürün bulunur, satırına adet eklenir; siparişte yoksa "beklenmeyen" satır açılır
create or replace function stk_rcv_scan(p_id uuid, p_code text, p_qty numeric default 1) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r stk_receipts; it stk_items; v_line stk_receipt_lines; v_sort int;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'open' then raise exception 'bad_status'; end if;
  select * into it from stk_items where company_id = lab_company() and (barcode = trim(p_code) or lower(code) = lower(trim(p_code))) order by (barcode = trim(p_code)) desc limit 1;
  if it.id is null then raise exception 'item_not_found'; end if;
  select * into v_line from stk_receipt_lines where receipt_id = p_id and item_id = it.id order by (qty < expected) desc, sort limit 1;
  if v_line.id is null then
    select coalesce(max(sort), -1) + 1 into v_sort from stk_receipt_lines where receipt_id = p_id;
    insert into stk_receipt_lines (receipt_id, sort, item_id, name, unit, expected, qty, unit_cost, scanned_at)
    values (p_id, v_sort, it.id, it.name, it.unit, 0, greatest(coalesce(p_qty, 1), 0), case when it.purchase_currency = 'TRY' then it.purchase_price end, now())
    returning * into v_line;
  else
    update stk_receipt_lines set qty = greatest(qty + coalesce(p_qty, 1), 0), scanned_at = now() where id = v_line.id returning * into v_line;
  end if;
  return jsonb_build_object('line', v_line.id, 'name', v_line.name, 'qty', v_line.qty, 'expected', v_line.expected, 'unit', v_line.unit,
                            'track_lot', it.track_lot, 'track_expiry', it.track_expiry, 'unexpected', v_line.expected = 0);
end $$;
revoke execute on function stk_rcv_scan(uuid, text, numeric) from public, anon;
grant execute on function stk_rcv_scan(uuid, text, numeric) to authenticated;

-- Satır düzelt: { qty, damaged, lot_no, expiry_date, note }
create or replace function stk_rcv_line(p_line uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_r uuid;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select l.receipt_id into v_r from stk_receipt_lines l join stk_receipts r on r.id = l.receipt_id where l.id = p_line and r.company_id = lab_company() and r.status = 'open';
  if v_r is null then raise exception 'bad_status'; end if;
  update stk_receipt_lines set
    qty = coalesce(nullif(p ->> 'qty', '')::numeric, qty),
    damaged = coalesce(nullif(p ->> 'damaged', '')::numeric, damaged),
    lot_no = case when p ? 'lot_no' then nullif(left(trim(p ->> 'lot_no'), 60), '') else lot_no end,
    expiry_date = case when p ? 'expiry_date' then nullif(p ->> 'expiry_date', '')::date else expiry_date end,
    note = case when p ? 'note' then nullif(left(trim(p ->> 'note'), 200), '') else note end
  where id = p_line;
  if exists (select 1 from stk_receipt_lines where id = p_line and damaged > qty) then raise exception 'damaged_gt_qty'; end if;
end $$;
revoke execute on function stk_rcv_line(uuid, jsonb) from public, anon;
grant execute on function stk_rcv_line(uuid, jsonb) to authenticated;

-- Stok kartı olmayan kalem ekle (serbest)
create or replace function stk_rcv_free(p_id uuid, p_name text, p_qty numeric, p_unit text default 'adet') returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from stk_receipts where id = p_id and company_id = lab_company() and status = 'open') then raise exception 'bad_status'; end if;
  if nullif(trim(p_name), '') is null or coalesce(p_qty, 0) <= 0 then raise exception 'line_name'; end if;
  insert into stk_receipt_lines (receipt_id, sort, name, unit, expected, qty, scanned_at)
  values (p_id, (select coalesce(max(sort), -1) + 1 from stk_receipt_lines where receipt_id = p_id), left(trim(p_name), 300), coalesce(nullif(left(trim(p_unit), 20), ''), 'adet'), 0, p_qty, now())
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function stk_rcv_free(uuid, text, numeric, text) from public, anon;
grant execute on function stk_rcv_free(uuid, text, numeric, text) to authenticated;

create or replace function stk_rcv_remove(p_line uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  delete from stk_receipt_lines l using stk_receipts r where l.id = p_line and r.id = l.receipt_id and r.status = 'open' and r.company_id = lab_company() and l.po_line_id is null;
  update stk_receipt_lines l set qty = 0, damaged = 0 from stk_receipts r where l.id = p_line and r.id = l.receipt_id and r.status = 'open' and l.po_line_id is not null;
end $$;
revoke execute on function stk_rcv_remove(uuid) from public, anon;
grant execute on function stk_rcv_remove(uuid) to authenticated;

-- Onay: stoğa eklensin mi (faturalı → hayır, faturasız → evet), teslim alan imzası
create or replace function stk_rcv_confirm(p_id uuid, p_add_stock boolean, p_signer text, p_png text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_receipts; l record; v_all boolean; it stk_items;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if p_add_stock is null then raise exception 'stock_choice_required'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'open' then raise exception 'bad_status'; end if;
  if not exists (select 1 from stk_receipt_lines where receipt_id = p_id and qty > 0) then raise exception 'no_qty'; end if;
  if coalesce(p_png, '') not like 'data:image/png;base64,%' then raise exception 'signature_required'; end if;
  if p_add_stock then
    for l in select * from stk_receipt_lines where receipt_id = p_id and item_id is not null and qty - damaged > 0 loop
      select * into it from stk_items where id = l.item_id;
      if it.track_lot and l.lot_no is null then raise exception 'lot_required:%', l.name; end if;
      if it.track_expiry and l.expiry_date is null then raise exception 'expiry_required:%', l.name; end if;
      perform stk_move_sys(l.item_id, r.warehouse_id, l.qty - l.damaged, 'purchase', coalesce(l.unit_cost, it.purchase_price, 0), l.lot_no, l.expiry_date, current_date,
                           'receipt', r.id, null, r.party_id, left(stk_rcv_no(r) || coalesce(' · ' || r.supplier_doc, '') || ' (faturasız mal kabul)', 300));
    end loop;
  end if;
  if r.po_id is not null then
    update pur_order_lines pl set received_qty = least(pl.qty, pl.received_qty + (l2.qty - l2.damaged))
    from stk_receipt_lines l2 where l2.receipt_id = p_id and l2.po_line_id = pl.id and l2.qty - l2.damaged > 0;
    select bool_and(received_qty >= qty) into v_all from pur_order_lines where order_id = r.po_id;
    update pur_orders set status = case when v_all then 'received' else 'partial' end, received_at = case when v_all then now() else received_at end
    where id = r.po_id and status in ('approved', 'sent', 'partial');
  end if;
  update stk_receipts set status = 'confirmed', add_to_stock = p_add_stock, signer_name = left(coalesce(nullif(trim(p_signer), ''), 'Depo'), 160), signature = p_png,
         note = coalesce(nullif(left(trim(p_note), 500), ''), note), confirmed_by = auth.uid(), confirmed_at = now() where id = p_id;
  perform deliver(r.company_id, module_recipients('purchases', 2),
    'Mal kabul yapıldı · ' || stk_rcv_no(r),
    coalesce((select name from fin_parties where id = r.party_id), 'Tedarikçi') || ' · ' || (select count(*) from stk_receipt_lines where receipt_id = p_id and qty > 0) || ' kalem · '
      || case when p_add_stock then 'stoğa girdi (faturasız)' else 'fatura bekleniyor' end
      || case when exists (select 1 from stk_receipt_lines where receipt_id = p_id and (qty <> expected and expected > 0 or damaged > 0)) then ' · eksik / fazla / hasarlı var' else '' end,
    '/stok/mal-kabul/' || p_id);
end $$;
revoke execute on function stk_rcv_confirm(uuid, boolean, text, text, text) from public, anon;
grant execute on function stk_rcv_confirm(uuid, boolean, text, text, text) to authenticated;

create or replace function stk_rcv_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  update stk_receipts set status = 'cancelled' where id = p_id and company_id = lab_company() and status = 'open';
  if not found then raise exception 'bad_status'; end if;
end $$;
revoke execute on function stk_rcv_cancel(uuid) from public, anon;
grant execute on function stk_rcv_cancel(uuid) to authenticated;

-- Faturalı mal kabulü gelen alış faturasıyla eşleştir (ya da eşleşmeyi kaldır: p_invoice null)
create or replace function stk_rcv_match(p_id uuid, p_invoice uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_receipts;
begin
  if not (can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'confirmed' then raise exception 'bad_status'; end if;
  if p_invoice is not null and not exists (select 1 from inv_invoices where id = p_invoice and company_id = lab_company() and direction = 'purchase' and status <> 'cancelled') then raise exception 'invoice_not_found'; end if;
  update stk_receipts set invoice_id = p_invoice, matched_by = case when p_invoice is null then null else auth.uid() end, matched_at = case when p_invoice is null then null else now() end where id = p_id;
end $$;
revoke execute on function stk_rcv_match(uuid, uuid) from public, anon;
grant execute on function stk_rcv_match(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- PERSONELE OKUTARAK TESLİM (isteksiz): malzeme isteği kaydı açılır ve aynı anda teslim edilir
--  p_lines: [{ item_id?, name?, qty, unit? }]
-- ---------------------------------------------------------------------
create or replace function stk_issue_direct(p_employee uuid, p_warehouse uuid, p_lines jsonb, p_signer text, p_png text, p_employee_png text, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_year int := extract(year from now())::int; l jsonb; n int := 0; it stk_items; v_lines jsonb := '[]'::jsonb; v_line uuid;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from employees where id = p_employee and company_id = lab_company()) then raise exception 'not_found'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'no_lines'; end if;
  if coalesce(p_employee_png, '') not like 'data:image/png;base64,%' then raise exception 'employee_signature_required'; end if;
  insert into stk_requests (kind, year, no, employee_id, reason, status)
  values ('material', v_year, lab_next_no('mt', v_year), p_employee, coalesce(nullif(left(trim(p_note), 500), ''), 'Depodan okutularak teslim'), 'pending')
  returning id into v_id;
  for l in select * from jsonb_array_elements(p_lines) loop
    it := null;
    if nullif(l ->> 'item_id', '') is not null then select * into it from stk_items where id = (l ->> 'item_id')::uuid and company_id = lab_company(); end if;
    if coalesce((l ->> 'qty')::numeric, 0) <= 0 then continue; end if;
    insert into stk_request_lines (request_id, sort, item_id, name, unit, qty)
    values (v_id, n, it.id, coalesce(it.name, nullif(left(trim(l ->> 'name'), 160), ''), 'Malzeme'), coalesce(it.unit, nullif(left(trim(l ->> 'unit'), 20), ''), 'adet'), (l ->> 'qty')::numeric)
    returning id into v_line;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('line_id', v_line, 'qty', (l ->> 'qty')::numeric));
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'no_qty'; end if;
  perform stk_req_log(v_id, 'direct_issue', 'Depo sorumlusu okutarak teslim etti');
  perform stk_req_deliver(v_id, v_lines, p_warehouse, p_signer, p_png, p_employee_png);
  return v_id;
end $$;
revoke execute on function stk_issue_direct(uuid, uuid, jsonb, text, text, text, text) from public, anon;
grant execute on function stk_issue_direct(uuid, uuid, jsonb, text, text, text, text) to authenticated;

-- Personel seçimi (depo): aktif personel + açık malzeme isteği sayısı
create or replace function stk_issue_people() returns table (id uuid, name text, department text, open_requests int)
language sql stable security definer set search_path = public as $$
  select e.id, e.first_name || ' ' || e.last_name, d.name,
         (select count(*)::int from stk_requests r where r.employee_id = e.id and r.kind in ('material', 'asset') and r.status in ('pending', 'ready'))
  from employees e left join departments d on d.id = e.department_id
  where e.company_id = lab_company() and e.status = 'active' and can_module('stock', 2)
  order by 4 desc, 2;
$$;
revoke execute on function stk_issue_people() from public, anon;
grant execute on function stk_issue_people() to authenticated;

-- ---------------------------------------------------------------------
-- DEMİRBAŞ SAYIMI
-- ---------------------------------------------------------------------
create table if not exists ast_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  title text not null check (length(title) between 1 and 120),
  scope_location text check (scope_location is null or length(scope_location) <= 120),
  scope_category text,
  status text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  note text check (note is null or length(note) <= 500),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  closed_by uuid, closed_at timestamptz,
  unique (company_id, year, no)
);
create table if not exists ast_count_items (
  id uuid primary key default gen_random_uuid(),
  count_id uuid not null references ast_counts (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete cascade,
  expected boolean not null default true,
  expected_location text,
  found_at timestamptz,
  found_by uuid,
  found_location text check (found_location is null or length(found_location) <= 120),
  condition text check (condition is null or condition in ('ok', 'damaged', 'broken')),
  note text check (note is null or length(note) <= 200),
  photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) <= 900000)),
  unique (count_id, asset_id)
);
create index if not exists ast_count_items_idx on ast_count_items (count_id, found_at);
alter table ast_counts enable row level security;
alter table ast_count_items enable row level security;

create or replace function ast_count_can() returns boolean
language sql stable security definer set search_path = public as $$
  select can_module('assets', 2) or (to_regprocedure('svc_is_tech()') is not null and svc_is_tech());
$$;
revoke execute on function ast_count_can() from public, anon;
grant execute on function ast_count_can() to authenticated;

drop policy if exists ast_counts_read on ast_counts;
create policy ast_counts_read on ast_counts for select to authenticated using (company_id = lab_company() and (can_module('assets') or ast_count_can()));
drop policy if exists ast_count_items_read on ast_count_items;
create policy ast_count_items_read on ast_count_items for select to authenticated using (exists (select 1 from ast_counts c where c.id = count_id));
grant select on ast_counts, ast_count_items to authenticated;

create or replace function ast_count_start(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_year int := extract(year from now())::int; v_loc text := nullif(trim(p ->> 'location'), ''); v_cat text := nullif(p ->> 'category', '');
begin
  if not can_module('assets', 2) then raise exception 'not_allowed'; end if;
  insert into ast_counts (year, no, title, scope_location, scope_category, note)
  values (v_year, lab_next_no('ds', v_year), coalesce(nullif(left(trim(p ->> 'title'), 120), ''), 'Demirbaş sayımı ' || to_char(current_date, 'DD.MM.YYYY')), v_loc, v_cat, nullif(left(trim(p ->> 'note'), 500), ''))
  returning id into v_id;
  insert into ast_count_items (count_id, asset_id, expected, expected_location)
  select v_id, a.id, true, a.location from assets a
  where a.company_id = lab_company() and a.status not in ('RETIRED') and a.disposed_on is null
    and (v_loc is null or a.location ilike '%' || v_loc || '%') and (v_cat is null or a.category = v_cat);
  return v_id;
end $$;
revoke execute on function ast_count_start(jsonb) from public, anon;
grant execute on function ast_count_start(jsonb) to authenticated;

-- Okut: kod / seri no / QR (AST:<uuid> ya da yalnız uuid). Kapsam dışıysa "fazla" olarak eklenir.
create or replace function ast_count_scan(p_count uuid, p_code text, p_location text default null, p_condition text default 'ok') returns jsonb
language plpgsql security definer set search_path = public as $$
declare a assets; v_code text := trim(coalesce(p_code, '')); v_item ast_count_items; v_dup boolean := false;
begin
  if not ast_count_can() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from ast_counts where id = p_count and company_id = lab_company() and status = 'open') then raise exception 'bad_status'; end if;
  if v_code ~* '^(ast:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select * into a from assets where id = regexp_replace(v_code, '^ast:', '', 'i')::uuid and company_id = lab_company();
  end if;
  if a.id is null then
    select * into a from assets where company_id = lab_company() and (lower(code) = lower(v_code) or lower(serial_no) = lower(v_code)) limit 1;
  end if;
  if a.id is null then raise exception 'asset_not_found'; end if;
  select * into v_item from ast_count_items where count_id = p_count and asset_id = a.id;
  if v_item.id is null then
    insert into ast_count_items (count_id, asset_id, expected, expected_location) values (p_count, a.id, false, a.location) returning * into v_item;
  end if;
  v_dup := v_item.found_at is not null;
  update ast_count_items set found_at = coalesce(found_at, now()), found_by = coalesce(found_by, auth.uid()),
         found_location = coalesce(nullif(left(trim(p_location), 120), ''), found_location, a.location),
         condition = case when p_condition in ('ok', 'damaged', 'broken') then p_condition else coalesce(condition, 'ok') end
  where id = v_item.id returning * into v_item;
  return jsonb_build_object('item', v_item.id, 'asset', a.id, 'name', a.name, 'code', a.code, 'expected', v_item.expected, 'duplicate', v_dup,
                            'moved', v_item.found_location is distinct from a.location and a.location is not null, 'location', v_item.found_location, 'expected_location', a.location);
end $$;
revoke execute on function ast_count_scan(uuid, text, text, text) from public, anon;
grant execute on function ast_count_scan(uuid, text, text, text) to authenticated;

-- Elle işaretle / düzelt: p_found false → bulunmadı yap
create or replace function ast_count_mark(p_item uuid, p_found boolean, p_location text default null, p_condition text default null, p_note text default null, p_photo text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not ast_count_can() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from ast_count_items i join ast_counts c on c.id = i.count_id where i.id = p_item and c.company_id = lab_company() and c.status = 'open') then raise exception 'bad_status'; end if;
  update ast_count_items set
    found_at = case when p_found then coalesce(found_at, now()) end,
    found_by = case when p_found then coalesce(found_by, auth.uid()) end,
    found_location = case when p_found then coalesce(nullif(left(trim(p_location), 120), ''), found_location, expected_location) end,
    condition = case when p_found then coalesce(case when p_condition in ('ok', 'damaged', 'broken') then p_condition end, condition, 'ok') end,
    note = coalesce(nullif(left(trim(p_note), 200), ''), note),
    photo = case when coalesce(p_photo, '') like 'data:image/jpeg;base64,%' and length(p_photo) <= 900000 then p_photo else photo end
  where id = p_item;
end $$;
revoke execute on function ast_count_mark(uuid, boolean, text, text, text, text) from public, anon;
grant execute on function ast_count_mark(uuid, boolean, text, text, text, text) to authenticated;

-- Kapat: p_apply → bulunanların yeri güncellenir, arızalılar "bakımda", p_mark_lost → bulunamayanlar "kayıp"
create or replace function ast_count_close(p_count uuid, p_apply boolean, p_mark_lost boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c ast_counts; v_moved int := 0; v_broken int := 0; v_lost int := 0;
begin
  if not can_module('assets', 2) then raise exception 'not_allowed'; end if;
  select * into c from ast_counts where id = p_count and company_id = lab_company() for update;
  if c.id is null or c.status <> 'open' then raise exception 'bad_status'; end if;
  if p_apply then
    update assets a set location = i.found_location, updated_at = now()
    from ast_count_items i where i.count_id = p_count and i.asset_id = a.id and i.found_at is not null and i.found_location is not null and i.found_location is distinct from a.location;
    get diagnostics v_moved = row_count;
    update assets a set status = 'MAINTENANCE', note = left(coalesce(a.note || ' · ', '') || 'Sayımda arızalı bulundu (' || to_char(current_date, 'DD.MM.YYYY') || ')', 1000), updated_at = now()
    from ast_count_items i where i.count_id = p_count and i.asset_id = a.id and i.condition = 'broken' and a.status in ('AVAILABLE', 'ASSIGNED');
    get diagnostics v_broken = row_count;
    if p_mark_lost then
      update assets a set status = 'LOST', note = left(coalesce(a.note || ' · ', '') || 'Sayımda bulunamadı (' || to_char(current_date, 'DD.MM.YYYY') || ')', 1000), updated_at = now()
      from ast_count_items i where i.count_id = p_count and i.asset_id = a.id and i.expected and i.found_at is null and a.status in ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE');
      get diagnostics v_lost = row_count;
    end if;
  end if;
  update ast_counts set status = 'closed', closed_by = auth.uid(), closed_at = now() where id = p_count;
  return jsonb_build_object('moved', v_moved, 'broken', v_broken, 'lost', v_lost);
end $$;
revoke execute on function ast_count_close(uuid, boolean, boolean) from public, anon;
grant execute on function ast_count_close(uuid, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
