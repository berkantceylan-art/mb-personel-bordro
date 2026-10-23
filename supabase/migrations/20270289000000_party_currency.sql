-- Cari kartın para birimini değiştirme (ör. Bizim Hesap'ta Euro olan cari ERP'de TL açılmışsa)
--  Yalnız iptal edilmemiş finans hareketi olmayan karta izin verilir; hekim kartına bağlı cariler hekim kartından yönetilir.
-- Tekrar çalıştırılabilir.

create or replace function fin_party_set_currency(p_party uuid, p_cur text) returns void
language plpgsql security definer set search_path = public as $$
declare pt fin_parties; n int;
begin
  if not (can_module('finance', 2) or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if p_cur not in ('TRY', 'EUR', 'USD', 'GBP', 'CHF') then raise exception 'bad_currency'; end if;
  select * into pt from fin_parties where id = p_party and company_id = lab_company();
  if pt.id is null then raise exception 'not_found'; end if;
  if pt.currency = p_cur then return; end if;
  if pt.lab_customer_id is not null then raise exception 'lab_party'; end if;
  select count(*) into n from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = pt.id and t.voided_at is null;
  if n > 0 then raise exception 'has_moves:%', n; end if;
  if exists (select 1 from inv_invoices where party_id = pt.id and status <> 'cancelled') then raise exception 'has_invoices'; end if;
  if coalesce(pt.opening_balance, 0) <> 0 then raise exception 'has_opening'; end if;
  update fin_parties set currency = p_cur where id = pt.id;
end $$;
revoke execute on function fin_party_set_currency(uuid, text) from public, anon;
grant execute on function fin_party_set_currency(uuid, text) to authenticated;

notify pgrst, 'reload schema';
