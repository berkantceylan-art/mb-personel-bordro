-- Satın alma modülü — 2. aşama: teklif toplama / karşılaştırma (RFQ) ve tedarikçi puanı

create table if not exists pur_rfqs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  year int not null, no int not null,
  title text not null check (length(title) between 1 and 160),
  status text not null default 'open' check (status in ('open', 'awarded', 'cancelled')),
  due_date date,
  currency text not null default 'TRY',
  note text check (note is null or length(note) <= 1000),
  awarded_supplier uuid,
  po_id uuid references pur_orders (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (company_id, year, no)
);
create table if not exists pur_rfq_lines (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references pur_rfqs (id) on delete cascade,
  sort int not null default 0,
  item_id uuid references stk_items (id) on delete set null,
  name text not null check (length(name) between 1 and 300),
  qty numeric(14, 3) not null check (qty > 0),
  unit text not null default 'adet',
  request_line_id uuid references stk_request_lines (id) on delete set null
);
create table if not exists pur_rfq_suppliers (
  id uuid primary key default gen_random_uuid(),
  rfq_id uuid not null references pur_rfqs (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  token uuid not null default gen_random_uuid() unique,
  status text not null default 'invited' check (status in ('invited', 'viewed', 'quoted', 'declined')),
  sent_at timestamptz, viewed_at timestamptz, quoted_at timestamptz,
  delivery_days int check (delivery_days is null or delivery_days between 0 and 365),
  valid_until date,
  note text check (note is null or length(note) <= 1000),
  quoted_by text check (quoted_by is null or length(quoted_by) <= 120),
  unique (rfq_id, party_id)
);
create table if not exists pur_rfq_quotes (
  supplier_row uuid not null references pur_rfq_suppliers (id) on delete cascade,
  line_id uuid not null references pur_rfq_lines (id) on delete cascade,
  unit_price bigint check (unit_price is null or unit_price >= 0),
  vat_rate numeric(5, 2) not null default 20,
  available boolean not null default true,
  note text check (note is null or length(note) <= 300),
  primary key (supplier_row, line_id)
);
create index if not exists pur_rfq_lines_idx on pur_rfq_lines (rfq_id, sort);
create index if not exists pur_rfq_sup_idx on pur_rfq_suppliers (rfq_id);
alter table pur_rfqs enable row level security;
alter table pur_rfq_lines enable row level security;
alter table pur_rfq_suppliers enable row level security;
alter table pur_rfq_quotes enable row level security;
drop policy if exists pur_rfqs_read on pur_rfqs;
create policy pur_rfqs_read on pur_rfqs for select to authenticated using (company_id = (select lab_company()) and ((select can_module('purchases')) or (select can_module('stock'))));
drop policy if exists pur_rfq_lines_read on pur_rfq_lines;
create policy pur_rfq_lines_read on pur_rfq_lines for select to authenticated using (exists (select 1 from pur_rfqs r where r.id = rfq_id));
drop policy if exists pur_rfq_sup_read on pur_rfq_suppliers;
create policy pur_rfq_sup_read on pur_rfq_suppliers for select to authenticated using (exists (select 1 from pur_rfqs r where r.id = rfq_id));
drop policy if exists pur_rfq_quotes_read on pur_rfq_quotes;
create policy pur_rfq_quotes_read on pur_rfq_quotes for select to authenticated using (exists (select 1 from pur_rfq_suppliers s where s.id = supplier_row));
revoke all on pur_rfqs, pur_rfq_lines, pur_rfq_suppliers, pur_rfq_quotes from anon;
grant select on pur_rfqs, pur_rfq_lines, pur_rfq_suppliers, pur_rfq_quotes to authenticated;

-- Teklif isteği oluştur: { title, due_date, note, currency, lines:[{item_id,name,qty,unit,request_line_id}], parties:[uuid] }
create or replace function pur_rfq_create(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; l jsonb; i int := 0; v_party uuid;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if jsonb_typeof(p->'parties') <> 'array' or jsonb_array_length(p->'parties') = 0 then raise exception 'party_required'; end if;
  insert into pur_rfqs (year, no, title, due_date, note, currency)
  values (extract(year from current_date)::int, lab_next_no('rfq', extract(year from current_date)::int), left(coalesce(nullif(trim(p->>'title'), ''), 'Teklif isteği'), 160),
          nullif(p->>'due_date', '')::date, nullif(left(coalesce(p->>'note', ''), 1000), ''), coalesce(nullif(p->>'currency', ''), 'TRY'))
  returning id into v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce(nullif(l->>'qty', '')::numeric, 0) <= 0 then continue; end if;
    i := i + 1;
    insert into pur_rfq_lines (rfq_id, sort, item_id, name, qty, unit, request_line_id)
    values (v_id, i, nullif(l->>'item_id', '')::uuid, left(coalesce(nullif(trim(l->>'name'), ''), 'Kalem'), 300), (l->>'qty')::numeric, left(coalesce(nullif(l->>'unit', ''), 'adet'), 20), nullif(l->>'request_line_id', '')::uuid);
  end loop;
  if i = 0 then raise exception 'lines_required'; end if;
  for v_party in select (x #>> '{}')::uuid from jsonb_array_elements(p->'parties') x loop
    if exists (select 1 from fin_parties where id = v_party and company_id = lab_company()) then
      insert into pur_rfq_suppliers (rfq_id, party_id) values (v_id, v_party) on conflict do nothing;
    end if;
  end loop;
  return v_id;
end $$;

create or replace function pur_rfq_add_supplier(p_rfq uuid, p_party uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from pur_rfqs where id = p_rfq and company_id = lab_company() and status = 'open') then raise exception 'rfq_closed'; end if;
  insert into pur_rfq_suppliers (rfq_id, party_id) values (p_rfq, p_party) on conflict do nothing;
end $$;

create or replace function pur_rfq_mark_sent(p_rows uuid[]) returns void
language sql security definer set search_path = public as $$
  update pur_rfq_suppliers s set sent_at = coalesce(s.sent_at, now())
   where s.id = any(p_rows) and exists (select 1 from pur_rfqs r where r.id = s.rfq_id and r.company_id = lab_company()) and pur_can_draft();
$$;

-- Teklif kaydet (ortak): { delivery_days, valid_until, note, name, decline, quotes:[{line_id, unit_price, vat_rate, available, note}] }
create or replace function pur_rfq_save_quote_row(p_row uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare q jsonb; s pur_rfq_suppliers; r pur_rfqs;
begin
  select * into s from pur_rfq_suppliers where id = p_row for update;
  select * into r from pur_rfqs where id = s.rfq_id;
  if r.status <> 'open' then raise exception 'rfq_closed'; end if;
  if coalesce((p->>'decline')::boolean, false) then
    update pur_rfq_suppliers set status = 'declined', quoted_at = now(), note = nullif(left(coalesce(p->>'note', ''), 1000), ''), quoted_by = nullif(left(coalesce(p->>'name', ''), 120), '') where id = p_row;
    return;
  end if;
  for q in select * from jsonb_array_elements(coalesce(p->'quotes', '[]')) loop
    if not exists (select 1 from pur_rfq_lines where id = (q->>'line_id')::uuid and rfq_id = r.id) then continue; end if;
    insert into pur_rfq_quotes (supplier_row, line_id, unit_price, vat_rate, available, note)
    values (p_row, (q->>'line_id')::uuid, nullif(q->>'unit_price', '')::bigint, least(greatest(coalesce(nullif(q->>'vat_rate', '')::numeric, 20), 0), 100),
            coalesce((q->>'available')::boolean, true), nullif(left(coalesce(q->>'note', ''), 300), ''))
    on conflict (supplier_row, line_id) do update set unit_price = excluded.unit_price, vat_rate = excluded.vat_rate, available = excluded.available, note = excluded.note;
  end loop;
  update pur_rfq_suppliers set status = 'quoted', quoted_at = now(), delivery_days = nullif(p->>'delivery_days', '')::int, valid_until = nullif(p->>'valid_until', '')::date,
         note = nullif(left(coalesce(p->>'note', ''), 1000), ''), quoted_by = coalesce(nullif(left(coalesce(p->>'name', ''), 120), ''), quoted_by) where id = p_row;
end $$;
revoke execute on function pur_rfq_save_quote_row(uuid, jsonb) from public, anon, authenticated;

-- Satın alma telefonla aldığı teklifi kendisi girer
create or replace function pur_rfq_quote_internal(p_row uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from pur_rfq_suppliers s join pur_rfqs r on r.id = s.rfq_id where s.id = p_row and r.company_id = lab_company()) then raise exception 'not_found'; end if;
  perform pur_rfq_save_quote_row(p_row, p);
end $$;

-- Tedarikçi portalı (bağlantıyla, hesapsız)
create or replace function sup_rfq_view(p_token uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s pur_rfq_suppliers; r pur_rfqs; res jsonb;
begin
  select * into s from pur_rfq_suppliers where token = p_token;
  if s.id is null then return null; end if;
  select * into r from pur_rfqs where id = s.rfq_id;
  if s.viewed_at is null and not exists (select 1 from memberships where user_id = auth.uid() and company_id = r.company_id) then
    update pur_rfq_suppliers set viewed_at = now(), status = case when status = 'invited' then 'viewed' else status end where id = s.id;
  end if;
  select jsonb_build_object(
    'no', 'TK-' || r.year || '-' || lpad(r.no::text, 4, '0'), 'title', r.title, 'status', r.status, 'due_date', r.due_date, 'currency', r.currency, 'note', r.note,
    'supplier', (select name from fin_parties where id = s.party_id), 'my_status', s.status, 'delivery_days', s.delivery_days, 'valid_until', s.valid_until, 'my_note', s.note, 'quoted_by', s.quoted_by,
    'won', r.status = 'awarded' and r.awarded_supplier = s.id,
    'company', (select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email) from companies c where c.id = r.company_id),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'qty', l.qty, 'unit', l.unit, 'unit_price', q.unit_price, 'vat_rate', coalesce(q.vat_rate, 20), 'available', coalesce(q.available, true), 'note', q.note) order by l.sort), '[]')
              from pur_rfq_lines l left join pur_rfq_quotes q on q.line_id = l.id and q.supplier_row = s.id where l.rfq_id = r.id)
  ) into res;
  return res;
