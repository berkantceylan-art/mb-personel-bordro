-- Fişli / faturalı cari grubu: silme işlemleri (tekrar çalıştırılabilir)
--  sup_row_delete   : ekstredeki tek satır (fiş, ödeme, iskonto, aktarılan satır) iptal edilir
--  sup_import_undo  : "Ekstre aktar" ile gelen tüm satırlar geri alınır (dosya yeniden yüklenebilir)
--  sup_group_remove : firmanın fişli carileri (fişli, iskontosuz fişli, KDV) silinir; faturalı cari kalır

-- grubun tüm carileri (asıl + fişli taraf)
create or replace function sup_group_parties(p_main uuid) returns uuid[] language sql stable security definer set search_path = public as $$
  select array_agg(id) from fin_parties where company_id = lab_company() and (id = p_main or slip_of = p_main);
$$;
revoke execute on function sup_group_parties(uuid) from public, anon, authenticated;

create or replace function sup_row_delete(p_main uuid, p_txn uuid) returns text
language plpgsql security definer set search_path = public as $$
declare t fin_txns; v_ids uuid[] := sup_group_parties(p_main); v_slip uuid;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into t from fin_txns where id = p_txn and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  -- yansıma satırına basıldıysa asıl işlem iptal edilir
  if t.ref_type = 'mirror' and t.ref_id is not null then select * into t from fin_txns where id = t.ref_id for update; end if;
  if not exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = any (v_ids)) then raise exception 'not_in_group'; end if;
  if t.voided_at is not null then return 'already'; end if;
  if t.ref_type = 'invoice' then raise exception 'use_invoice_cancel'; end if;
  select id into v_slip from sup_slips where fin_txn_id = t.id and not cancelled limit 1;
  if v_slip is not null then
    perform sup_slip_cancel(v_slip);
  else
    update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = 'Fişli / faturalı cari ekranından silindi' where id = t.id;
    if t.lab_payment_id is not null then delete from lab_payments where id = t.lab_payment_id; end if;
  end if;
  -- aynı satır ekstreyle tekrar aktarılabilsin
  delete from sup_import_keys where company_id = lab_company() and (txn_id = t.id or (v_slip is not null and slip_id = v_slip));
  return case when v_slip is not null then 'slip' else 'txn' end;
end $$;
revoke execute on function sup_row_delete(uuid, uuid) from public, anon;
grant execute on function sup_row_delete(uuid, uuid) to authenticated;

create or replace function sup_import_undo(p_main uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[] := sup_group_parties(p_main); r record; n_slip int := 0; n_txn int := 0; n_x int;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if v_ids is null then raise exception 'not_found'; end if;
  for r in select k.key, k.slip_id, k.txn_id from sup_import_keys k where k.company_id = lab_company() and k.party_id = any (v_ids) loop
    if r.slip_id is not null and exists (select 1 from sup_slips where id = r.slip_id and not cancelled) then
      perform sup_slip_cancel(r.slip_id); n_slip := n_slip + 1;
    end if;
    if r.txn_id is not null then
      update fin_txns set voided_at = now(), voided_by = auth.uid(), void_reason = 'Ekstre aktarımı geri alındı' where id = r.txn_id and voided_at is null;
      if found then n_txn := n_txn + 1; end if;
    end if;
  end loop;
  -- anahtarı kaybolmuş aktarım satırları (ref_type stmt_import)
  update fin_txns t set voided_at = now(), voided_by = auth.uid(), void_reason = 'Ekstre aktarımı geri alındı'
   where t.company_id = lab_company() and t.ref_type = 'stmt_import' and t.voided_at is null
     and exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = any (v_ids));
  get diagnostics n_x = row_count;
  n_txn := n_txn + n_x;
  delete from sup_import_keys where company_id = lab_company() and party_id = any (v_ids);
  return jsonb_build_object('slips', n_slip, 'txns', n_txn);
end $$;
revoke execute on function sup_import_undo(uuid) from public, anon;
grant execute on function sup_import_undo(uuid) to authenticated;

-- Fişli taraf carilerini sil. p_force=false: yalnız sayımı döner. p_force=true: fiş / yansıma / aktarım / iskonto / KDV kayıtları
-- kalıcı silinir; kasa-banka hareketi olan (fişli cariye doğrudan girilmiş) ödeme varsa durur, önce o ödeme iptal edilmeli.
create or replace function sup_group_remove(p_main uuid, p_force boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_side uuid[]; v_txns uuid[]; n_pay int; n_slips int; n_txn int;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select array_agg(id) into v_side from fin_parties where company_id = c and slip_of = p_main;
  if v_side is null then return jsonb_build_object('removed', 0); end if;
  select array_agg(distinct x) into v_txns from (
    select m.txn_id x from fin_moves m join fin_txns t on t.id = m.txn_id where t.company_id = c and m.party_id = any (v_side)
    union select id from fin_txns where company_id = c and party_id = any (v_side)) q;
  -- kasa / banka ya da grup dışı cari hareketi olan işlem (gerçek ödeme) varsa silinmez
  select count(distinct t.id) into n_pay from fin_txns t
   where t.id = any (coalesce(v_txns, '{}')) and t.voided_at is null
     and exists (select 1 from fin_moves m where m.txn_id = t.id and (m.account_id is not null or (m.party_id is not null and m.party_id <> all (v_side) and m.party_id <> p_main)));
  select count(*) into n_slips from sup_slips where party_id = any (v_side) and not cancelled;
  n_txn := coalesce(array_length(v_txns, 1), 0);
  if not p_force then
    return jsonb_build_object('parties', array_length(v_side, 1), 'slips', n_slips, 'txns', n_txn, 'payments', n_pay);
  end if;
  if n_pay > 0 then raise exception 'has_payments:%', n_pay; end if;
  perform set_config('app.skip_mirror', 'on', true);
  perform set_config('app.skip_audit', 'on', true);
  -- bağlı kayıtlar: mal kabul ve stok hareketleri faturalı cariye geçer, fiş ve aktarım kayıtları silinir
  update stk_receipts set party_id = p_main where party_id = any (v_side);
  update stk_moves set party_id = p_main where party_id = any (v_side);
  delete from sup_import_keys where company_id = c and party_id = any (v_side);
  delete from sup_slip_open where party_id = any (v_side);
  update sup_slips set fin_txn_id = null where party_id = any (v_side);
  delete from sup_slips where party_id = any (v_side);
  -- bu carilere ait işlemler (asıl işlemi faturalı caride olan ödemelerin yansımaları dahil)
  delete from fin_txns where id = any (coalesce(v_txns, '{}'));
  update fin_bank_lines set suggested_party_id = null where suggested_party_id = any (v_side);
  delete from fin_bank_rules where party_id = any (v_side);
  delete from fin_parties where id = any (v_side);
  return jsonb_build_object('removed', array_length(v_side, 1), 'slips', n_slips, 'txns', n_txn);
end $$;
revoke execute on function sup_group_remove(uuid, boolean) from public, anon;
grant execute on function sup_group_remove(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
