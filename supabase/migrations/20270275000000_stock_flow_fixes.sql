-- =====================================================================
-- STOK VE ÜRETİM DÜZELTMELERİ (modül testlerinde bulunan hatalar)
--  1) Alış faturası (inv_post): aynı siparişin / faturanın mal kabulünde stoğa zaten girmiş miktar
--     faturada ikinci kez girmez. Önceden 5 frez geldi, stok 10 arttı.
--  2) Sayım kapanışı (stk_count_close): fark, satırın sayıldığı andaki stoğa göre hesaplanır; sayımdan
--     sonra yapılan tüketimler korunur. Önceden 50 sayılıp 5 tüketilen alçı 50 kalıyordu.
--  3) Lotsuz transfer (stk_transfer_send): karantinadaki / geri çağrılmış lot "mevcut" sayılmaz.
--     Önceden ana depoda eksi stok, şubede "temiz" lotsuz stok oluşuyordu.
--  4) Transfer teslimi (stk_transfer_receive): eksik gelen miktar lotlara küsuratla bölünmez; lot lot
--     (son kullanma sırasıyla) dağıtılır, eksik kısım alıcı depoda "fire" olarak kaydedilir.
--  5) Mal kabulde seri takipli (ÜTS) ürün düz barkodla okutulamaz (aynı seri iki adet oluyordu).
--  6) İşten silinen ÜTS malzemesinin "verme" bildirimi de iptal edilir / "iptal gerekli" olur.
--  7) Yeniden yapım (prd_remake): şef ve kalite onayı, paket ve sevkiyat aşaması sıfırlanır; iş yeni
--     turda kontrollerden geçmeden çıkamaz. Teslim edilmiş iş de akışa geri alınır (durumu "teslim"
--     kalır, irsaliye ve cari değişmez; yeniden çıkışta ilk teslim tarihi korunur).
--  8) Paketteyken geri çevrilen iş paketten çıkar; paket kapanınca yalnız sevkiyattaki işler teslim olur.
-- Fonksiyonların veritabanındaki geçerli tanımı yamalanır. Tekrar çalıştırılabilir.
-- Önce 20270270000000_supplier_stock_backfill.sql (sayım kapanışının yeni hâli de yamalanır).
-- =====================================================================

create or replace function _mig_patch(p_sig text, p_old text, p_new text) returns void language plpgsql as $$
declare d text;
begin
  select pg_get_functiondef(p_sig::regprocedure) into d;
  if position(p_new in d) > 0 then return; end if;                 -- zaten yamalı
  if position(p_old in d) = 0 then raise exception 'Yama uygulanamadı: %', p_sig; end if;
  execute replace(d, p_old, p_new);
end $$;

-- 1) Alış faturası: mal kabulde stoğa girmiş miktar tekrar girmez
select _mig_patch('inv_post(uuid)',
  $x$  v_cogs bigint := 0; v_cost bigint; v_have numeric;$x$,
  $x$  v_cogs bigint := 0; v_cost bigint; v_have numeric; v_rcv numeric; v_add numeric;$x$);
select _mig_patch('inv_post(uuid)',
  $x$    elsif v.type = 'invoice' then     -- alış: birim maliyet = iskontolu matrah (TL) / miktar
      perform stk_move_sys(it.id, v_wh, l.qty, 'purchase', round(l.net * v.rate / l.qty)::bigint, l.lot_no, l.expiry_date, v.invoice_date, 'invoice', v.id, null, v.party_id, v_note);$x$,
  $x$    elsif v.type = 'invoice' then     -- alış: birim maliyet = iskontolu matrah (TL) / miktar
      -- bu faturaya ya da siparişine bağlı mal kabulde "stoğa ekle" ile girmiş, henüz faturalanmamış miktar tekrar girmez
      select coalesce(sum(rl.qty - rl.damaged), 0) into v_rcv
        from stk_receipts r join stk_receipt_lines rl on rl.receipt_id = r.id
       where r.status = 'confirmed' and coalesce(r.add_to_stock, false) and rl.item_id = it.id
         and (r.invoice_id = v.id or (v.po_id is not null and r.po_id = v.po_id));
      if v_rcv > 0 then
        v_rcv := v_rcv - coalesce((select sum(il.qty) from inv_lines il join inv_invoices ii on ii.id = il.invoice_id
                                    where ii.id <> v.id and ii.status = 'posted' and ii.direction = 'purchase' and ii.type = 'invoice'
                                      and il.item_id = it.id and v.po_id is not null and ii.po_id = v.po_id), 0)
                        - coalesce((select sum(il.qty) from inv_lines il where il.invoice_id = v.id and il.item_id = it.id and il.sort < l.sort), 0);
      end if;
      v_add := l.qty - greatest(least(coalesce(v_rcv, 0), l.qty), 0);
      if v_add > 0 then
        perform stk_move_sys(it.id, v_wh, v_add, 'purchase', round(l.net * v.rate / l.qty)::bigint, l.lot_no, l.expiry_date, v.invoice_date, 'invoice', v.id, null, v.party_id, v_note);
      end if;$x$);

