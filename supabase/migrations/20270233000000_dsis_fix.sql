-- Dentalsis aktarımı sonrası düzenlemeler + KPI hızı
--  1) KPI aylık özet: 45 bin işte zaman aşımına düşüyordu → tek geçişte gruplayan sürüm
--  2) Kur: işin tarihinden önce kur yoksa ilk bulunan kur kullanılır (eski tarihler 1:1 sayılmasın)
--  3) Toplu kapatma: bugünden önceki açık / provadaki aktarılmış işler "teslim edildi" (ÜTS, irsaliye, akış tetiklenmez)
--  4) Ürünlere Türkçe ad (name_tr) ve ürünlerin stok kartı
--  5) Para birimi düzeltme: hekim ve iş para birimi Dentalsis kalemleriyle aynı olmalı (€ / ₺)
--  6) Ciro analizi
-- Önce 20270231000000_dentalsis_import.sql. Tekrar çalıştırılabilir.

-- 7) Yerli / yabancı ayrımı -----------------------------------------------------
create or replace function lab_is_foreign(p_country text, p_kind text) returns boolean language sql immutable as $$
  select coalesce(p_kind, '') = 'doctor_foreign'
      or upper(translate(coalesce(nullif(trim(p_country), ''), 'TR'), 'İıüÜ', 'IIUU')) not in ('TR', 'TURKIYE', 'TURKEY', 'TÜRKİYE')
$$;

-- 1) KPI ---------------------------------------------------------------------
drop function if exists kpi_monthly(int);
create or replace function kpi_monthly(p_months int default 12) returns table (
  month date, revenue_try bigint, jobs int, units numeric, on_time numeric, remakes int, remake_rate numeric, avg_days numeric, new_jobs int, clinics int,
  revenue_dom bigint, revenue_for bigint, revenue_for_eur bigint, jobs_for int
) language sql stable security definer set search_path = public as $$
  with prm as (select date_trunc('month', current_date)::date - ((least(greatest(p_months, 1), 36) - 1) || ' months')::interval as f),
  m as (select generate_series((select f from prm), date_trunc('month', current_date), interval '1 month')::date m),
  d as (
    select date_trunc('month', lab_day(j.delivered_at))::date m, j.id, j.customer_id, j.due_date, j.in_date, lab_day(j.delivered_at) dd,
           round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 1) end)::bigint rev,
           lab_is_foreign(lc.country, lc.kind) fx, case when j.currency = 'EUR' then j.total else 0 end eur
    from jobs j join lab_customers lc on lc.id = j.customer_id where j.status = 'delivered' and j.delivered_at >= (select f from prm)
  ),
  u as (select ji.job_id, sum(ji.qty) q from job_items ji join d on d.id = ji.job_id where ji.amount >= 0 group by ji.job_id),
  agg as (
    select d.m, sum(d.rev) rev, sum(d.rev) filter (where not d.fx) rev_dom, sum(d.rev) filter (where d.fx) rev_for,
           sum(d.eur) filter (where d.fx) eur_for, count(*) filter (where d.fx) n_for, count(*) n, coalesce(sum(u.q), 0) units,
           round(100.0 * count(*) filter (where d.due_date is null or d.dd <= d.due_date) / nullif(count(*), 0), 1) on_time,
           round(avg(d.dd - d.in_date), 1) avg_days, count(distinct d.customer_id) clinics
    from d left join u on u.job_id = d.id group by d.m
  ),
  rm as (select date_trunc('month', r.created_at at time zone 'Europe/Istanbul')::date m, count(*) n from prd_remakes r
         where r.created_at >= (select f from prm) group by 1),
  nj as (select date_trunc('month', j.in_date)::date m, count(*) n from jobs j where j.in_date >= (select f from prm) and j.status <> 'cancelled' group by 1),
  ok as (select (can_module('sales') or can_module('finance')) money, (can_module('sales') or can_module('finance') or can_module('production', 3)) seen)
  select m.m,
    case when (select money from ok) then coalesce(agg.rev, 0) else 0 end::bigint,
    coalesce(agg.n, 0)::int, coalesce(agg.units, 0), agg.on_time,
    coalesce(rm.n, 0)::int, round(100.0 * coalesce(rm.n, 0) / nullif(agg.n, 0), 1), agg.avg_days,
    coalesce(nj.n, 0)::int, coalesce(agg.clinics, 0)::int,
    case when (select money from ok) then coalesce(agg.rev_dom, 0) else 0 end::bigint,
    case when (select money from ok) then coalesce(agg.rev_for, 0) else 0 end::bigint,
    case when (select money from ok) then coalesce(agg.eur_for, 0) else 0 end::bigint,
    coalesce(agg.n_for, 0)::int
  from m left join agg on agg.m = m.m left join rm on rm.m = m.m left join nj on nj.m = m.m
  where (select seen from ok)
  order by m.m;
