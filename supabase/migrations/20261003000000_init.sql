-- =====================================================================
-- MB Personel & Bordro — Faz 1 şeması
-- Çok şirketli / çok şubeli; tüm erişim RLS ile şirket + şube bazında.
-- Para alanları kuruş cinsinden bigint (₺1 = 100).
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Tipler
-- ---------------------------------------------------------------------
create type app_role as enum ('owner', 'accountant', 'hr', 'branch_manager', 'safety', 'employee');
create type employee_status as enum ('active', 'on_leave', 'terminated');
create type insurance_type as enum ('MIN_WAGE', 'FIXED_NET');
create type ledger_type as enum ('ACCRUAL', 'BONUS', 'OVERTIME', 'ADVANCE', 'SALARY', 'BES', 'GARNISHMENT', 'DEDUCTION', 'ADJUSTMENT');
create type ledger_channel as enum ('BANK', 'CASH', 'NONE');
create type punch_direction as enum ('IN', 'OUT');
create type punch_source as enum ('DEVICE', 'MANUAL', 'MOBILE');

-- ---------------------------------------------------------------------
-- Organizasyon
-- ---------------------------------------------------------------------
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table branches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  address text,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create table memberships (
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  role app_role not null,
  -- false ise sadece membership_branches'taki şubeleri görür
  all_branches boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

create table membership_branches (
  user_id uuid not null,
  company_id uuid not null,
  branch_id uuid not null references branches(id) on delete cascade,
  primary key (user_id, company_id, branch_id),
  foreign key (user_id, company_id) references memberships(user_id, company_id) on delete cascade
);

create table departments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  unique (company_id, name)
);

create table positions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text not null,
  unique (company_id, name)
);

-- ---------------------------------------------------------------------
-- Vardiyalar (personel tablosundan önce: varsayılan vardiya referansı)
-- ---------------------------------------------------------------------
create table shifts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid references branches(id) on delete cascade,
  name text not null,
  code text not null,
  color text not null default '#E7F1FB',
  start_time time not null,
  end_time time not null,
  crosses_midnight boolean not null default false,
  break_minutes int not null default 60,
  break_paid boolean not null default false,
  late_tolerance_min int not null default 10,
  early_leave_tolerance_min int not null default 10,
  overtime_threshold_min int not null default 30,
  -- ISO gün numaraları 1=Pzt … 7=Paz
  weekdays smallint[] not null default '{1,2,3,4,5,6}',
  -- dolu ise tek kişiye özel vardiya
  employee_id uuid,
  valid_from date,
  valid_to date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Personel
-- ---------------------------------------------------------------------
create table employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid not null references branches(id),
  department_id uuid references departments(id),
  position_id uuid references positions(id),
  default_shift_id uuid references shifts(id) on delete set null,
  -- PDKS kart / sicil no (cihaz dosyasındaki 35xxx)
  card_no text,
  first_name text not null,
  last_name text not null,
  hire_date date not null,
  termination_date date,
  status employee_status not null default 'active',
  -- personel mobil uygulamasına giriş yapan kullanıcı
  user_id uuid references auth.users(id) on delete set null,
  photo_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, card_no)
);
create index on employees (company_id, branch_id);
create index on employees (company_id, department_id);

alter table shifts
  add constraint shifts_employee_fk foreign key (employee_id) references employees(id) on delete cascade;

-- KVKK: kimlik / iletişim / banka bilgileri ayrı tabloda, daha dar yetkiyle
create table employee_private (
  employee_id uuid primary key references employees(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  national_id text,
  sgk_no text,
  birth_date date,
  gender text,
  marital_status text,
  phone text,
  email text,
  address text,
  emergency_contact_name text,
  emergency_contact_phone text,
  iban text,
  bank_name text default 'Garanti BBVA',
  education text,
  driving_license text,
  military_status text,
  updated_at timestamptz not null default now()
);

-- Ücret sözleşmesi geçmişi: toplam ücret = resmi net + elden
create table pay_contracts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  valid_from date not null,
  valid_to date,
  total_net bigint not null check (total_net >= 0),
  insurance_type insurance_type not null default 'MIN_WAGE',
  fixed_official_net bigint check (fixed_official_net is null or fixed_official_net > 0),
  bes_rate numeric(5,4) not null default 0,
  employer_discount boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  check (insurance_type = 'MIN_WAGE' or fixed_official_net is not null)
);
create index on pay_contracts (employee_id, valid_from desc);

