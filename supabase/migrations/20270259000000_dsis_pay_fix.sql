-- Dentalsis tahsilat düzeltmesi
--  * Eski aktarım tahsilatları iki kez yazmıştı (sayaç referansa karışıyordu) ve tarihler bir gün geri kayıyordu (27.02 ↔ 28.02).
--  * dsis_payments_preview: Dentalsis'ten gelen tahsilatlarda çift kayıt ve elle girilmiş benzer tahsilatlar
--  * dsis_payments_reset: Dentalsis'ten gelen tahsilatları siler (finansa işlenmiş olanlara dokunmaz);
--    ardından "Tahsilatları yeniden aktar" her tahsilatı bir kez, doğru tarihle yazar ve bakiyeyi yeniden eşitler.
-- Tekrar çalıştırılabilir.

create or replace function dsis_day(t text) returns date language sql immutable as $$
  select case when t ~ '^\d{4}-\d{2}-\d{2}' and left(t, 10) <> '0000-00-00' and left(t, 4)::int between 2000 and 2100 then left(t, 10)::date end
$$;

create or replace function dsis_payments_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := dsis_guard();
begin
  return jsonb_build_object(
    'dsis_rows', (select count(*) from lab_payments p join lab_customers lc on lc.id = p.customer_id
                   where lc.company_id = c and p.legacy_ref ~ '^dsis2?:'),
    'dsis_total_eur', (select coalesce(sum(p.amount), 0) from lab_payments p join lab_customers lc on lc.id = p.customer_id
                   where lc.company_id = c and p.legacy_ref ~ '^dsis2?:' and p.currency = 'EUR'),
    'dsis_total_try', (select coalesce(sum(p.amount), 0) from lab_payments p join lab_customers lc on lc.id = p.customer_id
                   where lc.company_id = c and p.legacy_ref ~ '^dsis2?:' and p.currency = 'TRY'),
    'dup_extra', (select coalesce(sum(n - 1), 0) from (
        select count(*) n from lab_payments p join lab_customers lc on lc.id = p.customer_id
         where lc.company_id = c and p.legacy_ref ~ '^dsis2?:'
         group by p.customer_id, p.amount, p.currency, p.note, p.paid_on having count(*) > 1) d),
    'dup_customers', (select count(distinct customer_id) from (
        select p.customer_id from lab_payments p join lab_customers lc on lc.id = p.customer_id
         where lc.company_id = c and p.legacy_ref ~ '^dsis2?:'
         group by p.customer_id, p.amount, p.currency, p.note, p.paid_on having count(*) > 1) d),
    'linked_to_finance', (select count(*) from lab_payments p join lab_customers lc on lc.id = p.customer_id
                   where lc.company_id = c and p.legacy_ref ~ '^dsis2?:' and p.fin_txn_id is not null),
    'manual_2026', (select count(*) from lab_payments p join lab_customers lc on lc.id = p.customer_id
                   where lc.company_id = c and lc.legacy_id is not null and p.legacy_ref is null and p.paid_on >= date '2026-01-01'),
    -- elle girilmiş ve Dentalsis'ten gelen bir tahsilatla aynı tutar / ±3 gün: muhtemel çift giriş
    'manual_like', (select coalesce(jsonb_agg(x), '[]') from (
        select lc.name hekim, p.paid_on tarih, p.amount tutar, p.currency, p.note not_ from lab_payments p join lab_customers lc on lc.id = p.customer_id
         where lc.company_id = c and p.legacy_ref is null and p.paid_on >= date '2026-01-01'
           and exists (select 1 from lab_payments d where d.customer_id = p.customer_id and d.legacy_ref ~ '^dsis2?:'
                         and d.amount = p.amount and d.currency = p.currency and abs(d.paid_on - p.paid_on) <= 3)
         order by lc.name, p.paid_on limit 50) x)
  );
end $$;
revoke execute on function dsis_payments_preview() from public, anon;
grant execute on function dsis_payments_preview() to authenticated;

create or replace function dsis_payments_reset() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); n int;
begin
  perform set_config('app.skip_audit', 'on', true);
  delete from lab_payments p using lab_customers lc
   where lc.id = p.customer_id and lc.company_id = c and p.legacy_ref ~ '^dsis2?:' and p.fin_txn_id is null;
  get diagnostics n = row_count;
  return jsonb_build_object('deleted', n);
end $$;
revoke execute on function dsis_payments_reset() from public, anon;
grant execute on function dsis_payments_reset() to authenticated;

-- Tahsilat aktarımı: tarih Dentalsis'teki gün (saat dilimi kayması yok)
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
    if (select count(*) from lab_payments where customer_id = v_cust.id and paid_on = coalesce(dsis_day(r->>'tarih'), p_as_of)
          and amount = round(v_amt * 100)::bigint and currency = dsis_cur(r->>'para_birimi') and note = v_note and legacy_ref like 'dsis%') >= v_k then continue; end if;
    v_ref := 'dsis2:' || md5(v_key || '#' || v_k);
    insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by)
    values (v_cust.id, coalesce(dsis_day(r->>'tarih'), p_as_of), round(v_amt * 100)::bigint, dsis_cur(r->>'para_birimi'), 'other', v_note, v_ref, null)
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

notify pgrst, 'reload schema';
