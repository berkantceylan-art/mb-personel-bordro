-- =====================================================================
-- SATIŞ, HEKİM CARİSİ, SATIN ALMA VE ONAY DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) Cari kart (fin_party_balances / fin_party_balance_at): eski cari düzeninde işlerden kesilmiş faturaların
--     (yalnız KDV'si cariye yazılmış, affects_balance = false) matrahı iç hesap düzenindeki hekimin cari kartına
--     eklenir. Önceden toplu geçişten sonra 11.000'lik fatura cari kartta 1.000 görünüyordu.
--  2) Dentalsis aktarımı: ülkesi "Türkiye" (küçük harfle) yazılı hekim yurt içi / TL açılır; ülke düzeltme adımı
--     yanlışlıkla yabancı açılmış yurt içi hekimi de geri çevirir.
--  3) Dökümü (hesap özeti / fatura) kesilmiş irsaliyedeki iş ya da faturası kesilmiş iş iptal edilemez,
--     teslimden çıkarılamaz: önce döküm / fatura iptal edilmeli. (Dentalsis eşitlemesi bu kontrolden muaftır.)
--  4) Satış iadesi bizim e-Arşiv / e-Fatura serimizden numara almaz (iade belgesini müşteri keser).
--  5) Excel fatura aktarımında yeni açılan yabancı müşterinin ülkesi boşsa "TR" yazılmaz.
--  6) Satın alma bütçesi: siparişten oluşturulan taslak fatura siparişi bütçeden düşürmez; yalnız işlenmiş fatura düşürür.
--  7) Silinen masraf beyanının / satın alma siparişinin bekleyen onay talebi iptal edilir.
--  8) Onay akışı silinince bekleyen talepler iptal edilip uygun akışla yeniden başlatılır (belge kilitli kalmaz).
-- Tekrar çalıştırılabilir. Önce 20270260000000_cari_model.sql, 20270261000000_inv_import.sql,
-- 20270243000000_purchasing_p3.sql, 20270231000000_dentalsis_import.sql.
-- =====================================================================

create or replace function _mig_patch(p_sig text, p_old text, p_new text) returns void language plpgsql as $$
declare d text;
begin
  select pg_get_functiondef(p_sig::regprocedure) into d;
  if position(p_new in d) > 0 then return; end if;                 -- zaten yamalı
  if position(p_old in d) = 0 then raise exception 'Yama uygulanamadı: %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ---------------------------------------------------------------------
-- 1) Cari kart: eski düzende işlerden kesilmiş faturaların matrahı (iade ise eksi)
-- ---------------------------------------------------------------------
create or replace function fin_legacy_invoice_base(p_party uuid, p_currency text, p_date date default null)
returns bigint language sql stable set search_path = public as $$
  select coalesce(sum(
           (case when i.type = 'return' then -1 else 1 end)
           * case when i.currency = p_currency then i.total - (i.vat_total - i.withholding_total)
                  else round((i.total - (i.vat_total - i.withholding_total)) * i.rate
                             / coalesce(case when p_currency = 'TRY' then 1 else fx_rate(p_currency, i.invoice_date) end, i.rate)) end), 0)::bigint
  from inv_invoices i
  where i.party_id = p_party and i.direction = 'sale' and i.status = 'posted' and not i.affects_balance
    and (p_date is null or i.invoice_date <= p_date);
$$;
revoke execute on function fin_legacy_invoice_base(uuid, text, date) from public, anon;
grant execute on function fin_legacy_invoice_base(uuid, text, date) to authenticated;

create or replace view fin_party_balances with (security_invoker = true) as
select p.id as party_id, p.name, p.kind, p.currency, p.lab_customer_id,
       p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)
       + case when coalesce(c.internal_book, false) then
           -- eski düzende kesilmiş (yalnız KDV'si cariye yazılmış) faturaların matrahı
           fin_legacy_invoice_base(p.id, p.currency)
           - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.book in ('official', 'both')), 0)
         else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered'), 0)
           - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null), 0)
         end as balance
from fin_parties p
left join lab_customers c on c.id = p.lab_customer_id;

