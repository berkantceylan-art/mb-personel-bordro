-- Zimmet modülü: demirbaş kartı, personele zimmet, iade, personelin mobilden teslim onayı

create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code text,                                   -- demirbaş / zimmet no
  name text not null,
  category text not null default 'DIGER' check (category in ('BILGISAYAR', 'TELEFON', 'EL_ALETI', 'MAKINE', 'ANAHTAR_KART', 'ARAC', 'KIYAFET_KKD', 'MOBILYA', 'DIGER')),
  brand_model text,
  serial_no text,
  purchase_date date,
  value bigint check (value is null or value >= 0),   -- kuruş
  status text not null default 'AVAILABLE' check (status in ('AVAILABLE', 'ASSIGNED', 'MAINTENANCE', 'LOST', 'RETIRED')),
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, code)
);
create index if not exists assets_company_idx on assets (company_id, status);

create table if not exists asset_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  asset_id uuid not null references assets(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  assigned_on date not null default current_date,
  returned_on date,
  condition_out text,                          -- teslimde durum
  condition_in text,                           -- iadede durum
  note text,
  return_note text,
  assigned_by uuid references auth.users(id) default auth.uid(),
  acknowledged_at timestamptz,                 -- personel mobilden "teslim aldım"
  created_at timestamptz not null default now()
);
create index if not exists asset_assign_emp_idx on asset_assignments (employee_id, returned_on);
create index if not exists asset_assign_asset_idx on asset_assignments (asset_id, returned_on);
-- Aynı demirbaş aynı anda tek kişide
create unique index if not exists asset_assign_open_uidx on asset_assignments (asset_id) where returned_on is null;

alter table assets enable row level security;
alter table asset_assignments enable row level security;
drop policy if exists assets_read on assets;
create policy assets_read on assets for select using (is_member(company_id));
drop policy if exists assets_write on assets;
create policy assets_write on assets for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]));
drop policy if exists aa_read on asset_assignments;
create policy aa_read on asset_assignments for select using (can_see_employee(employee_id));
drop policy if exists aa_write on asset_assignments;
create policy aa_write on asset_assignments for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));
drop policy if exists aa_self_ack on asset_assignments;
create policy aa_self_ack on asset_assignments for update
  using (is_self_employee(employee_id)) with check (is_self_employee(employee_id));

-- Zimmet verilince demirbaş "zimmetli", iade edilince "boşta"; personele bildirim
create or replace function trg_asset_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
declare a assets; e employees;
begin
  select * into a from assets where id = new.asset_id;
  select * into e from employees where id = new.employee_id;
  if tg_op = 'INSERT' then
    if a.status in ('LOST', 'RETIRED') then raise exception 'Kayıp / hurda demirbaş zimmetlenemez'; end if;
    update assets set status = 'ASSIGNED', updated_at = now() where id = new.asset_id;
    if e.user_id is not null then
      perform deliver(new.company_id, array[e.user_id], 'Size zimmet verildi', a.name || coalesce(' · ' || a.code, '') || ' · lütfen uygulamadan teslim aldığınızı onaylayın', '/benim/zimmet');
    end if;
  elsif tg_op = 'UPDATE' and old.returned_on is null and new.returned_on is not null then
    update assets set status = case when new.condition_in ilike '%kayıp%' then 'LOST' when new.condition_in ilike '%arıza%' or new.condition_in ilike '%hasar%' then 'MAINTENANCE' else 'AVAILABLE' end, updated_at = now() where id = new.asset_id;
    if e.user_id is not null then
      perform deliver(new.company_id, array[e.user_id], 'Zimmet iadesi alındı', a.name || coalesce(' · ' || a.code, ''), '/benim/zimmet');
    end if;
  elsif tg_op = 'UPDATE' and old.acknowledged_at is null and new.acknowledged_at is not null then
    perform deliver(new.company_id, managers_for_employee(new.employee_id), 'Zimmet teslim onayı',
      e.first_name || ' ' || e.last_name || ' · ' || a.name || ' teslim aldığını onayladı', '/personel/' || e.id);
  end if;
  return new;
end $$;
drop trigger if exists asset_assignment_trg on asset_assignments;
create trigger asset_assignment_trg after insert or update on asset_assignments for each row execute function trg_asset_assignment();

-- Belge türü: zimmet tutanağı (şablon) · iade tutanağı
update document_types set template_key = 'zimmet-tutanagi', description = 'Teslim edilen demirbaşlar listelenir; personel imzalar' where company_id is null and name = 'Zimmet tutanağı';
insert into document_types (company_id, name, category, required, has_expiry, sort_order, template_key, description)
select null, 'Zimmet iade tutanağı', 'cikis', false, false, 216, 'zimmet-iade-tutanagi', 'İade edilen demirbaşlar; teslim alan imzalar'
where not exists (select 1 from document_types where company_id is null and name = 'Zimmet iade tutanağı');
