-- =====================================================================
-- ÜRÜN MALİYETİ (üretim reçetesi + işçilik + genel giderler)
--  Malzeme : stk_boms (ürün başına malzeme, fire %) × stk_avg_cost (ortalama alış, yoksa kart fiyatı)
--  İşçilik : prd_route_steps.std_minutes × istasyon dakika ücreti (yoksa genel dakika ücreti)
--  Giderler: üretim genel gideri (üye başına TL) + tekrar payı % + pazarlama % + genel yönetim % + finansman %
--            (yüzdeler üretim maliyeti üzerinden; başlangıç değerleri — aylar içinde gerçek rakamlarla güncellenir)
--  prd_product_cost(ürün) : ayrıntılı maliyet kartı · prd_cost_list() : tüm ürünler, fiyat ve marj
--  prd_seed_pfm_noritake(ürün) : "Metal destekli porselen — Noritake, döküm" hazır reçetesi (malzeme kartları + rota)
-- Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists prd_cost_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  labor_rate_min bigint not null default 600,          -- kuruş / dakika (genel)
  overhead_per_unit bigint not null default 20000,     -- kuruş / üye: kira, elektrik, cihaz amortismanı, bakım
  remake_pct numeric(5, 2) not null default 4,
  marketing_pct numeric(5, 2) not null default 7,
  admin_pct numeric(5, 2) not null default 10,
  finance_pct numeric(5, 2) not null default 2,
  note text check (note is null or length(note) <= 500),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table prd_cost_settings enable row level security;
drop policy if exists prd_cost_settings_read on prd_cost_settings;
create policy prd_cost_settings_read on prd_cost_settings for select to authenticated
  using (company_id = (select lab_company()) and ((select can_module('production')) or (select can_module('stock')) or (select can_module('finance')) or (select can_module('sales'))));
revoke all on prd_cost_settings from anon;
grant select on prd_cost_settings to authenticated;

alter table prd_stations add column if not exists labor_rate_min bigint check (labor_rate_min is null or labor_rate_min >= 0);   -- kuruş / dakika

create or replace function prd_cost_can() returns boolean language sql stable as $$
  select can_module('production') or can_module('stock') or can_module('finance') or can_module('sales');
$$;

create or replace function prd_cost_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('production', 3) or can_module('finance', 3)) then raise exception 'not_allowed'; end if;
  insert into prd_cost_settings (company_id, labor_rate_min, overhead_per_unit, remake_pct, marketing_pct, admin_pct, finance_pct, note, updated_at)
  values (lab_company(), greatest(coalesce((p->>'labor_rate_min')::bigint, 600), 0), greatest(coalesce((p->>'overhead_per_unit')::bigint, 0), 0),
          least(greatest(coalesce((p->>'remake_pct')::numeric, 0), 0), 100), least(greatest(coalesce((p->>'marketing_pct')::numeric, 0), 0), 100),
          least(greatest(coalesce((p->>'admin_pct')::numeric, 0), 0), 100), least(greatest(coalesce((p->>'finance_pct')::numeric, 0), 0), 100),
          nullif(left(trim(coalesce(p->>'note', '')), 500), ''), now())
  on conflict (company_id) do update set labor_rate_min = excluded.labor_rate_min, overhead_per_unit = excluded.overhead_per_unit, remake_pct = excluded.remake_pct,
    marketing_pct = excluded.marketing_pct, admin_pct = excluded.admin_pct, finance_pct = excluded.finance_pct, note = excluded.note, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function prd_cost_settings_save(jsonb) from public, anon;
grant execute on function prd_cost_settings_save(jsonb) to authenticated;

create or replace function prd_station_rate_save(p_station uuid, p_rate bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('production', 3) or can_module('finance', 3)) then raise exception 'not_allowed'; end if;
  update prd_stations set labor_rate_min = case when p_rate is null or p_rate <= 0 then null else p_rate end where id = p_station and company_id = lab_company();
end $$;
revoke execute on function prd_station_rate_save(uuid, bigint) from public, anon;
grant execute on function prd_station_rate_save(uuid, bigint) to authenticated;

-- Reçete satırı malzemesinin birim fiyatı (TL kuruş): stok kartı / alış ortalaması
create or replace function prd_item_price_save(p_item uuid, p_price bigint, p_currency text default 'TRY') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('stock', 2) or can_module('production', 3) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  update stk_items set purchase_price = greatest(coalesce(p_price, 0), 0), purchase_currency = case when p_currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF') then p_currency else 'TRY' end, updated_at = now()
   where id = p_item and company_id = lab_company();