$$;
revoke execute on function kpi_monthly(int) from public, anon;
grant execute on function kpi_monthly(int) to authenticated;

-- 2) Kur ---------------------------------------------------------------------
create or replace function fx_rate(p_currency text, p_date date default current_date) returns numeric
language sql stable as $$
  select case when p_currency = 'TRY' then 1::numeric
    else coalesce(
      (select selling from fx_rates where currency = p_currency and rate_date <= coalesce(p_date, current_date) order by rate_date desc limit 1),
      (select selling from fx_rates where currency = p_currency order by rate_date asc limit 1)) end;
$$;
grant execute on function fx_rate(text, date) to authenticated;

create or replace function fx_rates_missing(p_from date, p_to date) returns date[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d order by d), '{}') from (
    select g::date d from generate_series(p_from, least(p_to, current_date), interval '1 day') g
    where extract(isodow from g) < 6 and not exists (select 1 from fx_rates r where r.rate_date = g::date and r.currency = 'EUR')
  ) x
$$;
revoke execute on function fx_rates_missing(date, date) from public, anon;
grant execute on function fx_rates_missing(date, date) to authenticated;

-- 3) Toplu kapatma -------------------------------------------------------------
-- Toplu işlemde teslim tetikleyicileri (ÜTS bildirimi, irsaliye, akış kaydı) çalışmasın: oturum ayarı app.bulk = on
do $$
declare f text; src text; marker text := 'if current_setting(''app.bulk'', true) = ''on'' then return new; end if;';
begin
  foreach f in array array['uts_on_job_delivered', 'jobs_flow_sync', 'jobs_waybill_sync'] loop
    if to_regproc(f) is null then continue; end if;
    select pg_get_functiondef(to_regproc(f)) into src;
    if position('app.bulk' in src) > 0 then continue; end if;
    src := regexp_replace(src, E'\\nbegin\\n', E'\nbegin\n  ' || marker || E'\n', '');
    execute src;
  end loop;
end $$;

create or replace function dsis_close_old(p_before date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); v_before date := coalesce(p_before, (now() at time zone 'Europe/Istanbul')::date); n int;
begin
  perform set_config('app.skip_audit', 'on', true);
  perform set_config('app.bulk', 'on', true);
  update jobs set status = 'delivered', flow_stage = 'out', holder_employee_id = null,
         delivered_at = ((coalesce(due_date, in_date)::timestamp + time '12:00') at time zone 'Europe/Istanbul')
  where company_id = c and legacy_id > 0 and status in ('open', 'tryin', 'ready') and in_date < v_before;
  get diagnostics n = row_count;
  update job_steps s set done = true from jobs j
  where j.id = s.job_id and j.company_id = c and j.legacy_id > 0 and j.status = 'delivered' and not s.done and j.in_date < v_before;
  return jsonb_build_object('closed', n);
end $$;

-- 4) Ürün Türkçe adı ve stok kartı ---------------------------------------------
alter table lab_products add column if not exists name_tr text check (name_tr is null or length(name_tr) <= 160);

