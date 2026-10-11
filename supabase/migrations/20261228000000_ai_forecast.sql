-- =====================================================================
-- TALEP TAHMİNİ VE KÖK NEDEN SİNYALLERİ
--  dmd_product_forecast(ay)  : ürün bazında aylık teslim edilen ünit geçmişi (12 ay) ve gelecek ay tahmini
--                              (ağırlıklı hareketli ortalama × geçen yılın aynı ayı mevsim katsayısı)
--  dmd_material_forecast(ay) : malzeme bazında aylık tüketim tahmini, eldeki stok, yoldaki sipariş, kaç gün yeter, önerilen alım
--  prd_remake_signals(gün)   : yeniden yapımlarda olağan dışı kümeler (neden × istasyon / teknisyen / ürün / lot / hekim)
-- Tekrar çalıştırılabilir. Önce 20261227000000_quality_crm.sql.
-- =====================================================================

create or replace function dmd_month_weights(p_hist numeric[]) returns numeric language sql immutable as $$
  -- p_hist: en eskiden en yeniye 12 ay; son 3 aya 0.2 / 0.3 / 0.5 ağırlık
  select case when coalesce(array_length(p_hist, 1), 0) < 3 then coalesce((select avg(x) from unnest(p_hist) x), 0)
    else 0.2 * p_hist[array_length(p_hist, 1) - 2] + 0.3 * p_hist[array_length(p_hist, 1) - 1] + 0.5 * p_hist[array_length(p_hist, 1)] end;
$$;

create or replace function dmd_product_forecast(p_ahead int default 1)
returns table (product_id uuid, product text, hist numeric[], forecast numeric, trend_pct int)
language sql stable security definer set search_path = public as $$
  with months as (select (date_trunc('month', current_date) - (g || ' month')::interval)::date m from generate_series(1, 12) g),
  sold as (
    select i.product_id, date_trunc('month', j.delivered_at at time zone 'Europe/Istanbul')::date m, sum(i.qty) q
    from job_items i join jobs j on j.id = i.job_id
    where j.status = 'delivered' and j.delivered_at >= date_trunc('month', current_date) - interval '24 months' and i.product_id is not null and i.kind is distinct from 'adjust'
    group by 1, 2
  ),
  h as (
    select p.id, p.name,
      array_agg(coalesce(s.q, 0) order by mo.m) hist,
      (select coalesce(sum(q), 0) from sold x where x.product_id = p.id and x.m = (date_trunc('month', current_date) - interval '12 months' + make_interval(months => p_ahead - 1))::date) ly_same,
      (select coalesce(avg(q), 0) from sold x where x.product_id = p.id and x.m between (date_trunc('month', current_date) - interval '24 months')::date and (date_trunc('month', current_date) - interval '13 months')::date) ly_avg
    from lab_products p cross join months mo left join sold s on s.product_id = p.id and s.m = mo.m
    where p.is_active
    group by p.id, p.name
  )
  select id, name, hist,
    round(dmd_month_weights(hist) * case when ly_avg > 0 and ly_same > 0 then least(1.6, greatest(0.6, ly_same / ly_avg)) else 1 end, 1),
    case when (hist[9] + hist[10] + hist[11]) > 0 then round(100.0 * ((hist[10] + hist[11] + hist[12]) - (hist[7] + hist[8] + hist[9])) / nullif(hist[7] + hist[8] + hist[9], 0))::int end
  from h
  where (select sum(x) from unnest(hist) x) > 0 and (can_module('production') or can_logistics() or can_module('sales') or can_module('stock'))
  order by 4 desc;
$$;
revoke execute on function dmd_product_forecast(int) from public, anon;
grant execute on function dmd_product_forecast(int) to authenticated;

create or replace function dmd_material_forecast(p_lead_days int default 14)
returns table (item_id uuid, code text, item text, unit text, supplier_party_id uuid, hist numeric[], monthly numeric, daily numeric, stock numeric, on_order numeric, cover_days int, suggest numeric, min_qty numeric)
language sql stable security definer set search_path = public as $$
  with months as (select (date_trunc('month', current_date) - (g || ' month')::interval)::date m from generate_series(1, 6) g),
  used as (
    select m.item_id, date_trunc('month', m.move_date)::date mo, -sum(m.qty) q
    from stk_moves m where m.kind in ('consume', 'sale') and m.qty < 0 and m.move_date >= date_trunc('month', current_date) - interval '6 months' and m.move_date < date_trunc('month', current_date)
    group by 1, 2
  ),
  h as (
    select i.id, i.code, i.name, i.unit, i.supplier_party_id, coalesce(i.min_qty, 0) min_qty,
      array_agg(coalesce(u.q, 0) order by mo.m) hist
    from stk_items i cross join months mo left join used u on u.item_id = i.id and u.mo = mo.m
    where i.is_active and i.kind in ('material', 'raw', 'consumable', 'packaging', 'goods')
    group by i.id
  ),
  f as (
    select h.*, round(dmd_month_weights(hist), 2) monthly,
      coalesce((select sum(qty) from stk_moves sm where sm.item_id = h.id), 0) stock,
      coalesce((select sum(l.qty - l.received_qty) from pur_order_lines l join pur_orders o on o.id = l.order_id where l.item_id = h.id and o.status in ('approved', 'sent', 'partial', 'pending')), 0) on_order
    from h where (select sum(x) from unnest(hist) x) > 0
  )
  select id, code, name, unit, supplier_party_id, hist, monthly, round(monthly / 30.0, 3), round(stock, 3), round(on_order, 3),
    case when monthly > 0 then floor(greatest(stock, 0) / (monthly / 30.0))::int end,
    greatest(0, ceil(monthly * (coalesce(p_lead_days, 14) + 30) / 30.0 + min_qty - stock - on_order)),
    min_qty
  from f
  where can_module('stock') or can_module('purchases') or can_module('production')
  order by case when monthly > 0 then greatest(stock, 0) / (monthly / 30.0) end nulls last;
