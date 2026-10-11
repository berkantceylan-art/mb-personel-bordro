-- =====================================================================
-- KULLANICI TÜRLERİ
--  Şirket sahibi "İK uzmanı", "Muhasebeci", "Ön muhasebeci" gibi türler açar ve her türün hangi
--  modülleri hangi seviyede kullanacağını seçer. Kullanıcıya tür atanınca rolü, bayrakları ve modül
--  yetkileri türden yazılır; tür değişince o türdeki herkes güncellenir.
--  Yeni alan modülleri: hr (insan kaynakları), attendance (puantaj ve izin), payroll (bordro ve ücret),
--  safety (İSG ve yasal uyum), lab (laboratuvar, hekim, kargo)
-- Tekrar çalıştırılabilir. Önce 20261209000000_job_flow.sql.
-- =====================================================================

-- 1) Modül listesi genişler
do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'module_permissions'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%module%in%';
  if c is not null then execute format('alter table module_permissions drop constraint %I', c); end if;
end $$;
alter table module_permissions add constraint module_permissions_module_check
  check (module in ('hr', 'attendance', 'payroll', 'safety', 'lab', 'finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users'));

create or replace function all_modules() returns text[] language sql immutable as $$
  select array['hr', 'attendance', 'payroll', 'safety', 'lab', 'finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users'];
$$;

-- Rol varsayılanı (satır yoksa) — mevcut kullanıcılar bugünkü menülerini aynen görür
create or replace function module_default_level(p_role text, p_logistics boolean, p_module text) returns smallint
language sql immutable as $$
  select greatest(
    case p_role
      when 'owner' then 3
      when 'accountant' then case
        when p_module in ('finance', 'sales', 'purchases', 'expenses', 'assets', 'payroll') then 3
        when p_module in ('stock', 'hr', 'attendance', 'lab') then 2
        when p_module in ('production', 'safety') then 1 else 0 end
      when 'branch_manager' then case
        when p_module in ('stock', 'production', 'hr', 'attendance', 'lab') then 2
        when p_module in ('sales', 'purchases', 'expenses', 'assets', 'safety') then 1 else 0 end
      when 'hr' then case
        when p_module in ('hr', 'attendance', 'safety') then 3
        when p_module in ('lab', 'users') then 2
        when p_module in ('assets', 'expenses', 'payroll') then 1 else 0 end
      when 'safety' then case when p_module = 'safety' then 3 when p_module in ('hr', 'attendance') then 1 else 0 end
      else 0 end,
    case when coalesce(p_logistics, false) and p_module in ('stock', 'production', 'lab') then 2 else 0 end
  )::smallint;
$$;

-- Herhangi bir kullanıcının seviyesi (iç yardımcı)
create or replace function module_level_for(p_user uuid, p_module text) returns smallint
language sql stable security definer set search_path = public as $$
  select greatest(
    coalesce(
      (select p.level from module_permissions p join memberships m on m.company_id = p.company_id and m.user_id = p.user_id
       where p.user_id = p_user and p.module = p_module order by m.created_at limit 1),
      (select module_default_level(m.role::text, m.logistics_access, p_module) from memberships m where m.user_id = p_user order by m.created_at limit 1),
      0::smallint),
    case when p_module = 'production' and exists (select 1 from prd_people pp join employees e on e.id = pp.employee_id where e.user_id = p_user and pp.is_active) then 2 else 0 end
  )::smallint;
$$;
revoke execute on function module_level_for(uuid, text) from public, anon, authenticated;

create or replace function module_level(p_module text) returns smallint
language sql stable security definer set search_path = public as $$ select module_level_for(auth.uid(), p_module) $$;
grant execute on function module_level(text) to authenticated;

create or replace function my_module_levels() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(m, module_level_for(auth.uid(), m)) from unnest(all_modules()) as m;
$$;
grant execute on function my_module_levels() to authenticated;

