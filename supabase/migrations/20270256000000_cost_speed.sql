-- Hız: "canceling statement due to statement timeout" düzeltmesi
-- 1) pc_unit_cost her ürün için job_items'ı baştan sona tarıyordu (parça başı kaydı olmasa bile).
--    Artık parça başı kaydı yoksa hemen 0 döner; ürün indeksi eklendi.
-- 2) Müşteri kârlılığı yalnız satılan / fiyatı olan ürünlerin maliyetini hesaplar (tüm ürün listesi yerine).

create index if not exists job_items_product_idx on job_items (product_id) where product_id is not null;
do $$ begin
  if to_regclass('public.pc_entries') is not null then
    create index if not exists pc_entries_product_status_idx on pc_entries (lab_product_id, work_date) where status in ('approved', 'posted');
  end if;
end $$;

create or replace function pc_unit_cost(p_product uuid) returns bigint
language plpgsql stable security definer set search_path = public as $$
declare v_amt bigint; v_q numeric; v_made bigint;
begin
  select coalesce(sum(amount), 0), coalesce(sum(qty), 0) into v_amt, v_q from pc_entries
   where lab_product_id = p_product and status in ('approved', 'posted') and work_date >= current_date - 90;
  if v_amt = 0 then return 0; end if;
  select coalesce(sum(i.qty), 0) into v_made from job_items i join jobs j on j.id = i.job_id
   where i.product_id = p_product and j.status <> 'cancelled' and j.in_date >= current_date - 90;
  return round(v_amt::numeric / greatest(v_made, v_q, 1))::bigint;
end $$;

create or replace function prd_customer_margin(p_from date default (current_date - interval '12 months')::date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); v jsonb; v_sales jsonb; v_prices jsonb;
begin
  if not (prd_cost_can() or has_role(c, array['owner', 'accountant']::app_role[])) then raise exception 'not_allowed'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('c', s.customer_id, 'p', s.product_id, 'cur', s.cur, 'q', s.q, 'r', s.r, 'last', s.last)), '[]'::jsonb) into v_sales
    from (select j.customer_id, i.product_id, upper(j.currency) as cur, sum(i.qty)::int as q, sum(i.amount)::bigint as r, max(j.in_date) as last
            from jobs j
            join job_items i on i.job_id = j.id
           where j.company_id = c and j.in_date >= p_from and j.status <> 'cancelled' and j.customer_id is not null
             and i.product_id is not null and i.kind = 'paid' and i.amount > 0 and coalesce(j.patient, '') <> 'DEVİR BAKİYESİ'
           group by 1, 2, 3) s;
  select coalesce(jsonb_agg(jsonb_build_object('c', p.customer_id, 'p', p.product_id, 't', p.price_try, 'e', p.price_eur)), '[]'::jsonb) into v_prices
    from lab_customer_prices p join lab_customers lc on lc.id = p.customer_id and lc.company_id = c;
  select jsonb_build_object(
    'eur', coalesce(fx_rate('EUR', current_date), 0),
    'usd', coalesce(fx_rate('USD', current_date), 0),
    'customers', coalesce((select jsonb_agg(jsonb_build_object('id', lc.id, 'name', lc.name, 'kind', lc.kind, 'cur', lc.currency, 'city', lc.city))
                             from lab_customers lc where lc.company_id = c), '[]'::jsonb),
    'prices', v_prices, 'sales', v_sales
  ) into v;
  return v;
end $$;
revoke execute on function prd_customer_margin(date) from public, anon;
grant execute on function prd_customer_margin(date) to authenticated;

-- Seçilen ürünlerin maliyeti (uygulama 40'arlı parçalar halinde çağırır; her çağrı kendi süresiyle)
create or replace function prd_cost_for(p_ids uuid[]) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not (prd_cost_can() or has_role(lab_company(), array['owner', 'accountant']::app_role[])) then raise exception 'not_allowed'; end if;
  select coalesce(jsonb_object_agg(x.id, jsonb_build_object('total', (x.cc->>'total')::bigint, 'production', (x.cc->>'production')::bigint)), '{}'::jsonb) into v
    from (select p.id, prd_cost_core(p.id) as cc
            from lab_products p
           where p.id = any (p_ids) and (p.company_id = lab_company() or p.company_id is null)
             and (exists (select 1 from stk_boms b where b.lab_product_id = p.id) or exists (select 1 from prd_route_steps r where r.lab_product_id = p.id))) x;
  return v;
end $$;
revoke execute on function prd_cost_for(uuid[]) from public, anon;
grant execute on function prd_cost_for(uuid[]) to authenticated;

notify pgrst, 'reload schema';
