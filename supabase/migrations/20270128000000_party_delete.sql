-- Cari kart silme: hareketi olmayan cari silinir; faturası, finans işlemi, çeki, siparişi vb. olan cari silinmez
-- (kayıtlar bozulmasın diye), bunun yerine pasife alınması önerilir. Tekrar çalıştırılabilir.

-- Cariye bağlı kayıtlar: {"Fatura": 3, "Finans işlemi": 5, ...}
create or replace function fin_party_usage(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r record; n bigint; out jsonb := '{}'; lbl text;
begin
  if not (can_module('finance') or can_module('sales') or can_module('purchases')) then raise exception 'not_allowed'; end if;
  for r in
    select c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = 'fin_parties'::regclass and c.contype = 'f'
      and not (c.conrelid = 'fin_bank_lines'::regclass and a.attname = 'suggested_party_id')
      and c.conrelid::regclass::text not in ('fin_bank_rules')
  loop
    execute format('select count(*) from %s where %I = $1', r.tbl, r.col) into n using p_id;
    if n > 0 then
      lbl := case r.tbl
        when 'fin_txns' then 'Finans işlemi' when 'fin_moves' then 'Cari hareketi' when 'inv_invoices' then 'Fatura'
        when 'fin_cheques' then 'Çek / senet' when 'fin_cheque_events' then 'Çek hareketi' when 'pur_orders' then 'Satın alma siparişi'
        when 'stk_moves' then 'Stok hareketi' when 'stk_receipts' then 'Mal kabul' when 'stk_items' then 'Stok kartı (tedarikçi)'
        when 'stk_lots' then 'Lot' when 'exp_claims' then 'Masraf' when 'exp_recurring' then 'Tekrarlayan masraf'
        when 'assets' then 'Demirbaş' when 'asset_maintenance' then 'Demirbaş bakımı' when 'fin_reconciliations' then 'Mutabakat'
        when 'cns_entities' then 'Grup şirketi' when 'sup_slips' then 'Tedarikçi irsaliyesi' when 'sup_slip_open' then 'Açık irsaliye'
        when 'sup_portal_users' then 'Tedarikçi portal kullanıcısı' else r.tbl end;
      out := out || jsonb_build_object(lbl, coalesce((out->>lbl)::bigint, 0) + n);
    end if;
  end loop;
  return out;
end $$;
revoke execute on function fin_party_usage(uuid) from public, anon;
grant execute on function fin_party_usage(uuid) to authenticated;

create or replace function fin_party_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p fin_parties; u jsonb;
begin
  if not (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into p from fin_parties where id = p_id and company_id = lab_company() for update;
  if p.id is null then raise exception 'not_found'; end if;
  if p.lab_customer_id is not null then raise exception 'lab_linked'; end if;
  u := fin_party_usage(p_id);
  if u <> '{}'::jsonb then
    raise exception 'in_use: %', (select string_agg(key || ' ' || value, ', ') from jsonb_each_text(u));
  end if;
  update fin_bank_lines set suggested_party_id = null where suggested_party_id = p_id;
  delete from fin_bank_rules where party_id = p_id;
  delete from fin_parties where id = p_id;
end $$;
revoke execute on function fin_party_delete(uuid) from public, anon;
grant execute on function fin_party_delete(uuid) to authenticated;

notify pgrst, 'reload schema';
