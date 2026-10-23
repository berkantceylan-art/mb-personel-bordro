-- Dentalsis aktarma › Ciro analizi: zaman aşımına düşmesin diye kur her gün ve para birimi için bir kez hesaplanır
-- (önceden her iş için üç kez kur aranıyordu). Tekrar çalıştırılabilir.

create or replace function dsis_revenue_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  with j as materialized (
    select jb.currency, jb.total, lab_day(jb.delivered_at) as d, jb.customer_id
      from jobs jb where jb.company_id = lab_company() and jb.legacy_id > 0 and jb.status = 'delivered'
  ),
  r as materialized (
    select currency, d, case when currency = 'TRY' then 1 else coalesce(fx_rate(currency, d), 0) end as rate from (select distinct currency, d from j) x
  ),
  jj as materialized (
    select j.*, round(j.total * r.rate)::bigint as tr from j join r on r.currency = j.currency and r.d is not distinct from j.d
  )
  select case when has_role(lab_company(), array['owner']::app_role[]) then jsonb_build_object(
    'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'jobs', n, 'total', t, 'try', tr) order by currency), '[]') from (
        select currency, count(*) n, sum(total) t, sum(tr)::bigint tr from jj group by currency) a),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'eur', eur, 'try', tl, 'try_total', tt, 'jobs', n) order by m), '[]') from (
        select to_char(date_trunc('month', d), 'YYYY-MM') m, sum(total) filter (where currency = 'EUR') eur, sum(total) filter (where currency = 'TRY') tl, sum(tr)::bigint tt, count(*) n
          from jj group by 1) b),
    'by_market', (select coalesce(jsonb_agg(jsonb_build_object('foreign', fx, 'jobs', n, 'eur', eur, 'try', tl, 'try_total', tt)), '[]') from (
        select lab_is_foreign(lc.country, lc.kind) fx, count(*) n, sum(jj.total) filter (where jj.currency = 'EUR') eur, sum(jj.total) filter (where jj.currency = 'TRY') tl, sum(jj.tr)::bigint tt
          from jj join lab_customers lc on lc.id = jj.customer_id group by 1) k),
    'open', (select count(*) from jobs where company_id = lab_company() and legacy_id > 0 and status in ('open', 'tryin', 'ready')),
    'mismatch', (select count(*) from jobs jb join lab_customers lc on lc.id = jb.customer_id where jb.company_id = lab_company() and jb.legacy_id > 0 and jb.currency <> lc.currency),
    'fx_first', (select min(rate_date) from fx_rates where currency = 'EUR'),
    'fx_days_2026', (select count(*) from fx_rates where currency = 'EUR' and rate_date >= date '2026-01-01'),
    'products', (select count(*) from lab_products where company_id = lab_company() and is_active),
    'products_tr', (select count(*) from lab_products where company_id = lab_company() and is_active and name_tr is not null),
    'products_stock', (select count(*) from lab_products p where p.company_id = lab_company() and p.is_active and exists (select 1 from stk_items s where s.lab_product_id = p.id))
  ) end
$$;
revoke execute on function dsis_revenue_summary() from public, anon;
grant execute on function dsis_revenue_summary() to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dsis_revenue_summary() to service_role; end if; end $$;

notify pgrst, 'reload schema';