-- ---------------------------------------------------------------------
-- Özlük belgeleri
-- ---------------------------------------------------------------------
create table document_types (
  id uuid primary key default gen_random_uuid(),
  -- null = tüm şirketlerde geçerli varsayılan tür
  company_id uuid references companies(id) on delete cascade,
  name text not null,
  category text not null default 'ozluk',
  required boolean not null default true,
  has_expiry boolean not null default false,
  sort_order int not null default 100
);

create table employee_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  document_type_id uuid not null references document_types(id),
  file_path text not null,
  file_name text,
  expires_on date,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
create index on employee_documents (employee_id);

-- ---------------------------------------------------------------------
-- Cari hesap: her kuruş tarihli hareket. Silinmez, iptal edilir.
-- ---------------------------------------------------------------------
create table ledger_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete restrict,
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  entry_date date not null,
  type ledger_type not null,
  channel ledger_channel not null default 'NONE',
  amount bigint not null,
  note text,
  receipt_path text,
  signature_path text,
  bank_reference text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid references auth.users(id),
  void_reason text,
  check (type = 'ADJUSTMENT' or amount > 0),
  check (type not in ('ADVANCE', 'SALARY') or channel <> 'NONE')
);
create index on ledger_entries (company_id, period);
create index on ledger_entries (employee_id, entry_date);

-- Hareket tutarı / türü değiştirilemez; sadece iptal alanları doldurulabilir
create or replace function ledger_entries_guard() returns trigger
language plpgsql as $$
begin
  if old.voided_at is not null then
    raise exception 'İptal edilmiş hareket değiştirilemez';
  end if;
  if (new.employee_id, new.period, new.entry_date, new.type, new.channel, new.amount)
     is distinct from (old.employee_id, old.period, old.entry_date, old.type, old.channel, old.amount) then
    raise exception 'Cari hareket değiştirilemez; iptal edip yeni hareket girin';
  end if;
  return new;
end $$;
create trigger ledger_entries_guard before update on ledger_entries
  for each row execute function ledger_entries_guard();

-- Personel + dönem bazında özet (RLS altta yatan tablodan uygulanır)
create view ledger_period_summary with (security_invoker = true) as
select
  company_id,
  employee_id,
  period,
  sum(amount) filter (where type in ('ACCRUAL', 'BONUS', 'OVERTIME')) as accrued,
  sum(amount) filter (where type in ('ADVANCE', 'SALARY') and channel = 'BANK') as paid_bank,
  sum(amount) filter (where type in ('ADVANCE', 'SALARY') and channel = 'CASH') as paid_cash,
  sum(amount) filter (where type in ('BES', 'GARNISHMENT', 'DEDUCTION')) as deductions,
  sum(case
        when type in ('ACCRUAL', 'BONUS', 'OVERTIME') then amount
        when type = 'ADJUSTMENT' then amount
        else -amount end) as balance
from ledger_entries
where voided_at is null
group by company_id, employee_id, period;

-- ---------------------------------------------------------------------
-- Vardiya atama ve puantaj
-- ---------------------------------------------------------------------
create table shift_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  shift_id uuid references shifts(id) on delete cascade,
  work_date date not null,
  -- null shift + day_type ile hafta tatili / izin işaretlenebilir
  day_type text check (day_type in ('WORK', 'WEEKLY_OFF', 'HOLIDAY')) default 'WORK',
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, work_date)
);

create table devices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid not null references branches(id) on delete cascade,
  code text not null,
  direction punch_direction not null,
  name text,
  unique (company_id, branch_id, code)
);

create table attendance_imports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid not null references branches(id),
  file_name text not null,
  punch_count int not null default 0,
  duplicate_count int not null default 0,
  error_count int not null default 0,
  imported_by uuid references auth.users(id) default auth.uid(),
  imported_at timestamptz not null default now()
);

create table attendance_punches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  branch_id uuid not null references branches(id),
  card_no text not null,
  employee_id uuid references employees(id) on delete set null,
  device_code text,
  direction punch_direction not null,
  -- yerel (İstanbul) duvar saati
  punched_at timestamp not null,
  source punch_source not null default 'DEVICE',
  import_id uuid references attendance_imports(id) on delete set null,
  reason text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  -- aynı dosya tekrar yüklenince kayıt çoğalmaz
  unique (company_id, card_no, direction, punched_at)
);
create index on attendance_punches (company_id, punched_at);
create index on attendance_punches (employee_id, punched_at);

