-- Bizim Hesap ↔ ERP karşılaştırma: cari bakiyesini Bizim Hesap'taki bakiyeye eşitleme
--  bh_balance_equalize(cari, hedef bakiye kuruş, tarih): fark tek "Bizim Hesap bakiye eşitleme" kaydıyla kapatılır
--  (kategori stmt_import: genel muhasebeye fiş üretmez). Hekim kartına bağlı cariler Dentalsis'ten eşitlendiği için reddedilir.
-- Tekrar çalıştırılabilir. Önce 20270279000000_bh_statement_import.sql.

create or replace function bh_balance_equalize(p_party uuid, p_target bigint, p_date date default current_date) returns bigint
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); pt fin_parties; v_now bigint; v_diff bigint; v_cat uuid := fin_category('stmt_import'); v_rate numeric;
begin
  if not (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into pt from fin_parties where id = p_party and company_id = c;
  if pt.id is null then raise exception 'not_found'; end if;
  if pt.lab_customer_id is not null then raise exception 'lab_party'; end if;
  if v_cat is null then raise exception 'category_missing'; end if;
  select balance into v_now from fin_party_balances where party_id = pt.id;
  v_diff := coalesce(p_target, 0) - coalesce(v_now, 0);
  if v_diff = 0 then return 0; end if;
  v_rate := case when pt.currency = 'TRY' then 1 else fin_rate(pt.currency, p_date) end;
  perform fin_post_sys(
    jsonb_build_object('kind', 'adjust', 'txn_date', p_date, 'description', 'Bizim Hesap bakiye eşitleme', 'amount', abs(v_diff), 'currency', pt.currency,
                       'party_id', pt.id, 'category_id', v_cat, 'ref_type', 'bh_import'),
    jsonb_build_array(
      jsonb_build_object('party_id', pt.id, 'amount', v_diff, 'currency', pt.currency, 'rate', v_rate, 'description', 'Bizim Hesap bakiye eşitleme'),
      jsonb_build_object('category_id', v_cat, 'amount', -v_diff, 'currency', pt.currency, 'rate', v_rate, 'description', 'Bizim Hesap aktarımı')));
  return v_diff;
end $$;
revoke execute on function bh_balance_equalize(uuid, bigint, date) from public, anon;
grant execute on function bh_balance_equalize(uuid, bigint, date) to authenticated;

notify pgrst, 'reload schema';
