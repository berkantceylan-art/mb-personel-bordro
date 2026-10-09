-- KVKK uyumu: aydınlatma metinleri (sürümlü), onay / açık rıza kayıtları, veri sahibi başvuruları (md. 11, 30 gün),
-- hassas veri erişim kaydı, saklama süreleri ve imha tutanakları, veri ihlali kaydı

create table if not exists kvkk_notices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  audience text not null check (audience in ('employee', 'candidate', 'visitor')),
  kind text not null default 'aydinlatma' check (kind in ('aydinlatma', 'acik_riza')),
  purpose_key text,                       -- açık rıza amacı (ör. 'foto_paylasim')
  title text not null,
  body text not null,
  version int not null default 1,
  active boolean not null default true,
  published_at timestamptz not null default now(),
  created_by uuid references auth.users(id) default auth.uid()
);
create index if not exists kvkk_notices_idx on kvkk_notices (company_id, audience, active);

create table if not exists kvkk_consents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  notice_id uuid not null references kvkk_notices(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  employee_id uuid references employees(id) on delete cascade,
  version int not null,
  granted boolean not null default true,        -- açık rızada geri alınabilir
  channel text not null default 'mobil',
  ip text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists kvkk_consents_emp_idx on kvkk_consents (employee_id, notice_id);

create table if not exists kvkk_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid references employees(id) on delete set null,
  requester_name text not null,
  requester_contact text not null,
  requester_type text not null default 'calisan' check (requester_type in ('calisan', 'eski_calisan', 'aday', 'diger')),
  request_type text not null check (request_type in ('bilgi', 'erisim', 'duzeltme', 'silme', 'itiraz', 'aktarim', 'tazmin', 'diger')),
  details text not null,
  received_at timestamptz not null default now(),
  due_on date not null default (current_date + 30),
  status text not null default 'open' check (status in ('open', 'in_progress', 'answered', 'rejected')),
  response text,
  responded_at timestamptz,
  handled_by uuid references auth.users(id)
);

create table if not exists kvkk_access_log (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid references auth.users(id) default auth.uid(),
  action text not null,           -- view / reveal / download / export
  entity text not null,           -- employee / document / report / candidate / payroll
  entity_id text,
  detail text,
  at timestamptz not null default now()
);
create index if not exists kvkk_access_idx on kvkk_access_log (company_id, at desc);

create table if not exists kvkk_retention (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category text not null,
  data text not null,
  legal_basis text,
  retention text not null,
  years numeric,
  action text not null default 'Anonimleştirme',
  sort int not null default 100,
  unique (company_id, category)
);

create table if not exists kvkk_disposals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  category text not null,
  method text not null,
  record_count int not null,
  detail text,
  done_by uuid references auth.users(id) default auth.uid(),
  done_at timestamptz not null default now()
);

create table if not exists kvkk_breaches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  occurred_at timestamptz not null,
  detected_at timestamptz not null default now(),
  description text not null,
  data_categories text,
  affected_count int,
  measures text,
  board_notified_at timestamptz,          -- Kurul'a 72 saat içinde
  subjects_notified_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid()
);

alter table kvkk_notices enable row level security;
alter table kvkk_consents enable row level security;
alter table kvkk_requests enable row level security;
alter table kvkk_access_log enable row level security;
alter table kvkk_retention enable row level security;
alter table kvkk_disposals enable row level security;
alter table kvkk_breaches enable row level security;

