-- Uyum (onboarding): ilk gün / ilk hafta / 30-60-90 gün kontrol listesi, mentor (usta), deneme süresi değerlendirmesi

create table if not exists onboarding_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,      -- null = varsayılan liste
  phase text not null check (phase in ('day1', 'week1', 'day30', 'day60', 'day90')),
  title text not null,
  description text,
  owner text not null default 'hr' check (owner in ('hr', 'chief', 'mentor', 'employee')),
  sort int not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists employee_onboarding (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  mentor_employee_id uuid references employees(id) on delete set null,
  started_on date not null default current_date,
  probation_end date,
  welcome_note text,
  eval_scores jsonb,                     -- {"kalite":4,"hiz":3,...}
  probation_decision text check (probation_decision in ('continue', 'terminate')),
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists onboarding_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  item_id uuid references onboarding_items(id) on delete set null,
  phase text not null,
  title text not null,
  description text,
  owner text not null,
  sort int not null default 100,
  due_on date not null,
  done_at timestamptz,
  done_by uuid references auth.users(id),
  note text
);
create index if not exists onboarding_tasks_emp_idx on onboarding_tasks (employee_id, due_on);

-- Varsayılan kontrol listesi (diş laboratuvarı)
insert into onboarding_items (company_id, phase, title, description, owner, sort)
select null, x.phase, x.title, x.description, x.owner, x.sort from (values
  ('day1', 'SGK işe giriş bildirgesi verildi', 'İşe başlamadan önce (en geç başladığı gün) e-Bildirge''den', 'hr', 10),
  ('day1', 'Kayıt sihirbazı evrakları imzalandı', 'Sözleşme, KVKK, İSG ve işe giriş formları', 'hr', 20),
  ('day1', 'PDKS kartı tanımlandı, mobil uygulama daveti gönderildi', null, 'hr', 30),
  ('day1', 'Zimmet (önlük, gözlük, maske, el aletleri) teslim edildi', null, 'chief', 40),
  ('day1', 'Temel İSG bilgilendirmesi ve acil çıkışlar gösterildi', null, 'chief', 50),
  ('day1', 'Ekiple tanışma ve laboratuvar turu', null, 'mentor', 60),
  ('day1', 'Uygulamaya giriş yaptım, bilgilerimi kontrol ettim', null, 'employee', 70),
  ('week1', 'İş akışı, kalite kuralları ve iş emri takibi anlatıldı', null, 'mentor', 10),
  ('week1', 'İlk işlerini usta gözetiminde tamamladı', null, 'mentor', 20),
  ('week1', 'e-Devlet belgelerimi yükledim', 'İkametgâh, adli sicil, nüfus kayıt örneği, diploma', 'employee', 30),
  ('week1', 'İşe giriş sağlık muayenesi yapıldı', null, 'hr', 40),
  ('day30', '30. gün görüşmesi (şef + personel)', 'Uyum, eksikler, eğitim ihtiyacı', 'chief', 10),
  ('day30', 'Beceri seviyesi (yetkinlik matrisi) ilk kez girildi', null, 'chief', 20),
  ('day60', 'Deneme süresi değerlendirmesi yapıldı ve karar verildi', 'Deneme süresi bitmeden: devam / sonlandır', 'chief', 10),
  ('day90', '90. gün görüşmesi ve ilk hedefler belirlendi', null, 'chief', 10),
  ('day90', 'Uyum sürecini değerlendirdim (geri bildirim)', null, 'employee', 20)
) as x(phase, title, description, owner, sort)
where not exists (select 1 from onboarding_items where company_id is null);

alter table onboarding_items enable row level security;
alter table employee_onboarding enable row level security;
alter table onboarding_tasks enable row level security;

drop policy if exists oi_read on onboarding_items;
create policy oi_read on onboarding_items for select using (company_id is null or is_member(company_id));
drop policy if exists oi_write on onboarding_items;
create policy oi_write on onboarding_items for all
  using (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[]))
  with check (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[]));

drop policy if exists eo_read on employee_onboarding;
create policy eo_read on employee_onboarding for select using (can_see_employee(employee_id) or is_self_employee(employee_id));
drop policy if exists eo_write on employee_onboarding;
create policy eo_write on employee_onboarding for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));

drop policy if exists ot_read on onboarding_tasks;
create policy ot_read on onboarding_tasks for select using (
  can_see_employee(employee_id) or is_self_employee(employee_id)
  or exists (select 1 from employee_onboarding o join employees m on m.id = o.mentor_employee_id where o.employee_id = onboarding_tasks.employee_id and m.user_id = auth.uid()));
drop policy if exists ot_write on onboarding_tasks;
create policy ot_write on onboarding_tasks for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));

