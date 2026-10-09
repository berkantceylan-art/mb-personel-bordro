-- Patron ekranı: seçilen kullanıcılar (sahip / muhasebe rolünde) mobilde patron panelini görür.
-- SGK tahakkuk ve ödemeleri elle girilir; borç = tahakkuk − ödenen.
alter table memberships add column if not exists is_boss boolean not null default false;

create table if not exists sgk_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  accrued bigint not null default 0 check (accrued >= 0),   -- tahakkuk (kuruş)
  paid bigint not null default 0 check (paid >= 0),         -- ödenen
  paid_on date,
  due_on date,
  note text,
  updated_by uuid references auth.users(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  unique (company_id, period)
);
alter table sgk_payments enable row level security;
drop policy if exists sgk_pay_read on sgk_payments;
create policy sgk_pay_read on sgk_payments for select using (can_manage_pay(company_id));
drop policy if exists sgk_pay_write on sgk_payments;
create policy sgk_pay_write on sgk_payments for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));
