-- Dentalsis kontrol raporu: "Dentalsis'te açık" tanımı eşitlemeyle aynı (BİTİM + teslim değilse açık); iptal edilen ERP işleri
-- "çıkmış" sayılmaz; "Kalan iş (ERP)" yalnız Dentalsis listesinde olan işleri sayar, listede olmayan açık işler ayrı gösterilir.
-- Tekrar çalıştırılabilir. Önce 20270290000000_dsis_audit_split.sql.

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
    'erp_open', (select count(*) from _dsis_ej e where e.status in ('open', 'tryin', 'ready') and exists (select 1 from _dsis_rj r where r.id = e.legacy_id)),
    'erp_open_only', (select count(*) from _dsis_ej e where e.status in ('open', 'tryin', 'ready') and not exists (select 1 from _dsis_rj r where r.id = e.legacy_id)),
    'missing', (select count(*) from _dsis_rj r where not exists (select 1 from _dsis_ej e where e.legacy_id = r.id)),
    'missing_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'cari', cariad, 'hasta', hasta, 'tarih', left(tarih1, 10), 'prova', provaturu)), '[]')
        from (select * from _dsis_rj r where not exists (select 1 from _dsis_ej e where e.legacy_id = r.id) order by id desc limit 100) x),
    'should_close', (select count(*) from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id where r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1' and e.status in ('open', 'tryin', 'ready')),
    'should_close_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select r.id, r.no, r.cariad, r.hasta, e.status from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id
        where r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1' and e.status in ('open', 'tryin', 'ready') order by r.id desc limit 100) x),
    'should_open', (select count(*) from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id where not (r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1') and e.status = 'delivered'),
    'should_open_list', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from (select r.id, r.no, r.cariad, r.hasta, r.provaturu, e.status from _dsis_rj r join _dsis_ej e on e.legacy_id = r.id
        where not (r.provaturu = 'BİTİM' and coalesce(r.teslim, '1') = '1') and e.status = 'delivered' order by r.id desc limit 100) x),
    'erp_only', (select count(*) from _dsis_ej e where e.in_date >= v_from and e.status <> 'cancelled' and not exists (select 1 from _dsis_rj r where r.id = e.legacy_id)),
    'erp_only_list', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'no', no, 'legacy_id', legacy_id, 'patient', patient, 'status', status)), '[]')
        from (select * from _dsis_ej e where e.in_date >= v_from and e.status <> 'cancelled' and not exists (select 1 from _dsis_rj r where r.id = e.legacy_id) order by legacy_id desc limit 100) x)
  ) into v;
  return v;
end $$;

grant execute on function dsis_audit_jobs() to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dsis_audit_jobs() to service_role; end if; end $$;
notify pgrst, 'reload schema';
