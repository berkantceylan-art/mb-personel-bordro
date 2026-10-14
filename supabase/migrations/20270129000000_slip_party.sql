-- =====================================================================
-- FİŞLİ CARİ: aynı firmanın iki carisi
--  Faturalı cari : faturayla aldığımız mal (resmi). Firmanın asıl cari kartı.
--  Fişli cari    : fişle aldığımız, faturası kesilmeyecek mal. "Firma (fişli)" adıyla ayrı cari kart,
--                  fin_parties.slip_of = faturalı cari. Fiş = cariye borç (fin_txns kind 'purchase_slip').
--  Mal kabulde "Fişli" seçilirse kabul fişli cariye işlenir, onayda tutarı fişli cariye borç yazılır.
--  Ödeme, çek, senet tek kayıtla girilir; aynı tutar iki cariye de düşer (otomatik yansıma).
-- Eski "fiş carisi" kayıtları (faturalı cariye bağlı fişler) fişli cariye taşınır. Tekrar çalıştırılabilir.
-- =====================================================================

alter table fin_parties add column if not exists slip_of uuid references fin_parties (id) on delete restrict;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_parties_slip_self') then
    alter table fin_parties add constraint fin_parties_slip_self check (slip_of is null or slip_of <> id);
  end if;
end $$;
create unique index if not exists fin_parties_slip_uidx on fin_parties (slip_of) where slip_of is not null;

alter table fin_txns drop constraint if exists fin_txns_kind_check;
alter table fin_txns add constraint fin_txns_kind_check check (kind in (
  'opening', 'collection', 'payment', 'transfer', 'income', 'expense', 'exchange',
  'sale_invoice', 'purchase_invoice', 'sale_return', 'purchase_return',
  'cheque_in', 'cheque_out', 'cheque_endorse', 'cheque_collect', 'cheque_bounce', 'cheque_pay', 'cheque_deposit',
  'card_spend', 'card_payment', 'loan_draw', 'loan_payment',
  'advance_give', 'advance_close', 'advance_return', 'partner_in', 'partner_out',
  'credit_sale', 'depreciation', 'stock', 'adjust', 'purchase_slip'));

alter table sup_slips add column if not exists fin_txn_id uuid references fin_txns (id) on delete set null;

-- Firmanın fişli carisi (yoksa açılır). Fişli cari verilirse kendisi döner.
create or replace function fin_party_twin(p_main uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare m fin_parties; v uuid;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_module('stock', 2) or auth.uid() is null) then raise exception 'not_allowed'; end if;
  select * into m from fin_parties where id = p_main and company_id = lab_company();
  if m.id is null then raise exception 'party_required'; end if;
  if m.slip_of is not null then return m.id; end if;
  select id into v from fin_parties where slip_of = m.id;
  if v is not null then return v; end if;
  insert into fin_parties (company_id, name, kind, person_type, phone, email, contact_name, address, district, city, country, iban, currency, payment_term_days, slip_of, note, source)
  values (m.company_id, left(m.name || ' (fişli)', 200), 'supplier', m.person_type, m.phone, m.email, m.contact_name, m.address, m.district, m.city, m.country, m.iban, m.currency,
          m.payment_term_days, m.id, 'Faturasız (fişle) alımlar için. Faturalı cari: ' || left(m.name, 150), 'manual')
  returning id into v;
  return v;
end $$;
revoke execute on function fin_party_twin(uuid) from public, anon;
grant execute on function fin_party_twin(uuid) to authenticated;