-- 2) Sayım: fark sayıldığı andaki stoğa göre
-- (fonksiyonun imzası sürüme göre değişebilir: (uuid, boolean) ya da (uuid, boolean, boolean); hangisi varsa yamalanır)
do $d$ declare s text; begin
  for s in select p.oid::regprocedure::text from pg_proc p where p.proname = 'stk_count_close' and p.pronamespace = 'public'::regnamespace loop
    perform _mig_patch(s,
      $x$    where item_id = l.item_id and warehouse_id = c.warehouse_id and lot_no is not distinct from l.lot_no;$x$,
      $x$    where item_id = l.item_id and warehouse_id = c.warehouse_id and lot_no is not distinct from l.lot_no
      and created_at <= coalesce(l.counted_at, now());   -- sayımdan sonraki hareketler korunur$x$);
  end loop;
end $d$;

-- 3) Lotsuz transfer: engelli lotlar kullanılabilir sayılmaz
select _mig_patch('stk_transfer_send(uuid, boolean)',
  $x$    where item_id = l.item_id and warehouse_id = t.from_warehouse_id and (l.lot_no is null or lot_no = l.lot_no);$x$,
  $x$    where item_id = l.item_id and warehouse_id = t.from_warehouse_id and (l.lot_no is null or lot_no = l.lot_no)
      and (l.lot_no is not null or lot_no is null or not stk_lot_blocked(item_id, lot_no));   -- karantina / geri çağrılmış lot sayılmaz$x$);

-- 5) Mal kabul: seri takipli ürün yalnız karekodla
select _mig_patch('stk_rcv_scan(uuid, text, numeric)',
  $x$  if it.id is null then raise exception 'item_not_found'; end if;$x$,
  $x$  if it.id is null then raise exception 'item_not_found'; end if;
  if coalesce(it.uts_tracked, false) and it.uts_kind = 'serial' then raise exception 'serial_scan_required'; end if;$x$);

-- 6) İşten silinen ÜTS malzemesinin verme bildirimi de iptal edilir
select _mig_patch('uts_on_job_material()',
  $x$source_key = 'mat:' || old.id and status$x$,
  $x$source_key in ('mat:' || old.id, 'ver:' || old.id) and status$x$);

-- 7) Yeniden yapım: onaylar, paket ve aşama sıfırlanır; teslim edilmiş iş akışa döner
select _mig_patch('prd_remake(uuid, text, text, uuid, uuid, boolean, uuid)',
  $x$  update jobs set status = 'open' where id = p_job and status in ('ready', 'tryin');$x$,
  $x$  -- yeni tur: iş şef ve kaliteden yeniden geçer; teslim edilmiş iş "teslim" kalır (irsaliye / cari değişmez) ama akışa döner
  update jobs set status = case when status in ('ready', 'tryin') then 'open' else status end,
         flow_stage = 'production', holder_employee_id = null, holder_since = now(),
         chief_passed_at = null, qc_passed_at = null, package_id = null, packed_by = null, packed_at = null
   where id = p_job and status <> 'cancelled';$x$);

-- akış: teslim edilmiş ama yeniden yapımda olan iş (flow_stage <> 'out') okutulabilir; reddedilen iş paketten çıkar;
-- yeniden çıkışta ilk teslim tarihi korunur
select _mig_patch('prd_flow_scan(text, uuid, text, text, uuid)',
  $x$  if j.status = 'delivered' and v_act not in ('note') then$x$,
  $x$  if j.status = 'delivered' and j.flow_stage = 'out' and v_act not in ('note') then$x$);
