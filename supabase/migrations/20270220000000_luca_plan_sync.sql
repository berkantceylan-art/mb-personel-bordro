-- =====================================================================
-- Luca hesap planı ERP'ye: Luca'daki hesaplar ERP hesap planında da açılır, kategoriler Luca alt hesaplarına bağlanır.
--  gl_luca_sync_to_erp()       : Luca planında olup ERP'de olmayan hesapları açar (üst hesaplar sırayla)
--  Yönlendirme                 : sistemin kullandığı ana hesaplar (770, 191, 391 …) Luca alt hesabına yönlendirilir.
--                                gl_luca_map'teki eşleştirme yeni fiş satırlarında da uygulanır (kasa / banka / cari bağlı hesapları hariç).
--  gl_luca_categories()        : gelir / gider kategorileri, bağlı hesap ve Luca alt hesabı önerisi
-- Tekrar çalıştırılabilir. Önce 20270219000000_luca_export.sql.
-- =====================================================================

alter table gl_luca_settings add column if not exists redirect boolean not null default false;
alter table gl_luca_settings add column if not exists synced_at timestamptz;

-- Öneri kuralı sıkılaştırıldı (ilk kelime eşleşmesi kaldırıldı: "Alıcılar" bir müşteriye eşleşmesin)
-- ERP hesabı için Luca alt hesap önerisi: aynı ana hesabın altındaki tek alt hesap, banka hesap no, aynı ya da içeren ad
create or replace function gl_luca_suggest(p_erp text) returns text
language plpgsql stable security definer set search_path = public as $$
declare co uuid := lab_company(); a gl_accounts; main text := split_part(p_erp, '.', 1); n text; dig text; r text; k int;
begin
  select * into a from gl_accounts where company_id = co and code = p_erp;
  if a.id is null then return null; end if;
  select count(*), min(l.code) into k, r from gl_luca_leaves(main) l;
  if k = 0 then return null; end if;
  if k = 1 then return r; end if;
  n := gl_luca_norm(a.name);
  if a.link_type = 'fin_account' then
    select regexp_replace(coalesce(fa.account_no, ''), '\D', '', 'g') into dig from fin_accounts fa where fa.id = a.link_id;
    if length(coalesce(dig, '')) >= 6 then
      select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where position(dig in l.nm) > 0 or exists (select 1 from regexp_matches(l.nm, '([0-9]{6,})', 'g') m where position(m[1] in dig) > 0);
      if k = 1 then return r; end if;
    end if;
  end if;
  if length(n) >= 3 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where l.nm = n;
    if k = 1 then return r; end if;
  end if;
  if length(n) >= 5 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where length(l.nm) >= 5 and (l.nm like '%' || n || '%' or n like '%' || l.nm || '%');
    if k = 1 then return r; end if;
  end if;
  -- aynı başlangıç (ör. GENEL YÖNETİM GİDERLERİ ↔ GENEL YÖNETİM GİDERİ): son 4 harf hariç ön ek, tek eşleşme
  if length(n) >= 10 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where l.nm like left(n, greatest(8, length(n) - 4)) || '%';
    if k = 1 then return r; end if;
  end if;
  return null;
end $$;
revoke execute on function gl_luca_suggest(text) from public, anon, authenticated;

-- Luca planında olup ERP'de olmayan hesaplar
create or replace function gl_luca_sync_preview() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'plan', (select count(*) from gl_luca_accounts where company_id = lab_company()),
    'create', (select count(*) from gl_luca_accounts la where la.company_id = lab_company()
                 and la.code ~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$'
                 and not exists (select 1 from gl_accounts a where a.company_id = la.company_id and a.code = la.code)),
    'skip', (select count(*) from gl_luca_accounts la where la.company_id = lab_company() and la.code !~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$' and length(la.code) > 2),
    'sample', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name) order by code), '[]') from (
                 select la.code, la.name from gl_luca_accounts la where la.company_id = lab_company()
                   and la.code ~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$'
                   and not exists (select 1 from gl_accounts a where a.company_id = la.company_id and a.code = la.code)
                 order by la.code limit 12) s),
    'synced_at', (select synced_at from gl_luca_settings where company_id = lab_company()),
    'redirect', coalesce((select redirect from gl_luca_settings where company_id = lab_company()), false)) end;
