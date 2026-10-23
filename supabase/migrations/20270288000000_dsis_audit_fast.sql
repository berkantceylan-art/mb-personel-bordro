-- Dentalsis kontrol raporu: zaman aşımına düşmesin (bakiyeler toplu hesaplanır, ara sonuçlar bir kez üretilir)
-- Tekrar çalıştırılabilir. Önce 20270285000000_dsis_audit.sql.

-- Karşılaştırma raporu (Dentalsis'ten okunan son listeye göre)
create or replace function dsis_audit_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v jsonb;
begin
  with rc as materialized (select * from dsis_remote_cari),
  lc as materialized (select * from lab_customers where company_id = c),
  js as materialized (select customer_id, sum(total) as t from jobs where company_id = c and status = 'delivered' group by customer_id),
  ps as materialized (select customer_id, sum(amount) as t, sum(amount) filter (where book in ('internal', 'both')) as ti from lab_payments group by customer_id),
  bal as materialized (
    select rc.id, coalesce(lc.name, rc.name) as name, lc.id as cust, lc.currency,
           round(case lc.currency when 'EUR' then coalesce(rc.eur, 0) when 'USD' then coalesce(rc.usd, 0) else coalesce(rc.tl, 0) end * 100)::bigint as remote,
           (coalesce(js.t, 0) - case when lc.internal_book then coalesce(ps.ti, 0) else coalesce(ps.t, 0) end
              + case when lc.internal_book then coalesce(lc.internal_opening, 0) else 0 end)::bigint as erp
      from rc join lc on lc.legacy_id = rc.id left join js on js.customer_id = lc.id left join ps on ps.customer_id = lc.id
  ),
  rj as materialized (select * from dsis_remote_jobs where coalesce(durum, '1') = '1'),
  ej as materialized (select id, no, legacy_id, status, customer_id, patient, in_date from jobs where company_id = c and legacy_id > 0),
  r0 as materialized (select coalesce(min(left(tarih1, 10))::date, date '2026-01-01') as d from dsis_remote_jobs where tarih1 ~ '^\d{4}-\d{2}-\d{2}'),
  miss as materialized (select rj.* from rj left join ej on ej.legacy_id = rj.id where ej.id is null),
  st_open as materialized (select rj.id, rj.no, rj.cariad, rj.hasta, rj.tarih2, ej.status from rj join ej on ej.legacy_id = rj.id
               where rj.provaturu = 'BİTİM' and coalesce(rj.teslim, '1') = '1' and ej.status in ('open', 'tryin', 'ready')),
  st_closed as materialized (select rj.id, rj.no, rj.cariad, rj.hasta, rj.provaturu, ej.status from rj join ej on ej.legacy_id = rj.id
               where coalesce(rj.provaturu, '') <> 'BİTİM' and ej.status in ('delivered', 'cancelled')),
  erp_only as materialized (select ej.* from ej left join rj r on r.id = ej.legacy_id
               where r.id is null and ej.in_date >= (select d from r0) and ej.status <> 'cancelled')
  select jsonb_build_object(
    'scanned_at', (select max(seen_at) from dsis_remote_jobs),
    'cari_at', (select max(seen_at) from dsis_remote_cari),
    'customers', jsonb_build_object(
      'remote', (select count(*) from rc),
      'linked', (select count(*) from rc join lc on lc.legacy_id = rc.id),
      'missing', (select count(*) from rc where not exists (select 1 from lc where lc.legacy_id = rc.id)),
      'missing_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from (select rc.id, rc.name from rc where not exists (select 1 from lc where lc.legacy_id = rc.id) order by rc.name limit 100) x),
      'name_diff', (select coalesce(jsonb_agg(jsonb_build_object('id', rc.id, 'remote', rc.name, 'erp', lc.name)), '[]') from rc join lc on lc.legacy_id = rc.id where dsis_norm(rc.name) <> dsis_norm(lc.name)),
      'erp_only', (select coalesce(jsonb_agg(jsonb_build_object('id', lc.id, 'name', lc.name) order by lc.name), '[]') from lc where lc.legacy_id is not null and lc.legacy_id > 0 and not exists (select 1 from rc where rc.id = lc.legacy_id))
    ),
    'balances', jsonb_build_object(
      'checked', (select count(*) from bal),
      'mismatch', (select count(*) from bal where remote <> erp),
      'list', (select coalesce(jsonb_agg(jsonb_build_object('id', cust, 'name', name, 'currency', currency, 'remote', remote, 'erp', erp, 'diff', erp - remote) order by abs(erp - remote) desc), '[]')
                 from (select * from bal where remote <> erp order by abs(erp - remote) desc limit 200) x)
    ),
    'jobs', jsonb_build_object(
      'remote', (select count(*) from rj),
      'remote_open', (select count(*) from rj where coalesce(provaturu, '') <> 'BİTİM' or coalesce(teslim, '1') <> '1'),
      'erp_open', (select count(*) from ej where status in ('open', 'tryin', 'ready')),
      'missing', (select count(*) from miss),
      'missing_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'cari', cariad, 'hasta', hasta, 'tarih', left(tarih1, 10), 'prova', provaturu)), '[]') from (select * from miss order by id desc limit 100) x),
      'should_close', (select count(*) from st_open),
      'should_close_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from st_open order by id desc limit 100) x),
      'should_open', (select count(*) from st_closed),
      'should_open_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select * from st_closed order by id desc limit 100) x),
      'erp_only', (select count(*) from erp_only),
      'erp_only_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'legacy_id', legacy_id, 'patient', patient, 'status', status)), '[]') from (select * from erp_only order by legacy_id desc limit 100) x)
    )
  ) into v;
  return v;
end $$;
revoke execute on function dsis_audit_report() from public, anon;
grant execute on function dsis_audit_report() to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dsis_audit_report() to service_role; end if; end $$;
create index if not exists jobs_customer_status_idx on jobs (customer_id, status);
notify pgrst, 'reload schema';
