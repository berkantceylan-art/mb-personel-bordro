-- Satın alma — 3. aşama: 3'lü eşleştirme (sipariş / mal kabul / fatura), bütçe, raporlar

-- ---------------------------------------------------------------------
-- Kolonlar
-- ---------------------------------------------------------------------
alter table pur_orders add column if not exists category_id uuid references fin_categories (id) on delete set null;   -- gider türü (bütçe)
alter table pur_orders add column if not exists over_budget boolean not null default false;
alter table pur_orders add column if not exists match_ok_by uuid;
alter table pur_orders add column if not exists match_ok_at timestamptz;
alter table pur_orders add column if not exists match_ok_note text check (match_ok_note is null or length(match_ok_note) <= 300);
alter table pur_orders add column if not exists match_ok_diff bigint;
alter table inv_invoices add column if not exists po_id uuid references pur_orders (id) on delete set null;
create index if not exists inv_invoices_po_idx on inv_invoices (po_id) where po_id is not null;
alter table pur_settings add column if not exists match_price_tol numeric(5, 2) not null default 2;      -- % fiyat toleransı
alter table pur_settings add column if not exists match_qty_tol numeric(14, 3) not null default 0;      -- miktar toleransı
alter table pur_settings add column if not exists budget_block boolean not null default true;           -- bütçe aşımında yönetici onayı

-- Geçmiş bağlantılar: siparişten oluşturulan faturalar ve faturayla eşleşen mal kabuller
update inv_invoices i set po_id = o.id from pur_orders o where o.invoice_id = i.id and i.po_id is null;
update inv_invoices i set po_id = r.po_id from stk_receipts r where r.invoice_id = i.id and r.po_id is not null and i.po_id is null;

-- Mal kabul faturayla eşleşince fatura siparişe de bağlanır
create or replace function pur_rcv_invoice_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.invoice_id is not null and new.po_id is not null and new.invoice_id is distinct from old.invoice_id then
    update inv_invoices set po_id = new.po_id where id = new.invoice_id and po_id is null;
    update pur_orders o set invoice_id = case when o.invoice_id is null or not exists (select 1 from inv_invoices x where x.id = o.invoice_id and x.status <> 'cancelled') then new.invoice_id else o.invoice_id end,
           status = case when o.status = 'received' then 'invoiced' else o.status end
     where o.id = new.po_id;
  end if;
  return new;
end $$;
drop trigger if exists pur_rcv_invoice_sync on stk_receipts;
create trigger pur_rcv_invoice_sync after update of invoice_id on stk_receipts for each row execute function pur_rcv_invoice_sync();

-- Siparişin gider türü: seçilmişse o; stoklu kalem varsa "stok", yoksa "malzeme gideri" (fatura işlenirken kullanılan kuralın aynısı)
create or replace function pur_po_category(p_po uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(o.category_id,
           case when exists (select 1 from pur_order_lines l join stk_items i on i.id = l.item_id where l.order_id = o.id and i.kind <> 'service') then fin_category('stock')
                when exists (select 1 from pur_order_lines l join stk_items i on i.id = l.item_id where l.order_id = o.id and i.kind = 'service') then fin_category('exp_other')
                else fin_category('exp_material') end)
  from pur_orders o where o.id = p_po;
$$;
revoke execute on function pur_po_category(uuid) from public, anon, authenticated;

-- Siparişin KDV hariç TL tutarı
create or replace function pur_po_net_try(o pur_orders) returns bigint language sql stable as $$
  select case when o.total = 0 then 0 when o.currency = 'TRY' then o.subtotal else round(o.subtotal * (o.total_try::numeric / o.total)) end::bigint;
$$;

-- ---------------------------------------------------------------------
-- BÜTÇE: gider türü × ay
-- ---------------------------------------------------------------------
create table if not exists pur_budgets (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  year int not null check (year between 2000 and 2100),
  month int not null check (month between 1 and 12),
  category_id uuid not null references fin_categories (id) on delete cascade,
  amount bigint not null default 0 check (amount >= 0),     -- TL kuruş, KDV hariç
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (company_id, year, month, category_id)
);
alter table pur_budgets enable row level security;
drop policy if exists pur_budgets_read on pur_budgets;
create policy pur_budgets_read on pur_budgets for select to authenticated
  using (company_id = (select lab_company()) and ((select can_module('purchases')) or (select can_module('finance'))));
revoke all on pur_budgets from anon;
grant select on pur_budgets to authenticated;

-- Gerçekleşen (işlenmiş alış faturaları, KDV hariç TL) + taahhüt (onaylı ama faturası gelmemiş siparişler)
create or replace function pur_budget_rows(p_year int) returns table (category_id uuid, month int, actual bigint, committed bigint)
language sql stable security definer set search_path = public as $$
  with a as (
    select coalesce(li.category_id,
             fin_category(case when si.kind is not null and si.kind <> 'service' then 'stock' when si.kind = 'service' then 'exp_other' else 'exp_material' end)) cat,
           extract(month from i.invoice_date)::int m,
           sum(round(li.net * i.rate) * case when i.type = 'return' then -1 else 1 end)::bigint v
      from inv_invoices i join inv_lines li on li.invoice_id = i.id left join stk_items si on si.id = li.item_id
     where i.company_id = lab_company() and i.direction = 'purchase' and i.status = 'posted' and extract(year from i.invoice_date)::int = p_year
     group by 1, 2
  ), c as (
    select pur_po_category(o.id) cat, extract(month from o.order_date)::int m, sum(pur_po_net_try(o))::bigint v
      from pur_orders o
     where o.company_id = lab_company() and o.status in ('approved', 'sent', 'partial', 'received') and extract(year from o.order_date)::int = p_year
       and not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status <> 'cancelled')
       and not (o.closed_short and not exists (select 1 from pur_order_lines l where l.order_id = o.id and l.received_qty > 0))
     group by 1, 2
  )
  select coalesce(a.cat, c.cat), coalesce(a.m, c.m), coalesce(a.v, 0), coalesce(c.v, 0)
    from a full join c on c.cat = a.cat and c.m = a.m
   where coalesce(a.cat, c.cat) is not null;