-- Manuel kayıtlarda gerekçe zorunlu
alter table attendance_punches
  add constraint manual_reason check (source <> 'MANUAL' or coalesce(length(reason), 0) > 0);

-- ---------------------------------------------------------------------
-- Yasal parametreler (yıl bazlı)
-- ---------------------------------------------------------------------
create table legal_params (
  year int primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Denetim kaydı
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  company_id uuid,
  table_name text not null,
  row_id text,
  action text not null,
  old_data jsonb,
  new_data jsonb,
  actor uuid default auth.uid(),
  at timestamptz not null default now()
);
create index on audit_log (company_id, at desc);

create or replace function audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  rec jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (company_id, table_name, row_id, action, old_data, new_data)
  values (
    (rec->>'company_id')::uuid,
    tg_table_name,
    coalesce(rec->>'id', rec->>'employee_id'),
    tg_op,
    case when tg_op <> 'INSERT' then to_jsonb(old) end,
    case when tg_op <> 'DELETE' then to_jsonb(new) end
  );
  return coalesce(new, old);
end $$;

create trigger audit_employees after insert or update or delete on employees for each row execute function audit_trigger();
create trigger audit_employee_private after insert or update or delete on employee_private for each row execute function audit_trigger();
create trigger audit_pay_contracts after insert or update or delete on pay_contracts for each row execute function audit_trigger();
create trigger audit_ledger after insert or update on ledger_entries for each row execute function audit_trigger();
create trigger audit_punches after insert or update or delete on attendance_punches for each row execute function audit_trigger();
create trigger audit_shifts after insert or update or delete on shifts for each row execute function audit_trigger();

-- =====================================================================
-- Yetki yardımcıları
-- =====================================================================
create or replace function has_role(p_company uuid, p_roles app_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.company_id = p_company and m.role = any (p_roles)
  );
$$;

create or replace function is_member(p_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = p_company);
$$;

-- Personel (employee rolü) dışındaki üyeler için şube görünürlüğü
create or replace function can_see_branch(p_company uuid, p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and m.company_id = p_company and m.role <> 'employee'
      and (m.all_branches or exists (
        select 1 from membership_branches mb
        where mb.user_id = m.user_id and mb.company_id = m.company_id and mb.branch_id = p_branch))
  );
$$;

create or replace function can_see_employee(p_employee uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e
    where e.id = p_employee
      and (e.user_id = auth.uid() or can_see_branch(e.company_id, e.branch_id))
  );
$$;

-- Para / maaş verisini yönetebilen roller
create or replace function can_manage_pay(p_company uuid)
returns boolean language sql stable as $$
  select has_role(p_company, array['owner', 'accountant']::app_role[]);
$$;

create or replace function can_manage_hr(p_company uuid)
returns boolean language sql stable as $$
  select has_role(p_company, array['owner', 'accountant', 'hr']::app_role[]);
$$;

-- Cari hareket iptali (tek yol)
create or replace function void_ledger_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid;
begin
  select company_id into v_company from ledger_entries where id = p_id;
  if v_company is null or not can_manage_pay(v_company) then
    raise exception 'Yetki yok';
  end if;
  if coalesce(length(p_reason), 0) = 0 then
    raise exception 'İptal gerekçesi zorunlu';
  end if;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_id and voided_at is null;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table companies enable row level security;
alter table branches enable row level security;
alter table memberships enable row level security;
alter table membership_branches enable row level security;
alter table departments enable row level security;
alter table positions enable row level security;
alter table shifts enable row level security;
alter table employees enable row level security;
alter table employee_private enable row level security;
alter table pay_contracts enable row level security;
alter table document_types enable row level security;
alter table employee_documents enable row level security;
alter table ledger_entries enable row level security;
alter table shift_assignments enable row level security;
alter table devices enable row level security;
alter table attendance_imports enable row level security;
alter table attendance_punches enable row level security;
alter table legal_params enable row level security;
alter table audit_log enable row level security;

-- Organizasyon
create policy companies_read on companies for select using (is_member(id));
create policy companies_owner on companies for update using (has_role(id, array['owner']::app_role[]));

create policy branches_read on branches for select using (is_member(company_id));
create policy branches_write on branches for all
  using (has_role(company_id, array['owner']::app_role[]))
  with check (has_role(company_id, array['owner']::app_role[]));

