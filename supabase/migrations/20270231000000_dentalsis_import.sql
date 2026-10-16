-- Dentalsis Plus'tan (eski iş takip programı) 2026 kayıtlarını aktarma
--  * Hekim/hastane (cari), ürün, iş, iş kalemleri, prova adımları, tahsilatlar
--  * Her kayıt Dentalsis kimliğiyle eşlenir (legacy_id): aktarım tekrar çalıştırılırsa aynı kayıt ikinci kez oluşmaz
--  * Toplu aktarımda denetim kaydı (audit_log) yazılmaz; ÜTS / irsaliye / üretim akışı tetiklenmez (işler doğrudan son durumlarıyla eklenir)
--  * Cari bakiyeler Dentalsis'teki güncel bakiyeye eşitlenir (dsis_import_balance)
-- Önce 20270230000000_door.sql. Tekrar çalıştırılabilir.

alter table lab_customers add column if not exists legacy_id bigint;
alter table lab_products add column if not exists legacy_id bigint;
alter table jobs add column if not exists legacy_id bigint;
alter table jobs add column if not exists legacy_no bigint;
alter table lab_payments add column if not exists legacy_ref text check (legacy_ref is null or length(legacy_ref) <= 120);
create unique index if not exists lab_customers_legacy_uq on lab_customers (company_id, legacy_id) where legacy_id is not null;
create unique index if not exists lab_products_legacy_uq on lab_products (company_id, legacy_id) where legacy_id is not null;
create unique index if not exists jobs_legacy_uq on jobs (legacy_id) where legacy_id is not null;
create unique index if not exists lab_payments_legacy_uq on lab_payments (legacy_ref) where legacy_ref is not null;

