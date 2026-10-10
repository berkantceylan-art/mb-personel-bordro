-- =====================================================================
-- Cari hesap: tahsilatlar, ekstre, banka bilgileri; portalda "Hesabım"
--  lab_payments : hekim / klinik / aracı tahsilatları (TL / € / $)
--  lab_options  : kind 'bank' satırları proforma ve ekstrede banka bilgisi olarak basılır
-- Portal hesabı yalnız kendi kartının işlerini, satırlarını ve tahsilatlarını görür.
-- Tekrar çalıştırılabilir. Önce 20261125000000_lab_jobs.sql çalıştırılmış olmalı.
-- =====================================================================

create table if not exists lab_payments (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references lab_customers (id) on delete restrict,
  paid_on date not null default current_date,
  amount bigint not null check (amount > 0),                 -- kuruş / cent
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  method text not null default 'bank' check (method in ('cash', 'bank', 'card', 'check', 'offset', 'other')),
  ref text check (ref is null or length(ref) <= 80),
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists lab_payments_idx on lab_payments (customer_id, paid_on desc);

alter table lab_payments enable row level security;
drop policy if exists lab_payments_lab on lab_payments;
create policy lab_payments_lab on lab_payments for all to authenticated using (can_logistics()) with check (can_logistics());
drop policy if exists lab_payments_portal on lab_payments;
create policy lab_payments_portal on lab_payments for select to authenticated
  using (exists (select 1 from lab_customers c where c.id = customer_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id)));

drop trigger if exists audit_lab_payments on lab_payments;
create trigger audit_lab_payments after insert or update or delete on lab_payments for each row execute function audit_trigger();

-- Portal: kendi işlerinin satırları (proforma / ekstre için)
drop policy if exists job_items_portal on job_items;
create policy job_items_portal on job_items for select to authenticated
  using (exists (select 1 from jobs j join lab_customers c on c.id = j.customer_id
                 where j.id = job_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id)));

-- Banka bilgileri (lab_options.kind = 'bank')
alter table lab_options drop constraint if exists lab_options_kind_check;
alter table lab_options add constraint lab_options_kind_check check (kind in ('delivery', 'tryin', 'bank'));
alter table lab_options drop constraint if exists lab_options_value_check;
alter table lab_options add constraint lab_options_value_check check (length(value) between 1 and 200);
drop policy if exists lab_options_bank_portal on lab_options;
create policy lab_options_bank_portal on lab_options for select to authenticated
  using (kind = 'bank' and exists (select 1 from portal_members m join portal_accounts a on a.id = m.account_id where m.user_id = auth.uid() and a.status = 'active'));

notify pgrst, 'reload schema';