create or replace function lab_products_set_tr(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  if not (can_logistics() or has_role(lab_company(), array['owner']::app_role[])) then raise exception 'not_allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    update lab_products set name_tr = left(nullif(trim(r->>'name_tr'), ''), 160)
    where id = (r->>'id')::uuid and company_id = lab_company();
    if found then n := n + 1; end if;
  end loop;
  -- Türkçe ad değişince stok kartının adı da güncellensin (kartı elle değiştirilmediyse)
  update stk_items s set name = left(p2.name_tr, 200)
  from lab_products p2
  where s.lab_product_id = p2.id and p2.company_id = lab_company() and p2.name_tr is not null
    and (s.name = p2.name or s.name = left(p2.name, 200)) and s.kind = 'product';
  return n;
end $$;

create or replace function dsis_products_to_stock() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); r record; n int := 0; v_code text;
begin
  for r in select p.* from lab_products p where p.company_id = c and p.is_active
             and not exists (select 1 from stk_items s where s.lab_product_id = p.id) loop
    v_code := 'URN-' || coalesce(r.legacy_id::text, upper(left(replace(r.id::text, '-', ''), 8)));
    if exists (select 1 from stk_items s where s.company_id = c and lower(s.code) = lower(v_code)) then
      v_code := v_code || '-' || upper(left(replace(r.id::text, '-', ''), 4));
    end if;
    insert into stk_items (company_id, code, name, kind, unit, lab_product_id, sale_price, sale_currency, note, created_by)
    values (c, v_code, left(coalesce(r.name_tr, r.name), 200), 'product', 'adet', r.id,
            coalesce(r.price_eur, r.price_try), case when r.price_eur is not null then 'EUR' else 'TRY' end,
            left('Protez / ürün kartından · ' || r.name, 2000), null);
    n := n + 1;
  end loop;
  return jsonb_build_object('stock_items', n);
end $$;

-- 5) Para birimi düzeltme -------------------------------------------------------
-- Bir parti Dentalsis işi: işin kalem para birimi (çoğunluk) ERP'deki işten farklıysa düzelt
create or replace function dsis_fix_currency(p_jobs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); j jsonb; v_cur text; n int := 0; m int := 0;
begin
  perform set_config('app.skip_audit', 'on', true);
  perform set_config('app.bulk', 'on', true);
  for j in select * from jsonb_array_elements(coalesce(p_jobs, '[]')) loop
    select dsis_cur(x->>'para_birimi') into v_cur
    from jsonb_array_elements(coalesce(j->'stoklar', '[]')) x
    where coalesce(x->>'durum', '1') = '1' and coalesce((x->>'topluSil')::int, 0) = 0
    group by 1 order by sum(abs(coalesce((x->>'tutar')::numeric, 0))) desc, count(*) desc limit 1;
    if v_cur is null then continue; end if;
    m := m + 1;
    update jobs set currency = v_cur where legacy_id = (j->>'id')::bigint and company_id = c and currency <> v_cur;
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('checked', m, 'fixed', n);
end $$;

-- Hekim para birimi: aktarılan işlerinin çoğunluğu hangi para birimindeyse o (yalnız Dentalsis'ten gelen işleri olan hekimler)
create or replace function dsis_fix_customer_currency() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); n int := 0; r record;
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in
    select x.customer_id, x.cur from (
      select j.customer_id, j.currency cur, row_number() over (partition by j.customer_id order by count(*) desc, sum(j.total) desc) rn
      from jobs j where j.company_id = c and j.legacy_id > 0 group by j.customer_id, j.currency
    ) x join lab_customers lc on lc.id = x.customer_id
    where x.rn = 1 and lc.currency <> x.cur
      and not exists (select 1 from jobs o where o.customer_id = x.customer_id and o.legacy_id is null)
  loop
    update lab_customers set currency = r.cur where id = r.customer_id;
    update fin_parties set currency = r.cur where lab_customer_id = r.customer_id and currency is distinct from r.cur;
    -- devir satırı da hekimin para biriminde olsun
    update jobs set currency = r.cur where customer_id = r.customer_id and legacy_id < 0;
    n := n + 1;
  end loop;
  return jsonb_build_object('customers_fixed', n,
    'mixed_customers', (select count(*) from (select customer_id from jobs where company_id = c and legacy_id > 0 group by customer_id having count(distinct currency) > 1) z));
