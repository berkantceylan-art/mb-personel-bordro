-- Performans değerlendirme (dönem, öz değerlendirme, şef değerlendirmesi, zam önerisi)
-- Yetkinlik (beceri matrisi) ve hedefler

create table if not exists review_cycles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  period_start date not null,
  period_end date not null,
  due_on date,
  self_eval boolean not null default true,
  criteria jsonb not null default '[{"key":"kalite","label":"İş kalitesi (iade / yeniden yapım azlığı)"},{"key":"hiz","label":"Hız ve verim"},{"key":"beceri","label":"Mesleki beceri"},{"key":"ogrenme","label":"Öğrenme ve gelişim"},{"key":"takim","label":"Ekip çalışması"},{"key":"disiplin","label":"Kurallara uyum ve İSG"}]',
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  cycle_id uuid not null references review_cycles(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  self_scores jsonb,
  self_comment text,
  self_submitted_at timestamptz,
  mgr_scores jsonb,
  mgr_comment text,
  strengths text,
  improvements text,
  overall numeric(3,2),
  raise_pct numeric(5,2),
  reviewer uuid references auth.users(id),
  mgr_submitted_at timestamptz,
  shared_at timestamptz,
  acknowledged_at timestamptz,
  employee_note text,
  unique (cycle_id, employee_id)
);
create index if not exists reviews_emp_idx on reviews (employee_id);

alter table review_cycles enable row level security;
alter table reviews enable row level security;
drop policy if exists rc_read on review_cycles;
create policy rc_read on review_cycles for select using (is_member(company_id));
drop policy if exists rc_write on review_cycles;
create policy rc_write on review_cycles for all
  using (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]))
  with check (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]));
drop policy if exists rv_read on reviews;
create policy rv_read on reviews for select using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));
drop policy if exists rv_write on reviews;
create policy rv_write on reviews for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));

