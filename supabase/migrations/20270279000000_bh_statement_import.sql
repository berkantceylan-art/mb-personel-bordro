-- Bizim Hesap cari ekstresi aktarımı
--  * fin_parties.bh_guid: Bizim Hesap'taki cari (aynı cari ikinci kez açılmaz)
--  * bh_statement_import: ekstre satırları (satış, alış, tahsilat, ödeme, borç / alacak fişi, iade, hesap açılışı) cariye işlenir
--      borç (+) carinin bize borcu artar, alacak (−) azalır. Kategori "stmt_import": genel muhasebeye fiş üretmez.
--      Aynı satır ikinci kez gelirse atlanır (sup_import_keys, anahtar "bh|…").
--  * p.mode = 'balance': satırlar yerine yalnız son bakiye tek "Bizim Hesap devir" kaydıyla işlenir
--  * bh_statement_undo: bir carinin Bizim Hesap aktarımını geri alır
-- Önce 20270267000000_supplier_cari_group.sql (sup_import_keys, stmt_import kategorisi). Tekrar çalıştırılabilir.

alter table fin_parties add column if not exists bh_guid text;
create unique index if not exists fin_parties_bh_guid_idx on fin_parties (company_id, bh_guid) where bh_guid is not null;

create or replace function bh_statement_import(p_party uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); pt fin_parties; r jsonb; v_date date; v_amt bigint; v_desc text; v_key text; v_k int; v_seen jsonb := '{}';
  v_cat uuid := fin_category('stmt_import'); v_rate numeric; v_txn uuid; n int := 0; n_skip int := 0; v_total bigint := 0;
begin
  if not (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into pt from fin_parties where id = p_party and company_id = c;
  if pt.id is null then raise exception 'not_found'; end if;
  if v_cat is null then raise exception 'category_missing'; end if;
  if nullif(p->>'guid', '') is not null and pt.bh_guid is null then
    update fin_parties set bh_guid = p->>'guid' where id = pt.id
      and not exists (select 1 from fin_parties x where x.company_id = c and x.bh_guid = p->>'guid');
  end if;

  if coalesce(p->>'mode', 'rows') = 'balance' then
    v_amt := coalesce((p->>'balance')::bigint, 0);
    v_key := 'bh|' || pt.id || '|balance';
    if v_amt = 0 or exists (select 1 from sup_import_keys where company_id = c and key = v_key) then
      return jsonb_build_object('moves', 0, 'skipped', 1);
    end if;
    v_date := coalesce(nullif(p->>'date', '')::date, current_date);
    v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, v_date) end;
    v_txn := fin_post_sys(
      jsonb_build_object('kind', 'adjust', 'txn_date', v_date, 'description', 'Bizim Hesap devir bakiyesi', 'amount', abs(v_amt), 'currency', pt.currency,
                         'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'bh_import'),
      jsonb_build_array(
        jsonb_build_object('party_id', pt.id, 'amount', v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Bizim Hesap devir bakiyesi'),
        jsonb_build_object('category_id', v_cat, 'amount', -v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Bizim Hesap aktarımı')));
    insert into sup_import_keys (key, party_id, txn_id) values (v_key, pt.id, v_txn);
    return jsonb_build_object('moves', 1, 'skipped', 0, 'total', v_amt);
  end if;

  for r in select * from jsonb_array_elements(coalesce(p->'rows', '[]')) loop
    v_date := nullif(r->>'date', '')::date;
    v_amt := coalesce((r->>'debit')::bigint, 0) - coalesce((r->>'credit')::bigint, 0);
    if v_date is null or v_amt = 0 then continue; end if;
    v_desc := left(concat_ws(' · ', 'Bizim Hesap', nullif(trim(r->>'type'), ''), nullif(trim(r->>'desc'), ''), nullif(trim(r->>'method'), '')), 500);
    v_key := concat_ws('|', pt.id, v_date, r->>'type', r->>'desc', v_amt);
    v_k := coalesce((v_seen->>v_key)::int, 0) + 1;
    v_seen := v_seen || jsonb_build_object(v_key, v_k);
    v_key := 'bh|' || md5(v_key || '#' || v_k);
    if exists (select 1 from sup_import_keys where company_id = c and key = v_key) then n_skip := n_skip + 1; continue; end if;
    v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, v_date) end;
    v_txn := fin_post_sys(
      jsonb_build_object('kind', 'adjust', 'txn_date', v_date, 'description', v_desc, 'amount', abs(v_amt), 'currency', pt.currency,
                         'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'bh_import',
                         'doc_no', nullif(left(substring(coalesce(r->>'desc', '') from 'No:\s*([A-Za-z0-9\-/]+)'), 60), '')),
      jsonb_build_array(
        jsonb_build_object('party_id', pt.id, 'amount', v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', left(v_desc, 300)),
        jsonb_build_object('category_id', v_cat, 'amount', -v_amt, 'currency', pt.currency, 'rate', v_rate, 'description', 'Bizim Hesap aktarımı')));
    insert into sup_import_keys (key, party_id, txn_id) values (v_key, pt.id, v_txn);
    n := n + 1; v_total := v_total + v_amt;
  end loop;
  return jsonb_build_object('moves', n, 'skipped', n_skip, 'total', v_total);
end $$;

create or replace function bh_statement_undo(p_party uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0;
begin
  if not (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  update fin_txns t set voided_at = now(), voided_by = auth.uid(), void_reason = 'Bizim Hesap aktarımı geri alındı'
   where t.company_id = lab_company() and t.ref_type = 'bh_import' and t.voided_at is null
     and exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = p_party);
  get diagnostics n = row_count;
  delete from sup_import_keys where company_id = lab_company() and party_id = p_party and key like 'bh|%';
  return n;
end $$;

revoke execute on function bh_statement_import(uuid, jsonb) from public, anon;
revoke execute on function bh_statement_undo(uuid) from public, anon;
grant execute on function bh_statement_import(uuid, jsonb) to authenticated;
grant execute on function bh_statement_undo(uuid) to authenticated;

notify pgrst, 'reload schema';