$$;
revoke execute on function pur_budget_rows(int) from public, anon, authenticated;

create or replace function pur_budget_usage(p_year int) returns table (category_id uuid, name text, kind text, month int, budget bigint, actual bigint, committed bigint)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  with r as (select * from pur_budget_rows(p_year)),
  b as (select x.category_id, x.month, x.amount from pur_budgets x where x.company_id = lab_company() and x.year = p_year),
  k as (select distinct q.category_id from (select r.category_id from r union select b.category_id from b) q)
  select k.category_id, fc.name, fc.kind, m.m, coalesce(b.amount, 0)::bigint, coalesce(r.actual, 0)::bigint, coalesce(r.committed, 0)::bigint
    from k join fin_categories fc on fc.id = k.category_id
    cross join generate_series(1, 12) m(m)
    left join b on b.category_id = k.category_id and b.month = m.m
    left join r on r.category_id = k.category_id and r.month = m.m
   order by fc.kind desc, fc.name, m.m;
end $$;
revoke execute on function pur_budget_usage(int) from public, anon;
grant execute on function pur_budget_usage(int) to authenticated;

-- p: [{category_id, month, amount}] (amount TL kuruş; 0 → sil)
create or replace function pur_budget_save(p_year int, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare l jsonb; n int := 0; v bigint;
begin
  if not (can_module('purchases', 3) or can_module('finance', 3)) then raise exception 'not_allowed'; end if;
  if p_year not between 2000 and 2100 then raise exception 'bad_year'; end if;
  for l in select * from jsonb_array_elements(coalesce(p, '[]'::jsonb)) loop
    if not exists (select 1 from fin_categories where id = (l->>'category_id')::uuid and company_id = lab_company()) then continue; end if;
    if coalesce((l->>'month')::int, 0) not between 1 and 12 then continue; end if;
    v := greatest(coalesce(nullif(l->>'amount', '')::bigint, 0), 0);
    if v = 0 then
      delete from pur_budgets where company_id = lab_company() and year = p_year and month = (l->>'month')::int and category_id = (l->>'category_id')::uuid;
    else
      insert into pur_budgets (company_id, year, month, category_id, amount) values (lab_company(), p_year, (l->>'month')::int, (l->>'category_id')::uuid, v)
      on conflict (company_id, year, month, category_id) do update set amount = excluded.amount, updated_by = auth.uid(), updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function pur_budget_save(int, jsonb) from public, anon;
grant execute on function pur_budget_save(int, jsonb) to authenticated;

-- Bir siparişin bütçe durumu (sipariş ayı + gider türü); bütçe girilmemişse budget null
create or replace function pur_budget_check(p_po uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o pur_orders; v_cat uuid; v_m int; v_y int; v_bud bigint; v_used bigint; v_this bigint;
begin
  if not (can_module('purchases') or can_module('stock') or can_module('finance')) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_po and company_id = lab_company();
  if o.id is null then return null; end if;
  v_cat := pur_po_category(o.id); v_y := extract(year from o.order_date)::int; v_m := extract(month from o.order_date)::int;
  select amount into v_bud from pur_budgets where company_id = o.company_id and year = v_y and month = v_m and category_id = v_cat;
  select coalesce(sum(actual + committed), 0) into v_used from pur_budget_rows(v_y) r where r.category_id = v_cat and r.month = v_m;
  v_this := pur_po_net_try(o);
  -- sipariş zaten taahhüt sayılıyorsa iki kez ekleme
  if o.status in ('approved', 'sent', 'partial', 'received') and not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status <> 'cancelled') then v_used := v_used - v_this; end if;
  return jsonb_build_object('category_id', v_cat, 'category', (select name from fin_categories where id = v_cat), 'year', v_y, 'month', v_m,
                            'budget', v_bud, 'used', v_used, 'this', v_this, 'after', v_used + v_this,
                            'over', v_bud is not null and v_used + v_this > v_bud);
end $$;
revoke execute on function pur_budget_check(uuid) from public, anon;
grant execute on function pur_budget_check(uuid) to authenticated;

-- Taslak / onaylı siparişin gider türünü değiştir
create or replace function pur_order_set_category(p_id uuid, p_cat uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if p_cat is not null and not exists (select 1 from fin_categories where id = p_cat and company_id = lab_company()) then raise exception 'not_found'; end if;
  update pur_orders set category_id = p_cat where id = p_id and company_id = lab_company() and status not in ('cancelled');
end $$;
revoke execute on function pur_order_set_category(uuid, uuid) from public, anon;
grant execute on function pur_order_set_category(uuid, uuid) to authenticated;

-- Sipariş kaydet: gider türü de alınır (diğer her şey 20270119 sürümüyle aynı)
create or replace function pur_order_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_old pur_orders; l jsonb; i int := 0; v_cur text := coalesce(nullif(p->>'currency', ''), 'TRY'); v_date date := coalesce(nullif(p->>'order_date', '')::date, current_date);
  v_qty numeric; v_price bigint; v_vr numeric; v_cat uuid := nullif(p->>'category_id', '')::uuid;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  if v_id is not null then
    select * into v_old from pur_orders where id = v_id for update;
    if v_old.id is null then raise exception 'not_found'; end if;
    if v_old.status not in ('draft') then raise exception 'po_locked'; end if;
  end if;
  if not exists (select 1 from fin_parties where id = nullif(p->>'party_id', '')::uuid) then raise exception 'party_required'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_cat is not null and not exists (select 1 from fin_categories where id = v_cat and company_id = lab_company()) then v_cat := null; end if;
  if v_id is null then
    insert into pur_orders (year, no, party_id) values (extract(year from v_date)::int, lab_next_no('po', extract(year from v_date)::int), (p->>'party_id')::uuid) returning id into v_id;
  end if;
  update pur_orders set party_id = (p->>'party_id')::uuid, order_date = v_date, expected_date = nullif(p->>'expected_date', '')::date, currency = v_cur,
    warehouse_id = coalesce(nullif(p->>'warehouse_id', '')::uuid, stk_default_warehouse()), note = nullif(left(coalesce(p->>'note', ''), 1000), ''), reject_reason = null,
    category_id = case when p ? 'category_id' then v_cat else category_id end
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
grant execute on function pur_order_save(jsonb) to authenticated;

-- Onaya gönder: bütçe kontrolü eklendi. Bütçeyi aşan sipariş (ayar açıksa) satın alma yöneticisinin onayına düşer.
--  Dönüş: approved | pending | budget (bütçe aşımı nedeniyle onayda)
create or replace function pur_order_submit(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_limit bigint; v_norate boolean; v_req uuid; u record; v_bud jsonb; v_over boolean; v_block boolean; v_no text; v_body text;
begin
  if not pur_can_draft() then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status <> 'draft' then raise exception 'po_locked'; end if;
  v_bud := pur_budget_check(o.id);
  v_over := coalesce((v_bud->>'over')::boolean, false);
  v_no := 'SA-' || o.year || '-' || lpad(o.no::text, 4, '0');
  v_body := v_no || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') || ' · ' || to_char(o.total / 100.0, 'FM999G999G990D00') || ' ' || o.currency;
  update pur_orders set status = 'pending', submitted_at = now(), over_budget = v_over where id = p_id;
  v_req := apr_start('purchase_order', o.id, o.total_try, (v_bud->>'category_id')::uuid, null, 'Satın alma ' || v_body || case when v_over then ' · BÜTÇE AŞIMI' else '' end, '/alis/siparisler/' || o.id);
  if v_req is not null then return 'pending'; end if;
  select approval_limit, coalesce(budget_block, true) into v_limit, v_block from pur_settings where company_id = o.company_id;
  v_block := coalesce(v_block, true);
  if not can_module('purchases', 2) or (v_over and v_block and not can_module('purchases', 3)) then
    for u in select m.user_id from memberships m where m.company_id = o.company_id and module_level_for(m.user_id, 'purchases') >= 3 loop
      insert into notifications (company_id, user_id, title, body, link)
      values (o.company_id, u.user_id, case when v_over then 'Bütçeyi aşan sipariş onay bekliyor' else 'Onay bekleyen satın alma siparişi' end,
              v_body || case when v_over then ' · ' || coalesce(v_bud->>'category', '') || ' bütçesi ' || to_char((v_bud->>'budget')::bigint / 100.0, 'FM999G999G990') || ' TL, bu siparişle ' || to_char((v_bud->>'after')::bigint / 100.0, 'FM999G999G990') || ' TL' else '' end,
              '/alis/siparisler/' || o.id);
    end loop;
    return case when v_over then 'budget' else 'pending' end;
  end if;
  v_norate := o.currency <> 'TRY' and fx_rate(o.currency, o.order_date) is null;
  if can_module('purchases', 3) or (coalesce(v_limit, 0) = 0) or (not v_norate and o.total_try <= v_limit) then
    update pur_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
    return 'approved';
  end if;
  return 'pending';
end $$;
grant execute on function pur_order_submit(uuid) to authenticated;

-- Siparişten alış faturası: gider türü satırlara, sipariş bağlantısı faturaya geçer
create or replace function pur_order_to_invoice(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_inv uuid; v_lines jsonb;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null then raise exception 'po_not_open'; end if;
  if o.invoice_id is not null and exists (select 1 from inv_invoices where id = o.invoice_id and status <> 'cancelled') then return o.invoice_id; end if;
  if o.status not in ('approved', 'sent', 'partial', 'received', 'invoiced') then raise exception 'po_not_open'; end if;
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'name', name, 'qty', case when received_qty > 0 then received_qty else qty end, 'unit', unit,
                                      'unit_price', round(unit_price / 100.0, 4), 'vat_rate', vat_rate, 'category_id', o.category_id) order by sort)
  into v_lines from pur_order_lines where order_id = p_id;
  v_inv := inv_save(jsonb_build_object('direction', 'purchase', 'party_id', o.party_id, 'invoice_date', current_date, 'currency', o.currency,
                                      'warehouse_id', o.warehouse_id, 'note', 'Satın alma siparişi SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'lines', v_lines));
  update inv_invoices set po_id = o.id where id = v_inv;
  update pur_orders set invoice_id = v_inv, status = 'invoiced' where id = p_id;
  return v_inv;
end $$;
grant execute on function pur_order_to_invoice(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 3'LÜ EŞLEŞTİRME: sipariş satırı ↔ mal kabul ↔ fatura satırı
--  status: waiting (gelmedi, fatura yok) | not_invoiced (geldi, fatura yok) | partial (kısmi faturalandı)
--          | ok | over_billed (gelenden fazla faturalandı) | price_up (fatura fiyatı siparişten yüksek) | extra (siparişte olmayan fatura satırı)
--  Hizmet / stok kartsız satır mal kabule girmez: fatura sipariş miktarıyla karşılaştırılır (2'li eşleştirme)
-- ---------------------------------------------------------------------
create or replace function pur_match_lines(p_po uuid) returns table (
  sort int, line_id uuid, name text, unit text, ordered numeric, received numeric, basis numeric, invoiced numeric,
  po_price bigint, inv_price bigint, inv_amount bigint, status text, two_way boolean)
language plpgsql stable security definer set search_path = public as $$
declare o pur_orders; v_pt numeric; v_qt numeric;
begin
  if not (can_module('purchases') or can_module('stock') or can_module('finance')) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders x where x.id = p_po and x.company_id = lab_company();
  if o.id is null then return; end if;
  select coalesce(max(s.match_price_tol), 2), coalesce(max(s.match_qty_tol), 0) into v_pt, v_qt from pur_settings s where s.company_id = o.company_id;
  return query
  with il as (
    select l.id, l.sort ls, l.name, l.unit,
           l.qty * case when i.type = 'return' then -1 else 1 end q,
           (l.net * case when i.type = 'return' then -1 else 1 end
              * case when i.currency = o.currency then 1
                     else i.rate / coalesce(case when o.currency = 'TRY' then 1 else fx_rate(o.currency, i.invoice_date) end, i.rate) end)::numeric amt,
           (select pl.id from pur_order_lines pl
             where pl.order_id = o.id and ((l.item_id is not null and pl.item_id = l.item_id) or lower(btrim(pl.name)) = lower(btrim(l.name)))
             order by (l.item_id is not null and pl.item_id = l.item_id) desc, pl.sort limit 1) pl_id
      from inv_invoices i join inv_lines l on l.invoice_id = i.id
     where i.po_id = o.id and i.status <> 'cancelled' and i.direction = 'purchase'
  ), agg as (
    select il.pl_id, sum(il.q) q, sum(il.amt) amt from il where il.pl_id is not null group by il.pl_id
  ), pl as (
    select x.*, (x.received_qty = 0 and (x.item_id is null or exists (select 1 from stk_items si where si.id = x.item_id and si.kind = 'service'))) tw
      from pur_order_lines x where x.order_id = o.id
  )
  select pl.sort, pl.id, pl.name, pl.unit, pl.qty, pl.received_qty,
         case when pl.tw then pl.qty else pl.received_qty end,
         coalesce(a.q, 0), pl.unit_price,
         case when coalesce(a.q, 0) <> 0 then round(a.amt / a.q)::bigint end,
         round(coalesce(a.amt, 0))::bigint,
         case
           when coalesce(a.q, 0) = 0 and pl.received_qty = 0 and not (pl.tw and o.status in ('received', 'invoiced')) then 'waiting'
           when coalesce(a.q, 0) = 0 then 'not_invoiced'
           when a.q > (case when pl.tw then pl.qty else pl.received_qty end) + v_qt then 'over_billed'
           when pl.unit_price > 0 and a.amt / a.q > pl.unit_price * (1 + v_pt / 100) then 'price_up'
           when a.q < (case when pl.tw then pl.qty else pl.received_qty end) - v_qt then 'partial'
           else 'ok' end,
         pl.tw
    from pl left join agg a on a.pl_id = pl.id
  union all
  select 1000 + il.ls, null::uuid, il.name, il.unit, 0::numeric, 0::numeric, 0::numeric, il.q, 0::bigint,
         case when il.q <> 0 then round(il.amt / il.q)::bigint end, round(il.amt)::bigint, 'extra', false
    from il where il.pl_id is null
  order by 1;
end $$;
revoke execute on function pur_match_lines(uuid) from public, anon;
grant execute on function pur_match_lines(uuid) to authenticated;

-- Sipariş bazında özet (son p_days gün ya da açık siparişler)
--  match: waiting (fatura yok) | partial | ok | diff | accepted (fark yöneticice kabul edildi)
create or replace function pur_match_list(p_days int default 180) returns table (
  po_id uuid, year int, no int, party_id uuid, party text, order_date date, status text, currency text,
  ordered bigint, received bigint, invoiced bigint, diff bigint, invoices int, issues int, match text, ok_note text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  with o as (
    select x.* from pur_orders x
     where x.company_id = lab_company() and x.status in ('approved', 'sent', 'partial', 'received', 'invoiced')
       and (x.order_date >= current_date - greatest(coalesce(p_days, 180), 1) or x.status in ('sent', 'partial', 'received')
            or exists (select 1 from inv_invoices i where i.po_id = x.id and i.status <> 'cancelled' and i.invoice_date >= current_date - greatest(coalesce(p_days, 180), 1)))
  ), s as (
    select o.id,
           sum(round(m.ordered * m.po_price))::bigint ord,
           sum(round(m.basis * m.po_price))::bigint rcv,
           sum(m.inv_amount)::bigint inv,
           count(*) filter (where m.status in ('over_billed', 'price_up', 'extra'))::int iss,
           count(*) filter (where m.status in ('partial', 'not_invoiced'))::int part,
           count(*) filter (where m.status = 'waiting')::int wait
      from o cross join lateral pur_match_lines(o.id) m group by o.id
  ), n as (
    select i.po_id, count(*)::int c from inv_invoices i join o on o.id = i.po_id where i.status <> 'cancelled' group by i.po_id
  )
  select o.id, o.year, o.no, o.party_id, p.name, o.order_date, o.status, o.currency,
         coalesce(s.ord, 0), coalesce(s.rcv, 0), coalesce(s.inv, 0), coalesce(s.inv, 0) - coalesce(s.rcv, 0), coalesce(n.c, 0), coalesce(s.iss, 0),
         case when coalesce(n.c, 0) = 0 then 'waiting'
              when coalesce(s.iss, 0) > 0 and o.match_ok_at is not null and abs((coalesce(s.inv, 0) - coalesce(s.rcv, 0)) - coalesce(o.match_ok_diff, 0)) <= 100 then 'accepted'
              when coalesce(s.iss, 0) > 0 then 'diff'
              when coalesce(s.part, 0) > 0 or coalesce(s.wait, 0) > 0 then 'partial'
              else 'ok' end,
         o.match_ok_note
    from o join fin_parties p on p.id = o.party_id left join s on s.id = o.id left join n on n.po_id = o.id
   order by o.order_date desc, o.no desc;
end $$;
revoke execute on function pur_match_list(int) from public, anon;
grant execute on function pur_match_list(int) to authenticated;

-- Siparişe bağlanmamış alış faturaları + aynı tedarikçinin aday siparişleri (tutara en yakın önce)
create or replace function pur_unlinked_invoices(p_days int default 120) returns table (
  invoice_id uuid, doc_no text, invoice_date date, party_id uuid, party text, total bigint, currency text, status text, candidates jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  return query
  select i.id, i.doc_no, i.invoice_date, i.party_id, coalesce(p.name, i.party_name), i.total, i.currency, i.status, c.j
    from inv_invoices i
    left join fin_parties p on p.id = i.party_id
    cross join lateral (
      select jsonb_agg(jsonb_build_object('id', o.id, 'no', 'SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'total', o.total, 'currency', o.currency,
                                          'date', o.order_date, 'status', o.status, 'has_invoice', exists (select 1 from inv_invoices x where x.po_id = o.id and x.status <> 'cancelled'))
                       order by (exists (select 1 from inv_invoices x where x.po_id = o.id and x.status <> 'cancelled')), abs(o.total - i.total) * case when o.currency = i.currency then 1 else 1000 end) j
        from (select * from pur_orders o2
               where o2.party_id = i.party_id and o2.company_id = i.company_id and o2.status in ('approved', 'sent', 'partial', 'received', 'invoiced')
                 and o2.order_date <= i.invoice_date + 7 and o2.order_date >= i.invoice_date - 180
               order by o2.order_date desc limit 8) o
    ) c
   where i.company_id = lab_company() and i.direction = 'purchase' and i.type = 'invoice' and i.status <> 'cancelled' and i.po_id is null
     and i.invoice_date >= current_date - greatest(coalesce(p_days, 120), 1) and c.j is not null
   order by i.invoice_date desc;
end $$;
revoke execute on function pur_unlinked_invoices(int) from public, anon;
grant execute on function pur_unlinked_invoices(int) to authenticated;

-- Faturayı siparişe bağla (p_po null: bağlantıyı kaldır)
create or replace function pur_invoice_link(p_invoice uuid, p_po uuid) returns void
language plpgsql security definer set search_path = public as $$
declare i inv_invoices; o pur_orders;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into i from inv_invoices where id = p_invoice and company_id = lab_company() and direction = 'purchase' for update;
  if i.id is null then raise exception 'invoice_not_found'; end if;
  if p_po is null then
    update inv_invoices set po_id = null where id = i.id;
    update pur_orders set invoice_id = (select x.id from inv_invoices x where x.po_id = pur_orders.id and x.status <> 'cancelled' order by x.invoice_date limit 1)
     where id = i.po_id and invoice_id = i.id;
    update pur_orders set status = 'received' where id = i.po_id and status = 'invoiced' and invoice_id is null;
    return;
  end if;
  select * into o from pur_orders where id = p_po and company_id = lab_company() for update;
  if o.id is null or o.status in ('draft', 'pending', 'cancelled') then raise exception 'po_not_open'; end if;
  if o.party_id <> i.party_id then raise exception 'party_mismatch'; end if;
  update inv_invoices set po_id = o.id where id = i.id;
  update pur_orders set invoice_id = case when invoice_id is null or not exists (select 1 from inv_invoices x where x.id = pur_orders.invoice_id and x.status <> 'cancelled') then i.id else invoice_id end,
         status = case when status = 'received' then 'invoiced' else status end
   where id = o.id;
end $$;
revoke execute on function pur_invoice_link(uuid, uuid) from public, anon;
grant execute on function pur_invoice_link(uuid, uuid) to authenticated;

-- Farkı kabul et (yönetici) / kabulü geri al
create or replace function pur_match_accept(p_po uuid, p_ok boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_diff bigint;
begin
  if not (can_module('purchases', 3) or can_module('finance', 3)) then raise exception 'not_allowed'; end if;
  if not p_ok then
    update pur_orders set match_ok_at = null, match_ok_by = null, match_ok_note = null, match_ok_diff = null where id = p_po and company_id = lab_company();
    return;
  end if;
  if coalesce(trim(p_note), '') = '' then raise exception 'note_required'; end if;
  select coalesce(sum(m.inv_amount), 0) - coalesce(sum(round(m.basis * m.po_price)), 0) into v_diff from pur_match_lines(p_po) m;
  update pur_orders set match_ok_at = now(), match_ok_by = auth.uid(), match_ok_note = left(trim(p_note), 300), match_ok_diff = v_diff where id = p_po and company_id = lab_company();
end $$;
revoke execute on function pur_match_accept(uuid, boolean, text) from public, anon;
grant execute on function pur_match_accept(uuid, boolean, text) to authenticated;

create or replace function pur_match_settings_save(p_price_tol numeric, p_qty_tol numeric, p_budget_block boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 3) then raise exception 'not_allowed'; end if;
  insert into pur_settings (company_id, match_price_tol, match_qty_tol, budget_block, updated_at)
  values (lab_company(), least(greatest(coalesce(p_price_tol, 2), 0), 100), greatest(coalesce(p_qty_tol, 0), 0), coalesce(p_budget_block, true), now())
  on conflict (company_id) do update set match_price_tol = excluded.match_price_tol, match_qty_tol = excluded.match_qty_tol, budget_block = excluded.budget_block, updated_at = now();
end $$;
revoke execute on function pur_match_settings_save(numeric, numeric, boolean) from public, anon;
grant execute on function pur_match_settings_save(numeric, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- RAPORLAR
-- ---------------------------------------------------------------------
create or replace function pur_report(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); v_out jsonb; v_m0 date := (date_trunc('month', p_to) - interval '11 months')::date;
begin
  if not (can_module('purchases') or can_module('finance')) then raise exception 'not_allowed'; end if;
  with po as (
    select o.* from pur_orders o where o.company_id = c and o.status not in ('draft', 'cancelled') and o.order_date between p_from and p_to
  ), inv as (
    select i.*, round(i.total * i.rate)::bigint * case when i.type = 'return' then -1 else 1 end t_try,
           round(i.subtotal * i.rate)::bigint * case when i.type = 'return' then -1 else 1 end n_try
      from inv_invoices i where i.company_id = c and i.direction = 'purchase' and i.status = 'posted' and i.invoice_date between p_from and p_to
  ), pl as (
    select l.*, o.order_date, o.party_id, round(l.unit_price * case when o.currency = 'TRY' then 1 else coalesce(fx_rate(o.currency, o.order_date), 1) end)::bigint price_try
      from pur_order_lines l join po o on o.id = l.order_id
  ), items as (
    select coalesce(pl.item_id::text, lower(btrim(pl.name))) k, min(pl.name) name, min(pl.unit) unit, sum(pl.qty) qty, sum(round(pl.qty * pl.price_try))::bigint total,
           round(sum(pl.qty * pl.price_try) / nullif(sum(pl.qty), 0))::bigint avg_price, min(pl.price_try) min_price, max(pl.price_try) max_price,
           (array_agg(pl.price_try order by pl.order_date, pl.id))[1] first_price, (array_agg(pl.price_try order by pl.order_date desc, pl.id))[1] last_price,
           count(distinct pl.party_id)::int suppliers, count(*)::int n
      from pl group by 1
  ), rfq as (
    select r.id,
           (select sum(q.unit_price * l.qty) from pur_rfq_quotes q join pur_rfq_lines l on l.id = q.line_id where q.supplier_row = r.awarded_supplier and q.available and q.unit_price is not null) won,
           (select avg(t.s) from (select sum(q.unit_price * l.qty) s from pur_rfq_suppliers sp join pur_rfq_quotes q on q.supplier_row = sp.id join pur_rfq_lines l on l.id = q.line_id
                                   where sp.rfq_id = r.id and sp.status = 'quoted' and sp.id <> r.awarded_supplier and q.available and q.unit_price is not null group by sp.id) t) others
      from pur_rfqs r where r.company_id = c and r.status = 'awarded' and (r.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
  )
  select jsonb_build_object(
    'kpi', jsonb_build_object(
      'po_n', (select count(*) from po),
      'po_total', (select coalesce(sum(total_try), 0) from po),
      'inv_n', (select count(*) from inv),
      'inv_total', (select coalesce(sum(t_try), 0) from inv),
      'inv_net', (select coalesce(sum(n_try), 0) from inv),
      'suppliers', (select count(distinct party_id) from po),
      'approval_hours', (select round(avg(extract(epoch from (approved_at - submitted_at)) / 3600)::numeric, 1) from po where approved_at is not null and submitted_at is not null),
      'lead_days', (select round(avg(extract(epoch from (received_at - coalesce(sent_at, approved_at))) / 86400)::numeric, 1) from po where received_at is not null and coalesce(sent_at, approved_at) is not null),
      'on_time_pct', (select round(100.0 * count(*) filter (where (received_at at time zone 'Europe/Istanbul')::date <= expected_date) / nullif(count(*), 0), 1) from po where received_at is not null and expected_date is not null),
      'late_open', (select count(*) from pur_orders where company_id = c and status in ('sent', 'partial') and expected_date < current_date),
      'req_to_po_days', (select round(avg(extract(epoch from (o.created_at - q.created_at)) / 86400)::numeric, 1)
                           from stk_request_lines l join stk_requests q on q.id = l.request_id join po o on o.id = l.po_id),
      'rfq_n', (select count(*) from rfq),
      'rfq_saving', (select coalesce(sum(greatest(round(others - won), 0)), 0)::bigint from rfq where won is not null and others is not null),
      'short_closed', (select count(*) from po where closed_short)
    ),
    'by_supplier', (select coalesce(jsonb_agg(x order by (x->>'po_total')::bigint desc), '[]') from (
        select jsonb_build_object('party_id', p.id, 'name', p.name, 'po_n', count(distinct po.id), 'po_total', coalesce(sum(po.total_try), 0),
                                  'inv_total', coalesce((select sum(t_try) from inv where inv.party_id = p.id), 0)) x
          from fin_parties p join po on po.party_id = p.id group by p.id, p.name
        union all
        select jsonb_build_object('party_id', p.id, 'name', p.name, 'po_n', 0, 'po_total', 0, 'inv_total', sum(inv.t_try))
          from inv join fin_parties p on p.id = inv.party_id where not exists (select 1 from po where po.party_id = inv.party_id) group by p.id, p.name) s),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('category_id', fc.id, 'name', coalesce(fc.name, 'Belirsiz'), 'total', t.v) order by t.v desc), '[]') from (
        select coalesce(li.category_id, fin_category(case when si.kind is not null and si.kind <> 'service' then 'stock' when si.kind = 'service' then 'exp_other' else 'exp_material' end)) cat,
               sum(round(li.net * inv.rate) * case when inv.type = 'return' then -1 else 1 end)::bigint v
          from inv join inv_lines li on li.invoice_id = inv.id left join stk_items si on si.id = li.item_id group by 1) t left join fin_categories fc on fc.id = t.cat),
    'by_item', (select coalesce(jsonb_agg(to_jsonb(it) - 'k' order by it.total desc), '[]') from (select * from items order by total desc limit 40) it),
    'price_up', (select coalesce(jsonb_agg(to_jsonb(it) - 'k' order by (it.last_price::numeric / nullif(it.first_price, 0)) desc), '[]')
                   from (select * from items where n > 1 and first_price > 0 and last_price > first_price * 1.03 order by last_price::numeric / first_price desc limit 15) it),
    'monthly', (select jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'),
                  'ordered', (select coalesce(sum(o.total_try), 0) from pur_orders o where o.company_id = c and o.status not in ('draft', 'cancelled') and date_trunc('month', o.order_date) = m),
                  'invoiced', (select coalesce(sum(round(i.total * i.rate) * case when i.type = 'return' then -1 else 1 end), 0) from inv_invoices i
                                where i.company_id = c and i.direction = 'purchase' and i.status = 'posted' and date_trunc('month', i.invoice_date) = m)) order by m)
                  from generate_series(v_m0, date_trunc('month', p_to)::date, interval '1 month') m)
  ) into v_out;
  return v_out;
end $$;
revoke execute on function pur_report(date, date) from public, anon;
grant execute on function pur_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Panel: eşleşme farkı, siparişsiz fatura ve bu ayın bütçesi eklendi
-- ---------------------------------------------------------------------
create or replace function pur_dashboard() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); d date := (now() at time zone 'Europe/Istanbul')::date; r jsonb; v_extra jsonb := '{}'::jsonb;
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
  if can_module('purchases') or can_module('finance') then
    select jsonb_build_object(
      'match_diff', (select count(*) from pur_match_list(120) m where m.match = 'diff'),
      'inv_unlinked', (select count(*) from pur_unlinked_invoices(90)),
      'budget', (select jsonb_build_object('budget', coalesce(sum(b.amount), 0)) from pur_budgets b where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int),
      'budget_used', (select jsonb_build_object('actual', coalesce(sum(u.actual), 0), 'committed', coalesce(sum(u.committed), 0))
                        from pur_budget_rows(extract(year from d)::int) u where u.month = extract(month from d)::int
                         and u.category_id in (select b.category_id from pur_budgets b where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int)),
      'budget_over', (select count(*) from (select b.category_id from pur_budgets b
                        left join pur_budget_rows(extract(year from d)::int) u on u.category_id = b.category_id and u.month = b.month
                        where b.company_id = c and b.year = extract(year from d)::int and b.month = extract(month from d)::int and coalesce(u.actual, 0) + coalesce(u.committed, 0) > b.amount) z)
    ) into v_extra;
  end if;
  return r || v_extra;
end $$;
revoke execute on function pur_dashboard() from public, anon;
grant execute on function pur_dashboard() to authenticated;

notify pgrst, 'reload schema';
