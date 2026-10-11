-- =====================================================================
-- SİPARİŞLER
--  lab_orders      : klinik / hekim siparişi (telefon, WhatsApp, e-posta, tarayıcı, kurye, portal) → iş kaydı
--  pur_orders      : satın alma siparişi (tedarikçiye): taslak → onay → gönderildi → teslim alındı → faturalandı
--  pur_settings    : onay limiti (bu tutarın üstü "Alış: yönetir" yetkilisinin onayını bekler)
-- Tekrar çalıştırılabilir. Önce 20261211000000_waybills.sql.
-- =====================================================================

-- 1) Klinik siparişi
create table if not exists lab_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null,
  no int not null,
  customer_id uuid references lab_customers (id) on delete restrict,
  source text not null default 'phone' check (source in ('phone', 'whatsapp', 'email', 'scanner', 'courier', 'portal', 'visit', 'other')),
  doctor_name text check (doctor_name is null or length(doctor_name) <= 120),
  patient text check (patient is null or length(patient) <= 120),
  shade text check (shade is null or length(shade) <= 30),
  teeth text check (teeth is null or length(teeth) <= 200),
  items jsonb not null default '[]'::jsonb,
  due_date date,
  pickup boolean not null default false,          -- ölçü / model kuryeyle alınacak
  pickup_note text check (pickup_note is null or length(pickup_note) <= 300),
  notes text check (notes is null or length(notes) <= 2000),
  status text not null default 'new' check (status in ('new', 'confirmed', 'job', 'cancelled')),
  job_id uuid references jobs (id) on delete set null,
  portal_case_id uuid references portal_cases (id) on delete set null,
  cancel_reason text check (cancel_reason is null or length(cancel_reason) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, year, no)
);
create index if not exists lab_orders_status_idx on lab_orders (status, created_at desc);
alter table lab_orders enable row level security;
drop policy if exists lab_orders_read on lab_orders;
create policy lab_orders_read on lab_orders for select to authenticated using (can_logistics() or can_module('sales'));
grant select on lab_orders to authenticated;
revoke insert, update, delete on lab_orders from authenticated;
drop trigger if exists audit_lab_orders on lab_orders;
create trigger audit_lab_orders after insert or update or delete on lab_orders for each row execute function audit_trigger();

create or replace function lab_order_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old lab_orders; v_day date := current_date;
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if v_id is not null then
    select * into v_old from lab_orders where id = v_id for update;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status in ('job', 'cancelled') then raise exception 'order_closed'; end if;
  end if;
  if nullif(p->>'customer_id', '') is null then raise exception 'customer_required'; end if;
  if v_id is null then
    insert into lab_orders (year, no, customer_id) values (extract(year from v_day)::int, lab_next_no('order', extract(year from v_day)::int), (p->>'customer_id')::uuid)
    returning id into v_id;
  end if;
  update lab_orders set
    customer_id = (p->>'customer_id')::uuid,
    source = case when p->>'source' in ('phone', 'whatsapp', 'email', 'scanner', 'courier', 'portal', 'visit', 'other') then p->>'source' else source end,
    doctor_name = nullif(left(trim(coalesce(p->>'doctor_name', '')), 120), ''),
    patient = nullif(left(trim(coalesce(p->>'patient', '')), 120), ''),
    shade = nullif(left(trim(coalesce(p->>'shade', '')), 30), ''),
    teeth = nullif(left(trim(coalesce(p->>'teeth', '')), 200), ''),
    items = case when jsonb_typeof(p->'items') = 'array' then p->'items' else items end,
    due_date = nullif(p->>'due_date', '')::date,
    pickup = coalesce((p->>'pickup')::boolean, false),
    pickup_note = nullif(left(trim(coalesce(p->>'pickup_note', '')), 300), ''),
    notes = nullif(left(trim(coalesce(p->>'notes', '')), 2000), ''),
    status = case when p->>'status' in ('new', 'confirmed') then p->>'status' else status end,
    updated_at = now()
  where id = v_id;
  return v_id;
