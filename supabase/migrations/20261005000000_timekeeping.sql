-- =====================================================================
-- Migration 3: Puantaj, vardiya, izin, fazla mesai
-- =====================================================================

-- ---------------------------------------------------------------------
-- Resmi tatiller
-- ---------------------------------------------------------------------
create table public_holidays (
  date date primary key,
  name text not null,
  half_day boolean not null default false
);
alter table public_holidays enable row level security;
create policy holidays_read on public_holidays for select using (auth.role() = 'authenticated');

insert into public_holidays (date, name, half_day) values
  ('2026-01-01', 'Yılbaşı', false),
  ('2026-03-19', 'Ramazan Bayramı arifesi', true),
  ('2026-03-20', 'Ramazan Bayramı 1. gün', false),
  ('2026-03-21', 'Ramazan Bayramı 2. gün', false),
  ('2026-03-22', 'Ramazan Bayramı 3. gün', false),
  ('2026-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', false),
  ('2026-05-01', 'Emek ve Dayanışma Günü', false),
  ('2026-05-19', 'Atatürk''ü Anma, Gençlik ve Spor Bayramı', false),
  ('2026-05-26', 'Kurban Bayramı arifesi', true),
  ('2026-05-27', 'Kurban Bayramı 1. gün', false),
  ('2026-05-28', 'Kurban Bayramı 2. gün', false),
  ('2026-05-29', 'Kurban Bayramı 3. gün', false),
  ('2026-05-30', 'Kurban Bayramı 4. gün', false),
  ('2026-07-15', 'Demokrasi ve Milli Birlik Günü', false),
  ('2026-08-30', 'Zafer Bayramı', false),
  ('2026-10-28', 'Cumhuriyet Bayramı arifesi', true),
  ('2026-10-29', 'Cumhuriyet Bayramı', false),
  ('2027-01-01', 'Yılbaşı', false),
  ('2027-04-23', 'Ulusal Egemenlik ve Çocuk Bayramı', false),
  ('2027-05-01', 'Emek ve Dayanışma Günü', false),
  ('2027-05-19', 'Atatürk''ü Anma, Gençlik ve Spor Bayramı', false),
  ('2027-07-15', 'Demokrasi ve Milli Birlik Günü', false),
  ('2027-08-30', 'Zafer Bayramı', false),
  ('2027-10-28', 'Cumhuriyet Bayramı arifesi', true),
  ('2027-10-29', 'Cumhuriyet Bayramı', false)
on conflict (date) do nothing;
-- Not: 2027 dini bayram tarihleri resmi takvim açıklanınca eklenmelidir.

-- ---------------------------------------------------------------------
-- İzin
-- ---------------------------------------------------------------------
create table leave_types (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  code text not null,
  name text not null,
  paid boolean not null default true,
  deducts_annual boolean not null default false,
  is_sick_leave boolean not null default false,
  color text not null default '#E6F4EC',
  sort_order int not null default 100
);
alter table leave_types enable row level security;
create policy leave_types_read on leave_types for select using (company_id is null or is_member(company_id));
create policy leave_types_write on leave_types for all
  using (company_id is not null and can_manage_hr(company_id)) with check (company_id is not null and can_manage_hr(company_id));

insert into leave_types (company_id, code, name, paid, deducts_annual, is_sick_leave, color, sort_order) values
  (null, 'YILLIK', 'Yıllık izin', true, true, false, '#E6F4EC', 10),
  (null, 'MAZERET', 'Mazeret izni (ücretli)', true, false, false, '#E7F1FB', 20),
  (null, 'UCRETSIZ', 'Ücretsiz izin', false, false, false, '#FFF4E0', 30),
  (null, 'RAPOR', 'Sağlık raporu (istirahat)', false, false, true, '#FDECEA', 40),
  (null, 'EVLILIK', 'Evlilik izni (3 gün)', true, false, false, '#F1ECFA', 50),
  (null, 'OLUM', 'Ölüm izni (3 gün)', true, false, false, '#EEF2F6', 60),
  (null, 'BABALIK', 'Babalık izni (5 gün)', true, false, false, '#E0F5FB', 70),
  (null, 'DOGUM', 'Doğum izni', false, false, false, '#FCE7F3', 80),
  (null, 'IDARI', 'İdari izin', true, false, false, '#EEF2F6', 90);