-- Fişi fişli cariye borç olarak işle (izin denetimi çağıranlarda)
create or replace function sup_slip_post(p_slip uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare s sup_slips; pt fin_parties; v_txn uuid; v_rate numeric; v_cat uuid; v_stock boolean;
begin
  select * into s from sup_slips where id = p_slip;
  if s.id is null or s.cancelled or s.fin_txn_id is not null then return s.fin_txn_id; end if;
  select * into pt from fin_parties where id = s.party_id;
  select coalesce(add_to_stock, false) into v_stock from stk_receipts where id = s.receipt_id;
  v_cat := coalesce(fin_category(case when v_stock then 'stock' else 'exp_material' end), fin_category('exp_material'), fin_category('exp_other'));
  v_rate := case when pt.currency = 'TRY' then 1 else coalesce(fx_rate(pt.currency, s.slip_date), 1) end;
  insert into fin_txns (company_id, txn_date, kind, description, doc_no, amount, currency, party_id, category_id, ref_type, ref_id, created_by)
  values (s.company_id, s.slip_date, 'purchase_slip', left(coalesce(s.note, 'Fişli alım'), 500), s.doc_no, s.amount, pt.currency, pt.id, v_cat, 'sup_slip', s.id, s.created_by)
  returning id into v_txn;
  insert into fin_moves (txn_id, move_date, party_id, amount, currency, rate, amount_try, description)
  values (v_txn, s.slip_date, pt.id, -s.amount, pt.currency, v_rate, -round(s.amount * v_rate), 'Fişli alım');
  insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
  values (v_txn, s.slip_date, v_cat, s.amount, pt.currency, v_rate, round(s.amount * v_rate), 'Fişli alım');
  update sup_slips set fin_txn_id = v_txn where id = s.id;
  return v_txn;
end $$;
revoke execute on function sup_slip_post(uuid) from public, anon, authenticated;

-- Fiş kaydı: her zaman firmanın fişli carisine yazılır ve cariye borç olarak işlenir
create or replace function sup_slip_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pt fin_parties; v_id uuid; v_amt bigint := nullif(p ->> 'amount', '')::bigint; v_cur text := coalesce(nullif(p ->> 'currency', ''), 'TRY'); v_date date := coalesce(nullif(p ->> 'slip_date', '')::date, current_date); v_conv bigint; v_party uuid;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = (p ->> 'party_id')::uuid and company_id = lab_company()) then raise exception 'party_required'; end if;
  v_party := fin_party_twin((p ->> 'party_id')::uuid);
  select * into pt from fin_parties where id = v_party;
  if coalesce(v_amt, 0) <= 0 then raise exception 'amount_required'; end if;
  v_conv := case when v_cur = pt.currency then v_amt else fin_conv(v_amt, v_cur, pt.currency, v_date) end;
  insert into sup_slips (party_id, slip_date, doc_no, amount, orig_amount, orig_currency, receipt_id, note, photo)
  values (pt.id, v_date, nullif(left(trim(p ->> 'doc_no'), 60), ''), v_conv, case when v_cur <> pt.currency then v_amt end, case when v_cur <> pt.currency then v_cur end,
          nullif(p ->> 'receipt_id', '')::uuid, nullif(left(trim(p ->> 'note'), 300), ''),
          case when coalesce(p ->> 'photo', '') like 'data:image/jpeg;base64,%' and length(p ->> 'photo') <= 900000 then p ->> 'photo' end)
  returning id into v_id;
  perform sup_slip_post(v_id);
  return v_id;
end $$;
revoke execute on function sup_slip_save(jsonb) from public, anon;
grant execute on function sup_slip_save(jsonb) to authenticated;

create or replace function sup_slip_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s sup_slips;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into s from sup_slips where id = p_id and company_id = lab_company() for update;
  if s.id is null then return; end if;
  update sup_slips set cancelled = true, receipt_id = null where id = p_id;
  if s.fin_txn_id is not null then
    update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = 'Fiş iptal edildi' where id = s.fin_txn_id and voided_at is null;
  end if;
end $$;
revoke execute on function sup_slip_cancel(uuid) from public, anon;
grant execute on function sup_slip_cancel(uuid) to authenticated;

-- Fişli alım işlemi finanstan iptal edilirse fiş de iptal sayılır
create or replace function sup_slip_on_void() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null and new.ref_type = 'sup_slip' then
    update sup_slips set cancelled = true, receipt_id = null where id = new.ref_id and not cancelled;
  end if;
  return new;
