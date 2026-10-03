-- =====================================================================
-- Migration 2: Dönemler ve zam modülü
-- =====================================================================

-- ---------------------------------------------------------------------
-- Bordro dönemleri
-- ---------------------------------------------------------------------
create table payroll_periods (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  employee_count int not null default 0,
  total_accrual bigint not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references auth.users(id),
  unique (company_id, period)
);

alter table payroll_periods enable row level security;
create policy periods_read on payroll_periods for select using (is_member(company_id));
create policy periods_write on payroll_periods for all
  using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

-- Var olan hareketlerden (ör. Excel aktarımı) dönem kayıtlarını oluştur
insert into payroll_periods (company_id, period, employee_count, total_accrual, created_by)
select company_id, period, count(distinct employee_id), coalesce(sum(amount), 0), null
from ledger_entries
where type = 'ACCRUAL' and voided_at is null
group by company_id, period
on conflict (company_id, period) do nothing;

-- Bir personele aynı dönemde ikinci hakediş yazılamaz (iptal edilen hariç).
-- Mevcut veride çift kayıt varsa indeks atlanır ve uyarı verilir.
do $$
begin
  if exists (
    select 1 from ledger_entries
    where type = 'ACCRUAL' and voided_at is null
    group by employee_id, period having count(*) > 1
  ) then
    raise notice 'Aynı döneme birden fazla hakediş yazılmış personel var; tekillik indeksi oluşturulmadı. Fazla kayıtları iptal edip bu bloğu tekrar çalıştırın.';
  else
    create unique index if not exists ledger_one_accrual_per_period
      on ledger_entries (employee_id, period)
      where type = 'ACCRUAL' and voided_at is null;
  end if;
end $$;

-- Kapalı döneme hareket girilemez
create or replace function ledger_entries_period_open() returns trigger
language plpgsql as $$
begin
  if exists (
    select 1 from payroll_periods p
    where p.company_id = new.company_id and p.period = new.period and p.status = 'closed'
  ) then
    raise exception '% dönemi kapalı; hareket girilemez', new.period;
  end if;
  return new;
end $$;
create trigger ledger_entries_period_open before insert on ledger_entries
  for each row execute function ledger_entries_period_open();

-- ---------------------------------------------------------------------
-- Zamlar
-- ---------------------------------------------------------------------
create table salary_raise_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  effective_date date not null,
  kind text not null check (kind in ('PERCENT', 'AMOUNT', 'SET', 'MIXED')),
  value numeric,
  round_to bigint,
  scope text not null default 'Tüm personel',
  note text,
  employee_count int not null default 0,
  monthly_increase bigint not null default 0,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);

alter table salary_raise_batches enable row level security;
create policy raise_batches_read on salary_raise_batches for select using (can_manage_pay(company_id));
create policy raise_batches_write on salary_raise_batches for insert with check (can_manage_pay(company_id));

alter table pay_contracts
  add column raise_batch_id uuid references salary_raise_batches(id) on delete set null,
  add column previous_total_net bigint,
  add column change_reason text;

create index on pay_contracts (company_id, valid_from);

-- Yeni sözleşme eklenince öncekini bir gün öncesinde kapat, eski tutarı sakla
create or replace function pay_contracts_close_previous() returns trigger
language plpgsql security definer set search_path = public as $$
declare prev record;
begin
  select * into prev from pay_contracts
  where employee_id = new.employee_id and id <> new.id and valid_from < new.valid_from
  order by valid_from desc limit 1;

  if found then
    if new.previous_total_net is null then
      new.previous_total_net := prev.total_net;
    end if;
    update pay_contracts set valid_to = new.valid_from - 1
    where id = prev.id and (valid_to is null or valid_to >= new.valid_from);
  end if;

  if exists (select 1 from pay_contracts where employee_id = new.employee_id and valid_from = new.valid_from and id <> new.id) then
    raise exception 'Bu personel için % tarihli bir ücret kaydı zaten var', new.valid_from;
  end if;
  return new;
end $$;
create trigger pay_contracts_close_previous before insert on pay_contracts
  for each row execute function pay_contracts_close_previous();