end $$;
revoke execute on function prd_item_price_save(uuid, bigint, text) from public, anon;
grant execute on function prd_item_price_save(uuid, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- Maliyet hesabı
-- ---------------------------------------------------------------------
create or replace function prd_cost_core(p_product uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s prd_cost_settings; p lab_products; v_mat bigint; v_lab bigint; v_min int; v_prod bigint; v_rem bigint; v_mkt bigint; v_adm bigint; v_fin bigint; v_total bigint; v_price bigint; v_price_eur_try bigint;
  v_mlines jsonb; v_llines jsonb;
begin
  select * into s from prd_cost_settings where company_id = lab_company();
  if s.company_id is null then s.labor_rate_min := 600; s.overhead_per_unit := 20000; s.remake_pct := 4; s.marketing_pct := 7; s.admin_pct := 10; s.finance_pct := 2; end if;
  select * into p from lab_products where id = p_product;
  if p.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bom_id', b.id, 'item_id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit, 'qty', b.qty, 'waste_pct', b.waste_pct,
           'unit_cost', stk_avg_cost(i.id), 'purchase_price', i.purchase_price, 'currency', i.purchase_currency,
           'cost', round(b.qty * (1 + b.waste_pct / 100) * stk_avg_cost(i.id))::bigint, 'note', b.note) order by i.code), '[]'),
         coalesce(sum(round(b.qty * (1 + b.waste_pct / 100) * stk_avg_cost(i.id))), 0)::bigint
    into v_mlines, v_mat
    from stk_boms b join stk_items i on i.id = b.item_id where b.lab_product_id = p_product;
  select coalesce(jsonb_agg(jsonb_build_object('step_id', r.id, 'station_id', st.id, 'station', st.name, 'minutes', coalesce(r.std_minutes, 0),
           'rate', coalesce(st.labor_rate_min, s.labor_rate_min), 'own_rate', st.labor_rate_min is not null,
           'cost', coalesce(r.std_minutes, 0) * coalesce(st.labor_rate_min, s.labor_rate_min)) order by r.sort, st.sort), '[]'),
         coalesce(sum(coalesce(r.std_minutes, 0) * coalesce(st.labor_rate_min, s.labor_rate_min)), 0)::bigint, coalesce(sum(r.std_minutes), 0)::int
    into v_llines, v_lab, v_min
    from prd_route_steps r join prd_stations st on st.id = r.station_id where r.lab_product_id = p_product;
  v_prod := v_mat + v_lab + s.overhead_per_unit;
  v_rem := round((v_mat + v_lab) * s.remake_pct / 100);
  v_prod := v_prod + v_rem;
  v_mkt := round(v_prod * s.marketing_pct / 100);
  v_adm := round(v_prod * s.admin_pct / 100);
  v_fin := round(v_prod * s.finance_pct / 100);
  v_total := v_prod + v_mkt + v_adm + v_fin;
  v_price := p.price_try;
  v_price_eur_try := case when p.price_eur is not null then round(p.price_eur * fx_rate('EUR', current_date)) end;
  return jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'material', p.material, 'price_try', p.price_try, 'price_eur', p.price_eur, 'per_unit', p.per_unit),
    'settings', to_jsonb(s) - 'company_id' - 'updated_by',
    'materials', v_mlines, 'labor', v_llines, 'minutes', v_min,
    'material', v_mat, 'labor_total', v_lab, 'overhead', s.overhead_per_unit, 'remake', v_rem, 'production', v_prod,
    'marketing', v_mkt, 'admin', v_adm, 'finance', v_fin, 'total', v_total,
    'price_try', v_price, 'price_eur_try', v_price_eur_try, 'eur_rate', fx_rate('EUR', current_date),
    'margin_try', case when v_price > 0 then round(100.0 * (v_price - v_total) / v_price, 1) end,
    'margin_eur', case when v_price_eur_try > 0 then round(100.0 * (v_price_eur_try - v_total) / v_price_eur_try, 1) end,
    'missing_prices', (select count(*) from stk_boms b where b.lab_product_id = p_product and stk_avg_cost(b.item_id) = 0));
