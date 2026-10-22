-- =====================================================================
-- MUHASEBE DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) Kilitli (ya da yılı kapanmış) döneme geri tarihli finans işlemi artık "takılı" fiş bırakmaz: fiş ilk açık
--     güne (kilit tarihinin ertesi günü / kapanmış yılın ertesi yılı başı) yazılır, açıklamasına asıl tarih eklenir.
--     Önceden fiş "pending · Hata: gl_locked" kalıyor; yeniden deneme, muhasebe dışı sayma ve iptal çalışmıyor,
--     sonraki ayların kilidi ve yıl kapanışı engelleniyordu. Kilitli tarihte duran kayıtsız (taslak / bekleyen)
--     fişler artık iptal edilebilir ya da muhasebe dışı sayılabilir; "Yeniden dene" tek bir hatalı kayıtta durmaz.
--  2) Onay bekleyen (taslak) fiş varken yıl kapanışı yapılmaz; KDV'li taslak ya da eşleştirme bekleyen fiş varken
--     o ayın KDV mahsubu yapılmaz. Kapanmış yıla düşen taslak onaylanmaz (atlanır).
--  3) Dönem sonu: bu ay amortismanı ayrılmış demirbaş "bekleyen" sayılmaz; kontrol uyarısı kalkar.
--  4) Onaylı modda onaylanmış fişi yalnız onay yetkilisi (muhasebe "Tam yetki") iptal eder ya da yeniden üretir.
--  5) Kapanmış yıla ait işlem sonradan iptal edilince kapanmış yıldaki fiş bozulmaz: kilitli dönemdeki gibi açık
--     döneme ters kayıt atılır.
-- Fonksiyonların veritabanındaki geçerli tanımı yamalanır. Tekrar çalıştırılabilir.
-- Önce 20270218000000_gl_checks.sql ve 20270214000000_period_end.sql.
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
-- İlk açık gün: kilit tarihinden ve kapanmış yıllardan sonraki ilk tarih (tarih açıksa kendisi)
-- ---------------------------------------------------------------------
create or replace function gl_open_date(p_company uuid, p_date date) returns date
language plpgsql stable security definer set search_path = public as $$
declare d date := p_date; l date;
begin
  if d is null then return null; end if;
  select lock_date into l from gl_settings where company_id = p_company;
  if l is not null and d <= l then d := l + 1; end if;
  while exists (select 1 from gl_vouchers where company_id = p_company and tag = 'closebs:' || extract(year from d)::int and status = 'posted') loop
    d := make_date(extract(year from d)::int + 1, 1, 1);
  end loop;
  return d;
end $$;
revoke execute on function gl_open_date(uuid, date) from public, anon;
grant execute on function gl_open_date(uuid, date) to authenticated;

-- ---------------------------------------------------------------------
-- Kilit koruması: yalnız kayıtlı (posted) fiş korunur; kayıtsız fiş kilitli tarihte iptal / muhasebe dışı olabilir
-- ---------------------------------------------------------------------
create or replace function gl_lock_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('gl.unlock', true) = 'on' or current_setting('app.resetting', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  -- kilitli dönemdeki kayıtlı fiş değişmez / silinmez
  if tg_op in ('UPDATE', 'DELETE') and old.status = 'posted' and gl_locked(old.company_id, old.voucher_date)
     and (tg_op = 'DELETE' or new.status <> old.status or new.voucher_date <> old.voucher_date) then
    raise exception 'gl_locked';
  end if;
  -- kilitli tarihe kayıtlı fiş girmez (yeni, tarihi değişen ya da kayda dönen)
  if tg_op in ('INSERT', 'UPDATE') and new.status = 'posted' and gl_locked(new.company_id, new.voucher_date)
     and (tg_op = 'INSERT' or new.voucher_date <> old.voucher_date or old.status <> 'posted') then
    raise exception 'gl_locked';
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------
-- ERP işleminden fiş: kapalı döneme düşen işlem ilk açık güne yazılır; kapanmış yıl kilit gibi korunur
-- ---------------------------------------------------------------------
select _mig_patch('gl_post_txn(uuid)',
  $x$v_rd date; dsum bigint; csum bigint;$x$,
  $x$v_rd date; dsum bigint; csum bigint; v_vd date; v_note text := '';$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$  select * into v from gl_vouchers where fin_txn_id = t.id;
$x$,
  $x$  select * into v from gl_vouchers where fin_txn_id = t.id;
  -- kilitli ya da yılı kapanmış tarihli işlem: fiş ilk açık güne
  v_vd := gl_open_date(t.company_id, t.txn_date);
  if v_vd <> t.txn_date then v_note := ' · asıl tarih ' || to_char(t.txn_date, 'DD.MM.YYYY') || ' (kapalı dönem)'; end if;
$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$    if v.status = 'posted' and gl_locked(t.company_id, v.voucher_date) then$x$,
  $x$    if v.status = 'posted' and gl_open_date(t.company_id, v.voucher_date) <> v.voucher_date then$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$        v_rd := greatest(current_date, s.lock_date + 1);$x$,
  $x$        v_rd := greatest(current_date, gl_open_date(t.company_id, v.voucher_date));$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$(v.status = 'posted' and gl_locked(t.company_id, v.voucher_date))) then return v.id; end if;$x$,
  $x$(v.status = 'posted' and gl_open_date(t.company_id, v.voucher_date) <> v.voucher_date)) then return v.id; end if;$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$    values (t.company_id, extract(year from t.txn_date)::int, gl_next_no(t.company_id, extract(year from t.txn_date)::int), t.txn_date, 'mahsup', 'auto', 'pending',
            left(coalesce(t.description, t.kind), 500), v_doc_type, left(v_doc_no, 60), v_doc_date, t.id)
    returning * into v;
  end if;$x$,
  $x$    values (t.company_id, extract(year from v_vd)::int, gl_next_no(t.company_id, extract(year from v_vd)::int), v_vd, 'mahsup', 'auto', 'pending',
            left(coalesce(t.description, t.kind) || v_note, 500), v_doc_type, left(v_doc_no, 60), v_doc_date, t.id)
    returning * into v;
  elsif v.year <> extract(year from v_vd)::int then   -- fiş başka yıla taşınıyor: o yılın numarası
    update gl_vouchers set year = extract(year from v_vd)::int, no = gl_next_no(t.company_id, extract(year from v_vd)::int) where id = v.id;
  end if;$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$update gl_vouchers set status = 'excluded', issues = excl, voucher_date = t.txn_date, updated_at = now() where id = v.id;$x$,
  $x$update gl_vouchers set status = 'excluded', issues = excl, voucher_date = v_vd, updated_at = now() where id = v.id;$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$           voucher_date = t.txn_date, updated_at = now() where id = v.id;$x$,
  $x$           voucher_date = v_vd, updated_at = now() where id = v.id;$x$);
