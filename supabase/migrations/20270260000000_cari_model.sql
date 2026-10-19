-- =====================================================================
-- Hekim carisi + cari kart düzeni
--  Hekim carisi (İşler › Hekimler): tüm işler + tüm tahsilatlar → bakiye Dentalsis'le aynı
--  Cari kart   (Finans › Cariler) : kesilen faturalar + aynı tahsilatlar (fatura − tahsilat)
--  Faturasız (nakit) müşteri      : tahsilat yalnız hekim carisinde; ara sıra kesilen fatura cari karta girer
-- Teknik: her müşteri "iç hesap" (internal_book) düzeninde; tahsilat defteri 'both' (iki cari) / 'internal' (faturasız).
-- Kasa / bankaya işlenmemiş tahsilat da artık cari karttan düşer.
-- Tekrar çalıştırılabilir. Önce 20270259000000_dsis_pay_fix.sql.
-- =====================================================================

alter table lab_customers add column if not exists no_invoice boolean not null default false;

-- 1) Cari kart bakiyesi: açılış + finans hareketleri (fatura, kasa/banka tahsilatı) + kasaya işlenmemiş tahsilatlar
create or replace view fin_party_balances with (security_invoker = true) as
select p.id as party_id, p.name, p.kind, p.currency, p.lab_customer_id,
       p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)
       + case when coalesce(c.internal_book, false) then
           - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.book in ('official', 'both')), 0)
         else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered'), 0)
         - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null), 0) end
       as balance
from fin_parties p left join lab_customers c on c.id = p.lab_customer_id;
grant select on fin_party_balances to authenticated;

create or replace function fin_party_balance_at(p_party uuid, p_date date, p_book text default 'official') returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('finance') or can_module('sales')) then return null; end if;
  if p_book = 'internal' then
    return (select c.internal_opening
       + coalesce((select sum(j.total) from jobs j where j.customer_id = c.id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
       - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = c.id and lp.book in ('internal', 'both') and lp.paid_on <= p_date), 0)
     from fin_parties p join lab_customers c on c.id = p.lab_customer_id where p.id = p_party and c.internal_book);
  end if;
  return (select p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null and m.move_date <= p_date), 0)
       + case when coalesce(c.internal_book, false) then
           - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.book in ('official', 'both') and lp.paid_on <= p_date), 0)
         else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
         - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.paid_on <= p_date), 0) end
     from fin_parties p left join lab_customers c on c.id = p.lab_customer_id where p.id = p_party);
end $$;
revoke execute on function fin_party_balance_at(uuid, date, text) from public, anon;
grant execute on function fin_party_balance_at(uuid, date, text) to authenticated;