-- Toplu aktarımda denetim kaydı yazma (oturum ayarı app.skip_audit = on)
create or replace function public.audit_trigger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  if current_setting('app.skip_audit', true) = 'on' then return coalesce(new, old); end if;
  insert into audit_log (company_id, table_name, row_id, action, old_data, new_data)
  values (
    (rec->>'company_id')::uuid,
    tg_table_name,
    coalesce(rec->>'id', rec->>'employee_id'),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create or replace function dsis_norm(t text) returns text language sql immutable as $$
  select nullif(regexp_replace(upper(translate(coalesce(t, ''), 'ıiğüşöçİĞÜŞÖÇ', 'IIGUSOCIGUSOC')), '[^A-Z0-9]+', '', 'g'), '')
$$;

create or replace function dsis_cur(t text) returns text language sql immutable as $$
  select case when upper(coalesce(t, '')) in ('EURO', 'EUR', '€') then 'EUR' when upper(coalesce(t, '')) in ('USD', 'DOLAR', '$') then 'USD' else 'TRY' end
$$;

create or replace function dsis_ts(t text) returns timestamptz language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' and left(t, 10) <> '0000-00-00' then (left(t, 19)::timestamp at time zone 'Europe/Istanbul') end
$$;

create or replace function dsis_guard() returns uuid language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company();
begin
  if not has_role(c, array['owner']::app_role[]) then raise exception 'Aktarımı yalnız şirket sahibi yapabilir'; end if;
  return c;
end $$;

-- 1) Cari (hekim / hastane) ve ürünler
create or replace function dsis_import_ref(p_cari jsonb, p_stok jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); r jsonb; v uuid; n_new int := 0; n_link int := 0; p_new int := 0; p_link int := 0;
  v_name text; v_country text;
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_cari, '[]')) loop
    v_name := left(trim(r->>'cariad'), 160);
    if v_name is null or v_name = '' then continue; end if;
    select id into v from lab_customers where company_id = c and legacy_id = (r->>'id')::bigint;
    if v is not null then continue; end if;
    select id into v from lab_customers where company_id = c and legacy_id is null and dsis_norm(name) = dsis_norm(v_name) limit 1;
    if v is not null then
      update lab_customers set legacy_id = (r->>'id')::bigint where id = v; n_link := n_link + 1;
    else
      v_country := coalesce(nullif(trim(r->>'ulke'), ''), 'TR');
      if upper(v_country) in ('TÜRKİYE', 'TURKIYE', 'TURKEY', 'TR') then v_country := 'TR'; end if;
      insert into lab_customers (company_id, name, kind, currency, phone, email, country, city, address, tax_office, tax_no, note, legacy_id)
      values (c, v_name, case when v_country = 'TR' then 'doctor_tr' else 'doctor_foreign' end,
              case when v_country = 'TR' then 'TRY' else 'EUR' end,
              left(coalesce(nullif(trim(r->>'telefon'), ''), nullif(trim(r->>'gsm'), '')), 40), left(nullif(trim(r->>'eposta'), ''), 200),
              left(v_country, 60), left(coalesce(nullif(trim(r->>'ilce'), '') || ' / ', '') || nullif(trim(r->>'il'), ''), 80),
              left(nullif(concat_ws(' ', nullif(trim(r->>'adres'), ''), nullif(trim(r->>'adres2'), ''), nullif(trim(r->>'adres3'), '')), ''), 400),
              left(nullif(trim(r->>'vergidaire'), ''), 80), left(nullif(regexp_replace(coalesce(r->>'vergino', ''), '\s', '', 'g'), ''), 20),
              left('Dentalsis''ten aktarıldı' || coalesce(' · kod ' || nullif(trim(r->>'carikod'), ''), '') || coalesce(' · fiyat listesi ' || nullif(trim(r->>'fiyatliste'), ''), ''), 2000),
              (r->>'id')::bigint);
      n_new := n_new + 1;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_stok, '[]')) loop
    v_name := left(trim(r->>'stokad'), 160);
    if v_name is null or v_name = '' then continue; end if;
    select id into v from lab_products where company_id = c and legacy_id = (r->>'id')::bigint;
    if v is not null then continue; end if;
    select id into v from lab_products where company_id = c and legacy_id is null and dsis_norm(name) = dsis_norm(v_name) limit 1;
    if v is not null then
      update lab_products set legacy_id = (r->>'id')::bigint where id = v; p_link := p_link + 1;
    else
      insert into lab_products (company_id, code, name, sort, is_active, legacy_id)
      values (c, left(nullif(trim(r->>'stokkod'), ''), 30), v_name, coalesce((r->>'siralama')::int, 0), coalesce(r->>'durum', '1') = '1', (r->>'id')::bigint);
      p_new := p_new + 1;
    end if;
  end loop;
  return jsonb_build_object('customers_new', n_new, 'customers_linked', n_link, 'products_new', p_new, 'products_linked', p_link);
end $$;

-- Dentalsis diş şeması renk kodu → ERP malzeme anahtarı
create or replace function dsis_tooth_material(p_code int) returns text language sql immutable as $$
  select case p_code
    when 1 then 'porselen' when 2 then 'zirkon' when 3 then 'implant' when 4 then 'fulkron' when 5 then 'emax'
    when 6 then 'postcore' when 7 then 'total' when 9 then 'total' when 10 then 'iskelet' when 11 then 'kompozit'
    when 12 then 'inlayonlay' when 13 then 'fulzirkon' when 14 then 'gecici' end
$$;

-- 2) İşler (bir parti: Dentalsis iş kayıtları dizisi)
create or replace function dsis_import_jobs(p_jobs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); j jsonb; s jsonb; pr jsonb; v_cust lab_customers; v_job uuid; v_no bigint; v_cur text; v_status text;
  v_delivered timestamptz; v_total bigint; v_teeth jsonb; v_received text[]; v_band text; v_kind text; v_amount bigint; v_qty int; v_unit bigint;
  v_prod uuid; v_sort int; n_ins int := 0; n_skip int := 0; n_del int := 0; n_cust int := 0; n_mixed int := 0; n_renum int := 0; k text; m text;
