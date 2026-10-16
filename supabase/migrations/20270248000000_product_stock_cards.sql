-- =====================================================================
-- PROTEZ ÜRÜNLERİNİN STOK KARTLARI
--  Her laboratuvar ürünü (lab_products) için "Protezler" kategorisinde bir stok kartı (kind = product)
--  Kart adı Türkçe (name_tr, yoksa asıl ad); orijinal ad nota yazılır. Satış fiyatı fiyat listesinden (TL, yoksa €).
--  stk_items.lab_product_id ile bağlıdır; ürün adı / Türkçesi / fiyatı / birimi / aktifliği değişince kart da güncellenir.
--  stk_sync_lab_products() : hepsini açar / günceller (dosya sonunda bir kez çalışır; ekrandaki düğme de çağırır)
-- Tekrar çalıştırılabilir.
-- =====================================================================

create unique index if not exists stk_items_lab_product_uidx on stk_items (lab_product_id) where lab_product_id is not null;

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
           is_active = p.is_active, category_id = coalesce(category_id, p_category),
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
  values (coalesce(p.company_id, lab_company()), v_code, v_name, 'product', p_category, case when p.per_unit then 'üye' else 'adet' end, v_price, v_cur, p.id, p.is_active,
          case when v_name <> p.name then left('Protez ürünü · orijinal ad: ' || p.name, 2000) else 'Protez ürünü' end);
  return 'created';
end $$;
revoke execute on function stk_sync_one_product(uuid, uuid) from public, anon, authenticated;

create or replace function stk_protez_category() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  select id into v from stk_categories where company_id = lab_company() and lower(name) = 'protezler' limit 1;
  if v is null then insert into stk_categories (company_id, name, sort) values (lab_company(), 'Protezler', 0) returning id into v; end if;
  return v;
end $$;
revoke execute on function stk_protez_category() from public, anon, authenticated;

create or replace function stk_sync_lab_products() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; v_cat uuid; v text; n_new int := 0; n_upd int := 0; n_tr int := 0;
begin
  if auth.uid() is not null and not (can_module('stock', 2) or can_module('sales', 2)) then raise exception 'not_allowed'; end if;
  v_cat := stk_protez_category();
  for r in select id, name_tr from lab_products where company_id = lab_company() or company_id is null loop
    v := stk_sync_one_product(r.id, v_cat);
    if v = 'created' then n_new := n_new + 1; elsif v = 'updated' then n_upd := n_upd + 1; end if;
    if coalesce(trim(r.name_tr), '') = '' then n_tr := n_tr + 1; end if;
  end loop;
  return jsonb_build_object('created', n_new, 'updated', n_upd, 'missing_tr', n_tr);
end $$;
revoke execute on function stk_sync_lab_products() from public, anon;
grant execute on function stk_sync_lab_products() to authenticated;

-- Ürün eklenince / değişince stok kartı da güncellenir
create or replace function lab_products_stock_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform stk_sync_one_product(new.id, stk_protez_category());
  return new;
end $$;
drop trigger if exists lab_products_stock_sync on lab_products;
create trigger lab_products_stock_sync after insert or update of name, name_tr, code, price_try, price_eur, per_unit, is_active on lab_products
  for each row execute function lab_products_stock_sync();

-- İlk aktarım
select stk_sync_lab_products();

notify pgrst, 'reload schema';