-- 2) Hekim kartından tahsilat: kasa / banka seçilmese de iki cariye işlenebilir; faturasızda yalnız hekim carisi
create or replace function lab_payment_add(p_customer uuid, p_date date, p_amount bigint, p_method text, p_ref text, p_note text, p_book text, p_account uuid default null, p_account_amount bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c lab_customers; pt fin_parties; a fin_accounts; v_txn uuid; v_lp uuid; v_book text := coalesce(p_book, 'official'); v_rate numeric;
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount'; end if;
  select * into c from lab_customers where id = p_customer;
  if c.id is null then raise exception 'not_found'; end if;
  if not c.internal_book then v_book := 'official'; end if;
  if coalesce(c.no_invoice, false) then v_book := 'internal'; end if;
  if v_book not in ('official', 'internal', 'both') then raise exception 'bad_book'; end if;

  if p_account is null then
    -- hesapsız: eski usul tahsilat kaydı (iç hesapta iç / ikisi; iç hesap kullanmayan müşteride tek cari)
    insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, book)
    values (p_customer, coalesce(p_date, current_date), p_amount, c.currency, coalesce(p_method, 'bank'), nullif(left(p_ref, 80), ''), nullif(left(p_note, 500), ''), v_book)
    returning id into v_lp;
    return v_lp;
  end if;

  select * into a from fin_accounts where id = p_account;
  if a.id is null then raise exception 'not_found'; end if;
  if v_book in ('official', 'both') then
    select * into pt from fin_parties where lab_customer_id = p_customer limit 1;
    if pt.id is null then raise exception 'party_missing'; end if;
    v_txn := fin_collect_or_pay('collection', pt.id, p_account, p_date,
      case when a.currency = c.currency then p_amount else coalesce(p_account_amount, p_amount) end,
      case when a.currency = c.currency then null else p_amount end,
      null, p_note, p_ref, p_method, v_book);
    return (select lab_payment_id from fin_txns where id = v_txn);
  end if;
  -- internal + hesap: kasa / banka girişi, karşılığı "İç hesap tahsilatı"
  v_rate := case when a.currency = 'TRY' then 1 else fx_rate(a.currency, p_date) end;
  v_txn := fin_post(
    jsonb_build_object('kind', 'income', 'txn_date', p_date, 'description', coalesce(nullif(p_note, ''), c.name || ' — iç hesap tahsilatı'), 'doc_no', p_ref,
                       'amount', coalesce(p_account_amount, p_amount), 'currency', a.currency, 'account_id', p_account, 'category_id', fin_category('internal_collection')),
    jsonb_build_array(
      jsonb_build_object('account_id', p_account, 'amount', coalesce(p_account_amount, p_amount), 'currency', a.currency, 'rate', v_rate),
      jsonb_build_object('category_id', fin_category('internal_collection'), 'amount', -coalesce(p_account_amount, p_amount), 'currency', a.currency, 'rate', v_rate)));
  insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, fin_txn_id, account_id, book)
  values (p_customer, coalesce(p_date, current_date), p_amount, c.currency, coalesce(p_method, case a.kind when 'cash' then 'cash' else 'bank' end), nullif(left(p_ref, 80), ''), nullif(left(p_note, 500), ''), v_txn, p_account, 'internal')
  returning id into v_lp;
  update fin_txns set lab_payment_id = v_lp where id = v_txn;
  return v_lp;
end $$;
grant execute on function lab_payment_add(uuid, date, bigint, text, text, text, text, uuid, bigint) to authenticated;

-- 3) Faturasız (nakit) ayarı — hekim kartı ve cari karttan
create or replace function lab_customer_set_no_invoice(p_customer uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare c lab_customers;
begin
  if not (can_logistics() or can_module('sales', 2) or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  select * into c from lab_customers where id = p_customer for update;
  if c.id is null then raise exception 'not_found'; end if;
  update lab_customers set no_invoice = coalesce(p_on, false), internal_book = true,
         pay_book = case when coalesce(p_on, false) then 'internal' else 'both' end, updated_at = now()
   where id = p_customer;
  -- tahsilatlar: eşitleme mahsubu yalnız hekim carisi; faturasızda kasaya işlenmemişler yalnız hekim carisi; diğerleri iki cari
  update lab_payments set book = case when coalesce(legacy_ref, '') like 'dsis-adj:%' then 'internal'
                                      when coalesce(p_on, false) and fin_txn_id is null then 'internal' else 'both' end
   where customer_id = p_customer;
end $$;
revoke execute on function lab_customer_set_no_invoice(uuid, boolean) from public, anon;
grant execute on function lab_customer_set_no_invoice(uuid, boolean) to authenticated;

-- 4) Toplu geçiş: önizleme + uygula
create or replace function cari_model_preview() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company();
begin
  if not has_role(c, array['owner']::app_role[]) then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'customers', (select count(*) from lab_customers where company_id = c),
    'already', (select count(*) from lab_customers where company_id = c and internal_book),
    'no_invoice', (select count(*) from lab_customers where company_id = c and no_invoice),
    'parties_linked', (select count(*) from fin_parties p join lab_customers lc on lc.id = p.lab_customer_id where lc.company_id = c),
    'customers_without_party', (select count(*) from lab_customers lc where lc.company_id = c and not exists (select 1 from fin_parties p where p.lab_customer_id = lc.id)),
    'unlinked_parties', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'kind', p.kind, 'currency', p.currency) order by p.name), '[]') from fin_parties p
                          where p.company_id = c and p.lab_customer_id is null and p.kind in ('customer', 'both')),
    'invoices', (select count(*) from inv_invoices i join fin_parties p on p.id = i.party_id join lab_customers lc on lc.id = p.lab_customer_id where lc.company_id = c and i.direction = 'sale'),
    'openings', (select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'amount', p.opening_balance, 'currency', p.currency) order by p.name), '[]') from fin_parties p
                  join lab_customers lc on lc.id = p.lab_customer_id where lc.company_id = c and p.opening_balance <> 0),
    'payments_both', (select count(*) from lab_payments lp join lab_customers lc on lc.id = lp.customer_id where lc.company_id = c and lp.book = 'both'),
    'payments_official', (select count(*) from lab_payments lp join lab_customers lc on lc.id = lp.customer_id where lc.company_id = c and lp.book = 'official'),
    'payments_internal', (select count(*) from lab_payments lp join lab_customers lc on lc.id = lp.customer_id where lc.company_id = c and lp.book = 'internal')
  );