-- 2) Türler
create table if not exists user_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  description text,
  color text not null default '#0A3D73',
  levels jsonb not null default '{}'::jsonb,
  scoped boolean not null default false,       -- yalnız sorumlu olduğu şube / bölüm personelini görür (şef)
  site_access boolean not null default false,  -- web sitesi yönetimi
  boss boolean not null default false,         -- patron ekranı (mobil özet)
  flow_role text check (flow_role in ('technician', 'chief', 'qc', 'dispatch')),
  sort int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, name)
);
alter table user_types enable row level security;
drop policy if exists user_types_read on user_types;
create policy user_types_read on user_types for select to authenticated using (is_member(company_id));
revoke insert, update, delete on user_types from authenticated;
grant select on user_types to authenticated;

alter table memberships add column if not exists user_type_id uuid references user_types (id) on delete set null;
alter table invites add column if not exists user_type_id uuid references user_types (id) on delete set null;

-- Türün temel rolü modüllerden çıkar (insan kaynakları verisine erişim rolle korunur)
create or replace function user_type_role(p_levels jsonb, p_scoped boolean) returns app_role language sql immutable as $$
  select case
    when coalesce((p_levels->>'payroll')::int, 0) >= 1 then 'accountant'
    when coalesce((p_levels->>'hr')::int, 0) >= 1 or coalesce((p_levels->>'attendance')::int, 0) >= 1 then case when p_scoped then 'branch_manager' else 'hr' end
    when coalesce((p_levels->>'safety')::int, 0) >= 1 then 'safety'
    else 'employee' end::app_role;
$$;

-- Seviyeleri temizle: bilinmeyen anahtar yok, 0–3
create or replace function user_type_clean(p jsonb) returns jsonb language sql immutable as $$
  select coalesce(jsonb_object_agg(m, least(greatest(coalesce((p->>m)::int, 0), 0), 3)), '{}'::jsonb) from unnest(all_modules()) m;
$$;