begin
  perform set_config('app.skip_audit', 'on', true);
  for j in select * from jsonb_array_elements(coalesce(p_jobs, '[]')) loop
    if exists (select 1 from jobs where legacy_id = (j->>'id')::bigint) then n_skip := n_skip + 1; continue; end if;
    if coalesce((j->>'durum')::int, 1) <> 1 or coalesce((j->>'topluSil')::int, 0) <> 0 then n_del := n_del + 1; continue; end if;

    select * into v_cust from lab_customers where company_id = c and legacy_id = (j->>'cariid')::bigint;
    if v_cust.id is null then
      select * into v_cust from lab_customers where company_id = c and dsis_norm(name) = dsis_norm(j->>'cariad') limit 1;
    end if;
    if v_cust.id is null then
      insert into lab_customers (company_id, name, kind, currency, note, legacy_id)
      values (c, left(coalesce(nullif(trim(j->>'cariad'), ''), 'Dentalsis cari ' || (j->>'cariid')), 160), 'doctor_tr',
              coalesce((select dsis_cur(x->>'para_birimi') from jsonb_array_elements(j->'stoklar') x limit 1), 'TRY'),
              'Dentalsis''ten aktarıldı', nullif(j->>'cariid', '')::bigint)
      returning * into v_cust;
      n_cust := n_cust + 1;
    end if;
    v_cur := v_cust.currency;
    if exists (select 1 from jsonb_array_elements(j->'stoklar') x where coalesce(x->>'durum', '1') = '1' and coalesce((x->>'topluSil')::int, 0) = 0 and dsis_cur(x->>'para_birimi') <> v_cur) then
      n_mixed := n_mixed + 1;
    end if;

    -- Durum: BİTİM + teslim = teslim edildi; diğer prova teslimde = provada; değilse açık
    if j->>'provaturu' = 'BİTİM' and coalesce(j->>'teslim', '0') = '1' then v_status := 'delivered';
    elsif coalesce(j->>'teslim', '0') = '1' then v_status := 'tryin';
    else v_status := 'open'; end if;
    select max(dsis_ts(x->>'teslimtarihi')) into v_delivered from jsonb_array_elements(j->'provalar') x where x->>'provaturu' = 'BİTİM' and coalesce(x->>'teslim', '0') = '1';
    v_delivered := coalesce(v_delivered, dsis_ts(j->>'tarih2'), dsis_ts(j->>'updated_at'));

    v_teeth := '{}'::jsonb;
    for k, m in select key, value #>> '{}' from jsonb_each(coalesce(j->'teeth', '{}')) loop
      if k ~ '^[1-4][1-8]$' and dsis_tooth_material(m::int) is not null then v_teeth := v_teeth || jsonb_build_object(k, dsis_tooth_material(m::int)); end if;
    end loop;
    v_received := array(select f from unnest(array['isirik', 'model', 'olcu', 'kasik', 'mum']) f where coalesce((j->'flags'->>f)::int, 0) <> 0);
    v_band := case when coalesce((j->'flags'->>'metalbant_cepecevre')::int, 0) <> 0 then 'circumferential'
                   when coalesce((j->'flags'->>'metalbant_var')::int, 0) <> 0 then 'yes'
                   when coalesce((j->'flags'->>'metalbant_yok')::int, 0) <> 0 then 'no' end;

    v_no := (j->>'iskayitno')::bigint;
    if v_no is null or exists (select 1 from jobs where no = v_no) then v_no := nextval('job_no'); n_renum := n_renum + 1; end if;

    insert into jobs (company_id, no, slip_no, customer_id, doctor_name, patient, shade, shade_cervical, shade_incisal, description, invoice_note, print_note,
                      metal_band, received, teeth, in_date, due_date, delivery_method, status, currency, total, delivered_at, flow_stage, created_by, created_at, legacy_id, legacy_no)
    values (c, v_no, left(nullif(trim(j->>'fisno'), ''), 40), v_cust.id, left(nullif(trim(j->>'doktor'), ''), 120), left(nullif(trim(j->>'hasta'), ''), 120),
            left(nullif(trim(j->>'disrenk'), ''), 30), left(nullif(trim(j->>'disrenk1'), ''), 30), left(nullif(trim(j->>'disrenk2'), ''), 30),
            left(nullif(concat_ws(E'\n', nullif(trim(j->>'aciklama'), ''),
                   case when nullif(trim(coalesce(j->>'implantmm', '') || coalesce(j->>'vidacapi', '') || coalesce(j->>'taramakafasi', '')), '') is not null
                        then 'İmplant: ' || concat_ws(' · ', nullif(trim(j->>'implantmm'), ''), nullif(trim(j->>'vidacapi'), ''), nullif(trim(j->>'taramakafasi'), '')) end), ''), 4000),
            left(nullif(trim(j->>'toplufaturaaciklama'), ''), 500), left(nullif(trim(j->>'yaziciaciklama'), ''), 500),
            v_band, v_received, v_teeth, coalesce(dsis_ts(j->>'tarih1')::date, current_date), dsis_ts(j->>'tarih2')::date, left(nullif(trim(j->>'teslimad'), ''), 80),
            v_status, v_cur, 0, case when v_status = 'delivered' then v_delivered end,
            case v_status when 'delivered' then 'out' when 'tryin' then 'tryin' else 'reception' end, null,
            coalesce(dsis_ts(j->>'created_at'), now()), (j->>'id')::bigint, (j->>'iskayitno')::bigint)
    returning id into v_job;

    v_total := 0; v_sort := 0;
    for s in select * from jsonb_array_elements(coalesce(j->'stoklar', '[]')) loop
      if coalesce(s->>'durum', '1') <> '1' or coalesce((s->>'topluSil')::int, 0) <> 0 then continue; end if;
      v_kind := case when coalesce((s->>'ucretsiz')::int, 0) <> 0 then 'free' when coalesce((s->>'rpt')::int, 0) <> 0 then 'rpt'
                     when coalesce((s->>'tamir')::int, 0) <> 0 then 'repair' when coalesce((s->>'duzeltme')::int, 0) <> 0 then 'adjust' else 'paid' end;
      v_qty := least(99, greatest(1, round(coalesce((s->>'miktar')::numeric, 1))::int));
      v_amount := case when v_kind = 'paid' then round(coalesce((s->>'tutar')::numeric, 0) * 100)::bigint else 0 end;
      v_unit := greatest(0, round(coalesce((s->>'fiyat')::numeric, 0) * 100)::bigint);
      select id into v_prod from lab_products where company_id = c and legacy_id = (s->>'stokid')::bigint;
      insert into job_items (job_id, product_id, name, qty, unit_price, amount, kind, sort)
      values (v_job, v_prod, left(coalesce(nullif(trim(s->>'stokad'), ''), 'Kalem'), 160), v_qty, v_unit, greatest(v_amount, 0), v_kind, v_sort);
      v_total := v_total + greatest(v_amount, 0); v_sort := v_sort + 1;
    end loop;

    v_sort := 0;
    for pr in select * from jsonb_array_elements(coalesce(j->'provalar', '[]')) order by (value->>'id')::bigint loop
      if coalesce((pr->>'topluSil')::int, 0) <> 0 then continue; end if;
      insert into job_steps (job_id, kind, out_date, back_date, delivery_method, done, note, sort)
      values (v_job, left(coalesce(nullif(trim(pr->>'provaturu'), ''), 'Prova'), 80),
              coalesce(dsis_ts(pr->>'teslimtarihi'), dsis_ts(pr->>'tarih2'))::date, dsis_ts(pr->>'tarih1')::date,
              left(nullif(trim(pr->>'teslimad'), ''), 80), coalesce(pr->>'teslim', '0') = '1',
              left(nullif('Çıkış: ' || nullif(trim(pr->>'cikisyapanad'), ''), 'Çıkış: '), 500), v_sort);
      v_sort := v_sort + 1;
    end loop;

    update jobs set total = v_total where id = v_job;
    n_ins := n_ins + 1;
  end loop;
  return jsonb_build_object('inserted', n_ins, 'skipped_existing', n_skip, 'skipped_deleted', n_del, 'customers_created', n_cust, 'currency_mismatch', n_mixed, 'renumbered', n_renum);