end $$;
drop trigger if exists fin_txns_slip_void on fin_txns;
create trigger fin_txns_slip_void after update of voided_at on fin_txns for each row execute function sup_slip_on_void();

-- Mal kabul tutarı (izin denetimsiz, iç kullanım): (gelen − hasarlı) × birim maliyet
create or replace function sup_receipt_amount_int(p_receipt uuid) returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(round((l.qty - l.damaged) * coalesce(l.unit_cost, i.purchase_price, 0))), 0)::bigint
  from stk_receipt_lines l left join stk_items i on i.id = l.item_id where l.receipt_id = p_receipt and l.qty - l.damaged > 0;
$$;
revoke execute on function sup_receipt_amount_int(uuid) from public, anon, authenticated;

-- Fişli cariye yapılan mal kabul onaylanınca tutarı fişli cariye borç yazılır (tutar 0 ise fiş bekler)
create or replace function stk_rcv_slip_on_confirm() returns trigger language plpgsql security definer set search_path = public as $$
declare v_amt bigint; v_id uuid;
begin
  if new.status = 'confirmed' and old.status <> 'confirmed'
     and exists (select 1 from fin_parties where id = new.party_id and slip_of is not null)
     and not exists (select 1 from sup_slips where receipt_id = new.id and not cancelled) then
    v_amt := sup_receipt_amount_int(new.id);
    if v_amt > 0 then
      insert into sup_slips (company_id, party_id, slip_date, doc_no, amount, receipt_id, note, created_by)
      values (new.company_id, new.party_id, current_date, new.supplier_doc, v_amt, new.id, left('Mal kabul ' || stk_rcv_no(new) || coalesce(' · ' || new.supplier_doc, ''), 300), auth.uid())
      returning id into v_id;
      perform sup_slip_post(v_id);
    end if;
  end if;
  return new;
end $$;
drop trigger if exists stk_receipts_slip on stk_receipts;
create trigger stk_receipts_slip after update of status on stk_receipts for each row execute function stk_rcv_slip_on_confirm();

-- Mal kabulü firmanın fişli carisine çevir (başlatırken "Fişli" seçildiyse)
create or replace function stk_rcv_use_slip(p_id uuid, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare r stk_receipts; m uuid;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into r from stk_receipts where id = p_id and company_id = lab_company() for update;
  if r.id is null or r.status <> 'open' then raise exception 'bad_status'; end if;
  if r.party_id is null then raise exception 'party_required'; end if;
  if p_on then
    update stk_receipts set party_id = fin_party_twin(r.party_id) where id = p_id;
  else
    select slip_of into m from fin_parties where id = r.party_id;
    if m is not null then update stk_receipts set party_id = m where id = p_id; end if;
  end if;
end $$;
revoke execute on function stk_rcv_use_slip(uuid, boolean) from public, anon;
grant execute on function stk_rcv_use_slip(uuid, boolean) to authenticated;

-- Ödeme / tahsilat / çek / senet: firmanın iki carisinden birine girilince aynı tutar öbürüne de yansır.
-- Yansıma ayrı işlemdir (ref_type 'mirror', ref_id = asıl işlem); kasa / bankayı etkilemez, karşılığı
-- "Fişli / faturalı cari yansıtma" hesabına yazılır. Asıl işlem iptal edilince yansıma da iptal olur.
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, 'slip_mirror', 'Fişli / faturalı cari yansıtma', 'other', true, 99 from companies c
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = 'slip_mirror');

create or replace function sup_mirror_kind(k text) returns boolean language sql immutable as $$
  select k in ('payment', 'collection', 'cheque_out', 'cheque_in', 'cheque_endorse', 'cheque_bounce', 'card_spend', 'transfer', 'exchange', 'advance_close', 'partner_out', 'partner_in');
$$;