end $$;
grant execute on function sup_rfq_view(uuid) to anon, authenticated;

create or replace function sup_rfq_submit(p_token uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare s pur_rfq_suppliers;
begin
  select * into s from pur_rfq_suppliers where token = p_token;
  if s.id is null then raise exception 'not_found'; end if;
  perform pur_rfq_save_quote_row(s.id, p);
  begin
    perform deliver((select company_id from pur_rfqs where id = s.rfq_id),
      (select array_agg(m.user_id) from memberships m where m.company_id = (select company_id from pur_rfqs where id = s.rfq_id) and m.role in ('owner')),
      'Yeni teklif geldi', (select name from fin_parties where id = s.party_id) || ' teklif verdi', '/satinalma/teklifler/' || s.rfq_id);
  exception when others then null;
  end;
end $$;
grant execute on function sup_rfq_submit(uuid, jsonb) to anon, authenticated;

-- Kazanan tedarikçiyi seç → taslak satın alma siparişi (teklif fiyatlarıyla); istek satırları siparişe bağlanır
create or replace function pur_rfq_award(p_rfq uuid, p_row uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare r pur_rfqs; s pur_rfq_suppliers; v_po uuid; n int := 0; l record; v_date date := current_date;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  select * into r from pur_rfqs where id = p_rfq and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status <> 'open' then raise exception 'rfq_closed'; end if;
  select * into s from pur_rfq_suppliers where id = p_row and rfq_id = p_rfq;
  if s.id is null or s.status <> 'quoted' then raise exception 'no_quote'; end if;
  insert into pur_orders (year, no, party_id, order_date, expected_date, currency, warehouse_id, note)
  values (extract(year from v_date)::int, lab_next_no('po', extract(year from v_date)::int), s.party_id, v_date,
          case when s.delivery_days is not null then v_date + s.delivery_days end, r.currency, stk_default_warehouse(),
          'Teklif TK-' || r.year || '-' || lpad(r.no::text, 4, '0') || ' sonucu' || coalesce(' · ' || r.note, ''))
  returning id into v_po;
  for l in select rl.*, q.unit_price, q.vat_rate from pur_rfq_lines rl join pur_rfq_quotes q on q.line_id = rl.id and q.supplier_row = s.id and q.available
           where rl.rfq_id = p_rfq order by rl.sort loop
    n := n + 1;
    insert into pur_order_lines (order_id, sort, item_id, name, qty, unit, unit_price, vat_rate, amount)
    values (v_po, n, l.item_id, l.name, l.qty, l.unit, coalesce(l.unit_price, 0), l.vat_rate, round(l.qty * coalesce(l.unit_price, 0)));
    if l.request_line_id is not null then update stk_request_lines set po_id = v_po where id = l.request_line_id and po_id is null; end if;
    if l.item_id is not null and coalesce(l.unit_price, 0) > 0 then
      update stk_items set purchase_price = l.unit_price, supplier_party_id = coalesce(supplier_party_id, s.party_id) where id = l.item_id;
    end if;
  end loop;
  if n = 0 then raise exception 'no_quote'; end if;
  perform pur_order_totals(v_po);
  update pur_rfqs set status = 'awarded', awarded_supplier = s.id, po_id = v_po where id = p_rfq;
  return v_po;
end $$;

create or replace function pur_rfq_cancel(p_rfq uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  update pur_rfqs set status = 'cancelled' where id = p_rfq and company_id = lab_company() and status = 'open';
end $$;

do $$ declare f text; begin
  foreach f in array array['pur_rfq_create(jsonb)', 'pur_rfq_add_supplier(uuid, uuid)', 'pur_rfq_mark_sent(uuid[])', 'pur_rfq_quote_internal(uuid, jsonb)', 'pur_rfq_award(uuid, uuid)', 'pur_rfq_cancel(uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- Tedarikçi karnesi: son 12 ay — zamanında teslim, ortalama gecikme, teslim süresi, hasar, teklif yanıtı, puan (0-100)
create or replace function pur_supplier_scores() returns table (
  party_id uuid, name text, orders int, received int, on_time_pct numeric, avg_delay numeric, avg_lead numeric, damage_pct numeric, rfq_invited int, rfq_quoted int, rfq_won int, spend bigint, score int)
language sql stable security definer set search_path = public as $$
  with o as (
    select o.party_id, o.id, o.total_try, o.expected_date, o.sent_at, o.received_at, o.status
      from pur_orders o where o.company_id = lab_company() and o.status not in ('draft', 'cancelled') and o.order_date >= current_date - 365
  ), od as (
    select party_id, count(*)::int n, count(*) filter (where received_at is not null)::int rcv,
           count(*) filter (where received_at is not null and expected_date is not null)::int with_due,
           count(*) filter (where received_at is not null and expected_date is not null and (received_at at time zone 'Europe/Istanbul')::date <= expected_date)::int on_time,
           avg(greatest(0, (received_at at time zone 'Europe/Istanbul')::date - expected_date)) filter (where received_at is not null and expected_date is not null) delay,
           avg(extract(epoch from (received_at - sent_at)) / 86400) filter (where received_at is not null and sent_at is not null) lead,
           sum(total_try)::bigint spend
      from o group by party_id
  ), dm as (
    select r.po_party party_id, sum(rl.damaged) dmg, sum(rl.qty) qty from (
      select sr.id, po.party_id po_party from stk_receipts sr join pur_orders po on po.id = sr.po_id where po.company_id = lab_company() and sr.created_at >= now() - interval '365 days') r
      join stk_receipt_lines rl on rl.receipt_id = r.id group by r.po_party
  ), rq as (
    select s.party_id, count(*)::int inv, count(*) filter (where s.status = 'quoted')::int quoted, count(*) filter (where r.awarded_supplier = s.id)::int won
      from pur_rfq_suppliers s join pur_rfqs r on r.id = s.rfq_id where r.company_id = lab_company() and r.created_at >= now() - interval '365 days' group by s.party_id
  )
  select p.id, p.name, coalesce(od.n, 0), coalesce(od.rcv, 0),
         case when od.with_due > 0 then round(100.0 * od.on_time / od.with_due, 1) end,
         round(od.delay, 1), round(od.lead::numeric, 1),
         case when dm.qty > 0 then round(100.0 * dm.dmg / dm.qty, 2) end,
         coalesce(rq.inv, 0), coalesce(rq.quoted, 0), coalesce(rq.won, 0), coalesce(od.spend, 0),
         round(
           0.5 * coalesce(case when od.with_due > 0 then 100.0 * od.on_time / od.with_due end, 75)
         + 0.3 * (100 - least(100, coalesce(case when dm.qty > 0 then 100.0 * dm.dmg / dm.qty end, 0) * 10))
         + 0.2 * coalesce(case when rq.inv > 0 then 100.0 * rq.quoted / rq.inv end, 75))::int
    from fin_parties p
    left join od on od.party_id = p.id left join dm on dm.party_id = p.id left join rq on rq.party_id = p.id
   where p.company_id = lab_company() and (od.n > 0 or rq.inv > 0)
   order by coalesce(od.spend, 0) desc;
$$;
revoke execute on function pur_supplier_scores() from public, anon;
grant execute on function pur_supplier_scores() to authenticated;
