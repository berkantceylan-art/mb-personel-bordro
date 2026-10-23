-- =====================================================================
-- Dentalsis ↔ ERP denetimi ve bakiye eşitlemenin hızlandırılması
--  1) dsis_remote_cari / dsis_remote_jobs: Dentalsis'ten okunan cari, bakiye ve 2026 iş listesi (karşılaştırma için)
--  2) dsis_import_balance: zaman aşımına düşmeyecek şekilde yeniden yazıldı (hekim adları tek seferde eşlenir,
--     devir kaydı her turda silinip yeniden açılmaz: tutar değişmediyse dokunulmaz, değiştiyse aynı iş numarasıyla yenilenir)
--  3) dsis_erp_balance(hekim): ERP'deki hekim bakiyesi (teslim edilen işler − tahsilat, iç defter açılışı dahil)
--  4) dsis_audit_report(): cari, bakiye ve iş karşılaştırma raporu
-- Tekrar çalıştırılabilir. Önce 20270277000000_dsis_auto_sync.sql.
-- =====================================================================

create table if not exists dsis_remote_cari (
  id bigint primary key,
  name text,
  tl numeric, eur numeric, usd numeric,
  raw jsonb,
  seen_at timestamptz not null default now()
);
create table if not exists dsis_remote_jobs (
  id bigint primary key,
  no bigint,
  cariid bigint,
  cariad text,
  hasta text,
  provaturu text,
  teslim text,
  tarih1 text,
  tarih2 text,
  durum text,
  seen_at timestamptz not null default now()
);
alter table dsis_remote_cari enable row level security;
alter table dsis_remote_jobs enable row level security;
revoke all on dsis_remote_cari, dsis_remote_jobs from anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on dsis_remote_cari, dsis_remote_jobs to service_role; end if; end $$;

create index if not exists jobs_legacy_id_idx on jobs (legacy_id);
create index if not exists lab_customers_legacy_idx on lab_customers (company_id, legacy_id);
create index if not exists lab_payments_legacy_ref_idx on lab_payments (legacy_ref);
create index if not exists lab_payments_customer_idx on lab_payments (customer_id);

