-- =====================================================================
-- BORDRO VE FİNANS DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) Personel carisi "Hareketi düzenle" (correct_ledger_entry):
--     - Kasa / banka ödemesine, fazla mesaiye, parça başına, prime, avans talebine ya da icra / BES kesintisine bağlı
--       hareket düzeltilemez (önceden kasa eski tutarda kalıyor, düzeltilen fazla mesai iki kez ödeniyordu).
--       Bu hareketler kaynağından iptal edilip yeniden girilir.
--     - Diğer hareketlerde tür değişmiyorsa resmi / elden tarafı, resmi brüt ve gün sayısı korunur
--       (önceden düzeltilen rapor kesintisinin eksik günü bordrodan kayboluyordu).
--  2) İcra / BES kesintisi caride "Sil" ile iptal edilemez; Bordro › kesintileri geri al kullanılır
--     (önceden icra dosyası ödenmiş görünmeye devam ediyordu).
--  3) Kredi taksiti anaparadan az ödenemez (önceden eksi faiz gideri yazılıp taksit kapanıyordu).
--  4) Banka ekstresinden işlenmiş bir işlem iptal edilince ekstre satırı yeniden işlenmeye açılır.
--  5) Yalnız masraf yetkisi olan kullanıcı "masraf" adıyla cariye ödeme ya da hesaplar arası aktarım kaydedemez.
-- Tekrar çalıştırılabilir.
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
-- 1) Cari hareket düzeltme
-- ---------------------------------------------------------------------
create or replace function correct_ledger_entry(p_id uuid, p_entry_date date, p_type ledger_type, p_channel ledger_channel, p_amount bigint,
                                                p_period character, p_note text, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare old ledger_entries; new_id uuid; v_same boolean;
begin
  select * into old from ledger_entries where id = p_id for update;
  if old.id is null or not can_manage_pay(old.company_id) then raise exception 'Yetki yok'; end if;
  if old.voided_at is not null then raise exception 'Bu hareket zaten iptal edilmiş'; end if;
  if coalesce(length(p_reason), 0) = 0 then raise exception 'Düzeltme gerekçesi zorunlu'; end if;

  -- bağlı kayıttan gelen hareket burada düzeltilmez (kasa / banka, fazla mesai, prim, parça başı, icra / BES)
  if old.fin_txn_id is not null then
    raise exception 'Bu hareket kasa / banka ödemesine bağlı; tutarı düzeltmek için hareketi silin (ödeme de geri alınır) ve ödemeyi yeniden girin.';
  end if;
  if old.type in ('BES', 'GARNISHMENT') or exists (select 1 from garnishment_deductions where ledger_entry_id = old.id) then
    raise exception 'Bu hareket bordro kesintisi (icra / BES); Bordro ekranından kesintileri geri alıp yeniden yazın.';
  end if;
  if exists (select 1 from overtime_ledger_links where ledger_entry_id = old.id)
     or exists (select 1 from overtime_records where ledger_entry_id = old.id) then
    raise exception 'Bu hareket fazla mesaiden geliyor; Fazla mesai ekranından geri alıp yeniden onaylayın.';
  end if;
  if exists (select 1 from pc_entries where ledger_entry_id = old.id)
     or exists (select 1 from prd_bonus_lines where ledger_entry_id = old.id) then
    raise exception 'Bu hareket parça başı / prim aktarımından geliyor; aktarımı geri alıp yeniden aktarın.';
  end if;
  if exists (select 1 from advance_requests where ledger_entry_id = old.id) then
    raise exception 'Bu hareket bir avans talebinden geliyor; talebi geri alıp yeniden onaylayın.';
  end if;

  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Düzeltildi: ' || p_reason
  where id = p_id;

  -- tür ve kanal aynıysa resmi / elden tarafı, resmi brüt ve gün korunur (bordro eksik günü ve resmi brütü buradan okur)
  v_same := p_type = old.type and p_channel = old.channel;
  insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note,
                              receipt_path, signature_path, bank_reference, corrects_id, pay_side, gross_amount, days)
  values (old.company_id, old.employee_id, p_period, p_entry_date, p_type, p_channel, p_amount, p_note,
          old.receipt_path, old.signature_path, old.bank_reference, old.id,
          case when v_same then old.pay_side end, case when v_same then old.gross_amount end, case when v_same then old.days end)
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------
-- 2) İcra / BES kesintisi cariden silinemez
-- ---------------------------------------------------------------------
select _mig_patch('void_ledger_entry(uuid, text)',
  $x$  if coalesce(length(p_reason), 0) = 0 then
    raise exception 'İptal gerekçesi zorunlu';
  end if;$x$,
  $x$  if coalesce(length(p_reason), 0) = 0 then
    raise exception 'İptal gerekçesi zorunlu';
  end if;
  -- icra / BES kesintisi: icra dosyası ve bordro durumu da geri alınmalı
  if exists (select 1 from ledger_entries where id = p_id and voided_at is null and type in ('BES', 'GARNISHMENT'))
     or exists (select 1 from garnishment_deductions where ledger_entry_id = p_id) then
    raise exception 'Bu hareket bordro kesintisi (icra / BES); Bordro ekranından kesintileri geri alın (icra dosyası bakiyesi de düzelir).';
  end if;$x$);

