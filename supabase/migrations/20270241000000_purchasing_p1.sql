-- Satın alma modülü — 1. aşama
--  1) Onaylı istek satırlarından tek tıkla satın alma siparişi (istek ↔ sipariş bağı)
--  2) Siparişi eksik teslimle kapatma
--  3) Sipariş teslim alınınca isteği açan kişiye bildirim, istek "teslime hazır"
--  4) Satın alma paneli özeti

alter table stk_request_lines add column if not exists po_id uuid references pur_orders (id) on delete set null;
create index if not exists stk_request_lines_po_idx on stk_request_lines (po_id) where po_id is not null;
alter table pur_orders add column if not exists closed_short boolean not null default false;
alter table pur_orders add column if not exists close_note text check (close_note is null or length(close_note) <= 300);

-- Onaylı istek satırlarından taslak sipariş (aynı tedarikçi)
create or replace function pur_from_requests(p_lines uuid[], p_party uuid, p_expected date default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_date date := current_date; v_no text; n int := 0; r record;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = p_party and company_id = lab_company()) then raise exception 'party_required'; end if;
  if coalesce(array_length(p_lines, 1), 0) = 0 then raise exception 'lines_required'; end if;
  insert into pur_orders (year, no, party_id, order_date, expected_date, currency, warehouse_id, note)
  values (extract(year from v_date)::int, lab_next_no('po', extract(year from v_date)::int), p_party, v_date, p_expected, 'TRY', stk_default_warehouse(), nullif(left(coalesce(p_note, ''), 1000), ''))
  returning id into v_id;
  for r in
    select l.id, l.item_id, l.name, l.unit, l.qty - coalesce(l.issued_qty, 0) as qty, coalesce(l.est_price, i.purchase_price, 0) as price, coalesce(i.vat_rate, 20) as vat, q.id as req_id, q.year, q.no
      from stk_request_lines l
      join stk_requests q on q.id = l.request_id and q.company_id = lab_company()
      left join stk_items i on i.id = l.item_id
     where l.id = any(p_lines) and l.to_purchase and l.po_id is null and l.buy_list_id is null and q.status in ('approved', 'purchase')
     order by q.created_at, l.sort
  loop
    if r.qty <= 0 then continue; end if;
    n := n + 1;
    insert into pur_order_lines (order_id, sort, item_id, name, qty, unit, unit_price, vat_rate, amount)
    values (v_id, n, r.item_id, left(r.name, 300), r.qty, coalesce(r.unit, 'adet'), r.price, r.vat, round(r.qty * r.price));
    update stk_request_lines set po_id = v_id where id = r.id;
  end loop;
  if n = 0 then raise exception 'lines_required'; end if;
  perform pur_order_totals(v_id);
  select 'SA-' || year || '-' || lpad(no::text, 4, '0') into v_no from pur_orders where id = v_id;
  insert into stk_request_events (request_id, action, note)
  select distinct l.request_id, 'po', 'Satın alma siparişine eklendi: ' || v_no from stk_request_lines l where l.po_id = v_id;
  return v_id;
end $$;
revoke execute on function pur_from_requests(uuid[], uuid, date, text) from public, anon;
grant execute on function pur_from_requests(uuid[], uuid, date, text) to authenticated;