end $$;
grant execute on function lab_order_save(jsonb) to authenticated;

create or replace function lab_order_status(p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if p_status not in ('new', 'confirmed', 'cancelled') then raise exception 'bad_status'; end if;
  update lab_orders set status = p_status, cancel_reason = case when p_status = 'cancelled' then nullif(left(p_reason, 300), '') end, updated_at = now()
  where id = p_id and status <> 'job';
end $$;
grant execute on function lab_order_status(uuid, text, text) to authenticated;

create or replace function lab_order_link(p_order uuid, p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  update lab_orders set status = 'job', job_id = p_job, updated_at = now() where id = p_order and status in ('new', 'confirmed');
end $$;
grant execute on function lab_order_link(uuid, uuid) to authenticated;

-- 2) Satın alma siparişi
create table if not exists pur_settings (
  company_id uuid primary key references companies (id) on delete cascade default lab_company(),
  approval_limit bigint not null default 0,      -- TL kuruş; 0 = her sipariş onaysız
  updated_at timestamptz not null default now()
);
alter table pur_settings enable row level security;
drop policy if exists pur_settings_read on pur_settings;
create policy pur_settings_read on pur_settings for select to authenticated using (can_module('purchases'));
grant select on pur_settings to authenticated;

create table if not exists pur_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null,
  no int not null,
  party_id uuid not null references fin_parties (id) on delete restrict,
  order_date date not null default current_date,
  expected_date date,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'sent', 'partial', 'received', 'invoiced', 'cancelled')),
  currency text not null default 'TRY',
  subtotal bigint not null default 0,
  vat_total bigint not null default 0,
  total bigint not null default 0,
  total_try bigint not null default 0,
  warehouse_id uuid references stk_warehouses (id) on delete set null,
  note text check (note is null or length(note) <= 1000),
  reject_reason text check (reject_reason is null or length(reject_reason) <= 300),
  invoice_id uuid references inv_invoices (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  sent_at timestamptz,
  received_at timestamptz,
  unique (company_id, year, no)
);
create table if not exists pur_order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references pur_orders (id) on delete cascade,
  sort int not null default 0,
  item_id uuid references stk_items (id) on delete set null,
  name text not null check (length(name) between 1 and 300),
  qty numeric(14, 3) not null check (qty > 0),
  unit text not null default 'adet',
  unit_price bigint not null default 0,          -- kuruş / cent
  vat_rate numeric(5, 2) not null default 20,
  amount bigint not null default 0,              -- KDV hariç
  received_qty numeric(14, 3) not null default 0
);
create index if not exists pur_order_lines_idx on pur_order_lines (order_id, sort);
create index if not exists pur_orders_status_idx on pur_orders (status, order_date desc);
alter table pur_orders enable row level security;
alter table pur_order_lines enable row level security;
drop policy if exists pur_orders_read on pur_orders;
create policy pur_orders_read on pur_orders for select to authenticated using (can_module('purchases') or can_module('stock'));
drop policy if exists pur_order_lines_read on pur_order_lines;
create policy pur_order_lines_read on pur_order_lines for select to authenticated using (exists (select 1 from pur_orders o where o.id = order_id));
grant select on pur_orders, pur_order_lines to authenticated;
revoke insert, update, delete on pur_orders, pur_order_lines from authenticated;
drop trigger if exists audit_pur_orders on pur_orders;
create trigger audit_pur_orders after insert or update or delete on pur_orders for each row execute function audit_trigger();