-- ---------------------------------------------------------------------
-- 3) Kredi taksiti anaparadan az ödenemez
-- ---------------------------------------------------------------------
select _mig_patch('fin_loan_pay(uuid, uuid, date, bigint)',
  $x$  v_exp := v_total - i.principal;$x$,
  $x$  if v_total < i.principal then raise exception 'amount_below_principal'; end if;   -- kısmi ödeme yok; eksi faiz yazılmaz
  v_exp := v_total - i.principal;$x$);

-- ---------------------------------------------------------------------
-- 4) İptal edilen işlemin banka ekstresi satırı yeniden işlenebilir
-- ---------------------------------------------------------------------
select _mig_patch('fin_void(uuid, text)',
  $x$  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;$x$,
  $x$  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
  -- bu işlemi oluşturan / eşleşen ekstre satırı yeniden işlenmeye açılır
  update fin_bank_lines set status = 'new', txn_id = null, handled_by = null, handled_at = null
   where txn_id = p_txn and status in ('posted', 'matched');$x$);
select _mig_patch('fin_void_sys(uuid, text)',
  $x$  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;$x$,
  $x$  if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
  update fin_bank_lines set status = 'new', txn_id = null, handled_by = null, handled_at = null
   where txn_id = p_txn and status in ('posted', 'matched');$x$);
-- daha önce iptal edilmiş işleme bağlı kalmış satırlar: "yeniden aç" çalışır
select _mig_patch('fin_bank_mark(uuid, text)',
  $x$where id = p_line and status in ('ignored', 'matched');$x$,
  $x$where id = p_line and (status in ('ignored', 'matched')
                            or (status = 'posted' and exists (select 1 from fin_txns t where t.id = fin_bank_lines.txn_id and t.voided_at is not null)));$x$);
update fin_bank_lines l set status = 'new', txn_id = null, handled_by = null, handled_at = null
 where l.status in ('posted', 'matched') and exists (select 1 from fin_txns t where t.id = l.txn_id and t.voided_at is not null);

-- ---------------------------------------------------------------------
-- 5) Masraf yetkisi yalnız gider kaydı girer
-- ---------------------------------------------------------------------
select _mig_patch('fin_post(jsonb, jsonb)',
  $x$    raise exception 'not_allowed';
  end if;
  return fin_post_sys(p_header, p_lines);$x$,
  $x$    raise exception 'not_allowed';
  end if;
  -- finans yetkisi olmayan masraf kullanıcısı: hesaptan / cariden yalnız çıkış, en az bir gider (ya da KDV) satırı;
  -- cariye ödeme ya da hesaplar arası aktarım kaydedemez
  if v_module = 'expenses' and not can_module('finance', 2) then
    if exists (select 1 from jsonb_array_elements(p_lines) x
                where (nullif(x->>'account_id', '') is not null or nullif(x->>'party_id', '') is not null) and coalesce((x->>'amount')::numeric, 0) > 0)
       or not exists (select 1 from jsonb_array_elements(p_lines) x join fin_categories c on c.id = nullif(x->>'category_id', '')::uuid
                       where c.kind in ('expense', 'vat_in') and coalesce((x->>'amount')::numeric, 0) > 0) then
      raise exception 'not_allowed';
    end if;
  end if;
  return fin_post_sys(p_header, p_lines);$x$);

drop function _mig_patch(text, text, text);

notify pgrst, 'reload schema';