select _mig_patch('prd_flow_scan(text, uuid, text, text, uuid)',
  $x$    if j.status = 'delivered' then
      raise exception 'already_out';$x$,
  $x$    if j.status = 'delivered' and j.flow_stage = 'out' then
      raise exception 'already_out';$x$);
select _mig_patch('prd_flow_scan(text, uuid, text, text, uuid)',
  $x$      chief_passed_at = null, qc_passed_at = case when v_role = 'dispatch' then qc_passed_at else null end
    where id = j.id;$x$,
  $x$      chief_passed_at = null, qc_passed_at = case when v_role = 'dispatch' then qc_passed_at else null end,
      package_id = null, packed_by = null, packed_at = null
    where id = j.id;$x$);
select _mig_patch('prd_flow_scan(text, uuid, text, text, uuid)',
  $x$flow_stage = 'out', status = 'delivered', delivered_at = v_now where id = j.id;$x$,
  $x$flow_stage = 'out', status = 'delivered', delivered_at = case when status = 'delivered' then delivered_at else v_now end where id = j.id;$x$);

-- 8) Paketleme: yeniden yapımdaki teslim edilmiş iş paketlenebilir; paket kapanınca yalnız sevkiyattakiler çıkar
select _mig_patch('prd_pack_scan(text, uuid, uuid)',
  $x$  if j.status = 'delivered' then raise exception 'already_out'; end if;$x$,
  $x$  if j.status = 'delivered' and j.flow_stage = 'out' then raise exception 'already_out'; end if;$x$);
select _mig_patch('prd_pack_close(uuid, boolean, text)',
  $x$for j in select no from jobs where package_id = p.id and status <> 'delivered' loop$x$,
  $x$for j in select no from jobs where package_id = p.id and flow_stage = 'dispatch' loop$x$);

drop function _mig_patch(text, text, text);

-- 4) Transfer teslimi: lot lot dağıtım, eksik kısım fire
create or replace function stk_transfer_receive(p_transfer uuid, p_received jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t stk_transfers; r record; l stk_transfer_lines; v_got numeric; v_left numeric; v_in numeric;
begin
  if not can_module('stock', 2) then raise exception 'not_allowed'; end if;
  select * into t from stk_transfers where id = p_transfer for update;
  if t.id is null or t.status <> 'in_transit' then raise exception 'bad_status'; end if;
  for l in select * from stk_transfer_lines where transfer_id = t.id loop
    v_got := coalesce(nullif(p_received->>l.id::text, '')::numeric, l.qty);
    if v_got < 0 or v_got > l.qty then raise exception 'bad_qty'; end if;
    update stk_transfer_lines set received_qty = v_got where id = l.id;
    v_left := v_got;
    -- çıkış hareketlerini lot bazında aynala; gelen miktar son kullanma sırasıyla lotlara dağıtılır
    for r in
      select lot_no, max(expiry_date) as expiry_date, -sum(qty) as qty, max(unit_cost) as unit_cost
      from stk_moves where doc_type = 'transfer' and doc_id = t.id and item_id = l.item_id and kind = 'transfer_out'
        and (l.lot_no is null or lot_no is not distinct from l.lot_no)
      group by lot_no
      order by max(expiry_date) nulls last, lot_no nulls last
    loop
      v_in := least(r.qty, greatest(v_left, 0));
      v_left := v_left - v_in;
      perform stk_move_sys(l.item_id, t.to_warehouse_id, r.qty, 'transfer_in', r.unit_cost, r.lot_no, r.expiry_date, current_date, 'transfer', t.id, null, null, 'Transfer #' || t.no);
      if r.qty - v_in > 0 then
        perform stk_move_sys(l.item_id, t.to_warehouse_id, -(r.qty - v_in), 'waste', r.unit_cost, r.lot_no, r.expiry_date, current_date, 'transfer', t.id, null, null,
                             'Transfer #' || t.no || ' eksik teslim (fire)');
      end if;
    end loop;
  end loop;
  update stk_transfers set status = 'received', received_at = now(), received_by = auth.uid() where id = t.id;
end $$;
revoke execute on function stk_transfer_receive(uuid, jsonb) from public, anon;
grant execute on function stk_transfer_receive(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