end $$;

-- 3) Tahsilatlar (Dentalsis tahsilat raporu; DEVİR satırları hariç) ve bakiyelerin Dentalsis'e eşitlenmesi
--    p_balances: [{id, cariad, tltutar, eurotutar, usdtutar}] (Dentalsis cari ekstre toplamları, + borç)
create or replace function dsis_import_balance(p_tahsilat jsonb, p_balances jsonb, p_as_of date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); r jsonb; v_cust lab_customers; v_amt numeric; v_ref text; n_pay int := 0; n_adj int := 0; n_miss int := 0; v_target bigint; v_now bigint; v_diff bigint;
  missing text[] := '{}';
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_tahsilat, '[]')) loop
    v_amt := coalesce((r->>'tutar')::numeric, 0);
    if v_amt <= 0 or upper(coalesce(r->>'aciklama', '')) like '%DEVİR%' or upper(coalesce(r->>'aciklama', '')) like '%DEVIR%' then continue; end if;
    select * into v_cust from lab_customers where company_id = c and dsis_norm(name) = dsis_norm(r->>'cariad') order by (legacy_id is null) limit 1;
    if v_cust.id is null then n_miss := n_miss + 1; missing := array_append(missing, left(r->>'cariad', 60)); continue; end if;
    v_ref := 'dsis:' || md5(concat_ws('|', r->>'cariad', r->>'tarih', r->>'tutar', r->>'para_birimi', r->>'aciklama', n_pay));
    if exists (select 1 from lab_payments where legacy_ref = v_ref) then continue; end if;
    insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by)
    values (v_cust.id, coalesce(dsis_ts(r->>'tarih')::date, p_as_of), round(v_amt * 100)::bigint, dsis_cur(r->>'para_birimi'), 'other',
            left('Dentalsis tahsilat · ' || coalesce(nullif(trim(r->>'aciklama'), ''), ''), 500), v_ref, null);
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

