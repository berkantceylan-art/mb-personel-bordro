-- =====================================================================
-- Web sitesi "Ekibimiz" ← bordro/İK personel kaydı
--
-- cms_team.employee_id: site kaydının bağlı olduğu personel.
-- site_hr_employees(): site editörüne aktarım listesi (yalnız ad, soyad,
--   departman, görev, işe giriş; kimlik/iletişim/ücret bilgisi YOK).
-- Personel kartında ad/görev değişirse sitedeki kayıt güncellenir;
-- personel ayrılırsa (işten çıkış / pasif) sitede otomatik gizlenir.
-- Siteye kimin çıkacağına admin karar verir (KVKK: açık rıza gerekir).
-- =====================================================================

alter table cms_team add column if not exists employee_id uuid unique references employees (id) on delete set null;

create or replace function site_hr_employees()
returns table (
  id uuid, first_name text, last_name text, department_name text, position_name text,
  hire_date date, team_id uuid, team_active boolean
)
language sql stable security definer set search_path = public as $$
  select e.id, e.first_name, e.last_name, d.name, p.name, e.hire_date, t.id, t.is_active
  from employees e
  left join departments d on d.id = e.department_id
  left join positions p on p.id = e.position_id
  left join cms_team t on t.employee_id = e.id and t.deleted_at is null
  where can_manage_site()
    and e.status <> 'terminated' and e.termination_date is null
  order by d.name nulls last, e.first_name, e.last_name;
$$;
revoke execute on function site_hr_employees() from public, anon;
grant execute on function site_hr_employees() to authenticated;

-- Personel kartı değişince sitedeki bağlı kaydı güncelle / gizle
create or replace function site_team_sync_employee() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_pos text;
begin
  if not exists (select 1 from cms_team where employee_id = new.id) then return null; end if;
  if new.status = 'terminated' or new.termination_date is not null then
    update cms_team set is_active = false where employee_id = new.id and is_active;
  end if;
  if new.first_name is distinct from old.first_name or new.last_name is distinct from old.last_name then
    update cms_team set name = left(trim(new.first_name || ' ' || new.last_name), 120) where employee_id = new.id;
  end if;
  if new.position_id is distinct from old.position_id then
    select name into v_pos from positions where id = new.position_id;
    update cms_team set role = jsonb_set(role, '{tr}', to_jsonb(coalesce(v_pos, ''))) where employee_id = new.id and v_pos is not null;
  end if;
  return null;
end $$;

drop trigger if exists site_team_sync on employees;
create trigger site_team_sync after update on employees for each row execute function site_team_sync_employee();
