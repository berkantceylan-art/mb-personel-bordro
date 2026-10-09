-- Unutulan okutma bildirimi: personel "giriş/çıkış okutmayı unuttum, saat şuydu" der; şef/İK onaylayınca okutma yazılır.
create table if not exists punch_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  on_date date not null,
  direction punch_direction not null,
  at_time time not null,
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists punch_requests_emp_idx on punch_requests (employee_id, on_date desc);
create index if not exists punch_requests_status_idx on punch_requests (company_id, status);
alter table punch_requests enable row level security;
drop policy if exists pr_read on punch_requests;
create policy pr_read on punch_requests for select using (can_see_employee(employee_id));
drop policy if exists pr_self_insert on punch_requests;
create policy pr_self_insert on punch_requests for insert
  with check (status = 'pending' and is_self_employee(employee_id) and on_date <= current_date and on_date >= current_date - 31);
drop policy if exists pr_self_cancel on punch_requests;
create policy pr_self_cancel on punch_requests for delete using (status = 'pending' and is_self_employee(employee_id));
drop policy if exists pr_hr on punch_requests;
create policy pr_hr on punch_requests for all
  using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id))
  with check (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(employee_id));

-- Karar: onayda okutma yazılır (kaynak MANUAL)
create or replace function decide_punch_request(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r punch_requests; e employees;
begin
  select * into r from punch_requests where id = p_id;
  if r.id is null then raise exception 'Talep bulunamadı'; end if;
  if not (has_role(r.company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[]) and can_see_employee(r.employee_id)) then raise exception 'Yetkiniz yok'; end if;
  if r.status <> 'pending' then raise exception 'Bu talep zaten karara bağlanmış'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Geçersiz karar'; end if;
  if p_status = 'approved' then
    select * into e from employees where id = r.employee_id;
    insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, reason, created_by)
    values (r.company_id, e.branch_id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, 'TALEP', r.direction, (r.on_date + r.at_time)::timestamp, 'MANUAL',
            'Personel bildirimi' || coalesce(': ' || r.note, ''), auth.uid())
    on conflict do nothing;
  end if;
  update punch_requests set status = p_status, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

create or replace function trg_punch_request_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; lbl text;
begin
  select * into e from employees where id = new.employee_id;
  lbl := case new.direction when 'IN' then 'giriş' else 'çıkış' end || ' ' || to_char(new.on_date, 'DD.MM.YYYY') || ' ' || to_char(new.at_time, 'HH24:MI');
  if tg_op = 'INSERT' then
    perform deliver(new.company_id, managers_for_employee(new.employee_id), 'Unutulan okutma bildirimi', e.first_name || ' ' || e.last_name || ' · ' || lbl, '/talepler');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id], case new.status when 'approved' then 'Okutmanız işlendi' else 'Okutma bildiriminiz reddedildi' end, lbl || coalesce(' · ' || new.decision_note, ''), '/benim/puantaj');
  end if;
  return new;
end $$;
drop trigger if exists punch_request_notify on punch_requests;
create trigger punch_request_notify after insert or update on punch_requests for each row execute function trg_punch_request_notify();

-- ---------------------------------------------------------------------
-- Maaş / avans ödemesi yazılınca personele bildirim ("maaşınız yattı")
-- ---------------------------------------------------------------------
create or replace function trg_salary_paid_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; lbl text;
begin
  if new.voided_at is not null or new.type not in ('SALARY', 'ADVANCE') or new.channel = 'NONE' then return new; end if;
  -- Toplu aktarım ve geçmiş kayıtlar için bildirim yok
  if new.system_tag is not null and (new.system_tag like 'import:%' or new.system_tag like 'banka:%' or new.system_tag like 'carry:%' or new.system_tag like 'odendi:%') then return new; end if;
  if new.entry_date < current_date - 3 then return new; end if;
  select * into e from employees where id = new.employee_id;
  if e.user_id is null then return new; end if;
  lbl := case new.type when 'SALARY' then 'Maaş ödemeniz' else 'Avansınız' end || case new.channel when 'BANK' then ' bankaya yatırıldı' else ' elden ödendi' end;
  perform deliver(new.company_id, array[e.user_id], lbl,
    tl_text(new.amount) || ' · ' || to_char(new.entry_date, 'DD.MM.YYYY') || coalesce(' · ' || new.note, ''), '/benim/hareketler?donem=' || new.period);
  return new;
end $$;
drop trigger if exists salary_paid_notify on ledger_entries;
create trigger salary_paid_notify after insert on ledger_entries for each row execute function trg_salary_paid_notify();

-- ---------------------------------------------------------------------
-- Fazla mesai talebi: personel kendi fazla mesaisini bildirir (MANUAL, onay bekler)
-- ---------------------------------------------------------------------
drop policy if exists ot_self_insert on overtime_records;
create policy ot_self_insert on overtime_records for insert
  with check (is_self_employee(employee_id) and source = 'MANUAL' and status = 'pending' and work_date <= current_date and work_date >= current_date - 31 and minutes <= 11 * 60);
drop policy if exists ot_self_cancel on overtime_records;
create policy ot_self_cancel on overtime_records for delete
  using (is_self_employee(employee_id) and status = 'pending' and source = 'MANUAL' and created_by = auth.uid());

create or replace function trg_overtime_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; lbl text;
begin
  select * into e from employees where id = new.employee_id;
  lbl := to_char(new.work_date, 'DD.MM.YYYY') || ' · ' || trim_scale(round(new.minutes / 60.0, 1)) || ' saat';
  if tg_op = 'INSERT' and new.source = 'MANUAL' and new.created_by = e.user_id then
    perform deliver(new.company_id, managers_for_employee(new.employee_id), 'Fazla mesai talebi', e.first_name || ' ' || e.last_name || ' · ' || lbl || coalesce(' · ' || new.note, ''), '/fazla-mesai');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id], case new.status when 'approved' then 'Fazla mesainiz onaylandı' else 'Fazla mesainiz reddedildi' end, lbl, '/benim/puantaj');
  end if;
  return new;
end $$;
drop trigger if exists overtime_notify on overtime_records;
create trigger overtime_notify after insert or update on overtime_records for each row execute function trg_overtime_notify();
