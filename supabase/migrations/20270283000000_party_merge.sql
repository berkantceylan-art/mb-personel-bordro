-- =====================================================================
-- Cari aktar ve sil (birleştirme): bir carinin TÜM kayıtları başka cariye taşınır, eski kart silinir.
--  Örnek: firmanın faturalı (resmi) carisi fişli carisine aktarılır, resmi cari silinir.
--  * Faturalar, finans işlemleri, çekler, fişler, mal kabul, sipariş, fiyat listeleri… (fin_parties'e bağlı her tablo)
--  * İki cari arasındaki "yansıma" kayıtları (ödemenin öbür cariye düşen kopyası) iptal edilir: ödeme artık tek caride.
--  * Para birimi farklıysa taşınan hareketler o günün kuruyla hedef carinin para birimine çevrilir (TL karşılığı aynı kalır).
--  * Kaynağın iskontosuz / KDV carileri hedefe bağlanır; hedef fişli cariyse bağımsız (asıl) cari olur.
--  * VKN, vergi dairesi, adres, iletişim boşsa kaynaktan alınır; istenirse hedefin adı değiştirilir.
-- Tekrar çalıştırılabilir.
-- =====================================================================

create or replace function fin_party_merge(p_from uuid, p_to uuid, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := lab_company(); f fin_parties; t fin_parties; r record; x record; n int; v_res jsonb := '{}'; v_rate numeric; v_mirror int := 0; v_conv int := 0;
  crit text[] := array['fin_moves', 'fin_txns', 'inv_invoices', 'stk_receipts', 'stk_moves', 'sup_slips', 'fin_cheques', 'gl_lines', 'outsource_statements', 'exp_claims', 'pur_orders'];
begin
  if not (can_module('finance', 3) or einv_is_service()) then raise exception 'not_allowed'; end if;
  select * into f from fin_parties where id = p_from and company_id = c;
  select * into t from fin_parties where id = p_to and company_id = c;
  if f.id is null or t.id is null then raise exception 'not_found'; end if;
  if f.id = t.id then raise exception 'same_party'; end if;
  if f.lab_customer_id is not null and t.lab_customer_id is not null then raise exception 'both_lab_linked'; end if;
  perform set_config('app.skip_mirror', 'on', true);

  -- 1) hedef bağımsız cari olur (fişli cariyse asıl cariden ayrılır)
  update fin_parties set slip_of = null, sub_kind = null where id = t.id and (slip_of is not null or sub_kind is not null);
  -- kaynağın iskontosuz / KDV / fişli alt carileri hedefe bağlanır
  begin
    update fin_parties set slip_of = t.id where slip_of = f.id and id <> t.id;
  exception when unique_violation then raise exception 'merge_conflict:alt cariler (hedefin aynı türde alt carisi var)';
  end;

  -- 2) iki cari arasındaki yansıma kayıtları iptal: ödeme tek caride kalır
  update fin_txns m set voided_at = now(), voided_by = auth.uid(), void_reason = 'Cari birleştirme: yansıma kaldırıldı'
   where m.company_id = c and m.ref_type = 'mirror' and m.voided_at is null
     and (   (exists (select 1 from fin_moves mm where mm.txn_id = m.id and mm.party_id = t.id) and exists (select 1 from fin_moves om where om.txn_id = m.ref_id and om.party_id = f.id))
          or (exists (select 1 from fin_moves mm where mm.txn_id = m.id and mm.party_id = f.id) and exists (select 1 from fin_moves om where om.txn_id = m.ref_id and om.party_id = t.id)));
  get diagnostics v_mirror = row_count;

  -- 3) para birimi farklıysa taşınacak cari hareketleri hedefin para birimine çevrilir (TL karşılığı korunur)
  if f.currency <> t.currency then
    for x in select id, move_date, amount_try from fin_moves where party_id = f.id loop
      v_rate := case when t.currency = 'TRY' then 1 else fx_rate(t.currency, x.move_date) end;
      if v_rate is null or v_rate <= 0 then raise exception 'rate_missing:%', t.currency; end if;
      update fin_moves set amount = round(x.amount_try / v_rate), currency = t.currency, rate = v_rate where id = x.id;
      v_conv := v_conv + 1;
    end loop;
    update fin_txns set amount = abs(round(amount * case when f.currency = 'TRY' then 1 else coalesce(fx_rate(f.currency, txn_date), 1) end
                                            / case when t.currency = 'TRY' then 1 else coalesce(fx_rate(t.currency, txn_date), 1) end)), currency = t.currency
     where party_id = f.id and currency = f.currency;
  end if;

  -- 4) fin_parties'e bağlı her tablo: kaynak → hedef
  for r in
    select cl.relname::text as tbl, a.attname::text as col
      from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
     where k.contype = 'f' and k.confrelid = 'public.fin_parties'::regclass and array_length(k.conkey, 1) = 1
  loop
    if r.tbl = 'fin_parties' and r.col = 'slip_of' then continue; end if;
    begin
      if r.tbl = 'fin_parties' then
        execute format('update public.fin_parties set %I = $1 where %I = $2 and id <> $2', r.col, r.col) using t.id, f.id;
      else
        execute format('update public.%I set %I = $1 where %I = $2', r.tbl, r.col, r.col) using t.id, f.id;
      end if;
      get diagnostics n = row_count;
    exception when unique_violation then
      if r.tbl = any (crit) then raise exception 'merge_conflict:% (aynı kayıt iki caride de var, ör. aynı fatura numarası)', r.tbl; end if;
      -- fiyat listesi / eşleştirme gibi tablolarda hedefte zaten olan satır: kaynaktaki kopyası silinir
      n := 0;
      for x in execute format('select ctid as id from public.%I where %I = $1', r.tbl, r.col) using f.id loop
        begin
          execute format('update public.%I set %I = $1 where ctid = $2', r.tbl, r.col) using t.id, x.id;
          n := n + 1;
        exception when unique_violation then
          execute format('delete from public.%I where ctid = $1', r.tbl) using x.id;
        end;
      end loop;
    end;
    if n > 0 then v_res := v_res || jsonb_build_object(r.tbl, coalesce((v_res->>r.tbl)::int, 0) + n); end if;
  end loop;

  -- 5) kaynak kart silinir, eksik bilgiler hedefe geçer
  delete from fin_parties where id = f.id;
  update fin_parties set
    name = coalesce(nullif(trim(p_name), ''), name),
    tax_no = coalesce(tax_no, f.tax_no), tax_office = coalesce(tax_office, f.tax_office), address = coalesce(address, f.address),
    city = coalesce(city, f.city), district = coalesce(district, f.district), country = coalesce(country, f.country),
    email = coalesce(email, f.email), phone = coalesce(phone, f.phone), is_einvoice = is_einvoice or coalesce(f.is_einvoice, false),
    lab_customer_id = coalesce(lab_customer_id, f.lab_customer_id), bh_guid = coalesce(bh_guid, f.bh_guid),
    kind = case when kind <> f.kind and kind <> 'both' then 'both' else kind end
   where id = t.id;
  return jsonb_build_object('moved', v_res, 'mirrors_voided', v_mirror, 'converted', v_conv, 'target', t.id);
end $$;
revoke execute on function fin_party_merge(uuid, uuid, text) from public, anon;
grant execute on function fin_party_merge(uuid, uuid, text) to authenticated;

notify pgrst, 'reload schema';