-- Atama yetkisi: sahip her şeyi; kullanıcı yönetimi 2+ olan, kendinden yüksek yetki veremez, kendine atayamaz, sahibe dokunamaz
create or replace function user_type_can_assign(p_actor uuid, p_levels jsonb, p_target uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_trole text; m text;
begin
  select role::text into v_role from memberships where user_id = p_actor order by created_at limit 1;
  if v_role is null then return 'not_allowed'; end if;
  if p_target is not null then
    select role::text into v_trole from memberships where user_id = p_target and company_id = (select company_id from memberships where user_id = p_actor order by created_at limit 1);
    if v_trole = 'owner' then return 'owner_full'; end if;
  end if;
  if v_role = 'owner' then return null; end if;
  if module_level_for(p_actor, 'users') < 2 then return 'not_allowed'; end if;
  if p_target = p_actor then return 'self'; end if;
  -- kendinden yetkili birine dokunamaz
  if p_target is not null then
    foreach m in array all_modules() loop
      if m in ('production', 'lab', 'stock') then continue; end if;
      if module_level_for(p_target, m) > module_level_for(p_actor, m) then return 'target_above'; end if;
    end loop;
  end if;
  foreach m in array all_modules() loop
    if (m in ('production', 'lab') and coalesce((p_levels->>m)::int, 0) <= 2) or (m = 'stock' and coalesce((p_levels->>m)::int, 0) <= 1) then continue; end if;
    if coalesce((p_levels->>m)::int, 0) > module_level_for(p_actor, m) then return 'above_own:' || m; end if;
  end loop;
  if coalesce((p_levels->>'users')::int, 0) >= 3 then return 'above_own:users'; end if;
  return null;
end $$;
revoke execute on function user_type_can_assign(uuid, jsonb, uuid) from public, anon, authenticated;

-- Türü bir kullanıcıya uygula (iç). p_old verilirse (tür düzenlendi): kişiye özel değiştirilmiş modüllere dokunulmaz
drop function if exists user_type_apply_sys(uuid, uuid, uuid);
create or replace function user_type_apply_sys(p_company uuid, p_user uuid, p_type uuid, p_old jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare t user_types; v_role app_role; m text; v_emp uuid; v_cur smallint;
begin
  select * into t from user_types where id = p_type and company_id = p_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  if exists (select 1 from memberships where user_id = p_user and company_id = p_company and role = 'owner') then raise exception 'owner_full'; end if;
  v_role := user_type_role(t.levels, t.scoped);
  update memberships set role = v_role, user_type_id = t.id,
    logistics_access = coalesce((t.levels->>'lab')::int, 0) >= 1,
    site_access = t.site_access,
    is_boss = t.boss and v_role = 'accountant',
    all_branches = case when t.scoped then all_branches else true end
  where user_id = p_user and company_id = p_company;
  foreach m in array all_modules() loop
    if p_old is not null then
      select level into v_cur from module_permissions where company_id = p_company and user_id = p_user and module = m;
      if v_cur is not null and v_cur <> coalesce((p_old->>m)::int, 0) then continue; end if;
    end if;
    insert into module_permissions (company_id, user_id, module, level, updated_at, updated_by)
    values (p_company, p_user, m, coalesce((t.levels->>m)::int, 0), now(), auth.uid())
    on conflict (company_id, user_id, module) do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
  end loop;
  if t.flow_role is not null then
    select id into v_emp from employees where user_id = p_user and company_id = p_company limit 1;
    if v_emp is not null then
      insert into prd_people (employee_id, company_id, flow_role, is_active) values (v_emp, p_company, t.flow_role, true)
      on conflict (employee_id) do update set flow_role = excluded.flow_role, is_active = true;
    end if;
  end if;
end $$;
revoke execute on function user_type_apply_sys(uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- Hazır türler
create or replace function user_types_seed(p_company uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; r record;
begin
  for r in select * from (values
    (10, 'İK uzmanı', 'Personel, işe alım, puantaj, izin, İSG. Maaş ve bordro görmez.', '#7C3AED', '{"hr":3,"attendance":3,"safety":2,"assets":1,"expenses":1,"users":2}'::jsonb, false, null::text),
    (20, 'Muhasebeci', 'Bordro, ücret, finans, alış-satış, masraf, demirbaş; personel ve puantajı görür.', '#0A3D73', '{"payroll":3,"hr":1,"attendance":1,"safety":1,"lab":1,"finance":3,"sales":3,"purchases":3,"stock":2,"production":1,"assets":3,"expenses":3}', false, null),
    (30, 'Ön muhasebeci', 'Fatura, tahsilat, ödeme, cari, masraf. Bordro ve maaş görmez.', '#0891B2', '{"lab":1,"finance":2,"sales":2,"purchases":2,"stock":1,"assets":1,"expenses":2}', false, null),
    (40, 'Bölüm şefi', 'Yalnız kendi bölümünün personeli: puantaj, izin onayı; üretim ve stok.', '#D97706', '{"hr":1,"attendance":2,"safety":1,"lab":1,"sales":1,"purchases":1,"stock":2,"production":3,"assets":1,"expenses":1}', true, 'chief'),
    (50, 'İSG uzmanı', 'İş güvenliği, sağlık, eğitim kayıtları.', '#059669', '{"safety":3,"hr":1}', false, null),
    (60, 'Laboratuvar kabul / sekreter', 'İş kayıt, hekim kartları, prova-teslim, kargo.', '#2563EB', '{"lab":2,"sales":1,"stock":1,"production":1}', false, null),
    (70, 'Teknisyen', 'Kutu okutur; kendi işlerini görür.', '#475569', '{"production":2,"stock":1}', false, 'technician'),
    (80, 'Kalite kontrol', 'Kontrol sorumlusu: kutuyu onaylar ya da geri gönderir.', '#0E7490', '{"production":2,"lab":1}', false, 'qc'),
    (90, 'Pazarlama / sevkiyat', 'Kutunun çıkışını yapar; hekim carisine işlenir.', '#16A34A', '{"lab":2,"production":2,"sales":1}', false, 'dispatch'),
    (100, 'Depo sorumlusu', 'Stok, depo, sayım, alış.', '#9333EA', '{"stock":3,"purchases":2,"production":1,"lab":1}', false, null),
    (110, 'Personel (yalnız kendi sayfası)', 'Telefondan kendi puantajı, izni, bordrosu, avans ve masraf.', '#64748B', '{}', false, null)
  ) as v(sort, name, description, color, levels, scoped, flow_role) loop
    insert into user_types (company_id, name, description, color, levels, scoped, flow_role, sort)
    values (p_company, r.name, r.description, r.color, user_type_clean(r.levels), r.scoped, r.flow_role, r.sort)
    on conflict (company_id, name) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke execute on function user_types_seed(uuid) from public, anon, authenticated;

do $$ declare c uuid; begin
  for c in select id from companies loop
    if not exists (select 1 from user_types where company_id = c) then perform user_types_seed(c); end if;
  end loop;
end $$;

-- 3) Arayüz fonksiyonları
create or replace function my_company() returns uuid language sql stable security definer set search_path = public as $$
  select company_id from memberships where user_id = auth.uid() order by created_at limit 1;
$$;
grant execute on function my_company() to authenticated;

create or replace function user_types_list() returns table (id uuid, name text, description text, color text, levels jsonb, scoped boolean, site_access boolean, boss boolean, flow_role text, sort int, members int, base_role text)
language sql stable security definer set search_path = public as $$
  select t.id, t.name, t.description, t.color, user_type_clean(t.levels), t.scoped, t.site_access, t.boss, t.flow_role, t.sort,
         (select count(*)::int from memberships m where m.user_type_id = t.id), user_type_role(t.levels, t.scoped)::text
  from user_types t where t.company_id = my_company()
  order by t.sort, t.name;
$$;
grant execute on function user_types_list() to authenticated;

create or replace function user_types_restore() returns int language plpgsql security definer set search_path = public as $$
begin
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  return user_types_seed(my_company());
end $$;
grant execute on function user_types_restore() to authenticated;

-- Kaydet (yeni ya da düzenle); türdeki herkes yeniden uygulanır. Döner: tür id
create or replace function user_type_save(p_id uuid, p_name text, p_description text, p_color text, p_levels jsonb, p_scoped boolean, p_site boolean, p_boss boolean, p_flow_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); v_id uuid; v_levels jsonb := user_type_clean(p_levels); v_err text; u uuid; v_old jsonb;
begin
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  v_err := user_type_can_assign(auth.uid(), v_levels, null);
  if v_err is not null then raise exception '%', v_err; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if p_flow_role is not null and p_flow_role not in ('technician', 'chief', 'qc', 'dispatch') then p_flow_role := null; end if;
  if p_id is null then
    insert into user_types (company_id, name, description, color, levels, scoped, site_access, boss, flow_role, sort)
    values (v_company, trim(p_name), nullif(trim(p_description), ''), coalesce(nullif(p_color, ''), '#0A3D73'), v_levels, coalesce(p_scoped, false), coalesce(p_site, false), coalesce(p_boss, false), p_flow_role,
            coalesce((select max(sort) + 10 from user_types where company_id = v_company), 10))
    returning id into v_id;
  else
    select user_type_clean(levels) into v_old from user_types where id = p_id and company_id = v_company;
    update user_types set name = trim(p_name), description = nullif(trim(p_description), ''), color = coalesce(nullif(p_color, ''), color), levels = v_levels,
      scoped = coalesce(p_scoped, false), site_access = coalesce(p_site, false), boss = coalesce(p_boss, false), flow_role = p_flow_role, updated_at = now()
    where id = p_id and company_id = v_company returning id into v_id;
    if v_id is null then raise exception 'type_not_found'; end if;
    for u in select user_id from memberships where user_type_id = v_id and company_id = v_company and role <> 'owner' and user_id <> auth.uid() loop
      perform user_type_apply_sys(v_company, u, v_id, v_old);
    end loop;
  end if;
  return v_id;
exception when unique_violation then raise exception 'name_taken';
end $$;
grant execute on function user_type_save(uuid, text, text, text, jsonb, boolean, boolean, boolean, text) to authenticated;

-- Sil: bu türdeki kullanıcıların yetkileri olduğu gibi kalır, yalnız tür bağı kopar
create or replace function user_type_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  update memberships set user_type_id = null where user_type_id = p_id;
  update invites set user_type_id = null where user_type_id = p_id and used_at is null;
  delete from user_types where id = p_id and company_id = my_company();
end $$;
grant execute on function user_type_delete(uuid) to authenticated;

-- Kullanıcıya tür ata
create or replace function user_type_assign(p_user uuid, p_type uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); t user_types; v_err text;
begin
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  if not exists (select 1 from memberships where user_id = p_user and company_id = v_company) then raise exception 'not_found'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(t.levels), p_user);
  if v_err is not null then raise exception '%', v_err; end if;
  perform user_type_apply_sys(v_company, p_user, p_type);
end $$;
grant execute on function user_type_assign(uuid, uuid) to authenticated;

-- Kişiye özel ayar (türden farklı tek modül): set_module_levels yeni modülleri de kabul eder
create or replace function set_module_levels(p_user uuid, p_levels jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role text; k text; v jsonb; v_err text;
begin
  select m.company_id, m.role::text into v_company, v_role from memberships m
  where m.user_id = p_user and m.company_id = my_company() limit 1;
  if v_company is null then raise exception 'not_found'; end if;
  if v_role = 'owner' then raise exception 'owner_full'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(coalesce((select jsonb_object_agg(key, value) from jsonb_each(p_levels) where jsonb_typeof(value) = 'number'), '{}'::jsonb)), case when p_user = auth.uid() then null else p_user end);
  if v_err is not null then raise exception '%', v_err; end if;
  if module_level('users') < 2 then raise exception 'not_allowed'; end if;
  if v_role = 'owner' then raise exception 'owner_full'; end if;
  if p_user = auth.uid() and p_levels ? 'users' and (jsonb_typeof(p_levels->'users') = 'null' or (p_levels->>'users')::int < 3) then raise exception 'self_lockout'; end if;
  for k, v in select * from jsonb_each(p_levels) loop
    if not (k = any (all_modules())) then continue; end if;
    if v is null or jsonb_typeof(v) = 'null' then
      delete from module_permissions where company_id = v_company and user_id = p_user and module = k;
    else
      insert into module_permissions (company_id, user_id, module, level, updated_at, updated_by)
      values (v_company, p_user, k, least(greatest((v #>> '{}')::int, 0), 3), now(), auth.uid())
      on conflict (company_id, user_id, module) do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
    end if;
  end loop;
end $$;
revoke execute on function set_module_levels(uuid, jsonb) from public, anon;
grant execute on function set_module_levels(uuid, jsonb) to authenticated;

-- Kullanıcı listesi (yeni)
drop function if exists users_overview();
create or replace function users_overview() returns table (
  user_id uuid, display_name text, role text, email text, last_sign_in_at timestamptz, created_at timestamptz,
  logistics boolean, site_access boolean, boss boolean, all_branches boolean, employee_id uuid, employee_name text, department text,
  user_type_id uuid, user_type text, type_color text, type_levels jsonb, levels jsonb, explicit jsonb, flow_role text
) language sql stable security definer set search_path = public, auth as $$
  select m.user_id,
         coalesce(m.display_name, e.first_name || ' ' || e.last_name, u.email, 'Kullanıcı'),
         m.role::text, u.email, u.last_sign_in_at, m.created_at,
         coalesce(m.logistics_access, false), coalesce(m.site_access, false), coalesce(m.is_boss, false), m.all_branches,
         e.id, e.first_name || ' ' || e.last_name, d.name,
         t.id, t.name, t.color, user_type_clean(t.levels),
         (select jsonb_object_agg(md, module_level_for(m.user_id, md)) from unnest(all_modules()) md),
         coalesce((select jsonb_object_agg(p.module, p.level) from module_permissions p where p.company_id = m.company_id and p.user_id = m.user_id), '{}'::jsonb),
         pp.flow_role
  from memberships m
  left join auth.users u on u.id = m.user_id
  left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  left join departments d on d.id = e.department_id
  left join user_types t on t.id = m.user_type_id
  left join prd_people pp on pp.employee_id = e.id and pp.is_active
  where m.company_id = my_company()
    and (module_level('users') >= 1 or exists (select 1 from memberships x where x.user_id = auth.uid() and x.role::text in ('owner', 'hr')))
  order by m.created_at;
$$;
revoke execute on function users_overview() from public, anon;
grant execute on function users_overview() to authenticated;

-- Hesabı olmayan aktif personel (hesap açma ekranı)
create or replace function users_without_account() returns table (employee_id uuid, name text, card_no text, department text, email text, open_invite text)
language sql stable security definer set search_path = public as $$
  select e.id, e.first_name || ' ' || e.last_name, e.card_no, d.name, p.email,
         (select i.code from invites i where i.employee_id = e.id and i.used_at is null and i.expires_at > now() order by i.created_at desc limit 1)
  from employees e
  left join departments d on d.id = e.department_id
  left join employee_private p on p.employee_id = e.id
  where e.company_id = my_company() and e.status = 'active' and e.user_id is null and module_level('users') >= 2
  order by e.first_name, e.last_name;
$$;
grant execute on function users_without_account() to authenticated;

-- Türlü davet kodu: rol türden çıkar
create or replace function user_invite_create(p_type uuid, p_employee uuid, p_name text, p_login text, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); t user_types; v_err text;
begin
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(t.levels), null);
  if v_err is not null then raise exception '%', v_err; end if;
  if p_employee is not null and not exists (select 1 from employees where id = p_employee and company_id = v_company) then raise exception 'not_found'; end if;
  insert into invites (company_id, code, role, employee_id, display_name, login_email, all_branches, user_type_id)
  values (v_company, p_code, user_type_role(t.levels, t.scoped), p_employee, p_name, lower(p_login), not t.scoped, t.id);
end $$;
grant execute on function user_invite_create(uuid, uuid, text, text, text) to authenticated;

-- Sunucunun doğrudan hesap açması (service_role): yetki, işlemi yapan kullanıcı adına kontrol edilir
create or replace function admin_attach_account(p_actor uuid, p_user uuid, p_employee uuid, p_type uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid; t user_types; v_err text; v_role app_role;
begin
  select company_id into v_company from memberships where user_id = p_actor order by created_at limit 1;
  if v_company is null then raise exception 'not_allowed'; end if;
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  v_err := user_type_can_assign(p_actor, user_type_clean(t.levels), null);
  if v_err is not null then raise exception '%', v_err; end if;
  if exists (select 1 from memberships where user_id = p_user and company_id <> v_company) then raise exception 'other_company'; end if;
  if p_employee is not null then
    if not exists (select 1 from employees where id = p_employee and company_id = v_company) then raise exception 'not_found'; end if;
    if exists (select 1 from employees where id = p_employee and user_id is not null and user_id <> p_user) then raise exception 'employee_linked'; end if;
  end if;
  v_role := user_type_role(t.levels, t.scoped);
  if not exists (select 1 from memberships where user_id = p_user and company_id = v_company) then
    insert into memberships (user_id, company_id, role, all_branches, display_name) values (p_user, v_company, v_role, not t.scoped, p_name);
  elsif exists (select 1 from memberships where user_id = p_user and company_id = v_company and role = 'owner') then
    raise exception 'owner_full';
  end if;
  if p_employee is not null then
    perform set_config('mb.allow_user_link', 'on', true);
    update employees set user_id = p_user where id = p_employee;
    perform set_config('mb.allow_user_link', 'off', true);
  end if;
  perform user_type_apply_sys(v_company, p_user, t.id);
end $$;
revoke execute on function admin_attach_account(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function admin_attach_account(uuid, uuid, uuid, uuid, text) to service_role; end if; end $$;

-- Şifre sıfırlama yetkisi (sunucu kontrolü için): hedef sahip değilse ve atayan yetkiliyse
create or replace function user_can_manage(p_target uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships t where t.user_id = p_target and t.company_id = my_company())
     and user_type_can_assign(auth.uid(), '{}'::jsonb, p_target) is null;
$$;
grant execute on function user_can_manage(uuid) to authenticated;

-- Erişimi kaldır
create or replace function user_remove(p_user uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); v_err text;
begin
  v_err := user_type_can_assign(auth.uid(), '{}'::jsonb, p_user);
  if v_err is not null then raise exception '%', v_err; end if;
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  perform set_config('mb.allow_user_link', 'on', true);
  update employees set user_id = null where user_id = p_user and company_id = v_company;
  perform set_config('mb.allow_user_link', 'off', true);
  delete from module_permissions where user_id = p_user and company_id = v_company;
  delete from memberships where user_id = p_user and company_id = v_company;
end $$;
grant execute on function user_remove(uuid) to authenticated;

-- Kapsam (şube / bölüm) ve görünen ad
create or replace function user_set_scope(p_user uuid, p_name text, p_all boolean, p_branches uuid[], p_departments uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); v_err text;
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = v_company and role = 'owner') then
    v_err := user_type_can_assign(auth.uid(), '{}'::jsonb, p_user);
    if v_err is not null then raise exception '%', v_err; end if;
  end if;
  if not coalesce(p_all, false) and coalesce(array_length(p_branches, 1), 0) = 0 then raise exception 'branch_required'; end if;
  update memberships set display_name = nullif(trim(p_name), ''), all_branches = coalesce(p_all, false) where user_id = p_user and company_id = v_company;
  delete from membership_branches where user_id = p_user and company_id = v_company;
  if not coalesce(p_all, false) then
    insert into membership_branches (user_id, company_id, branch_id) select p_user, v_company, b from unnest(p_branches) b where b in (select id from branches where company_id = v_company);
  end if;
  if to_regclass('public.membership_departments') is not null then
    delete from membership_departments where user_id = p_user and company_id = v_company;
    insert into membership_departments (user_id, company_id, department_id) select p_user, v_company, d from unnest(coalesce(p_departments, '{}')) d where d in (select id from departments where company_id = v_company);
  end if;
end $$;
grant execute on function user_set_scope(uuid, text, boolean, uuid[], uuid[]) to authenticated;

-- Davet kullanma: türlü davette tür uygulanır
create or replace function claim_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare inv invites; name text; emp employees; cur memberships;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapın'; end if;
  if not invite_rate_ok('claim:' || auth.uid()) then
    return json_build_object('error', 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
  end if;
  select * into inv from invites where code = invite_norm(p_code) for update;
  if inv.id is null or (inv.used_at is not null and inv.used_by is distinct from auth.uid()) or inv.expires_at < now() then
    return json_build_object('error', 'Davet kodu geçersiz, kullanılmış ya da süresi dolmuş.');
  end if;

  if inv.employee_id is not null then
    select * into emp from employees where id = inv.employee_id;
    if emp.id is null or emp.company_id <> inv.company_id then raise exception 'Davet geçersiz'; end if;
    if emp.user_id is not null and emp.user_id <> auth.uid() then
      raise exception 'Bu personel kaydı başka bir hesaba bağlı. Yöneticinizle görüşün.';
    end if;
  end if;

  select * into cur from memberships where user_id = auth.uid() and company_id = inv.company_id;
  if cur.user_id is not null and cur.role <> inv.role and inv.user_type_id is null then
    raise exception 'Bu hesap şirkete zaten farklı bir rolle bağlı.';
  end if;

  name := coalesce(inv.display_name, emp.first_name || ' ' || emp.last_name);
  if cur.user_id is null then
    insert into memberships (user_id, company_id, role, all_branches, display_name)
    values (auth.uid(), inv.company_id, inv.role, inv.all_branches or inv.role in ('owner', 'accountant', 'hr', 'safety'), name);
  end if;

  if inv.employee_id is not null then
    perform set_config('mb.allow_user_link', 'on', true);
    update employees set user_id = auth.uid() where id = inv.employee_id;
    perform set_config('mb.allow_user_link', 'off', true);
  end if;
  if inv.user_type_id is not null and coalesce(cur.role::text, '') <> 'owner' then
    perform user_type_apply_sys(inv.company_id, auth.uid(), inv.user_type_id);
  end if;
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return json_build_object('company_id', inv.company_id, 'role', inv.role);
end $$;

-- Denetim
do $$ begin
  if to_regclass('public.user_types') is not null then
    drop trigger if exists audit_user_types on user_types;
    create trigger audit_user_types after insert or update or delete on user_types for each row execute function audit_trigger();
  end if;
end $$;

notify pgrst, 'reload schema';