end $$;
revoke execute on function cari_model_preview() from public, anon;
grant execute on function cari_model_preview() to authenticated;

-- p_reset_opening: hekime bağlı cari kartların açılış bakiyesini sıfırlar (iç cari geçişinde kendiliğinden yazılmış tutarlar)
create or replace function cari_model_apply(p_reset_opening boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); n_c int; n_p int; n_o int := 0; n_new int;
begin
  if not has_role(c, array['owner']::app_role[]) then raise exception 'not_allowed'; end if;
  perform set_config('app.skip_audit', 'on', true);
  -- cari kartı olmayan hekime cari kart (lab_customers güncelleme tetikleyicisi açar)
  update lab_customers lc set updated_at = now() where lc.company_id = c and not exists (select 1 from fin_parties p where p.lab_customer_id = lc.id);
  get diagnostics n_new = row_count;
  update lab_customers set internal_book = true, pay_book = case when no_invoice then 'internal' else 'both' end
   where company_id = c and (not internal_book or pay_book is distinct from case when no_invoice then 'internal' else 'both' end);
  get diagnostics n_c = row_count;
  -- tahsilatlar: eşitleme mahsubu yalnız hekim carisi; faturasızda kasaya işlenmemişler yalnız hekim carisi; diğerleri iki cari
  update lab_payments lp set book = case
           when coalesce(lp.legacy_ref, '') like 'dsis-adj:%' then 'internal'
           when lc.no_invoice and lp.fin_txn_id is null then 'internal'
           else 'both' end
    from lab_customers lc
   where lc.id = lp.customer_id and lc.company_id = c
     and lp.book is distinct from case when coalesce(lp.legacy_ref, '') like 'dsis-adj:%' then 'internal' when lc.no_invoice and lp.fin_txn_id is null then 'internal' else 'both' end;
  get diagnostics n_p = row_count;
  if coalesce(p_reset_opening, true) then
    update fin_parties p set opening_balance = 0 from lab_customers lc
     where lc.id = p.lab_customer_id and lc.company_id = c and p.opening_balance <> 0;
    get diagnostics n_o = row_count;
  end if;
  return jsonb_build_object('customers', n_c, 'payments', n_p, 'openings_reset', n_o, 'touched_for_party', n_new);
end $$;
revoke execute on function cari_model_apply(boolean) from public, anon;
grant execute on function cari_model_apply(boolean) to authenticated;