-- Zam geçmişi görünümü (RLS pay_contracts'tan gelir)
create view salary_changes with (security_invoker = true) as
select
  pc.id,
  pc.company_id,
  pc.employee_id,
  e.first_name,
  e.last_name,
  e.department_id,
  d.name as department_name,
  pc.valid_from as effective_date,
  to_char(pc.valid_from, 'YYYY-MM') as period,
  pc.previous_total_net,
  pc.total_net,
  pc.total_net - pc.previous_total_net as increase,
  round((pc.total_net - pc.previous_total_net) * 100.0 / nullif(pc.previous_total_net, 0), 2) as increase_pct,
  pc.raise_batch_id,
  pc.change_reason,
  pc.insurance_type,
  pc.created_at
from pay_contracts pc
join employees e on e.id = pc.employee_id
left join departments d on d.id = e.department_id
where pc.previous_total_net is not null;

-- ---------------------------------------------------------------------
-- Personel özlük alanları (ek)
-- ---------------------------------------------------------------------
alter table employee_private
  add column if not exists birth_place text,
  add column if not exists father_name text,
  add column if not exists mother_name text,
  add column if not exists nationality text default 'T.C.',
  add column if not exists blood_type text,
  add column if not exists children_count int,
  add column if not exists phone2 text,
  add column if not exists city text,
  add column if not exists district text,
  add column if not exists emergency_contact_relation text,
  add column if not exists education_level text,
  add column if not exists school text,
  add column if not exists school_department text,
  add column if not exists graduation_year int,
  add column if not exists diploma_no text,
  add column if not exists license_class text,
  add column if not exists license_no text,
  add column if not exists license_date date,
  add column if not exists iban_holder text;

alter table employees
  add column if not exists position_title text,
  add column if not exists termination_reason text;

insert into document_types (company_id, name, category, required, has_expiry, sort_order)
select null, 'Ehliyet fotokopisi', 'ozluk', false, true, 45
where not exists (select 1 from document_types where company_id is null and name = 'Ehliyet fotokopisi');
insert into document_types (company_id, name, category, required, has_expiry, sort_order)
select null, 'Adli sicil kaydı', 'ozluk', false, false, 35
where not exists (select 1 from document_types where company_id is null and name = 'Adli sicil kaydı');
insert into document_types (company_id, name, category, required, has_expiry, sort_order)
select null, 'Askerlik durum belgesi', 'ozluk', false, false, 47
where not exists (select 1 from document_types where company_id is null and name = 'Askerlik durum belgesi');

-- Belgeler: silme ve personelin kendi belgesini okuması
create policy "documents_delete" on storage.objects for delete
  using (bucket_id = 'documents' and can_manage_hr(((storage.foldername(name))[1])::uuid));

-- Personel silme: cari hareketi olan personel silinemez (FK restrict), işten çıkarılır.
create policy employees_delete on employees for delete
  using (has_role(company_id, array['owner']::app_role[]));

-- ---------------------------------------------------------------------
-- Cari hareket düzeltme (düzenleme = eskiyi iptal + yenisini yaz, tek işlemde)
-- ---------------------------------------------------------------------
alter table ledger_entries add column if not exists corrects_id uuid references ledger_entries(id);

create or replace function correct_ledger_entry(
  p_id uuid,
  p_entry_date date,
  p_type ledger_type,
  p_channel ledger_channel,
  p_amount bigint,
  p_period char(7),
  p_note text,
  p_reason text
) returns uuid language plpgsql security definer set search_path = public as $$
declare old ledger_entries; new_id uuid;
begin
  select * into old from ledger_entries where id = p_id;
  if old.id is null or not can_manage_pay(old.company_id) then raise exception 'Yetki yok'; end if;
  if old.voided_at is not null then raise exception 'Bu hareket zaten iptal edilmiş'; end if;
  if coalesce(length(p_reason), 0) = 0 then raise exception 'Düzeltme gerekçesi zorunlu'; end if;

  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = 'Düzeltildi: ' || p_reason
  where id = p_id;

  insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note,
                              receipt_path, signature_path, bank_reference, corrects_id)
  values (old.company_id, old.employee_id, p_period, p_entry_date, p_type, p_channel, p_amount, p_note,
          old.receipt_path, old.signature_path, old.bank_reference, old.id)
  returning id into new_id;
  return new_id;
end $$;

-- ---------------------------------------------------------------------
-- Ücret kaydı silinince önceki kaydı yeniden aç
-- ---------------------------------------------------------------------
create or replace function pay_contracts_reopen_previous() returns trigger
language plpgsql security definer set search_path = public as $$
declare nxt date;
begin
  select min(valid_from) into nxt from pay_contracts where employee_id = old.employee_id and valid_from > old.valid_from;
  update pay_contracts set valid_to = case when nxt is null then null else nxt - 1 end
  where id = (select id from pay_contracts where employee_id = old.employee_id and valid_from < old.valid_from
              order by valid_from desc limit 1);
  return old;
end $$;
create trigger pay_contracts_reopen_previous after delete on pay_contracts
  for each row execute function pay_contracts_reopen_previous();