create policy memberships_self on memberships for select
  using (user_id = auth.uid() or has_role(company_id, array['owner']::app_role[]));
create policy memberships_owner on memberships for all
  using (has_role(company_id, array['owner']::app_role[]))
  with check (has_role(company_id, array['owner']::app_role[]));

create policy mb_read on membership_branches for select
  using (user_id = auth.uid() or has_role(company_id, array['owner']::app_role[]));
create policy mb_owner on membership_branches for all
  using (has_role(company_id, array['owner']::app_role[]))
  with check (has_role(company_id, array['owner']::app_role[]));

create policy departments_read on departments for select using (is_member(company_id));
create policy departments_write on departments for all using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));
create policy positions_read on positions for select using (is_member(company_id));
create policy positions_write on positions for all using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));

-- Personel
create policy employees_read on employees for select
  using (user_id = auth.uid() or can_see_branch(company_id, branch_id));
create policy employees_write on employees for all
  using (can_manage_hr(company_id) and can_see_branch(company_id, branch_id))
  with check (can_manage_hr(company_id) and can_see_branch(company_id, branch_id));

create policy private_read on employee_private for select
  using (can_manage_hr(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy private_write on employee_private for all
  using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));

create policy contracts_read on pay_contracts for select
  using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy contracts_write on pay_contracts for all
  using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

-- Belgeler
create policy doctypes_read on document_types for select using (company_id is null or is_member(company_id));
create policy doctypes_write on document_types for all
  using (company_id is not null and can_manage_hr(company_id))
  with check (company_id is not null and can_manage_hr(company_id));

create policy docs_read on employee_documents for select using (can_see_employee(employee_id));
create policy docs_write on employee_documents for all
  using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));

-- Cari hesap: okuma yöneticiler + personelin kendisi; yazma owner/muhasebe; silme yok
create policy ledger_read on ledger_entries for select
  using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy ledger_insert on ledger_entries for insert
  with check (can_manage_pay(company_id));

-- Vardiya ve puantaj
create policy shifts_read on shifts for select using (is_member(company_id));
create policy shifts_write on shifts for all
  using (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]));

create policy assign_read on shift_assignments for select using (can_see_employee(employee_id));
create policy assign_write on shift_assignments for all
  using (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));

create policy devices_read on devices for select using (is_member(company_id));
create policy devices_write on devices for all using (has_role(company_id, array['owner']::app_role[])) with check (has_role(company_id, array['owner']::app_role[]));

create policy imports_read on attendance_imports for select using (can_see_branch(company_id, branch_id));
create policy imports_write on attendance_imports for insert
  with check (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]));

create policy punches_read on attendance_punches for select
  using (can_see_branch(company_id, branch_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy punches_write on attendance_punches for insert
  with check (can_see_branch(company_id, branch_id) and has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]));
create policy punches_update on attendance_punches for update
  using (can_see_branch(company_id, branch_id) and has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]));

create policy legal_read on legal_params for select using (auth.role() = 'authenticated');

create policy audit_read on audit_log for select using (has_role(company_id, array['owner']::app_role[]));

-- =====================================================================
-- Depolama: özlük belgeleri, makbuzlar, imzalar (yol: <company_id>/...)
-- =====================================================================
insert into storage.buckets (id, name, public) values ('documents', 'documents', false)
on conflict (id) do nothing;

create policy "documents_read" on storage.objects for select
  using (bucket_id = 'documents' and can_manage_hr(((storage.foldername(name))[1])::uuid));
create policy "documents_write" on storage.objects for insert
  with check (bucket_id = 'documents' and can_manage_hr(((storage.foldername(name))[1])::uuid));

-- =====================================================================
-- Şirket kurulumu (ilk kullanıcıyı sahip yapar)
-- =====================================================================
create or replace function create_company(p_name text, p_branch text default 'Merkez')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_branch uuid;
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  insert into companies (name) values (p_name) returning id into v_company;
  insert into branches (company_id, name) values (v_company, p_branch) returning id into v_branch;
  insert into memberships (user_id, company_id, role, all_branches) values (auth.uid(), v_company, 'owner', true);
  insert into devices (company_id, branch_id, code, direction, name) values
    (v_company, v_branch, '002', 'IN', 'Giriş cihazı'),
    (v_company, v_branch, '001', 'OUT', 'Çıkış cihazı');
  return v_company;
end $$;
