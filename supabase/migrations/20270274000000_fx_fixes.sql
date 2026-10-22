-- =====================================================================
-- PARA VE DÖVİZ DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) Tahsilat / ödeme (fin_collect_or_pay): cari ile hesap farklı para birimindeyse ve cari tutarı
--     yazılmadıysa hesap tutarı o günün kuruyla cari para birimine çevrilir. Önceden 49.000 TL havale
--     EUR cariden 49.000 € düşüyordu (banka ekstresi aktarımı bu alanı hep boş gönderir).
--  2) Hekim kartından tahsilat (lab_payment_add): kasa / banka başka para birimindeyse hesaba giren tutar
--     kurla hesaplanır. Önceden 100 € tahsilat TL bankaya 100 TL giriyordu.
--  3) İşlerden fatura (inv_from_jobs): yurt dışı alıcıda satırlar %0 KDV ve 301 istisna koduyla gelir.
--     Önceden ihracat faturasına %10 KDV ekleniyordu.
--  4) Mal kabul onayı (stk_rcv_confirm): döviz fiyatlı kartın maliyeti TL'ye çevrilerek stoğa girer.
--     Önceden 100 € blok 100 TL maliyetle giriyordu.
--  5) Teklif kazanınca (pur_rfq_award) kartın alış para birimi de teklifin para birimine güncellenir.
--  6) Kasa / banka bakiyesi tarih itibarıyla (fin_account_balance_at) açılış bakiyesini yeniden içerir.
--     Önceden kasa sayımı açılış tutarı kadar sahte "sayım fazlası" yazıyordu.
-- Fonksiyonların veritabanındaki geçerli tanımı yamalanır. Tekrar çalıştırılabilir.
-- Önce 20270270000000_supplier_stock_backfill.sql.
-- =====================================================================

create or replace function _mig_patch(p_sig text, p_old text, p_new text) returns void language plpgsql as $$
declare d text;
begin
  select pg_get_functiondef(p_sig::regprocedure) into d;
  if position(p_new in d) > 0 then return; end if;                 -- zaten yamalı
  if position(p_old in d) = 0 then raise exception 'Yama uygulanamadı: %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- 1) Tahsilat / ödeme: farklı para biriminde cari tutarı boşsa kurla çevir
select _mig_patch('fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text, text)',
  $x$  s := case when p_kind = 'collection' then 1 else -1 end;$x$,
  $x$  s := case when p_kind = 'collection' then 1 else -1 end;
  -- cari ile hesap farklı para birimindeyse ve cari tutarı verilmediyse hesap tutarı o günün kuruyla çevrilir
  if pt.currency <> a.currency and coalesce(p_party_amount, 0) <= 0 then
    p_party_amount := round(p_amount * (case when a.currency = 'TRY' then 1 else coalesce(p_rate, fin_rate(a.currency, p_date)) end)
                            / fin_rate(pt.currency, p_date));
    if p_party_amount <= 0 then raise exception 'amount'; end if;
  end if;$x$);

-- 2) Hekim kartından tahsilat: hesaba giren tutar boşsa kurla çevir
select _mig_patch('lab_payment_add(uuid, date, bigint, text, text, text, text, uuid, bigint)',
  $x$  select * into a from fin_accounts where id = p_account;
  if a.id is null then raise exception 'not_found'; end if;$x$,
  $x$  select * into a from fin_accounts where id = p_account;
  if a.id is null then raise exception 'not_found'; end if;
  -- kasa / banka başka para birimindeyse ve hesaba giren tutar yazılmadıysa o günün kuruyla çevrilir
  if a.currency <> c.currency and coalesce(p_account_amount, 0) <= 0 then
    p_account_amount := round(p_amount * fin_rate(c.currency, coalesce(p_date, current_date)) / fin_rate(a.currency, coalesce(p_date, current_date)));
    if p_account_amount <= 0 then raise exception 'amount'; end if;
  end if;$x$);

-- 3) İşlerden fatura: yurt dışı alıcıda %0 KDV + 301 (mal ihracatı istisnası)
select _mig_patch('inv_from_jobs(uuid[])',
  $x$  select inv_lab_vat into v_vat from companies where id = lab_company();$x$,
  $x$  select inv_lab_vat into v_vat from companies where id = lab_company();
  -- yurt dışı alıcı: ihracat faturası, KDV %0 ve istisna kodu 301
  if (select coalesce(country, 'TR') not in ('TR', 'Türkiye', 'Turkey') from fin_parties where id = v_party) then v_vat := -1; end if;$x$);
select _mig_patch('inv_from_jobs(uuid[])',
  $x$'discount_pct', v_disc, 'vat_rate', coalesce(v_vat, 10), 'lab_product_id', li.product_id, 'job_id', j.id);$x$,
  $x$'discount_pct', v_disc, 'vat_rate', case when v_vat = -1 then 0 else coalesce(v_vat, 10) end,
        'vat_exemption_code', case when v_vat = -1 then '301' end, 'lab_product_id', li.product_id, 'job_id', j.id);$x$);

-- 4) Mal kabul: döviz fiyatlı kartın maliyeti TL kuruşa çevrilir
select _mig_patch('stk_rcv_confirm(uuid, boolean, text, text, text)',
  $x$coalesce(l.unit_cost, it.purchase_price, 0)$x$,
  $x$coalesce(l.unit_cost, case when coalesce(it.purchase_currency, 'TRY') = 'TRY' then it.purchase_price
                                     else round(it.purchase_price * coalesce(fx_rate(it.purchase_currency, current_date), 1))::bigint end, 0)$x$);

-- 5) Teklif kazanınca kartın fiyatı teklifin para birimiyle yazılır
select _mig_patch('pur_rfq_award(uuid, uuid)',
  $x$update stk_items set purchase_price = l.unit_price, supplier_party_id$x$,
  $x$update stk_items set purchase_price = l.unit_price, purchase_currency = r.currency, supplier_party_id$x$);

drop function _mig_patch(text, text, text);

-- 6) Hesap bakiyesi tarih itibarıyla: açılış bakiyesi dahil (kasa sayımı, "kasa eksi" kontrolü)
create or replace function fin_account_balance_at(p_account uuid, p_date date) returns bigint
language sql stable security definer set search_path = public as $$
  select (case when a.opening_date is null or a.opening_date <= p_date then a.opening_balance else 0 end
          + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id
                       where m.account_id = a.id and t.voided_at is null and m.move_date <= p_date), 0))::bigint
    from fin_accounts a where a.id = p_account and a.company_id = lab_company();
$$;
revoke execute on function fin_account_balance_at(uuid, date) from public, anon;
grant execute on function fin_account_balance_at(uuid, date) to authenticated;

notify pgrst, 'reload schema';