create or replace function pur_order_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old pur_orders; l jsonb; i int := 0; v_cur text := coalesce(nullif(p->>'currency', ''), 'TRY'); v_date date := coalesce(nullif(p->>'order_date', '')::date, current_date);
  v_qty numeric; v_price bigint; v_vr numeric;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  if v_id is not null then
    select * into v_old from pur_orders where id = v_id for update;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status not in ('draft') then raise exception 'po_locked'; end if;
  end if;
  if not exists (select 1 from fin_parties where id = nullif(p->>'party_id', '')::uuid) then raise exception 'party_required'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_id is null then
    insert into pur_orders (year, no, party_id) values (extract(year from v_date)::int, lab_next_no('po', extract(year from v_date)::int), (p->>'party_id')::uuid) returning id into v_id;
  end if;
  update pur_orders set party_id = (p->>'party_id')::uuid, order_date = v_date, expected_date = nullif(p->>'expected_date', '')::date, currency = v_cur,
    warehouse_id = coalesce(nullif(p->>'warehouse_id', '')::uuid, stk_default_warehouse()), note = nullif(left(coalesce(p->>'note', ''), 1000), ''), reject_reason = null
  where id = v_id;
  delete from pur_order_lines where order_id = v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    v_qty := coalesce(nullif(l->>'qty', '')::numeric, 0);
    if v_qty <= 0 then continue; end if;
    v_price := greatest(coalesce(nullif(l->>'unit_price', '')::bigint, 0), 0);
    v_vr := least(greatest(coalesce(nullif(l->>'vat_rate', '')::numeric, 20), 0), 100);
    i := i + 1;
    insert into pur_order_lines (order_id, sort, item_id, name, qty, unit, unit_price, vat_rate, amount)
    values (v_id, i, nullif(l->>'item_id', '')::uuid, left(coalesce(nullif(trim(l->>'name'), ''), 'Kalem'), 300), v_qty, left(coalesce(nullif(l->>'unit', ''), 'adet'), 20), v_price, v_vr, round(v_qty * v_price));
  end loop;
  if i = 0 then raise exception 'lines_required'; end if;
  perform pur_order_totals(v_id);
  return v_id;
end $$;