create type leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  leave_type_id uuid not null references leave_types(id),
  start_date date not null,
  end_date date not null,
  days numeric(5,1) not null,
  half_day boolean not null default false,
  status leave_status not null default 'pending',
  note text,
  document_path text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on leave_requests (employee_id, start_date);
create index on leave_requests (company_id, status);
alter table leave_requests enable row level security;
create policy leave_read on leave_requests for select using (can_see_employee(employee_id));
create policy leave_write on leave_requests for all
  using (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]))
  with check (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]));
-- Personel kendi talebini oluşturabilir (mobil uygulama için)
create policy leave_self_insert on leave_requests for insert
  with check (status = 'pending' and exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));

-- Devreden / düzeltme izin günleri (açılış bakiyesi)
create table leave_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  days numeric(5,1) not null,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table leave_adjustments enable row level security;
create policy leave_adj_read on leave_adjustments for select using (can_see_employee(employee_id));
create policy leave_adj_write on leave_adjustments for all using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));

-- ---------------------------------------------------------------------
-- Fazla mesai
-- ---------------------------------------------------------------------
create type overtime_status as enum ('pending', 'approved', 'rejected');

create table overtime_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  work_date date not null,
  period char(7) not null,
  minutes int not null check (minutes > 0),
  rate numeric(3,2) not null default 1.5,
  amount bigint,
  source text not null default 'AUTO' check (source in ('AUTO', 'MANUAL')),
  status overtime_status not null default 'pending',
  note text,
  ledger_entry_id uuid references ledger_entries(id),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);
create index on overtime_records (company_id, period);
alter table overtime_records enable row level security;
create policy ot_read on overtime_records for select using (can_see_employee(employee_id));
create policy ot_write on overtime_records for all
  using (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]))
  with check (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]));

create trigger audit_leave after insert or update or delete on leave_requests for each row execute function audit_trigger();
create trigger audit_overtime after insert or update or delete on overtime_records for each row execute function audit_trigger();

-- ---------------------------------------------------------------------
-- Puantaj: eksik gün kesintisi işareti, manuel kayıt silme
-- ---------------------------------------------------------------------
create policy punches_delete on attendance_punches for delete
  using (can_see_branch(company_id, branch_id) and has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]));

-- Varsayılan vardiyalar (yoksa)
insert into shifts (company_id, name, code, color, start_time, end_time, crosses_midnight, break_minutes, weekdays)
select c.id, 'Gündüz', 'G', '#E7F1FB', '08:30', '18:00', false, 60, '{1,2,3,4,5,6}' from companies c
where not exists (select 1 from shifts s where s.company_id = c.id);
insert into shifts (company_id, name, code, color, start_time, end_time, crosses_midnight, break_minutes, weekdays)
select c.id, 'Gece', 'N', '#1E3550', '19:00', '07:30', true, 60, '{1,2,3,4,5}' from companies c
where not exists (select 1 from shifts s where s.company_id = c.id and s.code = 'N');

-- Personele sonradan PDKS numarası verilince eski okutmaları bağla
create or replace function link_punches_to_employees(p_company uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not has_role(p_company, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) then
    raise exception 'Yetki yok';
  end if;
  update attendance_punches p set employee_id = e.id
  from employees e
  where p.company_id = p_company and e.company_id = p_company
    and p.employee_id is null and e.card_no is not null
    and ltrim(p.card_no, '0') = ltrim(e.card_no, '0');
  get diagnostics n = row_count;
  return n;
end $$;