$$;
revoke execute on function gl_luca_sync_preview() from public, anon;
grant execute on function gl_luca_sync_preview() to authenticated;

create or replace function gl_luca_sync_to_erp() returns jsonb
language plpgsql security definer set search_path = public as $$
declare co uuid := lab_company(); r record; pid uuid; pcode text; made int := 0; skipped int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from gl_luca_accounts where company_id = co) then raise exception 'luca_plan_empty'; end if;
  for r in
    select la.code, la.name from gl_luca_accounts la
    where la.company_id = co and la.code ~ '^[1-9][0-9]{2}(\.[0-9A-Za-z]{1,8}){0,4}$'
      and not exists (select 1 from gl_accounts a where a.company_id = co and a.code = la.code)
    order by length(la.code) - length(replace(la.code, '.', '')), la.code
  loop
    pcode := case when r.code ~ '\.' then regexp_replace(r.code, '\.[^.]+$', '') end;
    pid := null;
    if pcode is not null then
      select id into pid from gl_accounts where company_id = co and code = pcode;
      if pid is null then skipped := skipped + 1; continue; end if;
    end if;
    insert into gl_accounts (company_id, code, name, parent_id, kind, normal_side, note)
    values (co, r.code, left(coalesce(nullif(trim(r.name), ''), r.code), 160), pid, gl_kind_of(r.code), gl_side_of(r.code, coalesce(r.name, '')), 'Luca hesap planından')
    on conflict (company_id, code) do nothing;
    made := made + 1;
  end loop;
  insert into gl_luca_settings (company_id) values (co) on conflict (company_id) do nothing;
  update gl_luca_settings set redirect = true, synced_at = now(), updated_by = auth.uid(), updated_at = now() where company_id = co;
  return jsonb_build_object('created', made, 'skipped', skipped) || gl_luca_apply_suggestions();
end $$;
revoke execute on function gl_luca_sync_to_erp() from public, anon;
grant execute on function gl_luca_sync_to_erp() to authenticated;