select _mig_patch('gl_post_txn(uuid)',
  $x$kind = v_kind, voucher_date = t.txn_date, description = left(coalesce(t.description, t.kind), 500),$x$,
  $x$kind = v_kind, voucher_date = v_vd, description = left(coalesce(t.description, t.kind) || v_note, 500),$x$);

-- "Yeniden dene": tek bir hatalı kayıt turu durdurmaz
create or replace function gl_repost_pending() returns integer
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  for r in select fin_txn_id from gl_vouchers where company_id = lab_company() and status = 'pending' and fin_txn_id is not null loop
    begin
      perform gl_post_txn(r.fin_txn_id); n := n + 1;
    exception when others then
      update gl_vouchers set issues = left('Hata: ' || sqlerrm, 1000), updated_at = now() where fin_txn_id = r.fin_txn_id and status = 'pending';
    end;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Yıl kapanışı ve KDV mahsubu: onay / eşleştirme bekleyen fiş varken yapılmaz
-- ---------------------------------------------------------------------
select _mig_patch('gl_close_year(integer)',
  $x$  if exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'pending' and voucher_date between f and t) then raise exception 'gl_pending_in_year'; end if;$x$,
  $x$  if exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'pending' and voucher_date between f and t) then raise exception 'gl_pending_in_year'; end if;
  if exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'draft' and voucher_date between f and t
               and coalesce(tag, '') not like 'close%:' || p_year) then raise exception 'gl_drafts_in_year'; end if;$x$);

select _mig_patch('gl_vat_close(text)',
  $x$  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
$x$,
  $x$  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
  -- ayın KDV'sini etkileyebilecek bekleyen fiş (eşleştirme bekleyen ya da 191 / 391 satırlı taslak) varken mahsup yapılmaz
  if exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.voucher_date between date_trunc('month', d)::date and d
               and coalesce(v.tag, '') <> 'vat:' || p_month
               and (v.status = 'pending' or (v.status = 'draft' and exists (select 1 from gl_lines l join gl_accounts a on a.id = l.account_id
                                                                          where l.voucher_id = v.id and left(a.code, 3) in ('191', '391'))))) then
    raise exception 'gl_drafts_in_month';
  end if;
$x$);

-- onay: kapanmış yıla ya da kilitli tarihe düşen taslak atlanır
select _mig_patch('gl_approve(uuid[])',
  $x$if d = 0 or d <> c or gl_locked(lab_company(), r.voucher_date) then$x$,
  $x$if d = 0 or d <> c or gl_open_date(lab_company(), r.voucher_date) <> r.voucher_date then$x$);

-- ---------------------------------------------------------------------
-- Dönem sonu: bu ay amortismanı ayrılmış demirbaş bekleyen sayılmaz
-- ---------------------------------------------------------------------
select _mig_patch('gl_period_checklist(text)',
  $x$                     and coalesce((select sum(amount) from asset_depreciation d where d.asset_id = a.id and d.period < f), 0) + a.reval_accum < a.value + a.reval_cost - a.salvage_value)),$x$,
  $x$                     and coalesce((select sum(amount) from asset_depreciation d where d.asset_id = a.id and d.period < f), 0) + a.reval_accum < a.value + a.reval_cost - a.salvage_value
                     and not exists (select 1 from asset_depreciation d where d.asset_id = a.id and d.period = f))),$x$);

-- ---------------------------------------------------------------------
-- Onaylı modda onaylanmış fiş: iptal ve yeniden üretim yalnız onay yetkilisi
-- ---------------------------------------------------------------------
select _mig_patch('gl_voucher_cancel(uuid)',
  $x$  if v.source = 'auto' and v.status = 'posted' then raise exception 'gl_auto_voucher'; end if;$x$,
  $x$  if v.source = 'auto' and v.status = 'posted' then raise exception 'gl_auto_voucher'; end if;
  if v.status = 'posted' and gl_approval_on(v.company_id) and not can_module('ledger', 3) then raise exception 'not_allowed'; end if;$x$);
select _mig_patch('gl_tag_voucher(text, date, text, text, text)',
  $x$    if gl_locked(lab_company(), old.voucher_date) then raise exception 'gl_locked'; end if;$x$,
  $x$    if gl_locked(lab_company(), old.voucher_date) then raise exception 'gl_locked'; end if;
    if old.status = 'posted' and gl_approval_on(old.company_id) and not can_module('ledger', 3) then raise exception 'gl_approved_voucher'; end if;$x$);

drop function _mig_patch(text, text, text);

notify pgrst, 'reload schema';
