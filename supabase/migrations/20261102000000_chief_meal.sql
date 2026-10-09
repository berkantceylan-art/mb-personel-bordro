-- 1) Bölüm şefi: "Şube / bölüm şefi" (branch_manager) rolü bölümle sınırlanabilir;
--    bölüm atanmışsa yalnız o bölümlerin personelini görür ve yönetir.
-- 2) Mesai yemeği listesi: şef girer, yönetim onaylar.

-- ---------------------------------------------------------------------
-- 1) Şefin sorumlu olduğu bölümler
-- ---------------------------------------------------------------------
create table if not exists membership_departments (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  department_id uuid not null references departments(id) on delete cascade,
  primary key (user_id, company_id, department_id)
);
-- (memberships'e bileşik FK konmaz: PostgREST'te memberships→companies gömmesini belirsizleştirir)
alter table membership_departments drop constraint if exists membership_departments_user_id_company_id_fkey;
alter table membership_departments enable row level security;
drop policy if exists md_self on membership_departments;
create policy md_self on membership_departments for select using (user_id = auth.uid() or has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists md_owner on membership_departments;
create policy md_owner on membership_departments for all
  using (has_role(company_id, array['owner']::app_role[])) with check (has_role(company_id, array['owner']::app_role[]));

-- Bölüm görünürlüğü: bölüm atanmamışsa tüm bölümler; atanmışsa yalnız onlar (personel rolü hariç)
create or replace function can_see_department(p_company uuid, p_department uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.company_id = p_company and m.role <> 'employee'
      and (not exists (select 1 from membership_departments d where d.user_id = m.user_id and d.company_id = m.company_id)
           or (p_department is not null and exists (select 1 from membership_departments d where d.user_id = m.user_id and d.company_id = m.company_id and d.department_id = p_department)))
  );
$$;

create or replace function can_see_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee
      and (e.user_id = auth.uid() or (can_see_branch(e.company_id, e.branch_id) and can_see_department(e.company_id, e.department_id)))
  );
$$;

drop policy if exists employees_read on employees;
create policy employees_read on employees for select
  using (user_id = auth.uid() or (can_see_branch(company_id, branch_id) and can_see_department(company_id, department_id)));

drop policy if exists punches_read on attendance_punches;
create policy punches_read on attendance_punches for select
  using ((employee_id is null and can_see_branch(company_id, branch_id)) or can_see_employee(employee_id));

-- Bir personelden sorumlu yöneticiler (bildirimler için): sahip, İK ve kapsamındaki şefler
create or replace function managers_for_employee(p_employee uuid, p_roles app_role[] default array['owner', 'hr']::app_role[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from employees e
  join memberships m on m.company_id = e.company_id
  where e.id = p_employee
    and (m.role = any (p_roles)
         or (m.role = 'branch_manager'
             and (m.all_branches or exists (select 1 from membership_branches mb where mb.user_id = m.user_id and mb.company_id = m.company_id and mb.branch_id = e.branch_id))
             and (not exists (select 1 from membership_departments d where d.user_id = m.user_id and d.company_id = m.company_id)
                  or exists (select 1 from membership_departments d where d.user_id = m.user_id and d.company_id = m.company_id and d.department_id = e.department_id))));
$$;

-- İzin talebi bildirimi: şef kapsamına göre
create or replace function trg_leave_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; t text;
begin
  select * into e from employees where id = new.employee_id;
  select name into t from leave_types where id = new.leave_type_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform deliver(new.company_id, managers_for_employee(new.employee_id), 'Yeni izin talebi',
      e.first_name || ' ' || e.last_name || ' · ' || coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün', '/talepler');
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('approved', 'rejected', 'cancelled') and old.status in ('pending', 'approved') then
    perform deliver(new.company_id, array[e.user_id],
      'İzin talebiniz ' || case new.status when 'approved' then 'onaylandı' when 'rejected' then 'reddedildi' else 'iptal edildi' end,
      coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün', '/benim');
  end if;
  return new;
end $$;

-- Ofis çağrısı onayı ve belge bildirimi de şefe gitsin
create or replace function trg_office_call_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; users uuid[];
begin
  select * into e from employees where id = new.employee_id;
  if tg_op = 'INSERT' and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id], 'Ofise çağrıldınız',
      to_char(new.on_date, 'DD.MM.YYYY') || coalesce(' ' || to_char(new.at_time, 'HH24:MI'), '') || coalesce(' · ' || new.reason, ''), '/benim');
  elsif tg_op = 'UPDATE' and old.acknowledged_at is null and new.acknowledged_at is not null then
    users := managers_for_employee(new.employee_id);
    if new.created_by is not null then users := array_append(users, new.created_by); end if;
    perform deliver(new.company_id, users, 'Ofis çağrısı onaylandı',
      e.first_name || ' ' || e.last_name || ' · ' || to_char(new.on_date, 'DD.MM.YYYY') || ' geleceğini bildirdi', '/personel/' || e.id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2) Mesai yemeği listesi
-- ---------------------------------------------------------------------
create table if not exists meal_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  on_date date not null,
  head_count int not null check (head_count > 0),
  employee_ids uuid[] not null default '{}',
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by uuid references auth.users(id) default auth.uid(),
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists meal_requests_date_idx on meal_requests (company_id, on_date desc);
alter table meal_requests enable row level security;
drop policy if exists meal_read on meal_requests;
create policy meal_read on meal_requests for select
  using (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[])
         or (has_role(company_id, array['branch_manager']::app_role[]) and can_see_department(company_id, department_id)));
drop policy if exists meal_chief_insert on meal_requests;
create policy meal_chief_insert on meal_requests for insert
  with check (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]) and can_see_department(company_id, department_id) and status = 'pending');