end $$;


-- Dentalsis'teki ülke bilgisini ERP hekim kartına taşı (adıyla eşleşen mevcut kartlar TR kalmıştı)
create or replace function dsis_fix_customer_country(p_cari jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); r jsonb; v_country text; n int := 0;
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_cari, '[]')) loop
    v_country := nullif(trim(r->>'ulke'), '');
    if v_country is null or not lab_is_foreign(v_country, null) then continue; end if;
    update lab_customers set country = left(v_country, 60), kind = case when kind = 'doctor_tr' then 'doctor_foreign' else kind end
    where company_id = c and legacy_id = (r->>'id')::bigint and not lab_is_foreign(country, kind);
    if found then n := n + 1; end if;
  end loop;
  return jsonb_build_object('customers_foreign', n);
end $$;
revoke execute on function dsis_fix_customer_country(jsonb) from public, anon;
grant execute on function dsis_fix_customer_country(jsonb) to authenticated;

-- Tahsilat aktarımı tekrar çalıştırılınca çift kayıt olmasın + bakiye eşitleme
create or replace function dsis_import_balance(p_tahsilat jsonb, p_balances jsonb, p_as_of date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); r jsonb; v_cust lab_customers; v_amt numeric; v_ref text; v_key text; v_k int; v_seen jsonb := '{}'; v_note text; n_pay int := 0; n_adj int := 0; n_miss int := 0; v_target bigint; v_now bigint; v_diff bigint;
  missing text[] := '{}';
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_tahsilat, '[]')) loop
    v_amt := coalesce((r->>'tutar')::numeric, 0);
    if v_amt <= 0 or upper(coalesce(r->>'aciklama', '')) like '%DEVİR%' or upper(coalesce(r->>'aciklama', '')) like '%DEVIR%' then continue; end if;
    select * into v_cust from lab_customers where company_id = c and dsis_norm(name) = dsis_norm(r->>'cariad') order by (legacy_id is null) limit 1;
    if v_cust.id is null then n_miss := n_miss + 1; missing := array_append(missing, left(r->>'cariad', 60)); continue; end if;
    -- Aynı tahsilat tekrar eklenmesin: aynı hekim / tarih / tutar / açıklamanın kaçıncı tekrarı olduğuna bakılır
    v_note := left('Dentalsis tahsilat · ' || coalesce(nullif(trim(r->>'aciklama'), ''), ''), 500);
    v_key := concat_ws('|', v_cust.id, r->>'tarih', r->>'tutar', r->>'para_birimi', r->>'aciklama');
    v_k := coalesce((v_seen->>v_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_key, v_k);
    if (select count(*) from lab_payments where customer_id = v_cust.id and paid_on = coalesce(dsis_ts(r->>'tarih')::date, p_as_of)
          and amount = round(v_amt * 100)::bigint and currency = dsis_cur(r->>'para_birimi') and note = v_note and legacy_ref like 'dsis%') >= v_k then continue; end if;
    v_ref := 'dsis2:' || md5(v_key || '#' || v_k);
    insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by)
    values (v_cust.id, coalesce(dsis_ts(r->>'tarih')::date, p_as_of), round(v_amt * 100)::bigint, dsis_cur(r->>'para_birimi'), 'other', v_note, v_ref, null)
    on conflict do nothing;
    n_pay := n_pay + 1;
  end loop;

  -- Bakiye eşitleme: ERP bakiyesi (teslim edilen işler − tahsilat) Dentalsis'teki güncel bakiyeden farklıysa
  -- fark 31.12.2025 tarihli devir kaydıyla kapatılır (2026 ciro / kâr-zarar raporlarına girmez):
  --   ERP düşükse (devir borcu): "DEVİR BAKİYESİ" teslim edilmiş iş kaydı; ERP yüksekse: mahsup tahsilatı
  for r in select * from jsonb_array_elements(coalesce(p_balances, '[]')) loop
    select * into v_cust from lab_customers where company_id = c and legacy_id = (r->>'id')::bigint;
    if v_cust.id is null then continue; end if;
    delete from lab_payments where customer_id = v_cust.id and legacy_ref = 'dsis-adj:' || v_cust.id;
    delete from jobs where legacy_id = -(r->>'id')::bigint;
    v_target := round(case v_cust.currency when 'EUR' then coalesce((r->>'eurotutar')::numeric, 0) when 'USD' then coalesce((r->>'usdtutar')::numeric, 0) else coalesce((r->>'tltutar')::numeric, 0) end * 100)::bigint;
    v_now := coalesce((select sum(total) from jobs where customer_id = v_cust.id and status = 'delivered'), 0)
           - coalesce((select sum(amount) from lab_payments where customer_id = v_cust.id), 0)
           + case when v_cust.internal_book then coalesce(v_cust.internal_opening, 0) else 0 end;
    v_diff := v_target - v_now;
    if v_diff > 0 then
      insert into jobs (company_id, no, customer_id, patient, description, in_date, due_date, status, currency, total, delivered_at, flow_stage, created_by, legacy_id)
      values (c, nextval('job_no'), v_cust.id, 'DEVİR BAKİYESİ', 'Dentalsis''teki cari bakiyeye eşitleme (2025''ten devreden bakiye ve düzeltmeler)',
              date '2025-12-31', date '2025-12-31', 'delivered', v_cust.currency, v_diff, (date '2025-12-31' + time '12:00') at time zone 'Europe/Istanbul', 'out', null, -(r->>'id')::bigint);
      n_adj := n_adj + 1;
    elsif v_diff < 0 then
      insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by)
      values (v_cust.id, date '2025-12-31', -v_diff, v_cust.currency, 'offset', 'Dentalsis bakiye eşitleme (devir alacak / düzeltme)', 'dsis-adj:' || v_cust.id, null);
      n_adj := n_adj + 1;
    end if;
  end loop;
  return jsonb_build_object('payments', n_pay, 'adjusted', n_adj, 'unmatched_payments', n_miss, 'unmatched_names', to_jsonb(missing[1:20]));