-- ERP bakiyesi (hekimin para biriminde, kuruş)
create or replace function dsis_erp_balance(p_cust uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce((select sum(total) from jobs where customer_id = lc.id and status = 'delivered'), 0)
       - coalesce((select sum(amount) from lab_payments where customer_id = lc.id and (not lc.internal_book or book in ('internal', 'both'))), 0)
       + case when lc.internal_book then coalesce(lc.internal_opening, 0) else 0 end
  from lab_customers lc where lc.id = p_cust
$$;

drop function if exists dsis_import_balance(jsonb, jsonb, date);
create or replace function dsis_import_balance(p_tahsilat jsonb, p_balances jsonb, p_as_of date default current_date, p_pay boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); r jsonb; v_cust lab_customers; v_cid uuid; v_amt numeric; v_ref text; v_key text; v_k int; v_seen jsonb := '{}'; v_note text;
  n_pay int := 0; n_adj int := 0; n_same int := 0; n_miss int := 0; v_target bigint; v_now bigint; v_diff bigint; v_oth numeric; v_mis numeric;
  v_map jsonb; v_cur jsonb := '{}'; v_misMap jsonb := '{}'; missing text[] := '{}';
  v_devir jobs; v_adj lab_payments; v_no bigint;
begin
  perform set_config('app.skip_audit', 'on', true);
  -- hekim adı → kimlik (bir kez)
  select coalesce(jsonb_object_agg(n, jsonb_build_object('id', id, 'cur', currency)), '{}') into v_map from (
    select distinct on (dsis_norm(name)) dsis_norm(name) as n, id, currency from lab_customers where company_id = c order by dsis_norm(name), (legacy_id is null)
  ) x;

  for r in select * from jsonb_array_elements(coalesce(p_tahsilat, '[]')) loop
    v_amt := coalesce((r->>'tutar')::numeric, 0);
    if v_amt <= 0 or upper(coalesce(r->>'aciklama', '')) like '%DEVİR%' or upper(coalesce(r->>'aciklama', '')) like '%DEVIR%' then continue; end if;
    v_cid := nullif(v_map->dsis_norm(r->>'cariad')->>'id', '')::uuid;
    if v_cid is null then n_miss := n_miss + 1; missing := array_append(missing, left(r->>'cariad', 60)); continue; end if;
    -- hekimin para birimi dışında girilmiş tahsilat (bakiye adımında kullanılır)
    if dsis_cur(r->>'para_birimi') <> (v_map->dsis_norm(r->>'cariad')->>'cur') then
      v_misMap := v_misMap || jsonb_build_object(v_cid::text, coalesce((v_misMap->>v_cid::text)::numeric, 0) + v_amt);
    end if;
    if not p_pay then continue; end if;
    select * into v_cust from lab_customers where id = v_cid;
    v_note := left('Dentalsis tahsilat · ' || coalesce(nullif(trim(r->>'aciklama'), ''), ''), 500);
    v_key := concat_ws('|', v_cust.id, dsis_day(r->>'tarih'), round(v_amt * 100)::bigint, v_note);
    v_k := coalesce((v_seen->>v_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_key, v_k);
    if (select count(*) from lab_payments where customer_id = v_cust.id and paid_on = coalesce(dsis_day(r->>'tarih'), p_as_of)
          and amount = round(v_amt * 100)::bigint and note = v_note and legacy_ref like 'dsis%') >= v_k then continue; end if;
    v_ref := 'dsis2:' || md5(v_key || '#' || v_k);
    insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by, book)
    values (v_cust.id, coalesce(dsis_day(r->>'tarih'), p_as_of), round(v_amt * 100)::bigint, v_cust.currency, 'other', v_note, v_ref, null,
            case when coalesce(v_cust.no_invoice, false) then 'internal' when v_cust.internal_book then 'both' else 'official' end)
    on conflict do nothing;
    n_pay := n_pay + 1;
  end loop;

  -- Bakiye eşitleme: fark 31.12.2025 tarihli devir kaydıyla kapatılır (borç: DEVİR BAKİYESİ işi, alacak: mahsup tahsilatı)
  for r in select * from jsonb_array_elements(coalesce(p_balances, '[]')) loop
    select * into v_cust from lab_customers where company_id = c and legacy_id = (r->>'id')::bigint;
    if v_cust.id is null then continue; end if;
    select * into v_devir from jobs where legacy_id = -(r->>'id')::bigint limit 1;
    select * into v_adj from lab_payments where legacy_ref = 'dsis-adj:' || v_cust.id limit 1;
    v_target := round(case v_cust.currency when 'EUR' then coalesce((r->>'eurotutar')::numeric, 0) when 'USD' then coalesce((r->>'usdtutar')::numeric, 0) else coalesce((r->>'tltutar')::numeric, 0) end * 100)::bigint;
    v_mis := coalesce((v_misMap->>v_cust.id::text)::numeric, 0);
    if v_mis > 0 then
      v_oth := coalesce((r->>'tltutar')::numeric, 0) * (case when v_cust.currency <> 'TRY' then 1 else 0 end)
             + coalesce((r->>'eurotutar')::numeric, 0) * (case when v_cust.currency <> 'EUR' then 1 else 0 end)
             + coalesce((r->>'usdtutar')::numeric, 0) * (case when v_cust.currency <> 'USD' then 1 else 0 end);
      if v_oth = -v_mis then v_target := v_target - round(v_mis * 100)::bigint; end if;
    end if;
    -- mevcut devir / mahsup hariç ERP bakiyesi
    v_now := dsis_erp_balance(v_cust.id)
           - case when v_devir.id is not null and v_devir.status = 'delivered' then coalesce(v_devir.total, 0) else 0 end
           + case when v_adj.id is not null and (not v_cust.internal_book or v_adj.book in ('internal', 'both')) then coalesce(v_adj.amount, 0) else 0 end;
    v_diff := v_target - v_now;
    if v_diff > 0 then
      if v_adj.id is not null then delete from lab_payments where id = v_adj.id; end if;
      if v_devir.id is not null and v_devir.total = v_diff and v_devir.status = 'delivered' then n_same := n_same + 1; continue; end if;
      v_no := v_devir.no;
      if v_devir.id is not null then delete from jobs where id = v_devir.id; end if;
      insert into jobs (company_id, no, customer_id, patient, description, in_date, due_date, status, currency, total, delivered_at, flow_stage, created_by, legacy_id)
      values (c, coalesce(v_no, nextval('job_no')), v_cust.id, 'DEVİR BAKİYESİ', 'Dentalsis''teki cari bakiyeye eşitleme (2025''ten devreden bakiye ve düzeltmeler)',
              date '2025-12-31', date '2025-12-31', 'delivered', v_cust.currency, v_diff, (date '2025-12-31' + time '12:00') at time zone 'Europe/Istanbul', 'out', null, -(r->>'id')::bigint);
      n_adj := n_adj + 1;
    elsif v_diff < 0 then
      if v_devir.id is not null then delete from jobs where id = v_devir.id; end if;
      if v_adj.id is not null and v_adj.amount = -v_diff then n_same := n_same + 1; continue; end if;
      if v_adj.id is not null then delete from lab_payments where id = v_adj.id; end if;
      insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by, book)
      values (v_cust.id, date '2025-12-31', -v_diff, v_cust.currency, 'offset', 'Dentalsis bakiye eşitleme (devir alacak / düzeltme)', 'dsis-adj:' || v_cust.id, null,
              case when v_cust.internal_book then 'internal' else 'official' end);
      n_adj := n_adj + 1;
    else
      if v_devir.id is not null then delete from jobs where id = v_devir.id; n_adj := n_adj + 1; end if;
      if v_adj.id is not null then delete from lab_payments where id = v_adj.id; n_adj := n_adj + 1; end if;
      if v_devir.id is null and v_adj.id is null then n_same := n_same + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('payments', n_pay, 'adjusted', n_adj, 'unchanged', n_same, 'unmatched_payments', n_miss, 'unmatched_names', to_jsonb(missing[1:20]));
