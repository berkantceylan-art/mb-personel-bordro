-- Fişli cari para birimi: liste ekranında fişli bakiye kendi para biriminde (EUR) gösterilir;
-- yanlış para birimiyle (TL) açılıp hareket almış fişli / iskontosuz fişli cari EUR'ya çevrilir (tutarlar aynı kalır, yalnız birim düzeltilir).

drop function if exists sup_pairs();
create or replace function sup_pairs() returns table (
  main_id uuid, name text, currency text, invoice_balance bigint, invoices bigint, slip_id uuid, slip_name text, slip_balance bigint, slips bigint,
  payments bigint, last_slip date, receipts_waiting int, slip_currency text
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
         (select count(*)::int from stk_receipts r where r.party_id = t.id and r.status = 'confirmed' and not exists (select 1 from sup_slips x where x.receipt_id = r.id and not x.cancelled)),
         t.currency
  from fin_parties m join fin_parties t on t.slip_of = m.id and t.sub_kind is null
  where m.company_id = lab_company() and (can_module('finance') or can_module('purchases'))
  order by m.name;
$$;
revoke execute on function sup_pairs() from public, anon;
grant execute on function sup_pairs() to authenticated;

-- Fişli ve iskontosuz fişli carinin para birimini düzelt. Tutarlar değişmez (ekstredeki EUR tutarlar zaten EUR'dur);
-- TL karşılıkları hareket gününün TCMB kuruyla yeniden hesaplanır (kur yoksa son bilinen kur).
create or replace function sup_group_set_currency(p_main uuid, p_cur text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_side uuid[]; n_mv int; n_tx int; v_last numeric;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  if p_cur not in ('TRY', 'EUR', 'USD', 'GBP', 'CHF') then raise exception 'bad_currency'; end if;
  select array_agg(id) into v_side from fin_parties where company_id = c and slip_of = p_main and coalesce(sub_kind, '') in ('', 'nodisc') and currency <> p_cur;
  if v_side is null then return jsonb_build_object('parties', 0); end if;
  -- ERP'de girilmiş ödemenin TL yansıması varsa birim değiştirmek tutarı bozar: önce o ödemeler iptal edilmeli
  if exists (select 1 from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = any (v_side) and t.ref_type = 'mirror' and t.voided_at is null) then
    raise exception 'has_mirror';
  end if;
  perform set_config('app.skip_mirror', 'on', true);
  perform set_config('app.skip_audit', 'on', true);
  update fin_parties set currency = p_cur, updated_at = now() where id = any (v_side);
  -- yalnız bu carilerde kalan işlemler (fiş, aktarım, iskonto, yansıma); başka hesabı / cariyi olan işlem satırına dokunulmaz
  update fin_txns t set currency = p_cur
   where t.company_id = c and exists (select 1 from fin_moves m where m.txn_id = t.id and m.party_id = any (v_side))
     and not exists (select 1 from fin_moves m where m.txn_id = t.id and (m.account_id is not null or (m.party_id is not null and m.party_id <> all (v_side))));
  get diagnostics n_tx = row_count;
  select selling into v_last from fx_rates where currency = p_cur order by rate_date desc limit 1;
  update fin_moves m set currency = p_cur,
         rate = case when p_cur = 'TRY' then 1 else coalesce(fx_rate(p_cur, m.move_date), v_last, m.rate) end,
         amount_try = round(m.amount * case when p_cur = 'TRY' then 1 else coalesce(fx_rate(p_cur, m.move_date), v_last, m.rate) end)
   where m.txn_id in (select t.id from fin_txns t where t.company_id = c and t.currency = p_cur)
     and m.txn_id in (select m2.txn_id from fin_moves m2 where m2.party_id = any (v_side));
  get diagnostics n_mv = row_count;
  update sup_slip_lines l set currency = p_cur from sup_slips s where s.id = l.slip_id and s.party_id = any (v_side);
  return jsonb_build_object('parties', array_length(v_side, 1), 'txns', n_tx, 'moves', n_mv);
end $$;
revoke execute on function sup_group_set_currency(uuid, text) from public, anon;
grant execute on function sup_group_set_currency(uuid, text) to authenticated;

notify pgrst, 'reload schema';