-- Personel: kendi değerlendirmeleri; şef kısmı yalnız paylaşıldıktan sonra
create or replace function my_reviews()
returns table (id uuid, cycle_name text, period_start date, period_end date, due_on date, cycle_open boolean, self_eval boolean, criteria jsonb,
               self_scores jsonb, self_comment text, self_submitted_at timestamptz,
               mgr_scores jsonb, mgr_comment text, strengths text, improvements text, overall numeric, shared_at timestamptz, acknowledged_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, c.name, c.period_start, c.period_end, c.due_on, c.status = 'open', c.self_eval, c.criteria,
         r.self_scores, r.self_comment, r.self_submitted_at,
         case when r.shared_at is not null then r.mgr_scores end, case when r.shared_at is not null then r.mgr_comment end,
         case when r.shared_at is not null then r.strengths end, case when r.shared_at is not null then r.improvements end,
         case when r.shared_at is not null then r.overall end, r.shared_at, r.acknowledged_at
  from reviews r join review_cycles c on c.id = r.cycle_id join employees e on e.id = r.employee_id
  where e.user_id = auth.uid()
  order by c.period_end desc;
$$;
grant execute on function my_reviews() to authenticated;

create or replace function submit_self_review(p_review uuid, p_scores jsonb, p_comment text) returns void
language plpgsql security definer set search_path = public as $$
declare r reviews; c review_cycles;
begin
  select * into r from reviews where id = p_review;
  if r.id is null or not is_self_employee(r.employee_id) then raise exception 'Değerlendirme bulunamadı'; end if;
  select * into c from review_cycles where id = r.cycle_id;
  if c.status <> 'open' then raise exception 'Dönem kapandı'; end if;
  if r.mgr_submitted_at is not null then raise exception 'Şef değerlendirmesi tamamlandı; öz değerlendirme değiştirilemez'; end if;
  update reviews set self_scores = p_scores, self_comment = left(p_comment, 2000), self_submitted_at = now() where id = p_review;
  perform deliver(r.company_id, managers_for_employee(r.employee_id), 'Öz değerlendirme tamamlandı',
    (select first_name || ' ' || last_name from employees where id = r.employee_id) || ' · ' || c.name, '/performans/' || c.id || '/' || r.employee_id);
end $$;
grant execute on function submit_self_review(uuid, jsonb, text) to authenticated;

create or replace function acknowledge_review(p_review uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare r reviews;
begin
  select * into r from reviews where id = p_review;
  if r.id is null or not is_self_employee(r.employee_id) or r.shared_at is null then raise exception 'Değerlendirme bulunamadı'; end if;
  update reviews set acknowledged_at = now(), employee_note = left(p_note, 2000) where id = p_review;
end $$;
grant execute on function acknowledge_review(uuid, text) to authenticated;

-- Bildirimler: yeni dönem (öz değerlendirme daveti), sonuç paylaşıldı
create or replace function trg_review_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; c review_cycles;
begin
  select * into e from employees where id = new.employee_id;
  select * into c from review_cycles where id = new.cycle_id;
  if e.user_id is null then return new; end if;
  if tg_op = 'INSERT' and c.self_eval then
    perform deliver(new.company_id, array[e.user_id], 'Performans değerlendirmesi başladı', c.name || ' · öz değerlendirmenizi doldurun' || coalesce(' (son gün ' || to_char(c.due_on, 'DD.MM.YYYY') || ')', ''), '/benim/performans');
  elsif tg_op = 'UPDATE' and old.shared_at is null and new.shared_at is not null then
    perform deliver(new.company_id, array[e.user_id], 'Değerlendirme sonucunuz', c.name || ' sonucunuz paylaşıldı', '/benim/performans');
  end if;
  return new;
end $$;
drop trigger if exists review_notify on reviews;
create trigger review_notify after insert or update on reviews for each row execute function trg_review_notify();

/* ------------------------------------------------------------ Yetkinlik ve hedefler */
create table if not exists skills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,    -- null = varsayılan
  name text not null,
  category text not null default 'Teknik',
  sort int not null default 100,
  active boolean not null default true
);
insert into skills (company_id, name, category, sort)
select null, x.n, x.c, x.s from (values
  ('Porselen tabakalama', 'Sabit protez', 10), ('Renk seçimi ve boyama', 'Sabit protez', 20), ('Zirkon tasarım (CAD)', 'Dijital', 30),
  ('Frezeleme / CAM', 'Dijital', 40), ('3D baskı', 'Dijital', 50), ('Model tarama', 'Dijital', 55), ('İskelet tesviye', 'Metal', 60),
  ('Metal döküm', 'Metal', 70), ('Alçı ve model', 'Hazırlık', 80), ('Hareketli protez (akrilik)', 'Hareketli', 90),
  ('İmplant üstü protez', 'Sabit protez', 100), ('Kalite kontrol', 'Genel', 110), ('Klinik iletişimi / teslimat', 'Genel', 120)
) as x(n, c, s)
where not exists (select 1 from skills where company_id is null);

create table if not exists employee_skills (
  employee_id uuid not null references employees(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  level int not null check (level between 0 and 4),          -- 0 yok · 1 öğreniyor · 2 gözetimle · 3 bağımsız · 4 usta (öğretebilir)
  target_level int check (target_level between 0 and 4),
  assessed_by uuid references auth.users(id) default auth.uid(),
  assessed_at timestamptz not null default now(),
  primary key (employee_id, skill_id)
);

create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid references employees(id) on delete cascade,
  department_id uuid references departments(id) on delete cascade,
  title text not null,
  description text,
  due_on date,
  progress int not null default 0 check (progress between 0 and 100),
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  last_note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (employee_id is not null or department_id is not null)
);

alter table skills enable row level security;
alter table employee_skills enable row level security;
alter table goals enable row level security;
drop policy if exists sk_read on skills;
create policy sk_read on skills for select using (company_id is null or is_member(company_id));
drop policy if exists sk_write on skills;
create policy sk_write on skills for all using (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[])) with check (company_id is not null and has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists es_read on employee_skills;
create policy es_read on employee_skills for select using (can_see_employee(employee_id) or is_self_employee(employee_id));
drop policy if exists es_write on employee_skills;
create policy es_write on employee_skills for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));
drop policy if exists gl_read on goals;
create policy gl_read on goals for select using (
  (employee_id is not null and (can_see_employee(employee_id) or is_self_employee(employee_id)))
  or (department_id is not null and (can_see_department(company_id, department_id) or exists (select 1 from employees e where e.user_id = auth.uid() and e.department_id = goals.department_id))));
drop policy if exists gl_write on goals;
create policy gl_write on goals for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and (employee_id is null or can_see_employee(employee_id)))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and (employee_id is null or can_see_employee(employee_id)));

-- Personel kendi hedefinin ilerlemesini günceller
create or replace function update_my_goal(p_goal uuid, p_progress int, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare g goals;
begin
  select * into g from goals where id = p_goal;
  if g.id is null or g.employee_id is null or not is_self_employee(g.employee_id) then raise exception 'Hedef bulunamadı'; end if;
  update goals set progress = greatest(0, least(100, p_progress)), last_note = left(p_note, 500), updated_at = now(),
    status = case when p_progress >= 100 then 'done' else status end where id = p_goal;
end $$;
grant execute on function update_my_goal(uuid, int, text) to authenticated;
