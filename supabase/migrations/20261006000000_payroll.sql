-- =====================================================================
-- Migration 4: Resmi / elden ayrımı, BES, icra-nafaka, bordro
-- =====================================================================

-- ---------------------------------------------------------------------
-- Cari hareketlerde resmi / elden tarafı
-- ---------------------------------------------------------------------
alter table ledger_entries
  add column if not exists pay_side text check (pay_side in ('OFFICIAL', 'CASH')),
  add column if not exists gross_amount bigint,
  add column if not exists days numeric(5,1);

alter table overtime_records
  add column if not exists pay_side text not null default 'BOTH' check (pay_side in ('OFFICIAL', 'CASH', 'BOTH')),
  add column if not exists official_gross bigint,
  add column if not exists official_net bigint,
  add column if not exists cash_amount bigint;

-- Birden çok kalem (resmi + elden) bağlanabilsin
create table if not exists overtime_ledger_links (
  overtime_id uuid not null references overtime_records(id) on delete cascade,
  ledger_entry_id uuid not null references ledger_entries(id),
  primary key (overtime_id, ledger_entry_id)
);
alter table overtime_ledger_links enable row level security;
create policy otl_read on overtime_ledger_links for select using (exists (select 1 from overtime_records o where o.id = overtime_id and can_see_employee(o.employee_id)));
create policy otl_write on overtime_ledger_links for all
  using (exists (select 1 from overtime_records o where o.id = overtime_id and can_manage_hr(o.company_id)))
  with check (exists (select 1 from overtime_records o where o.id = overtime_id and can_manage_hr(o.company_id)));

-- ---------------------------------------------------------------------
-- BES (otomatik katılım)
-- ---------------------------------------------------------------------
create table bes_enrollments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  enrolled_on date not null,
  rate numeric(5,4) not null default 0.03,
  status text not null default 'active' check (status in ('active', 'opted_out', 'paused', 'left')),
  status_date date,
  policy_no text,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on bes_enrollments (employee_id);
alter table bes_enrollments enable row level security;
create policy bes_read on bes_enrollments for select using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy bes_write on bes_enrollments for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

-- Var olan sözleşmelerdeki BES oranından üyelik kaydı oluştur
insert into bes_enrollments (company_id, employee_id, enrolled_on, rate, status)
select distinct on (pc.employee_id) pc.company_id, pc.employee_id, pc.valid_from, pc.bes_rate, 'active'
from pay_contracts pc
where pc.bes_rate > 0
order by pc.employee_id, pc.valid_from desc;

-- ---------------------------------------------------------------------
-- İcra ve nafaka
-- ---------------------------------------------------------------------
create table garnishment_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  kind text not null check (kind in ('ALIMONY', 'ENFORCEMENT')),
  office text not null,
  file_no text not null,
  creditor text,
  served_at date not null,
  debt_amount bigint,
  monthly_amount bigint,
  seizable_ratio numeric(4,3) not null default 0.25,
  payment_iban text,
  status text not null default 'active' check (status in ('active', 'closed', 'suspended')),
  closed_at date,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (kind = 'ALIMONY' or debt_amount is not null),
  check (kind = 'ENFORCEMENT' or monthly_amount is not null)
);
create index on garnishment_files (employee_id);
alter table garnishment_files enable row level security;
create policy gf_read on garnishment_files for select using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy gf_write on garnishment_files for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

create table garnishment_deductions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  file_id uuid not null references garnishment_files(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  period char(7) not null,
  amount bigint not null check (amount > 0),
  ledger_entry_id uuid references ledger_entries(id),
  created_at timestamptz not null default now(),
  unique (file_id, period)
);
alter table garnishment_deductions enable row level security;
create policy gd_read on garnishment_deductions for select using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy gd_write on garnishment_deductions for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

create view garnishment_balances with (security_invoker = true) as
select f.*, coalesce(sum(d.amount), 0) as paid,
  case when f.kind = 'ENFORCEMENT' then greatest(f.debt_amount - coalesce(sum(d.amount), 0), 0) end as remaining
from garnishment_files f
left join garnishment_deductions d on d.file_id = f.id
group by f.id;

-- ---------------------------------------------------------------------
-- Bordro satırları (dönem × personel anlık görüntü)
-- ---------------------------------------------------------------------
create table payroll_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  period char(7) not null,
  days int not null,
  official_gross bigint not null,
  sgk_employee bigint not null,
  unemployment_employee bigint not null,
  income_tax bigint not null,
  stamp_tax bigint not null,
  official_net bigint not null,
  bes bigint not null default 0,
  garnishment bigint not null default 0,
  net_to_bank bigint not null,
  employer_cost bigint not null,
  cumulative_tax_base_after bigint not null,
  data jsonb not null,
  posted boolean not null default false,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  unique (employee_id, period)
);
create index on payroll_lines (company_id, period);
alter table payroll_lines enable row level security;
create policy pl_read on payroll_lines for select using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy pl_write on payroll_lines for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

create trigger audit_payroll after insert or update or delete on payroll_lines for each row execute function audit_trigger();
create trigger audit_garnishment after insert or update or delete on garnishment_files for each row execute function audit_trigger();
create trigger audit_bes after insert or update or delete on bes_enrollments for each row execute function audit_trigger();