end $$;
revoke execute on function prd_cost_core(uuid) from public, anon, authenticated;

create or replace function prd_product_cost(p_product uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not prd_cost_can() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from lab_products where id = p_product and (company_id = lab_company() or company_id is null)) then return null; end if;
  return prd_cost_core(p_product);
end $$;
revoke execute on function prd_product_cost(uuid) from public, anon;
grant execute on function prd_product_cost(uuid) to authenticated;

create or replace function prd_cost_list() returns table (
  id uuid, code text, name text, material text, lines int, steps int, minutes int, material_cost bigint, labor bigint, production bigint, total bigint,
  price_try bigint, price_eur bigint, price_eur_try bigint, margin_try numeric, margin_eur numeric, missing_prices int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not prd_cost_can() then raise exception 'not_allowed'; end if;
  return query
  select p.id, p.code, p.name, p.material,
         (select count(*)::int from stk_boms b where b.lab_product_id = p.id), (select count(*)::int from prd_route_steps r where r.lab_product_id = p.id),
         (c->>'minutes')::int, (c->>'material')::bigint, (c->>'labor_total')::bigint, (c->>'production')::bigint, (c->>'total')::bigint,
         p.price_try, p.price_eur, (c->>'price_eur_try')::bigint, (c->>'margin_try')::numeric, (c->>'margin_eur')::numeric, (c->>'missing_prices')::int
    from lab_products p cross join lateral (select prd_cost_core(p.id) c) x
   where (p.company_id = lab_company() or p.company_id is null) and p.is_active
   order by (select count(*) from stk_boms b where b.lab_product_id = p.id) = 0, p.sort, p.name;
end $$;
revoke execute on function prd_cost_list() from public, anon;
grant execute on function prd_cost_list() to authenticated;

-- ---------------------------------------------------------------------
-- Hazır reçete: Metal destekli porselen — Noritake (EX-3), Cr-Co döküm, 1 üye
--  Miktarlar yaklaşık sektör değerleri; fiyatlar Ekim 2026 tahmini (TL, kuruş). Alış yapıldıkça ortalama alış fiyatı kullanılır.
-- ---------------------------------------------------------------------
create or replace function prd_seed_pfm_noritake(p_product uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); r record; v_item uuid; v_st uuid; n_items int := 0; n_bom int := 0; n_steps int := 0;
begin
  if not (can_module('production', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from lab_products where id = p_product and (company_id = c or company_id is null)) then raise exception 'not_found'; end if;

  -- malzeme kartları (yoksa açılır) + reçete satırları
  for r in select * from (values
    ('RC-ALCI4', 'Tip 4 sert alçı (güdük / model)', 'g', 'raw', 50::numeric, 10::numeric, 86::bigint, 'Model ve güdük'),
    ('RC-KAIDE', 'Kaide alçısı (tip 3)', 'g', 'raw', 40, 10, 25, 'Model kaidesi'),
    ('RC-PIN', 'Model pini', 'adet', 'consumable', 1, 0, 600, 'Güdük pini'),
    ('RC-SPACER', 'Güdük sertleştirici + die spacer (payı)', 'üye', 'consumable', 1, 0, 800, 'Üye başına pay'),
    ('RC-MUM', 'Modelaj / daldırma / servikal mum', 'g', 'material', 1.5, 10, 1200, 'Kron mum modelajı'),
    ('RC-KANAL', 'Döküm kanal mumu', 'g', 'material', 0.5, 0, 600, 'Kanal ve rezervuar'),
    ('RC-REV', 'Fosfat bağlı revetman (Cr-Co)', 'g', 'raw', 90, 10, 95, 'Manşet başına pay'),
    ('RC-REVLIK', 'Revetman likidi', 'ml', 'raw', 22, 10, 228, '100 g tozda ~25 ml'),
    ('RC-CRCO', 'Cr-Co seramik döküm alaşımı', 'g', 'raw', 4, 15, 2000, 'Net tüketim (artık kısmen geri kullanılır)'),
    ('RC-POTA', 'Döküm potası (payı)', 'üye', 'consumable', 1, 0, 1000, '1 pota ≈ 30 döküm'),
    ('RC-KUM', 'Kumlama kumu Al2O3 110 µm', 'g', 'consumable', 25, 0, 30, 'Metal kumlama'),
    ('RC-FREZ', 'Seperatör + karbit frez aşınma payı', 'üye', 'consumable', 1, 0, 8000, 'Metal tesviye'),
    ('RC-NOP', 'Noritake EX-3 opak (pasta)', 'g', 'material', 0.3, 20, 14000, '2 kat opak'),
    ('RC-NBD', 'Noritake EX-3 body (dentin)', 'g', 'material', 1.0, 20, 9500, 'Dentin yığma'),
    ('RC-NEN', 'Noritake EX-3 enamel / insizal', 'g', 'material', 0.4, 20, 9500, 'Mine / insizal'),
    ('RC-NGL', 'Noritake glaze + boya', 'g', 'material', 0.1, 20, 12000, 'Glaze ve karakterizasyon'),
    ('RC-NLIK', 'Porselen modelaj likidi', 'ml', 'material', 0.5, 0, 600, 'Yığma likidi'),
    ('RC-ELMAS', 'Elmas frez, lastik, cila payı', 'üye', 'consumable', 1, 0, 4000, 'Porselen tesviye ve cila'),
    ('RC-PAKET', 'Paket (kutu, poşet, etiket, dezenfektan)', 'üye', 'packaging', 1, 0, 2500, 'Sevk paketi')
  ) as v(code, name, unit, kind, qty, waste, price, note) loop
    select id into v_item from stk_items where company_id = c and lower(code) = lower(r.code);
    if v_item is null then
      insert into stk_items (company_id, code, name, kind, unit, purchase_price, purchase_currency, note)
      values (c, r.code, r.name, r.kind, r.unit, r.price, 'TRY', 'Hazır reçete (Noritake metal-porselen) · tahmini fiyat, alış yapınca güncellenir')
      returning id into v_item;
      n_items := n_items + 1;
    end if;
    insert into stk_boms (lab_product_id, item_id, qty, waste_pct, note) values (p_product, v_item, r.qty, r.waste, r.note)
    on conflict (lab_product_id, item_id) do update set qty = excluded.qty, waste_pct = excluded.waste_pct, note = excluded.note;
    n_bom := n_bom + 1;
  end loop;

  -- istasyonlar (döküm akışı için eksikler açılır) + rota (seri üretim dakikaları, istasyon dakika ücreti kuruş)
  for r in select * from (values
    ('MDL', 'Model / alçı', 'model', '#8B6F47', 10, 12, 450::bigint, false),
    ('MUM', 'Mum modelaj', 'casting', '#B45309', 15, 18, 550, false),
    ('DOK', 'Revetman + döküm', 'casting', '#9A3412', 25, 8, 550, false),
    ('MTS', 'Metal tesviye + oksit', 'finishing', '#475569', 35, 20, 550, false),
    ('POR', 'Porselen / seramik', 'porcelain', '#DB2777', 50, 40, 800, false),
    ('BIT', 'Bitirme / cila', 'finishing', '#7C3AED', 60, 12, 650, false),
    ('QC', 'Kalite kontrol', 'qc', '#059669', 70, 3, 600, false),
    ('PAK', 'Paketleme', 'packing', '#64748B', 80, 2, 350, false)
  ) as v(code, name, kind, color, sort, minutes, rate, consume) loop
    select id into v_st from prd_stations where company_id = c and upper(code) = r.code limit 1;
    if v_st is null then
      insert into prd_stations (company_id, code, name, kind, color, sort, labor_rate_min) values (c, r.code, r.name, r.kind, r.color, r.sort, r.rate) returning id into v_st;
    else
      update prd_stations set labor_rate_min = coalesce(labor_rate_min, r.rate) where id = v_st;
    end if;
    insert into prd_route_steps (lab_product_id, station_id, sort, std_minutes, consume) values (p_product, v_st, r.sort, r.minutes, r.consume)
    on conflict (lab_product_id, station_id) do update set std_minutes = excluded.std_minutes, sort = excluded.sort;
    n_steps := n_steps + 1;
  end loop;

  insert into prd_cost_settings (company_id) values (c) on conflict (company_id) do nothing;
  return jsonb_build_object('items_created', n_items, 'bom_lines', n_bom, 'steps', n_steps);
end $$;
revoke execute on function prd_seed_pfm_noritake(uuid) from public, anon;
grant execute on function prd_seed_pfm_noritake(uuid) to authenticated;

notify pgrst, 'reload schema';