drop policy if exists meal_chief_update on meal_requests;
create policy meal_chief_update on meal_requests for update
  using (status = 'pending' and requested_by = auth.uid()) with check (status = 'pending' and requested_by = auth.uid());
drop policy if exists meal_chief_delete on meal_requests;
create policy meal_chief_delete on meal_requests for delete using (status = 'pending' and requested_by = auth.uid());
drop policy if exists meal_admin on meal_requests;
create policy meal_admin on meal_requests for all
  using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));

create or replace function trg_meal_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare dname text;
begin
  select name into dname from departments where id = new.department_id;
  if tg_op = 'INSERT' then
    perform deliver(new.company_id, role_users(new.company_id, array['owner', 'hr']::app_role[]), 'Mesai yemeği talebi',
      coalesce(dname, 'Bölüm') || ' · ' || to_char(new.on_date, 'DD.MM.YYYY') || ' · ' || new.head_count || ' kişi', '/yemek');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' and new.requested_by is not null then
    perform deliver(new.company_id, array[new.requested_by],
      'Mesai yemeği ' || case new.status when 'approved' then 'onaylandı' else 'reddedildi' end,
      coalesce(dname, 'Bölüm') || ' · ' || to_char(new.on_date, 'DD.MM.YYYY') || ' · ' || new.head_count || ' kişi' || coalesce(' · ' || new.decision_note, ''), '/yemek');
  end if;
  return new;
end $$;
drop trigger if exists meal_notify on meal_requests;
create trigger meal_notify after insert or update on meal_requests for each row execute function trg_meal_notify();

-- ---------------------------------------------------------------------
-- 3) Personel adları "Berkant Ceylan" biçiminde (Türkçe büyük/küçük harf kuralıyla)
-- ---------------------------------------------------------------------
create or replace function tr_title(t text) returns text language sql immutable as $$
  select string_agg(
    case when w = '' then '' else
      upper(translate(left(w, 1), 'iı', 'İI')) || lower(translate(substr(w, 2), 'İI', 'iı'))
    end, ' ')
  from unnest(string_to_array(regexp_replace(coalesce(t, ''), '\s+', ' ', 'g'), ' ')) with ordinality as u(w, ord)
  group by ()
$$;
update employees set first_name = tr_title(first_name), last_name = case when last_name = '-' then '-' else tr_title(last_name) end
where first_name <> tr_title(first_name) or (last_name <> '-' and last_name <> tr_title(last_name));
