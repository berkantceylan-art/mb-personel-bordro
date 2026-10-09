-- Dijital imza: basit muvafakat/formlar personel tarafından telefonda parmakla imzalanır
alter table document_types add column if not exists digital_sign boolean not null default false;
update document_types set digital_sign = true where company_id is null and template_key in ('fazla-calisma-muvafakat', 'yillik-izin-bolme-muvafakat', 'yillik-izin-erken-talep', 'kvkk-acik-riza', 'zimmet-tutanagi');

create table if not exists document_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  document_type_id uuid references document_types(id),
  template_key text not null,
  signature_path text not null,          -- imza PNG (documents deposu, personelin klasörü)
  content_text text not null,            -- imzalanan metnin o anki hali
  signed_at timestamptz not null default now(),
  ip text,
  user_agent text,
  created_by uuid references auth.users(id) default auth.uid()
);
create index if not exists document_signatures_emp_idx on document_signatures (employee_id, signed_at desc);
alter table document_signatures enable row level security;
drop policy if exists ds_read on document_signatures;
create policy ds_read on document_signatures for select using (can_see_employee(employee_id));
drop policy if exists ds_self_insert on document_signatures;
create policy ds_self_insert on document_signatures for insert with check (is_self_employee(employee_id) and created_by = auth.uid());
drop policy if exists ds_hr_delete on document_signatures;
create policy ds_hr_delete on document_signatures for delete using (can_manage_hr(company_id));

-- İmza atılınca İK'ya bildirim
create or replace function trg_signature_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; t text;
begin
  select * into e from employees where id = new.employee_id;
  select name into t from document_types where id = new.document_type_id;
  perform deliver(new.company_id, managers_for_employee(new.employee_id), 'Belge dijital imzalandı', e.first_name || ' ' || e.last_name || ' · ' || coalesce(t, new.template_key), '/personel/' || e.id);
  return new;
end $$;
drop trigger if exists signature_notify on document_signatures;
create trigger signature_notify after insert on document_signatures for each row execute function trg_signature_notify();