create or replace function gl_luca_set_redirect(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  insert into gl_luca_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update gl_luca_settings set redirect = coalesce(p_on, false), updated_by = auth.uid(), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function gl_luca_set_redirect(boolean) from public, anon;
grant execute on function gl_luca_set_redirect(boolean) to authenticated;

-- Yeni fiş satırı: ana hesap eşleştirmesi varsa Luca alt hesabına yaz (bağlı kasa / banka / cari hesapları hariç)
create or replace function gl_lines_luca_redirect() returns trigger language plpgsql security definer set search_path = public as $$
declare t uuid;
begin
  select a2.id into t
  from gl_accounts a
  join gl_luca_settings s on s.company_id = a.company_id and s.redirect
  join gl_luca_map m on m.company_id = a.company_id and m.erp_code = a.code
  join gl_accounts a2 on a2.company_id = a.company_id and a2.code = m.luca_code and a2.is_active
  where a.id = new.account_id and a.link_type is null and a2.id <> a.id and a2.link_type is null
    and not exists (select 1 from gl_maps g where g.company_id = a.company_id and g.account_id = a.id and g.source in ('fin_account', 'party', 'account_kind', 'party_kind'))
    and not exists (select 1 from gl_accounts c where c.parent_id = a2.id);
  if t is not null then new.account_id := t; end if;
  return new;
end $$;
drop trigger if exists gl_lines_luca_redirect on gl_lines;
create trigger gl_lines_luca_redirect before insert on gl_lines for each row execute function gl_lines_luca_redirect();

-- Sistem fişleri (gl_add_line) kod ile hesap bulur: ana hesabın altında hesap varsa önce Luca eşleştirmesine bakılır,
-- yoksa eskisi gibi ilk kayıt kabul eden alt hesap seçilir
create or replace function gl_postable_id(p_code text) returns uuid language sql stable security definer set search_path = public as $$
  select coalesce(
    (select a2.id from gl_luca_settings s
       join gl_luca_map m on m.company_id = s.company_id and m.erp_code = p_code
       join gl_accounts a2 on a2.company_id = s.company_id and a2.code = m.luca_code and a2.is_active and a2.postable
     where s.company_id = lab_company() and s.redirect limit 1),
    (select id from gl_accounts
      where company_id = lab_company() and is_active and (code = p_code or code like p_code || '.%') and postable
      order by (code = p_code) desc, string_to_array(code, '.') limit 1));
$$;
revoke execute on function gl_postable_id(text) from public, anon, authenticated;

-- Yönlendirme gereken hesaplar: altında hesap olan, bağlı olmayan ve kullanılan (fiş satırı veya kategori eşleştirmesi) hesaplar
create or replace function gl_luca_redirects() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(x order by x->>'code'), '[]') end from (
    select jsonb_build_object('code', a.code, 'name', a.name,
             'target', m.luca_code, 'target_name', (select t.name from gl_accounts t where t.company_id = a.company_id and t.code = m.luca_code),
             'suggest', gl_luca_suggest(a.code),
             'fallback', (select f.code || ' · ' || f.name from gl_accounts f where f.id = gl_postable_id(a.code)),
             'lines', (select count(*) from gl_lines l where l.account_id = a.id),
             'maps', (select count(*) from gl_maps g where g.company_id = a.company_id and g.account_id = a.id),
             'options', (select coalesce(jsonb_agg(jsonb_build_object('code', c.code, 'name', c.name) order by c.code), '[]') from (
                 select c.code, c.name from gl_accounts c
                 where c.company_id = a.company_id and c.code like a.code || '.%' and c.is_active and c.link_type is null
                   and not exists (select 1 from gl_accounts d where d.parent_id = c.id)
                 order by c.code limit 300) c)) x
    from gl_accounts a left join gl_luca_map m on m.company_id = a.company_id and m.erp_code = a.code
    where a.company_id = lab_company() and a.link_type is null and a.is_active
      and exists (select 1 from gl_accounts c where c.parent_id = a.id)
      and not exists (select 1 from gl_accounts c where c.parent_id = a.id and c.link_type is not null)
      and not exists (select 1 from gl_maps g where g.company_id = a.company_id and g.account_id = a.id and g.source in ('fin_account', 'party', 'account_kind', 'party_kind'))
      and (exists (select 1 from gl_lines l where l.account_id = a.id) or exists (select 1 from gl_maps g where g.company_id = a.company_id and g.account_id = a.id))
  ) q;
$$;
revoke execute on function gl_luca_redirects() from public, anon;
grant execute on function gl_luca_redirects() to authenticated;