create or replace function sup_mirror_move() returns trigger language plpgsql security definer set search_path = public as $$
declare t fin_txns; p fin_parties; v_twin uuid; v_cat uuid; v_id uuid;
begin
  if new.party_id is null then return null; end if;
  select * into t from fin_txns where id = new.txn_id;
  if t.id is null or t.voided_at is not null or coalesce(t.ref_type, '') = 'mirror' or not sup_mirror_kind(t.kind) then return null; end if;
  select * into p from fin_parties where id = new.party_id;
  v_twin := coalesce(p.slip_of, (select id from fin_parties where slip_of = p.id));
  if v_twin is null then return null; end if;
  -- aynı işlem içinde öbür cari zaten varsa (ör. elle ikisine birden) yansıtma yapılmaz
  if exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = v_twin) then return null; end if;
  if exists (select 1 from fin_txns x join fin_moves m on m.txn_id = x.id where x.ref_type = 'mirror' and x.ref_id = t.id and m.party_id = v_twin) then return null; end if;
  v_cat := fin_category('slip_mirror');
  if v_cat is null then return null; end if;
  insert into fin_txns (company_id, txn_date, kind, description, doc_no, amount, currency, party_id, category_id, ref_type, ref_id, created_by)
  values (t.company_id, t.txn_date, t.kind, left('↔ ' || coalesce(t.description, '') || ' (' || p.name || ' carisinden yansıma)', 500), t.doc_no, abs(new.amount), new.currency, v_twin, v_cat, 'mirror', t.id, t.created_by)
  returning id into v_id;
  insert into fin_moves (txn_id, move_date, party_id, amount, currency, rate, amount_try, description)
  values (v_id, new.move_date, v_twin, new.amount, new.currency, new.rate, new.amount_try, 'Yansıma: ' || left(p.name, 200));
  insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description)
  values (v_id, new.move_date, v_cat, -new.amount, new.currency, new.rate, -new.amount_try, 'Yansıma');
  return null;
end $$;
drop trigger if exists fin_moves_mirror on fin_moves;
-- işlem bitince (tüm satırlar yazıldıktan sonra) çalışır
create constraint trigger fin_moves_mirror after insert on fin_moves deferrable initially deferred for each row execute function sup_mirror_move();

create or replace function sup_mirror_void() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.voided_at is not null and old.voided_at is null then
    update fin_txns set voided_at = new.voided_at, voided_by = new.voided_by, void_reason = 'Asıl işlem iptal edildi'
    where ref_type = 'mirror' and ref_id = new.id and voided_at is null;
  end if;
  return new;
end $$;
drop trigger if exists fin_txns_mirror_void on fin_txns;
create trigger fin_txns_mirror_void after update of voided_at on fin_txns for each row execute function sup_mirror_void();

-- Fişli alım ödeme sayılmaz
create or replace function sup_is_payment_kind(k text) returns boolean language sql immutable as $$
  select k not in ('purchase_invoice', 'purchase_return', 'sale_invoice', 'sale_return', 'opening', 'purchase_slip');
$$;

-- Firma bazında iki cari ((−) biz borçluyuz): faturalı ve fişli bakiye, fatura / fiş / ödeme toplamları
drop function if exists sup_pairs();
create or replace function sup_pairs() returns table (
  main_id uuid, name text, currency text, invoice_balance bigint, invoices bigint, slip_id uuid, slip_name text, slip_balance bigint, slips bigint,
  payments bigint, last_slip date, receipts_waiting int
) language sql stable security definer set search_path = public as $$
  with mv as (
    select m.party_id, t.kind, t.ref_type, m.amount from fin_moves m join fin_txns t on t.id = m.txn_id
    where t.voided_at is null and m.party_id is not null and t.company_id = lab_company()
  )
  select m.id, m.name, m.currency,
         (m.opening_balance + coalesce((select sum(amount) from mv where mv.party_id = m.id), 0))::bigint,
         coalesce((select -sum(amount) from mv where mv.party_id = m.id and mv.kind in ('purchase_invoice', 'purchase_return')), 0)::bigint,
         t.id, t.name,
         (t.opening_balance + coalesce((select sum(amount) from mv where mv.party_id = t.id), 0))::bigint,
         coalesce((select -sum(amount) from mv where mv.party_id = t.id and mv.kind = 'purchase_slip'), 0)::bigint,
         coalesce((select sum(amount) from mv where mv.party_id = m.id and sup_mirror_kind(mv.kind)), 0)::bigint,
         (select max(x.slip_date) from sup_slips x where x.party_id = t.id and not x.cancelled),
         (select count(*)::int from stk_receipts r where r.party_id = t.id and r.status = 'confirmed' and not exists (select 1 from sup_slips x where x.receipt_id = r.id and not x.cancelled))
  from fin_parties m join fin_parties t on t.slip_of = m.id
  where m.company_id = lab_company() and (can_module('finance') or can_module('purchases'))
  order by m.name;