$$;
revoke execute on function dmd_material_forecast(int) from public, anon;
grant execute on function dmd_material_forecast(int) to authenticated;

-- Yeniden yapım sinyalleri: bir boyuttaki oran genel oranın 2 katından fazla ve en az 3 olay
create or replace function prd_remake_signals(p_days int default 90)
returns table (dimension text, label text, remakes int, base int, rate numeric, overall numeric, top_reason text)
language sql stable security definer set search_path = public as $$
  with jobs_p as (
    select j.id, j.customer_id, (select e.id from employees e where e.id = j.holder_employee_id) holder
    from jobs j where j.created_at >= now() - make_interval(days => p_days) and j.status <> 'cancelled'
  ),
  r as (select rm.*, j.customer_id from prd_remakes rm join jobs j on j.id = rm.job_id where rm.created_at >= now() - make_interval(days => p_days)),
  tot as (select greatest(1, (select count(*) from jobs_p)) n, (select count(distinct job_id) from r) k),
  dims as (
    -- teknisyen (hatanın kaynağı olarak işaretlenen)
    select 'Teknisyen'::text d, coalesce(e.first_name || ' ' || e.last_name, '—') l, count(distinct r.job_id)::int k,
      greatest(1, (select count(distinct h.job_id) from job_handoffs h where h.employee_id = r.employee_id and h.action = 'done' and h.at >= now() - make_interval(days => p_days)))::int b,
      mode() within group (order by r.reason) tr
    from r left join employees e on e.id = r.employee_id where r.employee_id is not null group by r.employee_id, e.first_name, e.last_name
    union all
    select 'İstasyon', coalesce(s.name, '—'), count(distinct r.job_id)::int,
      greatest(1, (select count(distinct o.job_id) from prd_job_ops o where o.station_id = r.station_id and o.created_at >= now() - make_interval(days => p_days)))::int,
      mode() within group (order by r.reason)
    from r left join prd_stations s on s.id = r.station_id where r.station_id is not null group by r.station_id, s.name
    union all
    select 'Hekim', coalesce(c.name, '—'), count(distinct r.job_id)::int,
      greatest(1, (select count(*) from jobs_p jp where jp.customer_id = r.customer_id))::int,
      mode() within group (order by r.reason)
    from r left join lab_customers c on c.id = r.customer_id where r.customer_id is not null group by r.customer_id, c.name
    union all
    select 'Ürün', p.name, count(distinct r.job_id)::int,
      greatest(1, (select count(distinct i2.job_id) from job_items i2 join jobs_p jp on jp.id = i2.job_id where i2.product_id = p.id))::int,
      mode() within group (order by r.reason)
    from r join job_items i on i.job_id = r.job_id join lab_products p on p.id = i.product_id group by p.id, p.name
    union all
    select 'Malzeme lotu', it.name || ' / ' || m.lot_no, count(distinct r.job_id)::int,
      greatest(1, (select count(distinct m2.job_id) from prd_job_materials m2 where m2.item_id = m.item_id and m2.lot_no = m.lot_no))::int,
      mode() within group (order by r.reason)
    from r join prd_job_materials m on m.job_id = r.job_id and m.lot_no is not null join stk_items it on it.id = m.item_id group by m.item_id, m.lot_no, it.name
  )
  select d, l, k, b, round(100.0 * k / b, 1), round(100.0 * (select k from tot) / (select n from tot), 1), tr
  from dims
  where (can_module('production') or can_logistics()) and k >= 2 and (100.0 * k / b) >= 2 * (100.0 * (select k from tot) / (select n from tot))
  order by (100.0 * k / b) / greatest(0.1, 100.0 * (select k from tot) / (select n from tot)) desc
  limit 20;
$$;
revoke execute on function prd_remake_signals(int) from public, anon;
grant execute on function prd_remake_signals(int) to authenticated;

notify pgrst, 'reload schema';