-- Kategorinin bugün gittiği hesap (gl_resolve ile aynı öncelik: kategori → kod → üst kategori)
create or replace function gl_category_account(p_cat uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(gl_map_get(c.company_id, 'category', c.id::text), gl_map_get(c.company_id, 'category_code', c.code),
                  gl_map_get(c.company_id, 'category', c.parent_id::text), gl_map_get(c.company_id, 'category_code', p.code),
                  gl_map_get(c.company_id, 'category_kind', c.kind))
  from fin_categories c left join fin_categories p on p.id = c.parent_id where c.id = p_cat;
$$;
revoke execute on function gl_category_account(uuid) from public, anon, authenticated;

-- Kategori adına göre Luca alt hesabı önerisi (bağlı hesabın ana kodu altında)
create or replace function gl_luca_category_suggest(p_name text, p_main text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text := gl_luca_norm(p_name); w text; r text; k int; leaves text[];
begin
  if p_main is null then return null; end if;
  select array_agg(c.code order by c.code) into leaves from gl_accounts c
  where c.company_id = lab_company() and c.code like p_main || '.%' and c.is_active and c.link_type is null
    and not exists (select 1 from gl_accounts d where d.parent_id = c.id);
  if leaves is null then return null; end if;
  if cardinality(leaves) = 1 then return leaves[1]; end if;
  -- aynı ad / ad içinde geçiyor
  select min(c.code), count(*) into r, k from gl_accounts c where c.company_id = lab_company() and c.code = any (leaves)
    and length(n) >= 4 and (gl_luca_norm(c.name) = n or gl_luca_norm(c.name) like n || '%' or gl_luca_norm(c.name) like '%' || n || '%');
  if k = 1 then return r; end if;
  if k > 1 then
    select min(c.code) into r from gl_accounts c where c.company_id = lab_company() and c.code = any (leaves) and gl_luca_norm(c.name) like n || '%';
    if r is not null then return r; end if;
  end if;
  -- ilk kelime tek bir alt hesabın başında geçiyorsa (ör. KARGO → KARGO GİDERLERİ)
  w := gl_luca_norm(split_part(trim(p_name), ' ', 1));
  if length(w) >= 5 then
    select min(c.code), count(*) into r, k from gl_accounts c where c.company_id = lab_company() and c.code = any (leaves) and gl_luca_norm(c.name) like w || '%';
    if k = 1 then return r; end if;
  end if;
  return null;
end $$;
revoke execute on function gl_luca_category_suggest(text, text) from public, anon, authenticated;

create or replace function gl_luca_categories() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(x order by x->>'kind', x->>'name'), '[]') end from (
    select jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name, 'kind', c.kind, 'parent', p.name,
             'account', a.code, 'account_name', a.name,
             'own', exists (select 1 from gl_maps g where g.company_id = c.company_id and g.source = 'category' and g.key = c.id::text),
             'leaf', a.id is not null and not exists (select 1 from gl_accounts d where d.parent_id = a.id),
             'suggest', case when a.id is not null and exists (select 1 from gl_accounts d where d.parent_id = a.id)
                             then gl_luca_category_suggest(c.name, split_part(a.code, '.', 1)) end,
             'options', (select coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name) order by o.code), '[]') from (
                 select o.code, o.name from gl_accounts o
                 where o.company_id = c.company_id and a.id is not null and o.code like split_part(a.code, '.', 1) || '.%' and o.is_active and o.link_type is null
                   and not exists (select 1 from gl_accounts d where d.parent_id = o.id)
                 order by o.code limit 300) o)) x
    from fin_categories c
    left join fin_categories p on p.id = c.parent_id
    left join gl_accounts a on a.id = gl_category_account(c.id)
    where (c.company_id = lab_company() or c.company_id is null) and c.is_active and c.kind in ('income', 'expense', 'other', 'stock', 'equity')
  ) q;
$$;
revoke execute on function gl_luca_categories() from public, anon;
grant execute on function gl_luca_categories() to authenticated;

create or replace function gl_luca_category_set(p_cat uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_categories where id = p_cat and (company_id = lab_company() or company_id is null)) then raise exception 'not_found'; end if;
  perform gl_map_save('category', p_cat::text, p_code);
end $$;
revoke execute on function gl_luca_category_set(uuid, text) from public, anon;
grant execute on function gl_luca_category_set(uuid, text) to authenticated;

-- Önerilenleri uygula: kategoriler + ana hesap yönlendirmeleri
create or replace function gl_luca_apply_suggestions() returns jsonb
language plpgsql security definer set search_path = public as $$
declare x jsonb; nc int := 0; nr int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  for x in select e from jsonb_array_elements(gl_luca_categories()) e where e->>'suggest' is not null loop
    perform gl_map_save('category', x->>'id', x->>'suggest'); nc := nc + 1;
  end loop;
  for x in select e from jsonb_array_elements(gl_luca_redirects()) e where e->>'target' is null and e->>'suggest' is not null loop
    insert into gl_luca_map (company_id, erp_code, luca_code) values (lab_company(), x->>'code', x->>'suggest')
    on conflict (company_id, erp_code) do update set luca_code = excluded.luca_code, updated_at = now();
    nr := nr + 1;
  end loop;
  return jsonb_build_object('categories', nc, 'redirects', nr);
end $$;
revoke execute on function gl_luca_apply_suggestions() from public, anon;
grant execute on function gl_luca_apply_suggestions() to authenticated;