select _mig_patch('fin_party_balance_at(uuid, date, text)',
  $x$       + case when coalesce(c.internal_book, false) then
           - coalesce($x$,
  $x$       + case when coalesce(c.internal_book, false) then
           fin_legacy_invoice_base(p.id, p.currency, p_date)   -- eski düzende kesilmiş faturaların matrahı
           - coalesce($x$);

-- ---------------------------------------------------------------------
-- 2) Dentalsis: "Türkiye" yurt içidir
-- ---------------------------------------------------------------------
select _mig_patch('dsis_import_ref(jsonb, jsonb)',
  $x$      if upper(v_country) in ('TÜRKİYE', 'TURKIYE', 'TURKEY', 'TR') then v_country := 'TR'; end if;$x$,
  $x$      if not lab_is_foreign(v_country, null) then v_country := 'TR'; end if;   -- Türkiye / TÜRKİYE / Turkey / TR$x$);

create or replace function dsis_fix_customer_country(p_cari jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid := dsis_guard(); r jsonb; v_country text; n int := 0; n_tr int := 0;
begin
  perform set_config('app.skip_audit', 'on', true);
  for r in select * from jsonb_array_elements(coalesce(p_cari, '[]')) loop
    v_country := nullif(trim(r->>'ulke'), '');
    if v_country is null then continue; end if;
    if lab_is_foreign(v_country, null) then
      update lab_customers set country = left(v_country, 60), kind = case when kind = 'doctor_tr' then 'doctor_foreign' else kind end
      where company_id = c and legacy_id = (r->>'id')::bigint and not lab_is_foreign(country, kind);
      if found then n := n + 1; end if;
    else
      -- yanlışlıkla yabancı açılmış yurt içi hekim (ör. "Türkiye" yazımı) geri çevrilir
      update lab_customers set country = 'TR', kind = 'doctor_tr'
      where company_id = c and legacy_id = (r->>'id')::bigint and kind = 'doctor_foreign' and not lab_is_foreign(country, null);
      if found then n_tr := n_tr + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('customers_foreign', n, 'customers_domestic', n_tr);
end $$;

-- ---------------------------------------------------------------------
-- 3) Faturası / dökümü kesilmiş iş iptal edilemez, teslimden çıkarılamaz
-- ---------------------------------------------------------------------
create or replace function jobs_doc_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.bulk', true) = 'on' then return new; end if;     -- Dentalsis eşitlemesi
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'cancelled' and old.invoice_id is not null
     and exists (select 1 from inv_invoices i where i.id = old.invoice_id and i.status = 'posted') then
    raise exception 'job_invoiced';
  end if;
  if old.status = 'delivered' and new.status <> 'delivered' and old.waybill_id is not null
     and exists (select 1 from lab_waybills w join lab_statements s on s.id = w.statement_id
                 where w.id = old.waybill_id and s.status <> 'cancelled') then
    raise exception 'statement_issued';
  end if;
  return new;
end $$;
drop trigger if exists jobs_doc_guard on jobs;
create trigger jobs_doc_guard before update of status on jobs for each row execute function jobs_doc_guard();

-- ---------------------------------------------------------------------
-- 4) Satış iadesi bizim serimizden numara almaz
-- ---------------------------------------------------------------------
select _mig_patch('inv_post(uuid)',
  $x$  if (v.direction = 'sale' or (v.direction = 'purchase' and v.type = 'return')) and v.doc_no is null and v.profile <> 'KAGIT'$x$,
  $x$  if ((v.direction = 'sale' and v.type = 'invoice') or (v.direction = 'purchase' and v.type = 'return')) and v.doc_no is null and v.profile <> 'KAGIT'$x$);

-- ---------------------------------------------------------------------
-- 5) Excel aktarımı: yabancı yeni carinin ülkesi "TR" olmaz
-- ---------------------------------------------------------------------
select _mig_patch('inv_import_external(jsonb)',
  $x$coalesce(nullif(r->'new_party'->>'country', ''), 'TR'),$x$,
  $x$coalesce(nullif(r->'new_party'->>'country', ''),
                           case when coalesce(r->>'profile', '') = 'IHRACAT' or coalesce(nullif(r->'new_party'->>'currency', ''), 'TRY') <> 'TRY'
                                then 'YURTDIŞI' else 'TR' end),$x$);