-- Uyum sürecini başlat: kontrol listesini işe giriş tarihine göre üretir (tekrar çağrılırsa eksikleri ekler)
create or replace function start_onboarding(p_employee uuid, p_mentor uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare e employees; has_own boolean; mentor_user uuid;
begin
  select * into e from employees where id = p_employee;
  if e.id is null then raise exception 'Personel bulunamadı'; end if;
  if not (has_role(e.company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(e.id)) then
    raise exception 'Yetkiniz yok';
  end if;
  insert into employee_onboarding (employee_id, company_id, mentor_employee_id, started_on, probation_end)
  values (e.id, e.company_id, p_mentor, coalesce(e.hire_date, current_date), (coalesce(e.hire_date, current_date) + interval '2 months')::date)
  on conflict (employee_id) do update set mentor_employee_id = coalesce(excluded.mentor_employee_id, employee_onboarding.mentor_employee_id);
  select exists (select 1 from onboarding_items where company_id = e.company_id and active) into has_own;
  insert into onboarding_tasks (company_id, employee_id, item_id, phase, title, description, owner, sort, due_on)
  select e.company_id, e.id, i.id, i.phase, i.title, i.description, i.owner, i.sort,
         coalesce(e.hire_date, current_date) + case i.phase when 'day1' then 0 when 'week1' then 6 when 'day30' then 30 when 'day60' then 55 else 90 end
  from onboarding_items i
  where i.active and (case when has_own then i.company_id = e.company_id else i.company_id is null end)
    and not exists (select 1 from onboarding_tasks t where t.employee_id = e.id and t.item_id = i.id);
  if e.user_id is not null then
    perform deliver(e.company_id, array[e.user_id], 'Aramıza hoş geldiniz!', 'İlk günleriniz için hazırladığımız listeye göz atın.', '/benim/ilk-gunlerim');
  end if;
  if p_mentor is not null then
    select user_id into mentor_user from employees where id = p_mentor;
    if mentor_user is not null then
      perform deliver(e.company_id, array[mentor_user], 'Yeni çalışana ustalık', e.first_name || ' ' || e.last_name || ' için mentor olarak atandınız.', '/benim/ilk-gunlerim');
    end if;
  end if;
end $$;
grant execute on function start_onboarding(uuid, uuid) to authenticated;

-- Görev işaretle: yönetici her görevi; personel kendi görevlerini; mentor mentor görevlerini
create or replace function toggle_onboarding_task(p_task uuid, p_done boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t onboarding_tasks; ok boolean;
begin
  select * into t from onboarding_tasks where id = p_task;
  if t.id is null then raise exception 'Görev bulunamadı'; end if;
  ok := (has_role(t.company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(t.employee_id))
     or (t.owner = 'employee' and is_self_employee(t.employee_id))
     or (t.owner = 'mentor' and exists (select 1 from employee_onboarding o join employees m on m.id = o.mentor_employee_id where o.employee_id = t.employee_id and m.user_id = auth.uid()));
  if not ok then raise exception 'Bu görevi işaretleme yetkiniz yok'; end if;
  update onboarding_tasks set done_at = case when p_done then now() end, done_by = case when p_done then auth.uid() end, note = coalesce(p_note, note) where id = p_task;
end $$;
grant execute on function toggle_onboarding_task(uuid, boolean, text) to authenticated;

-- Deneme süresi kararı bildirimi
create or replace function trg_probation_decision() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees;
begin
  if new.probation_decision is not null and old.probation_decision is distinct from new.probation_decision then
    select * into e from employees where id = new.employee_id;
    perform deliver(new.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = new.company_id and (role = 'owner' or role = 'hr' or is_boss)),
      'Deneme süresi kararı', e.first_name || ' ' || e.last_name || ': ' || case new.probation_decision when 'continue' then 'devam' else 'sonlandır' end, '/uyum/' || e.id);
  end if;
  return new;
end $$;
drop trigger if exists probation_decision_trg on employee_onboarding;
create trigger probation_decision_trg after update on employee_onboarding for each row execute function trg_probation_decision();

-- Mentorun sorumlu olduğu görevler (mentee adıyla)
create or replace function my_mentee_tasks()
returns table (id uuid, employee_name text, phase text, title text, due_on date, done_at timestamptz)
language sql stable security definer set search_path = public as $$
  select t.id, e.first_name || ' ' || e.last_name, t.phase, t.title, t.due_on, t.done_at
  from onboarding_tasks t
  join employee_onboarding o on o.employee_id = t.employee_id
  join employees m on m.id = o.mentor_employee_id
  join employees e on e.id = t.employee_id
  where m.user_id = auth.uid() and t.owner = 'mentor' and e.status <> 'terminated'
  order by t.due_on;
$$;
grant execute on function my_mentee_tasks() to authenticated;

-- Mentor adını personelin kendisi görsün
create or replace function my_onboarding()
returns table (started_on date, probation_end date, welcome_note text, mentor_name text, mentor_phone text)
language sql stable security definer set search_path = public as $$
  select o.started_on, o.probation_end, o.welcome_note, m.first_name || ' ' || m.last_name, mp.phone
  from employee_onboarding o join employees e on e.id = o.employee_id
  left join employees m on m.id = o.mentor_employee_id
  left join employee_private mp on mp.employee_id = m.id
  where e.user_id = auth.uid();
$$;
grant execute on function my_onboarding() to authenticated;