end $$;


create or replace function dsis_import_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role(lab_company(), array['owner']::app_role[]) then jsonb_build_object(
    'jobs', (select count(*) from jobs where legacy_id > 0 and company_id = lab_company()),
    'delivered', (select count(*) from jobs where legacy_id > 0 and company_id = lab_company() and status = 'delivered'),
    'opening_rows', (select count(*) from jobs where legacy_id < 0 and company_id = lab_company()),
    'customers', (select count(*) from lab_customers where legacy_id is not null and company_id = lab_company()),
    'products', (select count(*) from lab_products where legacy_id is not null and company_id = lab_company()),
    'payments', (select count(*) from lab_payments p join lab_customers lc on lc.id = p.customer_id where p.legacy_ref ~ '^dsis2?:' and lc.company_id = lab_company()),
    'first', (select min(in_date) from jobs where legacy_id > 0 and company_id = lab_company()),
    'last', (select max(in_date) from jobs where legacy_id > 0 and company_id = lab_company())) end
$$;


-- 6) Ciro analizi ----------------------------------------------------------------
create or replace function dsis_revenue_summary() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role(lab_company(), array['owner']::app_role[]) then jsonb_build_object(
    'by_currency', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'jobs', n, 'total', t, 'try', tr) order by currency), '[]') from (
        select j.currency, count(*) n, sum(j.total) t,
               sum(round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 0) end))::bigint tr
        from jobs j where j.company_id = lab_company() and j.legacy_id > 0 and j.status = 'delivered' group by j.currency) a),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('m', m, 'eur', eur, 'try', tl, 'try_total', tt, 'jobs', n) order by m), '[]') from (
        select to_char(date_trunc('month', lab_day(j.delivered_at)), 'YYYY-MM') m,
               sum(j.total) filter (where j.currency = 'EUR') eur, sum(j.total) filter (where j.currency = 'TRY') tl,
               sum(round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 0) end))::bigint tt, count(*) n
        from jobs j where j.company_id = lab_company() and j.legacy_id > 0 and j.status = 'delivered' group by 1) b),
    'by_market', (select coalesce(jsonb_agg(jsonb_build_object('foreign', fx, 'jobs', n, 'eur', eur, 'try', tl, 'try_total', tt)), '[]') from (
        select lab_is_foreign(lc.country, lc.kind) fx, count(*) n, sum(j.total) filter (where j.currency = 'EUR') eur, sum(j.total) filter (where j.currency = 'TRY') tl,
               sum(round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 0) end))::bigint tt
        from jobs j join lab_customers lc on lc.id = j.customer_id where j.company_id = lab_company() and j.legacy_id > 0 and j.status = 'delivered' group by 1) k),
    'open', (select count(*) from jobs where company_id = lab_company() and legacy_id > 0 and status in ('open', 'tryin', 'ready')),
    'mismatch', (select count(*) from jobs j join lab_customers lc on lc.id = j.customer_id where j.company_id = lab_company() and j.legacy_id > 0 and j.currency <> lc.currency),
    'fx_first', (select min(rate_date) from fx_rates where currency = 'EUR'),
    'fx_days_2026', (select count(*) from fx_rates where currency = 'EUR' and rate_date >= date '2026-01-01'),
    'products', (select count(*) from lab_products where company_id = lab_company() and is_active),
    'products_tr', (select count(*) from lab_products where company_id = lab_company() and is_active and name_tr is not null),
    'products_stock', (select count(*) from lab_products p where p.company_id = lab_company() and p.is_active and exists (select 1 from stk_items s where s.lab_product_id = p.id))
  ) end