-- ---------------------------------------------------------------------
-- 6) Bütçe: yalnız işlenmiş fatura siparişi taahhütten çıkarır
-- ---------------------------------------------------------------------
select _mig_patch('pur_budget_rows(integer)',
  $x$       and not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status <> 'cancelled')$x$,
  $x$       and not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status = 'posted')   -- taslak fatura taahhüdü düşürmez$x$);
select _mig_patch('pur_budget_rows(integer)',
  $x$where o.company_id = lab_company() and o.status in ('approved', 'sent', 'partial', 'received') and extract$x$,
  $x$where o.company_id = lab_company() and o.status in ('approved', 'sent', 'partial', 'received', 'invoiced') and extract$x$);
select _mig_patch('pur_budget_check(uuid)',
  $x$  if o.status in ('approved', 'sent', 'partial', 'received') and not exists$x$,
  $x$  if o.status in ('approved', 'sent', 'partial', 'received', 'invoiced') and not exists$x$);
select _mig_patch('pur_budget_check(uuid)',
  $x$not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status <> 'cancelled') then v_used := v_used - v_this; end if;$x$,
  $x$not exists (select 1 from inv_invoices i where i.po_id = o.id and i.status = 'posted') then v_used := v_used - v_this; end if;$x$);

-- ---------------------------------------------------------------------
-- 7) Silinen belgenin bekleyen onay talebi iptal edilir
-- ---------------------------------------------------------------------
create or replace function apr_cancel_on_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update apr_requests set status = 'cancelled', decided_at = now()
   where entity = tg_argv[0] and entity_id = old.id and status = 'pending';
  return old;
end $$;
drop trigger if exists exp_claims_apr_cancel on exp_claims;
create trigger exp_claims_apr_cancel after delete on exp_claims for each row execute function apr_cancel_on_delete('expense_claim');
drop trigger if exists pur_orders_apr_cancel on pur_orders;
create trigger pur_orders_apr_cancel after delete on pur_orders for each row execute function apr_cancel_on_delete('purchase_order');
-- geçmişte silinmiş belgelerin açık kalmış talepleri
update apr_requests r set status = 'cancelled', decided_at = now()
 where r.status = 'pending'
   and ((r.entity = 'expense_claim' and not exists (select 1 from exp_claims e where e.id = r.entity_id))
     or (r.entity = 'purchase_order' and not exists (select 1 from pur_orders o where o.id = r.entity_id)));

-- ---------------------------------------------------------------------
-- 8) Akış silinince bekleyen talepler yeniden başlar
-- ---------------------------------------------------------------------
select _mig_patch('apr_flow_save(jsonb)',
  $x$  if coalesce((p->>'delete')::boolean, false) then delete from apr_flows where id = v_id; return v_id; end if;$x$,
  $x$  if coalesce((p->>'delete')::boolean, false) then
    -- bekleyen talepler: iptal edilip kalan akışlarla yeniden başlatılır (uygun akış yoksa iptal kalır, belge kilitlenmez)
    declare r apr_requests; v_cat uuid := (select category_id from apr_flows where id = v_id);
    begin
      delete from apr_flows where id = v_id;
      for r in select * from apr_requests where flow_id is null and status = 'pending' and company_id = lab_company() loop
        update apr_requests set status = 'cancelled', decided_at = now() where id = r.id;
        perform apr_start(r.entity, r.entity_id, r.amount,
                          case when r.entity = 'expense_claim' then (select e.category_id from exp_claims e where e.id = r.entity_id) else v_cat end,
                          r.employee_id, r.title, r.link);
      end loop;
    end;
    return v_id;
  end if;$x$);

-- geçmişte akışı silinmiş (onaylayıcısız kalmış) bekleyen talepler bir kez yeniden başlatılır
do $$
declare r apr_requests;
begin
  for r in select * from apr_requests where flow_id is null and status = 'pending' loop
    update apr_requests set status = 'cancelled', decided_at = now() where id = r.id;
    perform apr_start(r.entity, r.entity_id, r.amount,
                      case when r.entity = 'expense_claim' then (select e.category_id from exp_claims e where e.id = r.entity_id) end,
                      r.employee_id, r.title, r.link);
  end loop;
end $$;

drop function _mig_patch(text, text, text);

notify pgrst, 'reload schema';