create or replace function pur_order_totals(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare o pur_orders;
begin
  update pur_orders x set subtotal = s.n, vat_total = s.v, total = s.n + s.v
  from (select coalesce(sum(amount), 0) n, coalesce(sum(round(amount * vat_rate / 100)), 0)::bigint v from pur_order_lines where order_id = p_id) s where x.id = p_id;
  select * into o from pur_orders where id = p_id;
  update pur_orders set total_try = case when o.currency = 'TRY' then o.total else round(o.total * coalesce(fx_rate(o.currency, o.order_date), 1)) end where id = p_id;
end $$;
revoke execute on function pur_order_totals(uuid) from public, anon, authenticated;
grant execute on function pur_order_save(jsonb) to authenticated;

-- Onaya gönder: limit altı ya da "Alış: yönetir" yetkilisi kendiliğinden onaylanır
create or replace function pur_order_submit(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_limit bigint;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status <> 'draft' then raise exception 'po_locked'; end if;
  select approval_limit into v_limit from pur_settings where company_id = o.company_id;
  if coalesce(v_limit, 0) = 0 or o.total_try <= v_limit or can_module('purchases', 3) then
    update pur_orders set status = 'approved', submitted_at = now(), approved_by = auth.uid(), approved_at = now() where id = p_id;
    return 'approved';
  end if;
  update pur_orders set status = 'pending', submitted_at = now() where id = p_id;
  return 'pending';
end $$;
grant execute on function pur_order_submit(uuid) to authenticated;

create or replace function pur_order_decide(p_id uuid, p_ok boolean, p_reason text default null) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
  if p_ok then
    update pur_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id and status = 'pending';
  else
    update pur_orders set status = 'draft', reject_reason = nullif(left(p_reason, 300), '') where id = p_id and status = 'pending';
  end if;
end $$;
grant execute on function pur_order_decide(uuid, boolean, text) to authenticated;

create or replace function pur_order_sent(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  update pur_orders set status = 'sent', sent_at = now() where id = p_id and status = 'approved';
end $$;
grant execute on function pur_order_sent(uuid) to authenticated;

-- Teslim al: [{"line_id": "...", "qty": 5}] (stok, alış faturası işlenince girer)
create or replace function pur_order_receive(p_id uuid, p_lines jsonb) returns void language plpgsql security definer set search_path = public as $$
declare l jsonb; v_all boolean;
begin
  if not (can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from pur_orders where id = p_id and status in ('approved', 'sent', 'partial')) then raise exception 'po_not_open'; end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    update pur_order_lines set received_qty = least(qty, greatest(0, received_qty + coalesce(nullif(l->>'qty', '')::numeric, 0)))
    where id = (l->>'line_id')::uuid and order_id = p_id;
  end loop;
  select bool_and(received_qty >= qty) into v_all from pur_order_lines where order_id = p_id;
  update pur_orders set status = case when v_all then 'received' else 'partial' end, received_at = case when v_all then now() else received_at end where id = p_id;
end $$;
grant execute on function pur_order_receive(uuid, jsonb) to authenticated;

-- Alış faturası taslağına dönüştür (teslim alınan, yoksa sipariş miktarıyla)
create or replace function pur_order_to_invoice(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_inv uuid; v_lines jsonb;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status not in ('approved', 'sent', 'partial', 'received') then raise exception 'po_not_open'; end if;
  if o.invoice_id is not null and exists (select 1 from inv_invoices where id = o.invoice_id and status <> 'cancelled') then return o.invoice_id; end if;
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'name', name, 'qty', case when received_qty > 0 then received_qty else qty end, 'unit', unit,
                                      'unit_price', round(unit_price / 100.0, 4), 'vat_rate', vat_rate) order by sort)
  into v_lines from pur_order_lines where order_id = p_id;
  v_inv := inv_save(jsonb_build_object('direction', 'purchase', 'party_id', o.party_id, 'invoice_date', current_date, 'currency', o.currency,
                                      'warehouse_id', o.warehouse_id, 'note', 'Satın alma siparişi ' || 'SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'lines', v_lines));
  update pur_orders set invoice_id = v_inv, status = 'invoiced' where id = p_id;
  return v_inv;
end $$;
grant execute on function pur_order_to_invoice(uuid) to authenticated;

create or replace function pur_order_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  update pur_orders set status = 'cancelled' where id = p_id and status in ('draft', 'pending', 'approved', 'sent');
end $$;
grant execute on function pur_order_cancel(uuid) to authenticated;

create or replace function pur_settings_save(p_limit bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
  insert into pur_settings (company_id, approval_limit, updated_at) values (lab_company(), greatest(coalesce(p_limit, 0), 0), now())
  on conflict (company_id) do update set approval_limit = excluded.approval_limit, updated_at = now();
end $$;
grant execute on function pur_settings_save(bigint) to authenticated;

-- Stok önerisi: minimumun altındakiler, tedarikçiye göre
create or replace function pur_suggestions() returns table (item_id uuid, code text, name text, unit text, qty numeric, min_qty numeric, max_qty numeric, suggest numeric, supplier_id uuid, supplier text, unit_price bigint, currency text, vat_rate numeric, on_order numeric)
language sql stable security definer set search_path = public as $$
  select i.id, i.code, i.name, i.unit, t.qty, i.min_qty, i.max_qty,
         greatest(coalesce(i.reorder_qty, 0), coalesce(i.max_qty, i.min_qty * 2) - t.qty - coalesce(oo.q, 0), 1),
         i.supplier_party_id, p.name, coalesce(i.purchase_price, 0), coalesce(i.purchase_currency, 'TRY'), coalesce(i.vat_rate, 20), coalesce(oo.q, 0)
  from stk_items i
  join stk_item_totals t on t.item_id = i.id
  left join fin_parties p on p.id = i.supplier_party_id
  left join lateral (select sum(l.qty - l.received_qty) q from pur_order_lines l join pur_orders o on o.id = l.order_id
                     where l.item_id = i.id and o.status in ('draft', 'pending', 'approved', 'sent', 'partial')) oo on true
  where can_module('purchases') and i.is_active and i.min_qty is not null and t.qty + coalesce(oo.q, 0) < i.min_qty
  order by p.name nulls last, i.name;
$$;
grant execute on function pur_suggestions() to authenticated;

notify pgrst, 'reload schema';
