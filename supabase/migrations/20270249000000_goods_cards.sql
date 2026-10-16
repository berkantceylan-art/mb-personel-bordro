-- Protez stok kartları "Ticari mal" türünde: ürün reçetesi ve işe malzeme eklerken listede çıkmaz
-- (reçeteye yalnız malzeme, hammadde, sarf ve ambalaj eklenebilir). Tekrar çalıştırılabilir.

create or replace function stk_sync_one_product(p_product uuid, p_category uuid) returns text
language plpgsql security definer set search_path = public as $$
declare p lab_products; v_item uuid; v_name text; v_base text; v_code text; n int := 1; v_cur text; v_price bigint;
begin
  select * into p from lab_products where id = p_product;
  if p.id is null then return 'missing'; end if;
  v_name := left(coalesce(nullif(trim(p.name_tr), ''), p.name), 200);
  v_cur := case when p.price_try is null and p.price_eur is not null then 'EUR' else 'TRY' end;
  v_price := coalesce(p.price_try, p.price_eur);
  select id into v_item from stk_items where lab_product_id = p.id;
  if v_item is not null then
    update stk_items set name = v_name, sale_price = v_price, sale_currency = v_cur, unit = case when p.per_unit then 'üye' else 'adet' end,
           is_active = p.is_active, kind = 'goods', category_id = coalesce(category_id, p_category),
           note = case when v_name <> p.name then left('Protez ürünü · orijinal ad: ' || p.name, 2000) else coalesce(note, 'Protez ürünü') end, updated_at = now()
     where id = v_item;
    return 'updated';
  end if;
  v_base := 'PR-' || coalesce(nullif(left(regexp_replace(upper(coalesce(p.code, '')), '[^A-Z0-9]', '', 'g'), 30), ''),
                             upper(left(replace(p.id::text, '-', ''), 8)));
  v_code := v_base;
  while exists (select 1 from stk_items where company_id = coalesce(p.company_id, lab_company()) and lower(code) = lower(v_code)) loop
    n := n + 1; v_code := left(v_base, 36) || '-' || n;
  end loop;
  insert into stk_items (company_id, code, name, kind, category_id, unit, sale_price, sale_currency, lab_product_id, is_active, note)
  values (coalesce(p.company_id, lab_company()), v_code, v_name, 'goods', p_category, case when p.per_unit then 'üye' else 'adet' end, v_price, v_cur, p.id, p.is_active,
          case when v_name <> p.name then left('Protez ürünü · orijinal ad: ' || p.name, 2000) else 'Protez ürünü' end);
  return 'created';
end $$;
revoke execute on function stk_sync_one_product(uuid, uuid) from public, anon, authenticated;

update stk_items set kind = 'goods', updated_at = now() where lab_product_id is not null and kind <> 'goods';

-- Reçeteye satılan ürün eklenmesin
create or replace function stk_boms_guard() returns trigger language plpgsql as $$
begin
  if exists (select 1 from stk_items where id = new.item_id and (lab_product_id is not null or kind in ('goods', 'product', 'service'))) then
    raise exception 'bom_item_not_material';
  end if;
  return new;
end $$;
drop trigger if exists stk_boms_guard on stk_boms;
create trigger stk_boms_guard before insert or update of item_id on stk_boms for each row execute function stk_boms_guard();

notify pgrst, 'reload schema';
