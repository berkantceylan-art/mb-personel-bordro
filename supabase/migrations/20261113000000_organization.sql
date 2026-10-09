-- Organizasyon yapısı: birim tipleri (grup, şirket, şube, bölüm…), hiyerarşik birimler, unvanlar,
-- personelin birimi / unvanı / bağlı olduğu yönetici, norm kadro

create table if not exists org_unit_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,   -- null = varsayılan
  name text not null,
  level int not null default 50,          -- şemada sıralama (küçük = üst)
  color text not null default '#0A3D73',
  sort int not null default 100
);
insert into org_unit_types (company_id, name, level, color, sort)
select null, x.n, x.l, x.c, x.s from (values
  ('Grup', 10, '#072A50', 10), ('Şirket', 20, '#0A3D73', 20), ('Şube', 30, '#0F4C8A', 30), ('Direktörlük', 35, '#2F6FB3', 35),
  ('Bölüm', 40, '#1A7F52', 40), ('Birim', 50, '#7A4F00', 50), ('Ekip', 60, '#6B7785', 60)
) as x(n, l, c, s)
where not exists (select 1 from org_unit_types where company_id is null);

create table if not exists org_units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  parent_id uuid references org_units(id) on delete set null,
  type_id uuid references org_unit_types(id) on delete set null,
  name text not null,
  code text,
  manager_employee_id uuid references employees(id) on delete set null,
  department_id uuid references departments(id) on delete set null,   -- puantaj / bordrodaki bölüm ile eşleşme
  branch_id uuid references branches(id) on delete set null,
  headcount_target int check (headcount_target is null or headcount_target >= 0),   -- norm kadro
  description text,
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (parent_id is distinct from id)
);
create index if not exists org_units_parent_idx on org_units (company_id, parent_id);

create table if not exists job_titles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  grade int,                               -- kademe (1 = en üst)
  is_manager boolean not null default false,
  description text,
  sort int not null default 100,
  unique (company_id, name)
);

alter table employees
  add column if not exists org_unit_id uuid references org_units(id) on delete set null,
  add column if not exists title_id uuid references job_titles(id) on delete set null,
  add column if not exists manager_employee_id uuid references employees(id) on delete set null;

alter table org_unit_types enable row level security;
alter table org_units enable row level security;
alter table job_titles enable row level security;
drop policy if exists out_read on org_unit_types;
create policy out_read on org_unit_types for select using (company_id is null or is_member(company_id));
drop policy if exists out_write on org_unit_types;
create policy out_write on org_unit_types for all using (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[])) with check (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists ou_read on org_units;
create policy ou_read on org_units for select using (is_member(company_id));
drop policy if exists ou_write on org_units;
create policy ou_write on org_units for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists jt_read on job_titles;
create policy jt_read on job_titles for select using (is_member(company_id));
drop policy if exists jt_write on job_titles;
create policy jt_write on job_titles for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));

-- Döngü engeli: bir birim kendi alt birimine bağlanamaz; personel kendi astına bağlanamaz
create or replace function trg_org_cycle() returns trigger
language plpgsql as $$
declare cur uuid; n int := 0;
begin
  if tg_table_name = 'org_units' then
    cur := new.parent_id;
    while cur is not null and n < 100 loop
      if cur = new.id then raise exception 'Bir birim kendi alt birimine bağlanamaz'; end if;
      select parent_id into cur from org_units where id = cur; n := n + 1;
    end loop;
  else
    cur := new.manager_employee_id;
    while cur is not null and n < 100 loop
      if cur = new.id then raise exception 'Personel kendi astına bağlanamaz'; end if;
      select manager_employee_id into cur from employees where id = cur; n := n + 1;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists org_units_cycle on org_units;
create trigger org_units_cycle before insert or update of parent_id on org_units for each row execute function trg_org_cycle();
drop trigger if exists employees_manager_cycle on employees;
create trigger employees_manager_cycle before update of manager_employee_id on employees for each row execute function trg_org_cycle();

-- Personelin kendi bağlı olduğu yöneticisi ve birimi (mobil)
create or replace function my_org()
returns table (unit_name text, unit_path text, title text, manager_name text, manager_phone text)
language sql stable security definer set search_path = public as $$
  with recursive me as (select * from employees where user_id = auth.uid() limit 1),
  path as (
    select u.id, u.parent_id, u.name::text as p, 0 as d from org_units u join me on u.id = me.org_unit_id
    union all
    select u.id, u.parent_id, (u.name || ' › ' || path.p)::text, path.d + 1 from org_units u join path on u.id = path.parent_id where path.d < 20
  )
  select (select name from org_units where id = me.org_unit_id),
         (select p from path order by d desc limit 1),
         coalesce((select name from job_titles where id = me.title_id), me.position_title),
         coalesce(mg.first_name || ' ' || mg.last_name, um.first_name || ' ' || um.last_name),
         coalesce(mp.phone, ump.phone)
  from me
  left join employees mg on mg.id = me.manager_employee_id
  left join employee_private mp on mp.employee_id = mg.id
  left join org_units u on u.id = me.org_unit_id
  left join employees um on um.id = u.manager_employee_id and um.id <> me.id
  left join employee_private ump on ump.employee_id = um.id;
$$;
grant execute on function my_org() to authenticated;