$$;
revoke execute on function sup_pairs() from public, anon;
grant execute on function sup_pairs() to authenticated;

-- Eski kayıtlar: faturalı cariye yazılmış fişler ve fiş carisi açılışları fişli cariye taşınır
do $$
declare r record; v_twin uuid;
begin
  for r in select distinct s.party_id from sup_slips s join fin_parties p on p.id = s.party_id where p.slip_of is null loop
    v_twin := fin_party_twin(r.party_id);
    update sup_slips set party_id = v_twin where party_id = r.party_id;
  end loop;
  for r in select o.* from sup_slip_open o join fin_parties p on p.id = o.party_id where p.slip_of is null and o.amount <> 0 loop
    v_twin := fin_party_twin(r.party_id);
    update fin_parties set opening_balance = r.amount, opening_date = coalesce(r.as_of, current_date) where id = v_twin and opening_balance = 0;
    delete from sup_slip_open where party_id = r.party_id;
  end loop;
  for r in select s.id from sup_slips s join fin_parties p on p.id = s.party_id where p.slip_of is not null and not s.cancelled and s.fin_txn_id is null loop
    perform sup_slip_post(r.id);
  end loop;
  -- eski düzende ödemeler fiş carisine de sayılıyordu: taşınan cariler için geçmiş ödemeler yansıtılır
  for r in
    select m.id, m.txn_id, m.party_id, m.amount, m.currency, m.rate, m.amount_try, m.move_date, t.kind, t.description, t.doc_no, t.company_id, t.txn_date, t.created_by, tw.id twin, p.name pname
    from fin_moves m join fin_txns t on t.id = m.txn_id join fin_parties p on p.id = m.party_id join fin_parties tw on tw.slip_of = p.id
    where t.voided_at is null and coalesce(t.ref_type, '') <> 'mirror' and sup_mirror_kind(t.kind)
      and not exists (select 1 from fin_txns x where x.ref_type = 'mirror' and x.ref_id = t.id)
      and not exists (select 1 from fin_moves y where y.txn_id = t.id and y.party_id = tw.id)
  loop
    declare v_id uuid; v_cat uuid := fin_category('slip_mirror');
    begin
      if v_cat is null then continue; end if;
      insert into fin_txns (company_id, txn_date, kind, description, doc_no, amount, currency, party_id, category_id, ref_type, ref_id, created_by)
      values (r.company_id, r.txn_date, r.kind, left('↔ ' || coalesce(r.description, '') || ' (' || r.pname || ' carisinden yansıma)', 500), r.doc_no, abs(r.amount), r.currency, r.twin, v_cat, 'mirror', r.txn_id, r.created_by)
      returning id into v_id;
      insert into fin_moves (txn_id, move_date, party_id, amount, currency, rate, amount_try, description) values (v_id, r.move_date, r.twin, r.amount, r.currency, r.rate, r.amount_try, 'Yansıma');
      insert into fin_moves (txn_id, move_date, category_id, amount, currency, rate, amount_try, description) values (v_id, r.move_date, v_cat, -r.amount, r.currency, r.rate, -r.amount_try, 'Yansıma');
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