-- Aktarım özeti
create or replace function dsis_import_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when has_role(lab_company(), array['owner']::app_role[]) then jsonb_build_object(
    'jobs', (select count(*) from jobs where legacy_id > 0 and company_id = lab_company()),
    'delivered', (select count(*) from jobs where legacy_id > 0 and company_id = lab_company() and status = 'delivered'),
    'opening_rows', (select count(*) from jobs where legacy_id < 0 and company_id = lab_company()),
    'customers', (select count(*) from lab_customers where legacy_id is not null and company_id = lab_company()),
    'products', (select count(*) from lab_products where legacy_id is not null and company_id = lab_company()),
    'payments', (select count(*) from lab_payments p join lab_customers lc on lc.id = p.customer_id where p.legacy_ref like 'dsis:%' and lc.company_id = lab_company()),
    'first', (select min(in_date) from jobs where legacy_id > 0 and company_id = lab_company()),
    'last', (select max(in_date) from jobs where legacy_id > 0 and company_id = lab_company())) end
$$;

revoke execute on function dsis_import_ref(jsonb, jsonb) from public, anon;
revoke execute on function dsis_import_jobs(jsonb) from public, anon;
revoke execute on function dsis_import_balance(jsonb, jsonb, date) from public, anon;
revoke execute on function dsis_import_status() from public, anon;
revoke execute on function dsis_guard() from public, anon;
grant execute on function dsis_import_ref(jsonb, jsonb) to authenticated;
grant execute on function dsis_import_jobs(jsonb) to authenticated;
grant execute on function dsis_import_balance(jsonb, jsonb, date) to authenticated;
grant execute on function dsis_import_status() to authenticated;

notify pgrst, 'reload schema';