end $$;
revoke execute on function dsis_import_balance(jsonb, jsonb, date, boolean) from public, anon;
grant execute on function dsis_import_balance(jsonb, jsonb, date, boolean) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function dsis_import_balance(jsonb, jsonb, date, boolean) to service_role; end if; end $$;

-- Karşılaştırma raporu (Dentalsis'ten okunan son listeye göre)
create or replace function dsis_audit_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v jsonb;
begin
  with rc as (select * from dsis_remote_cari),
  lc as (select * from lab_customers where company_id = c),
  bal as (
    select rc.id, coalesce(lc.name, rc.name) as name, lc.id as cust, lc.currency,
           round(case lc.currency when 'EUR' then coalesce(rc.eur, 0) when 'USD' then coalesce(rc.usd, 0) else coalesce(rc.tl, 0) end * 100)::bigint as remote,
           dsis_erp_balance(lc.id) as erp
      from rc join lc on lc.legacy_id = rc.id
  ),
  rj as (select * from dsis_remote_jobs where coalesce(durum, '1') = '1'),
  ej as (select id, no, legacy_id, status, customer_id, patient, in_date from jobs where company_id = c and legacy_id > 0),
  miss as (select rj.* from rj left join ej on ej.legacy_id = rj.id where ej.id is null),
  st_open as (select rj.id, rj.no, rj.cariad, rj.hasta, rj.tarih2, ej.status from rj join ej on ej.legacy_id = rj.id
               where rj.provaturu = 'BİTİM' and coalesce(rj.teslim, '1') = '1' and ej.status in ('open', 'tryin', 'ready')),
  st_closed as (select rj.id, rj.no, rj.cariad, rj.hasta, rj.provaturu, ej.status from rj join ej on ej.legacy_id = rj.id
               where coalesce(rj.provaturu, '') <> 'BİTİM' and ej.status in ('delivered', 'cancelled')),
  erp_only as (select ej.* from ej left join dsis_remote_jobs r on r.id = ej.legacy_id
               where r.id is null and ej.in_date >= (select coalesce(min(dsis_ts(tarih1))::date, date '2026-01-01') from dsis_remote_jobs) and ej.status <> 'cancelled')
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
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then
  grant execute on function dsis_audit_report() to service_role;
  grant execute on function dsis_erp_balance(uuid) to service_role;
end if; end $$;

notify pgrst, 'reload schema';
