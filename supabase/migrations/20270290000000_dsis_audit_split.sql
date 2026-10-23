-- Dentalsis kontrol raporu üç ayrı parçada (cariler, bakiyeler, işler): her parça kendi süre sınırı içinde çalışır;
-- biri yavaşlarsa diğerleri yine görünür. Sonuç sayfa açılışında yeniden hesaplanmaz, taramadan sonra saklanır.
-- Tekrar çalıştırılabilir. Önce 20270285000000_dsis_audit.sql.

create index if not exists dsis_remote_jobs_prova_idx on dsis_remote_jobs (provaturu);
create index if not exists jobs_company_legacy_idx on jobs (company_id, legacy_id) where legacy_id > 0;

create or replace function dsis_audit_cust() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v jsonb;
begin
  select jsonb_build_object(
    'remote', (select count(*) from dsis_remote_cari),
    'linked', (select count(*) from dsis_remote_cari rc where exists (select 1 from lab_customers lc where lc.company_id = c and lc.legacy_id = rc.id)),
    'missing', (select count(*) from dsis_remote_cari rc where not exists (select 1 from lab_customers lc where lc.company_id = c and lc.legacy_id = rc.id)),
    'missing_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from (
        select rc.id, rc.name from dsis_remote_cari rc where not exists (select 1 from lab_customers lc where lc.company_id = c and lc.legacy_id = rc.id) order by rc.name limit 100) x),
    'name_diff', (select coalesce(jsonb_agg(jsonb_build_object('id', rc.id, 'remote', rc.name, 'erp', lc.name)), '[]') from dsis_remote_cari rc
        join lab_customers lc on lc.company_id = c and lc.legacy_id = rc.id where dsis_norm(rc.name) <> dsis_norm(lc.name)),
    'erp_only', (select coalesce(jsonb_agg(jsonb_build_object('id', lc.id, 'name', lc.name) order by lc.name), '[]') from lab_customers lc
        where lc.company_id = c and lc.legacy_id > 0 and not exists (select 1 from dsis_remote_cari rc where rc.id = lc.legacy_id)),
    'cari_at', (select max(seen_at) from dsis_remote_cari)
  ) into v;
  return v;
end $$;

create or replace function dsis_audit_bal() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v jsonb;
begin
  create temp table if not exists _dsis_bal (cust uuid, name text, currency text, remote bigint, erp bigint) on commit drop;
  truncate _dsis_bal;
  insert into _dsis_bal
  select lc.id, coalesce(lc.name, rc.name), lc.currency,
         round(case lc.currency when 'EUR' then coalesce(rc.eur, 0) when 'USD' then coalesce(rc.usd, 0) else coalesce(rc.tl, 0) end * 100)::bigint,
         (coalesce(js.t, 0) - case when lc.internal_book then coalesce(ps.ti, 0) else coalesce(ps.t, 0) end
            + case when lc.internal_book then coalesce(lc.internal_opening, 0) else 0 end)::bigint
    from dsis_remote_cari rc
    join lab_customers lc on lc.company_id = c and lc.legacy_id = rc.id
    left join lateral (select sum(total) as t from jobs j where j.customer_id = lc.id and j.status = 'delivered') js on true
    left join lateral (select sum(amount) as t, sum(amount) filter (where book in ('internal', 'both')) as ti from lab_payments p where p.customer_id = lc.id) ps on true;
  select jsonb_build_object(
    'checked', (select count(*) from _dsis_bal),
    'mismatch', (select count(*) from _dsis_bal where remote <> erp),
    'list', (select coalesce(jsonb_agg(jsonb_build_object('id', cust, 'name', name, 'currency', currency, 'remote', remote, 'erp', erp, 'diff', erp - remote) order by abs(erp - remote) desc), '[]')
               from (select * from _dsis_bal where remote <> erp order by abs(erp - remote) desc limit 200) x)
  ) into v;
  return v;
end $$;

create or replace function dsis_audit_jobs() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v jsonb; v_from date;
begin
  create temp table if not exists _dsis_rj (id bigint primary key, no bigint, cariad text, hasta text, provaturu text, teslim text, tarih1 text, tarih2 text) on commit drop;
  create temp table if not exists _dsis_ej (legacy_id bigint primary key, id uuid, no bigint, status text, patient text, in_date date) on commit drop;
  truncate _dsis_rj; truncate _dsis_ej;
  insert into _dsis_rj select id, no, cariad, hasta, provaturu, teslim, tarih1, tarih2 from dsis_remote_jobs where coalesce(durum, '1') = '1' on conflict do nothing;
  insert into _dsis_ej select distinct on (legacy_id) legacy_id, id, no, status, patient, in_date from jobs where company_id = c and legacy_id > 0 order by legacy_id, created_at on conflict do nothing;
  analyze _dsis_rj; analyze _dsis_ej;
  select coalesce(min(left(tarih1, 10))::date, date '2026-01-01') into v_from from _dsis_rj where tarih1 ~ '^\d{4}-\d{2}-\d{2}';
  select jsonb_build_object(
    'scanned_at', (select max(seen_at) from dsis_remote_jobs),
    'remote', (select count(*) from _dsis_rj),
    'remote_open', (select count(*) from _dsis_rj where coalesce(provaturu, '') <> 'BİTİM' or coalesce(teslim, '1') <> '1'),
    'erp_open', (select count(*) from _dsis_ej where status in ('open', 'tryin', 'ready')),
    'missing', (select count(*) from _dsis_rj r where not exists (select 1 from _dsis_ej e where e.legacy_id = r.id)),
    'missing_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'cari', cariad, 'hasta', hasta, 'tarih', left(tarih1, 10), 'prova', provaturu)), '[]')
        from (select * from _dsis_rj r where not exists (select 1 from _dsis_ej e where e.legacy_id = r.id) order by id desc limit 100) x),
    'should_close', (select count(*) from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id where r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1' and e.status in ('open', 'tryin', 'ready')),
    'should_close_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select r.id, r.no, r.cariad, r.hasta, e.status from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id
        where r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1' and e.status in ('open', 'tryin', 'ready') order by r.id desc limit 100) x),
    'should_open', (select count(*) from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id where coalesce(r.provaturu, '') <> 'BİTİM' and e.status in ('delivered', 'cancelled')),
    'should_open_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select r.id, r.no, r.cariad, r.hasta, r.provaturu, e.status from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id
        where coalesce(r.provaturu, '') <> 'BİTİM' and e.status in ('delivered', 'cancelled') order by r.id desc limit 100) x),
    'erp_only', (select count(*) from _dsis_ej e where e.in_date >= v_from and e.status <> 'cancelled' and not exists (select 1 from _dsis_rj r where r.id = e.legacy_id)),
    'erp_only_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'legacy_id', legacy_id, 'patient', patient, 'status', status)), '[]')
        from (select * from _dsis_ej e where e.in_date >= v_from and e.status <> 'cancelled' and not exists (select 1 from _dsis_rj r where r.id = e.legacy_id) order by legacy_id desc limit 100) x)
  ) into v;
  return v;
end $$;

do $$ declare f text; begin
  foreach f in array array['dsis_audit_cust()', 'dsis_audit_bal()', 'dsis_audit_jobs()'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f); end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
