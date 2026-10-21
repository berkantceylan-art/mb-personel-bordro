-- Tedarikçi fişlerinin stoğa işlenmesi + sayımda eksik çıkan miktarın üretimde kullanım (consume) olarak düşülmesi. Tekrar çalıştırılabilir.

-- Grubun (fişli + iskontosuz fişli) fiş kalemlerinden stoğa girmemiş olanları fiş tarihiyle stoğa alır.
-- Kalemin stok kartı yoksa firmanın ürün listesinden kart açılır. Cari / muhasebe kayıtlarına dokunulmaz.
create or replace function sup_slips_stock_backfill(p_main uuid, p_warehouse uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_wh uuid := coalesce(p_warehouse, stk_default_warehouse()); r record; v_item uuid; v_ip uuid; v_mv bigint; v_cost bigint;
        n_lines int := 0; n_items int := 0; n_skip int := 0; v_slips int;
begin
  if not (can_module('stock', 2) or can_module('purchases', 2) or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if v_wh is null then raise exception 'warehouse_required'; end if;
  for r in
    select sl.id, sl.item_id, sl.name, sl.qty, sl.price, sl.currency, s.id slip_id, s.slip_date, s.doc_no, s.party_id
      from sup_slip_lines sl join sup_slips s on s.id = sl.slip_id join fin_parties p on p.id = s.party_id
     where p.company_id = c and p.slip_of = p_main and coalesce(p.sub_kind, '') in ('', 'nodisc')
       and not s.cancelled and sl.stk_move_id is null and sl.qty > 0
     order by s.slip_date, sl.slip_id, sl.sort
  loop
    v_item := r.item_id;
    if v_item is null then
      select id into v_ip from sup_item_prices where party_id = p_main and lower(supplier_name) = lower(trim(r.name)) limit 1;
      if v_ip is null then
        perform sup_item_price_save(p_main, jsonb_build_array(jsonb_build_object('supplier_name', r.name, 'price', r.price, 'currency', r.currency, 'price_date', r.slip_date)));
        select id into v_ip from sup_item_prices where party_id = p_main and lower(supplier_name) = lower(trim(r.name)) limit 1;
      end if;
      if v_ip is not null then
        select item_id into v_item from sup_item_prices where id = v_ip;
        if v_item is null then v_item := sup_item_link_int(p_main, v_ip, true); n_items := n_items + 1; end if;
      end if;
    end if;
    if v_item is null then n_skip := n_skip + 1; continue; end if;
    v_cost := case when r.currency = 'TRY' then r.price else round(r.price * coalesce(fx_rate(r.currency, r.slip_date), 1)) end;
    v_mv := stk_move_sys(v_item, v_wh, r.qty, 'purchase', v_cost, null, null, r.slip_date, 'sup_slip', r.slip_id, null, r.party_id,
                         left('Gözde fişi ' || coalesce(nullif(r.doc_no, ''), to_char(r.slip_date, 'DD.MM.YYYY')), 300));
    update sup_slip_lines set item_id = v_item, stk_move_id = v_mv where id = r.id;
    n_lines := n_lines + 1;
  end loop;
  select count(distinct s.id) into v_slips from sup_slips s join fin_parties p on p.id = s.party_id
   where p.slip_of = p_main and not s.cancelled and exists (select 1 from sup_slip_lines sl where sl.slip_id = s.id and sl.stk_move_id is not null);
  return jsonb_build_object('lines', n_lines, 'new_items', n_items, 'skipped', n_skip, 'slips', v_slips);
end $$;
revoke execute on function sup_slips_stock_backfill(uuid, uuid) from public, anon;
grant execute on function sup_slips_stock_backfill(uuid, uuid) to authenticated;

-- Sayım kapanışı: fazla çıkan miktar sayım farkı (count_adjust), eksik çıkan miktar üretimde kullanım (consume) olarak düşülür.
-- p_short_as_consume=false verilirse eski davranış (ikisi de sayım farkı).
drop function if exists stk_count_close(uuid, boolean);
create or replace function stk_count_close(p_count uuid, p_zero_uncounted boolean default false, p_short_as_consume boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare c stk_counts; l record; v_n int := 0; v_diff numeric;
begin
  if not can_module('stock', 3) then raise exception 'not_allowed'; end if;
  select * into c from stk_counts where id = p_count for update;
  if c.id is null or c.status <> 'open' then raise exception 'bad_status'; end if;
  for l in select * from stk_count_lines where count_id = c.id loop
    if l.counted is null and not p_zero_uncounted then continue; end if;
    -- sayım süresince oluşan hareketler hesaba katılır: güncel stok − sayılan
    select coalesce(l.counted, 0) - coalesce(sum(qty), 0) into v_diff from stk_moves
    where item_id = l.item_id and warehouse_id = c.warehouse_id and lot_no is not distinct from l.lot_no;
    if v_diff < 0 and coalesce(p_short_as_consume, true) then
      perform stk_move_sys(l.item_id, c.warehouse_id, v_diff, 'consume', stk_avg_cost(l.item_id), l.lot_no, l.expiry_date, c.count_date, 'count', c.id, null, null,
                           'Sayım #' || c.no || ' · üretimde kullanıldı');
      v_n := v_n + 1;
    elsif v_diff <> 0 then
      perform stk_move_sys(l.item_id, c.warehouse_id, v_diff, 'count_adjust', stk_avg_cost(l.item_id), l.lot_no, l.expiry_date, c.count_date, 'count', c.id, null, null, 'Sayım #' || c.no);
      v_n := v_n + 1;
    end if;
  end loop;
  update stk_counts set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = c.id;
  return v_n;
end $$;
revoke execute on function stk_count_close(uuid, boolean, boolean) from public, anon;
grant execute on function stk_count_close(uuid, boolean, boolean) to authenticated;

notify pgrst, 'reload schema';