-- Eksik teslimle kapat: kalan miktar beklenmez, sipariş tamamlanmış sayılır
create or replace function pur_order_close(p_id uuid, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o pur_orders;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id and company_id = lab_company() for update;
  if o.id is null then raise exception 'not_found'; end if;
  if o.status not in ('approved', 'sent', 'partial') then raise exception 'bad_status'; end if;
  update pur_orders set status = 'received', received_at = coalesce(received_at, now()), closed_short = exists (select 1 from pur_order_lines where order_id = p_id and received_qty < qty),
         close_note = nullif(left(coalesce(p_note, ''), 300), '') where id = p_id;
end $$;
revoke execute on function pur_order_close(uuid, text) from public, anon;
grant execute on function pur_order_close(uuid, text) to authenticated;

-- Sipariş geldi (kısmi / tam) → bağlı isteklerin sahiplerine bildirim; tam gelince istek "teslime hazır"
create or replace function pur_order_request_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare q record; v_no text := 'SA-' || new.year || '-' || lpad(new.no::text, 4, '0');
begin
  if new.status is not distinct from old.status or new.status not in ('partial', 'received') then return new; end if;
  for q in select distinct r.id, r.year, r.no, r.requested_by, r.status, r.kind from stk_requests r join stk_request_lines l on l.request_id = r.id where l.po_id = new.id loop
    if new.status = 'received' and q.status in ('approved', 'purchase')
       and not exists (select 1 from stk_request_lines l2 join pur_orders o2 on o2.id = l2.po_id where l2.request_id = q.id and o2.status not in ('received', 'invoiced', 'cancelled'))
       and not exists (select 1 from stk_request_lines l3 where l3.request_id = q.id and l3.to_purchase and l3.po_id is null and l3.buy_list_id is null) then
      update stk_requests set status = 'ready', updated_at = now() where id = q.id;
      insert into stk_request_events (request_id, action, note) values (q.id, 'ready', 'Satın alınan malzeme geldi (' || v_no || '), depodan teslim alınabilir');
    end if;
    begin
      perform deliver(new.company_id, array[q.requested_by],
        case when new.status = 'received' then 'İstediğiniz malzeme geldi' else 'İstediğiniz malzemenin bir kısmı geldi' end,
        'İstek ' || case q.kind when 'asset' then 'DT' when 'supply' then 'SP' else 'MT' end || '-' || q.year || '-' || lpad(q.no::text, 4, '0') || ' · sipariş ' || v_no || (case when new.status = 'received' then ' · depodan teslim alabilirsiniz' else '' end),
        '/benim/malzeme');
    exception when others then null;
    end;
  end loop;
  return new;
end $$;
drop trigger if exists pur_order_request_sync on pur_orders;
create trigger pur_order_request_sync after update of status on pur_orders for each row execute function pur_order_request_sync();

-- Satın alma paneli özeti
create or replace function pur_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); d date := (now() at time zone 'Europe/Istanbul')::date; r jsonb;
begin
  if not (can_module('purchases') or can_module('stock')) then raise exception 'not_allowed'; end if;
  select jsonb_build_object(
    'req_waiting', (select count(*) from stk_requests where company_id = c and status = 'purchase'),
    'lines_to_order', (select count(*) from stk_request_lines l join stk_requests q on q.id = l.request_id where q.company_id = c and q.status in ('approved') and l.to_purchase and l.po_id is null and l.buy_list_id is null),
    'po_draft', (select count(*) from pur_orders where company_id = c and status = 'draft'),
    'po_pending', (select count(*) from pur_orders where company_id = c and status = 'pending'),
    'po_unsent', (select count(*) from pur_orders where company_id = c and status = 'approved'),
    'po_open', (select count(*) from pur_orders where company_id = c and status in ('sent', 'partial')),
    'po_late', (select count(*) from pur_orders where company_id = c and status in ('sent', 'partial') and expected_date < d),
    'po_noinvoice', (select count(*) from pur_orders where company_id = c and status = 'received' and invoice_id is null),
    'month_total', (select coalesce(sum(total_try), 0) from pur_orders where company_id = c and status not in ('draft', 'cancelled') and order_date >= date_trunc('month', d)::date),
    'prev_total', (select coalesce(sum(total_try), 0) from pur_orders where company_id = c and status not in ('draft', 'cancelled') and order_date >= (date_trunc('month', d) - interval '1 month')::date and order_date < date_trunc('month', d)::date),
    'top_suppliers', (select coalesce(jsonb_agg(x order by x->>'total' desc), '[]') from (
        select jsonb_build_object('name', p.name, 'total', sum(o.total_try), 'n', count(*)) x from pur_orders o join fin_parties p on p.id = o.party_id
         where o.company_id = c and o.status not in ('draft', 'cancelled') and o.order_date >= (d - 90) group by p.name order by sum(o.total_try) desc limit 6) t)
  ) into r;
  return r;
end $$;
revoke execute on function pur_dashboard() from public, anon;
grant execute on function pur_dashboard() to authenticated;
