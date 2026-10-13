-- =====================================================================
-- ÖZLÜK DİJİTALLEŞTİRME SİHİRBAZI
--  employee_documents : yapay zekâ okuma sonucu, kaynak (kamera / tarayıcı), sayfa, belge tarihi, not
--  employee_dossier   : personel başına arşiv durumu (devam / tamam), "bu personelde yok" işaretli belge türleri
--  payroll_history    : arşivden okutulan eski bordrolar (kümülatif GV matrahı bordro hesabında kullanılır)
-- Tekrar çalıştırılabilir.
-- =====================================================================
alter table employee_documents add column if not exists ai_data jsonb;
alter table employee_documents add column if not exists source text check (source is null or source in ('camera', 'scan', 'upload'));
alter table employee_documents add column if not exists pages int;
alter table employee_documents add column if not exists doc_date date;
alter table employee_documents add column if not exists note text check (note is null or length(note) <= 300);

create table if not exists employee_dossier (
  employee_id uuid primary key references employees (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'done')),
  skipped uuid[] not null default '{}',
  step smallint not null default 1 check (step between 1 and 6),
  notes text check (notes is null or length(notes) <= 1000),
  done_at timestamptz,
  done_by uuid,
  updated_at timestamptz not null default now()
);
alter table employee_dossier enable row level security;
drop policy if exists employee_dossier_rw on employee_dossier;
create policy employee_dossier_rw on employee_dossier for all to authenticated using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));
grant select, insert, update, delete on employee_dossier to authenticated;

create table if not exists payroll_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  days int check (days is null or days between 0 and 31),
  gross bigint not null default 0,
  sgk_employee bigint not null default 0,
  unemployment_employee bigint not null default 0,
  income_tax bigint not null default 0,
  stamp_tax bigint not null default 0,
  net bigint not null default 0,
  bes bigint not null default 0,
  garnishment bigint not null default 0,
  net_paid bigint,
  cumulative_tax_base_after bigint,
  document_id uuid references employee_documents (id) on delete set null,
  data jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, period)
);
create index if not exists payroll_history_emp_idx on payroll_history (employee_id, period);
alter table payroll_history enable row level security;
drop policy if exists payroll_history_rw on payroll_history;
create policy payroll_history_rw on payroll_history for all to authenticated using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));
grant select, insert, update, delete on payroll_history to authenticated;

notify pgrst, 'reload schema';