-- 5) Dentalsis tahsilat aktarımı: hekimin para biriminde, kırpılmış açıklamayla bir kez; hekim carisine (faturalıda iki cariye)
create or replace function dsis_import_balance(p_tahsilat jsonb, p_balances jsonb, p_as_of date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := dsis_guard(); r jsonb; v_cust lab_customers; v_amt numeric; v_ref text; v_key text; v_k int; v_seen jsonb := '{}'; v_note text; n_pay int := 0; n_adj int := 0; n_miss int := 0; v_target bigint; v_now bigint; v_diff bigint; v_mis numeric; v_oth numeric;
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
           - coalesce((select sum(amount) from lab_payments where customer_id = v_cust.id and (not v_cust.internal_book or book in ('internal', 'both'))), 0)
           + case when v_cust.internal_book then coalesce(v_cust.internal_opening, 0) else 0 end;
    -- Dentalsis'te hekimin para birimi dışında girilmiş tahsilat (ör. € yerine ₺ seçilmiş): ERP'de hekimin para biriminde sayılır,
    -- Dentalsis'teki o para birimi bakiyesi yalnız bu tahsilatlardan oluşuyorsa hedefe eklenir
    select coalesce(sum((t->>'tutar')::numeric), 0) into v_mis from jsonb_array_elements(coalesce(p_tahsilat, '[]')) t
     where dsis_norm(t->>'cariad') = dsis_norm(v_cust.name) and coalesce((t->>'tutar')::numeric, 0) > 0 and dsis_cur(t->>'para_birimi') <> v_cust.currency
       and upper(coalesce(t->>'aciklama', '')) not like '%DEVİR%' and upper(coalesce(t->>'aciklama', '')) not like '%DEVIR%';
    if v_mis > 0 then
      v_oth := coalesce((r->>'tltutar')::numeric, 0) * (case when v_cust.currency <> 'TRY' then 1 else 0 end)
             + coalesce((r->>'eurotutar')::numeric, 0) * (case when v_cust.currency <> 'EUR' then 1 else 0 end)
             + coalesce((r->>'usdtutar')::numeric, 0) * (case when v_cust.currency <> 'USD' then 1 else 0 end);
      if v_oth = -v_mis then v_target := v_target - round(v_mis * 100)::bigint; end if;
    end if;
    v_diff := v_target - v_now;
    if v_diff > 0 then
      insert into jobs (company_id, no, customer_id, patient, description, in_date, due_date, status, currency, total, delivered_at, flow_stage, created_by, legacy_id)
      values (c, nextval('job_no'), v_cust.id, 'DEVİR BAKİYESİ', 'Dentalsis''teki cari bakiyeye eşitleme (2025''ten devreden bakiye ve düzeltmeler)',
              date '2025-12-31', date '2025-12-31', 'delivered', v_cust.currency, v_diff, (date '2025-12-31' + time '12:00') at time zone 'Europe/Istanbul', 'out', null, -(r->>'id')::bigint);
      n_adj := n_adj + 1;
    elsif v_diff < 0 then
      insert into lab_payments (customer_id, paid_on, amount, currency, method, note, legacy_ref, created_by, book)
      values (v_cust.id, date '2025-12-31', -v_diff, v_cust.currency, 'offset', 'Dentalsis bakiye eşitleme (devir alacak / düzeltme)', 'dsis-adj:' || v_cust.id, null,
              case when v_cust.internal_book then 'internal' else 'official' end);
      n_adj := n_adj + 1;
    end if;
  end loop;
  return jsonb_build_object('payments', n_pay, 'adjusted', n_adj, 'unmatched_payments', n_miss, 'unmatched_names', to_jsonb(missing[1:20]));
end $$;

notify pgrst, 'reload schema';

-- 6) Yeni açılan hekim de bu düzende başlar
alter table lab_customers alter column internal_book set default true;
alter table lab_customers alter column pay_book set default 'both';
notify pgrst, 'reload schema';