$$;


create or replace function boss_pnl(p_from date, p_to date, p_bucket text default 'day', p_basis text default 'delivered') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c uuid := lab_company();
  v_len int;
  v_bucket text := case when p_bucket = 'month' then 'month' else 'day' end;
  p_from0 date; p_to0 date;
  r jsonb;
begin
  if not (rev_can() or can_module('finance')) then raise exception 'not_allowed'; end if;
  if p_to < p_from then p_to := p_from; end if;
  if p_to - p_from > 1500 then p_from := p_to - 1500; end if;
  v_len := p_to - p_from + 1;
  p_to0 := p_from - 1;
  p_from0 := p_from - v_len;

  with
  jobs_ as (
    select case when p_basis = 'in' then jb.in_date else (jb.delivered_at at time zone 'Europe/Istanbul')::date end as d,
           round(jb.total * case when jb.currency = 'TRY' then 1 else coalesce(fx_rate(jb.currency, case when p_basis = 'in' then jb.in_date else (jb.delivered_at at time zone 'Europe/Istanbul')::date end), 1) end)::bigint as try,
           lab_is_foreign(lc.country, lc.kind) as fx, case when jb.currency = 'EUR' then jb.total else 0 end as eur
    from jobs jb join lab_customers lc on lc.id = jb.customer_id
    where jb.company_id = c and jb.status <> 'cancelled' and (p_basis = 'in' or jb.delivered_at is not null)
  ),
  lab as (select d, try, fx, eur from jobs_ where d between p_from0 and p_to),
  fin as (
    select m.move_date as d, fc.code, fc.name, fc.kind, m.amount_try as amt, t.party_id
    from fin_moves m
    join fin_txns t on t.id = m.txn_id and t.voided_at is null
    join fin_categories fc on fc.id = m.category_id
    where t.company_id = c and m.move_date between p_from0 and p_to
      and fc.kind in ('income', 'expense') and fc.code not in ('internal_collection', 'exp_salary')
  ),
  mat as (
    select sm.move_date as d, round(-sm.qty * sm.unit_cost)::bigint as try
    from stk_moves sm join stk_items si on si.id = sm.item_id
    where si.company_id = c and sm.kind in ('consume', 'waste') and sm.qty < 0 and sm.move_date between p_from0 and p_to
  ),
  buckets as (select date_trunc(v_bucket, g)::date as b from generate_series(p_from, p_to, ('1 ' || v_bucket)::interval) g group by 1),
  agg as (
    select date_trunc(v_bucket, d)::date as b, sum(lab_) lab, sum(labfx_) labfx, sum(inc_) inc, sum(exp_) exp, sum(mat_) mat from (
      select d, try lab_, case when fx then try else 0 end labfx_, 0 inc_, 0 exp_, 0 mat_ from lab where d >= p_from
      union all select d, 0, 0, case when kind = 'income' then -amt else 0 end, case when kind = 'expense' then amt else 0 end, 0 from fin where d >= p_from
      union all select d, 0, 0, 0, 0, try from mat where d >= p_from
    ) u group by 1
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', p_from0, 'prev_to', p_to0, 'bucket', v_bucket, 'basis', p_basis,
    'series', coalesce((select jsonb_agg(jsonb_build_object('b', b.b, 'lab', coalesce(a.lab, 0), 'lab_fx', coalesce(a.labfx, 0), 'inc', coalesce(a.inc, 0), 'exp', coalesce(a.exp, 0), 'mat', coalesce(a.mat, 0)) order by b.b)
                        from buckets b left join agg a on a.b = b.b), '[]'),
    'totals', jsonb_build_object(
      'lab', (select coalesce(sum(try), 0) from lab where d >= p_from),
      'lab_fx', (select coalesce(sum(try), 0) from lab where d >= p_from and fx),
      'lab_fx_eur', (select coalesce(sum(eur), 0) from lab where d >= p_from and fx),
      'jobs_tr', (select count(*) from lab where d >= p_from and not fx),
      'jobs_fx', (select count(*) from lab where d >= p_from and fx),
      'inc', (select coalesce(sum(-amt), 0) from fin where d >= p_from and kind = 'income'),
      'exp', (select coalesce(sum(amt), 0) from fin where d >= p_from and kind = 'expense'),
      'mat', (select coalesce(sum(try), 0) from mat where d >= p_from)),
    'prev', jsonb_build_object(
      'lab', (select coalesce(sum(try), 0) from lab where d < p_from),
      'lab_fx', (select coalesce(sum(try), 0) from lab where d < p_from and fx),
      'inc', (select coalesce(sum(-amt), 0) from fin where d < p_from and kind = 'income'),
      'exp', (select coalesce(sum(amt), 0) from fin where d < p_from and kind = 'expense'),
      'mat', (select coalesce(sum(try), 0) from mat where d < p_from)),
    'income_by', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'try', t) order by t desc) from (
                   select code, name, sum(-amt) t from fin where d >= p_from and kind = 'income' group by 1, 2 having sum(-amt) <> 0) x), '[]'),
    'expense_by', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'try', t, 'prev', pv) order by t desc) from (
                   select code, max(name) name, sum(case when d >= p_from then amt else 0 end) t, sum(case when d < p_from then amt else 0 end) pv
                   from fin where kind = 'expense' group by 1 having sum(case when d >= p_from then amt else 0 end) <> 0 or sum(case when d < p_from then amt else 0 end) <> 0) y), '[]'),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'try', t) order by t desc) from (
                   select coalesce(p.name, 'Carisiz') n, sum(f.amt) t from fin f left join fin_parties p on p.id = f.party_id
                   where f.d >= p_from and f.kind = 'expense' group by 1 order by 2 desc limit 8) z), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function boss_pnl(date, date, text, text) from public, anon;
grant execute on function boss_pnl(date, date, text, text) to authenticated;

revoke execute on function dsis_close_old(date) from public, anon;
revoke execute on function lab_products_set_tr(jsonb) from public, anon;
revoke execute on function dsis_products_to_stock() from public, anon;
revoke execute on function dsis_fix_currency(jsonb) from public, anon;
revoke execute on function dsis_fix_customer_currency() from public, anon;
revoke execute on function dsis_revenue_summary() from public, anon;
grant execute on function dsis_close_old(date) to authenticated;
grant execute on function lab_products_set_tr(jsonb) to authenticated;
grant execute on function dsis_products_to_stock() to authenticated;
grant execute on function dsis_fix_currency(jsonb) to authenticated;
grant execute on function dsis_fix_customer_currency() to authenticated;
grant execute on function dsis_revenue_summary() to authenticated;

analyze jobs;
notify pgrst, 'reload schema';
