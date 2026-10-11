-- =====================================================================
-- Gelişmiş kullanıcı yönetimi: modül yetki matrisi, son giriş, denetim kaydı (ERP modülleri)
-- Tekrar çalıştırılabilir. Önce 20261202000000_finance_core.sql.
-- =====================================================================

drop function if exists users_overview();
-- Kullanıcılar + modül seviyeleri (açık atanmış mı, rol varsayılanı mı) + son giriş
create or replace function users_overview() returns table (
  user_id uuid, display_name text, role text, email text, last_sign_in_at timestamptz, created_at timestamptz,
  logistics boolean, site_access boolean, employee_id uuid, levels jsonb, explicit jsonb
) language sql stable security definer set search_path = public, auth as $$
  select m.user_id,
         coalesce(m.display_name, e.first_name || ' ' || e.last_name, u.email, 'Kullanıcı'),
         m.role::text, u.email, u.last_sign_in_at, m.created_at,
         coalesce(m.logistics_access, false), coalesce(m.site_access, false), e.id,
         (select jsonb_object_agg(md, coalesce((select p.level from module_permissions p where p.company_id = m.company_id and p.user_id = m.user_id and p.module = md),
                                               module_default_level(m.role::text, m.logistics_access, md)))
          from unnest(array['finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users']) md),
         coalesce((select jsonb_object_agg(p.module, p.level) from module_permissions p where p.company_id = m.company_id and p.user_id = m.user_id), '{}'::jsonb)
  from memberships m
  left join auth.users u on u.id = m.user_id
  left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  where m.company_id in (select company_id from memberships where user_id = auth.uid())
    and (module_level('users') >= 1 or exists (select 1 from memberships x where x.user_id = auth.uid() and x.role::text in ('owner', 'hr')))
  order by m.created_at;
$$;
revoke execute on function users_overview() from public, anon;
grant execute on function users_overview() to authenticated;

-- Seviye ata: {"finance": 2, "stock": null}  (null = rol varsayılanına dön)
create or replace function set_module_levels(p_user uuid, p_levels jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role text; k text; v jsonb;
begin
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  select m.company_id, m.role::text into v_company, v_role from memberships m
  where m.user_id = p_user and m.company_id in (select company_id from memberships where user_id = auth.uid()) limit 1;
  if v_company is null then raise exception 'not_found'; end if;
  if v_role = 'owner' then raise exception 'owner_full'; end if;
  if p_user = auth.uid() and p_levels ? 'users' and (jsonb_typeof(p_levels->'users') = 'null' or (p_levels->>'users')::int < 3) then raise exception 'self_lockout'; end if;
  for k, v in select * from jsonb_each(p_levels) loop
    if k not in ('finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users') then continue; end if;
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

-- Tabloya doğrudan yazma kapalı (fonksiyon üzerinden)
drop policy if exists module_permissions_write on module_permissions;
revoke insert, update, delete on module_permissions from authenticated;

-- Denetim kaydı: kullanıcı yönetimi yetkisi (2+) olanlar da okuyabilir
drop policy if exists audit_read_users on audit_log;
create policy audit_read_users on audit_log for select to authenticated
  using (module_level('users') >= 2 and company_id in (select company_id from memberships where user_id = auth.uid()));

-- ERP modüllerinde eksik denetim tetikleyicileri
do $$ declare t text; begin
  foreach t in array array['fin_txns', 'module_permissions', 'prd_remakes', 'stk_counts', 'stk_transfers', 'fin_loans', 'exp_recurring'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists audit_%1$s on %1$s', t);
      execute format('create trigger audit_%1$s after insert or update or delete on %1$s for each row execute function audit_trigger()', t);
    end if;
  end loop;
end $$;

-- Denetim akışı için kullanıcı adları
create or replace function audit_actor_names() returns table (user_id uuid, name text)
language sql stable security definer set search_path = public as $$
  select m.user_id, coalesce(m.display_name, e.first_name || ' ' || e.last_name, 'Kullanıcı')
  from memberships m left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  where m.company_id in (select company_id from memberships where user_id = auth.uid());
$$;
revoke execute on function audit_actor_names() from public, anon;
grant execute on function audit_actor_names() to authenticated;

notify pgrst, 'reload schema';