drop policy if exists kn_read on kvkk_notices;
create policy kn_read on kvkk_notices for select using (is_member(company_id));
drop policy if exists kn_write on kvkk_notices;
create policy kn_write on kvkk_notices for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists kc_read on kvkk_consents;
create policy kc_read on kvkk_consents for select using (has_role(company_id, array['owner', 'hr']::app_role[]) or user_id = auth.uid());
drop policy if exists kr_staff on kvkk_requests;
create policy kr_staff on kvkk_requests for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists kr_self on kvkk_requests;
create policy kr_self on kvkk_requests for select using (employee_id is not null and is_self_employee(employee_id));
drop policy if exists kal_read on kvkk_access_log;
create policy kal_read on kvkk_access_log for select using (has_role(company_id, array['owner']::app_role[]) or (has_role(company_id, array['hr']::app_role[]) and user_id <> auth.uid()));
drop policy if exists kal_insert on kvkk_access_log;
create policy kal_insert on kvkk_access_log for insert with check (is_member(company_id) and user_id = auth.uid());
drop policy if exists kre_all on kvkk_retention;
create policy kre_all on kvkk_retention for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists kd_all on kvkk_disposals;
create policy kd_all on kvkk_disposals for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
drop policy if exists kb_all on kvkk_breaches;
create policy kb_all on kvkk_breaches for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));

-- Personelin onayı (aydınlatma okundu / açık rıza ver-geri al)
create or replace function kvkk_consent(p_notice uuid, p_granted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare n kvkk_notices; e employees;
begin
  select * into n from kvkk_notices where id = p_notice and active;
  select * into e from employees where user_id = auth.uid() and company_id = n.company_id limit 1;
  if n.id is null or e.id is null then raise exception 'Metin bulunamadı'; end if;
  if n.kind = 'aydinlatma' and not p_granted then raise exception 'Aydınlatma metni yalnız okundu olarak işaretlenir'; end if;
  update kvkk_consents set revoked_at = now() where employee_id = e.id and notice_id = n.id and revoked_at is null;
  insert into kvkk_consents (company_id, notice_id, user_id, employee_id, version, granted)
  values (n.company_id, n.id, auth.uid(), e.id, n.version, p_granted);
end $$;
grant execute on function kvkk_consent(uuid, boolean) to authenticated;

-- Personel kendi KVKK başvurusunu yapar
create or replace function kvkk_request_self(p_type text, p_details text) returns void
language plpgsql security definer set search_path = public as $$
declare e employees; p employee_private;
begin
  select * into e from employees where user_id = auth.uid() limit 1;
  if e.id is null then raise exception 'Personel kaydınız bulunamadı'; end if;
  select * into p from employee_private where employee_id = e.id;
  insert into kvkk_requests (company_id, employee_id, requester_name, requester_contact, requester_type, request_type, details)
  values (e.company_id, e.id, e.first_name || ' ' || e.last_name, coalesce(p.phone, p.email, 'uygulama'), 'calisan', p_type, left(p_details, 4000));
end $$;
grant execute on function kvkk_request_self(text, text) to authenticated;

create or replace function trg_kvkk_request_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform deliver(new.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = new.company_id and role in ('owner', 'hr')),
      'KVKK başvurusu (30 gün süre)', new.requester_name || ' · son gün ' || to_char(new.due_on, 'DD.MM.YYYY'), '/kvkk?sekme=basvuru');
  elsif old.status is distinct from new.status and new.status in ('answered', 'rejected') and new.employee_id is not null then
    perform deliver(new.company_id, (select array_agg(user_id) from employees where id = new.employee_id and user_id is not null), 'KVKK başvurunuz yanıtlandı', coalesce(left(new.response, 120), ''), '/benim/kvkk');
  end if;
  return new;
end $$;
drop trigger if exists kvkk_request_notify on kvkk_requests;
create trigger kvkk_request_notify after insert or update on kvkk_requests for each row execute function trg_kvkk_request_notify();

create table if not exists kvkk_checklist (
  company_id uuid not null references companies(id) on delete cascade,
  key text not null,
  done_at timestamptz,
  note text,
  updated_by uuid references auth.users(id) default auth.uid(),
  primary key (company_id, key)
);
alter table kvkk_checklist enable row level security;
drop policy if exists kcl_all on kvkk_checklist;
create policy kcl_all on kvkk_checklist for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));
