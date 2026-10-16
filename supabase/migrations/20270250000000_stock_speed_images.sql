-- =====================================================================
-- HIZLANDIRMA + STOK KARTI RESİMLERİ
--  1) stk_item_totals: her kart için stk_avg_cost iki kez (her biri ayrı sorgu + kur) çağrılıyordu.
--     Protez kartları eklenince ana sayfa / stok / reçete ekranları yavaşladı. Artık tek geçişte hesaplanır.
--  2) prd_cost_list: maliyet yalnız reçetesi / rotası olan ürünler için hesaplanır.
--  3) stk_items.image_path + 'stock-images' deposu (ticari mal / ürün resimleri)
-- Tekrar çalıştırılabilir.
-- =====================================================================

create or replace view stk_item_totals with (security_invoker = true) as
select i.id as item_id,
       coalesce(m.q, 0) as qty,
       a.c as avg_cost,
       round(coalesce(m.q, 0) * a.c)::bigint as value
from stk_items i
left join lateral (
  select sum(x.qty) as q,
         round(sum(x.qty * x.unit_cost) filter (where x.qty > 0 and x.kind in ('opening', 'purchase', 'produce', 'count_adjust', 'adjust', 'sale_return') and x.unit_cost > 0)
               / nullif(sum(x.qty) filter (where x.qty > 0 and x.kind in ('opening', 'purchase', 'produce', 'count_adjust', 'adjust', 'sale_return') and x.unit_cost > 0), 0))::bigint as ac
    from stk_moves x where x.item_id = i.id
) m on true
cross join lateral (
  select coalesce(m.ac,
                  round(coalesce(i.purchase_price, 0) * case when coalesce(i.purchase_currency, 'TRY') = 'TRY' or coalesce(i.purchase_price, 0) = 0 then 1
                                                             else coalesce(fx_rate(i.purchase_currency, current_date), 1) end)::bigint,
                  0)::bigint as c
) a;
grant select on stk_item_totals to authenticated;

create index if not exists stk_boms_product_idx on stk_boms (lab_product_id);
create index if not exists stk_boms_item_idx on stk_boms (item_id);

-- Maliyet listesi: reçetesiz ürünlerde hesap yapılmaz
create or replace function prd_cost_list() returns table (
  id uuid, code text, name text, material text, lines int, steps int, minutes int, material_cost bigint, labor bigint, production bigint, total bigint,
  price_try bigint, price_eur bigint, price_eur_try bigint, margin_try numeric, margin_eur numeric, missing_prices int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not prd_cost_can() then raise exception 'not_allowed'; end if;
  return query
  with base as (
    select p.*, (select count(*)::int from stk_boms b where b.lab_product_id = p.id) as n_lines,
           (select count(*)::int from prd_route_steps r where r.lab_product_id = p.id) as n_steps
      from lab_products p
     where (p.company_id = lab_company() or p.company_id is null) and p.is_active
  )
  select p.id, p.code, p.name, p.material, p.n_lines, p.n_steps,
         (c->>'minutes')::int, (c->>'material')::bigint, (c->>'labor_total')::bigint, (c->>'production')::bigint, (c->>'total')::bigint,
         p.price_try, p.price_eur, (c->>'price_eur_try')::bigint, (c->>'margin_try')::numeric, (c->>'margin_eur')::numeric, (c->>'missing_prices')::int
    from base p
    left join lateral (select prd_cost_core(p.id) as c where p.n_lines > 0 or p.n_steps > 0) x on true
   order by (p.n_lines = 0 and p.n_steps = 0), p.sort, p.name;
end $$;
revoke execute on function prd_cost_list() from public, anon;
grant execute on function prd_cost_list() to authenticated;

-- ---------------------------------------------------------------------
-- Stok kartı resmi
-- ---------------------------------------------------------------------
alter table stk_items add column if not exists image_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('stock-images', 'stock-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "stock_images_write" on storage.objects;
drop policy if exists "stock_images_update" on storage.objects;
drop policy if exists "stock_images_delete" on storage.objects;
create policy "stock_images_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'stock-images' and (select can_module('stock', 2)));
create policy "stock_images_update" on storage.objects for update to authenticated
  using (bucket_id = 'stock-images' and (select can_module('stock', 2)));
create policy "stock_images_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'stock-images' and (select can_module('stock', 2)));

notify pgrst, 'reload schema';
