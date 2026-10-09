-- İş Kanunu uyum modülleri: engelli kotası (md. 30), sözleşme türleri (md. 8-14), disiplin ve savunma (md. 19, 25, 38),
-- esaslı değişiklik (md. 22), telafi çalışması (md. 64), analık ve süt izni (md. 74), yıllık izin planı (md. 53-60)

-- 1) Engelli çalışan (özel nitelikli sağlık verisi: yalnız İK ve sahip görür; employee_private RLS'i geçerli)
alter table employee_private
  add column if not exists disabled boolean not null default false,
  add column if not exists disability_degree int check (disability_degree is null or disability_degree between 0 and 100);

-- 2) Sözleşme türü
alter table employees
  add column if not exists contract_type text not null default 'belirsiz' check (contract_type in ('belirsiz', 'belirli', 'kismi', 'cagri')),
  add column if not exists contract_end date,
  add column if not exists weekly_hours numeric(4,1),
  add column if not exists contract_renewals int not null default 0,
  add column if not exists fixed_term_reason text;

-- 3) Disiplin: tutanak → savunma → karar
create table if not exists disciplinary_cases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  incident_at timestamptz not null,
  learned_at date not null default current_date,         -- işverenin öğrendiği gün (md. 26: 6 iş günü)
  category text not null,
  description text not null,
  witnesses text,
  defense_requested_at timestamptz,
  defense_due date,
  defense_text text,
  defense_received_at timestamptz,
  defense_channel text,                                   -- mobil / yazılı
  decision text check (decision in ('uyari', 'ihtar', 'ucret_kesme', 'gecerli_fesih', 'hakli_fesih', 'islem_yok')),
  wage_cut_days numeric(3,1) check (wage_cut_days is null or (wage_cut_days > 0 and wage_cut_days <= 2)),
  wage_cut_period char(7),
  decision_note text,
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists disc_emp_idx on disciplinary_cases (employee_id, incident_at desc);

-- 4) Çalışma koşullarında esaslı değişiklik (md. 22): yazılı bildirim, 6 iş günü içinde yazılı kabul
create table if not exists condition_changes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  change_type text not null,
  description text not null,
  effective_date date,
  notified_at timestamptz not null default now(),
  response_due date not null,
  response text check (response in ('accepted', 'rejected')),
  response_note text,
  responded_at timestamptz,
  responded_ip text,
  created_by uuid references auth.users(id) default auth.uid()
);

-- 5) Telafi çalışması (md. 64): çalışılmayan süre 2 ay içinde, günde en çok 3 saat, tatil günlerinde yapılamaz
create table if not exists compensatory_work (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  reason text not null,
  off_date date not null,
  hours numeric(5,2) not null check (hours > 0),
  deadline date not null,
  employee_ids uuid[] not null,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create table if not exists compensatory_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  work_id uuid not null references compensatory_work(id) on delete cascade,
  work_date date not null,
  hours numeric(4,2) not null check (hours > 0 and hours <= 3),
  created_at timestamptz not null default now(),
  unique (work_id, work_date)
);

-- 6) Analık: doğum öncesi 8 + sonrası 16 hafta, 1 yıl günde 1,5 saat süt izni
create table if not exists maternity_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  expected_birth date,
  birth_date date,
  multiple boolean not null default false,
  leave_start date,
  leave_end date,
  milk_until date,
  part_time_until date,                                   -- doğum sonrası yarım çalışma (talep hâlinde)
  note text,
  created_at timestamptz not null default now()
);

-- 7) Yıllık izin planı
create table if not exists leave_plans (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  year int not null,
  start_date date not null,
  end_date date not null,
  days numeric(4,1) not null,
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

alter table disciplinary_cases enable row level security;
alter table condition_changes enable row level security;
alter table compensatory_work enable row level security;
alter table compensatory_entries enable row level security;
alter table maternity_records enable row level security;
alter table leave_plans enable row level security;

-- İK / sahip / muhasebe yazar; şef kendi bölümünü okur; personel kendi kaydını RPC ile görür
do $$
declare t text;
begin
  foreach t in array array['disciplinary_cases', 'condition_changes', 'maternity_records', 'leave_plans'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select using (can_see_employee(employee_id))', t);
    execute format('drop policy if exists %1$s_write on %1$s', t);
    execute format('create policy %1$s_write on %1$s for all using (has_role(company_id, array[''owner'', ''accountant'', ''hr'']::app_role[]) and can_see_employee(employee_id)) with check (has_role(company_id, array[''owner'', ''accountant'', ''hr'']::app_role[]))', t);
  end loop;
end $$;
drop policy if exists lp_self on leave_plans;
create policy lp_self on leave_plans for select using (is_self_employee(employee_id));
drop policy if exists cw_all on compensatory_work;
create policy cw_all on compensatory_work for all using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[])) with check (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]));
drop policy if exists ce2_all on compensatory_entries;
create policy ce2_all on compensatory_entries for all using (has_role(company_id, array['owner', 'accountant', 'hr', 'branch_manager']::app_role[])) with check (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]));

-- Personele gelen yazılar: savunma istemi ve esaslı değişiklik bildirimi
create or replace function my_letters()
returns table (kind text, id uuid, title text, body text, sent_at timestamptz, due date, answered_at timestamptz, answer text)
language sql stable security definer set search_path = public as $$
  select 'savunma', d.id, 'Savunma istemi · ' || d.category,
         'Tarih: ' || to_char(d.incident_at at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI') || E'\n' || d.description,
         d.defense_requested_at, d.defense_due, d.defense_received_at, d.defense_text
  from disciplinary_cases d where d.defense_requested_at is not null and is_self_employee(d.employee_id)
  union all
  select 'degisiklik', c.id, 'Çalışma koşullarında değişiklik · ' || c.change_type,
         c.description || coalesce(E'\nYürürlük: ' || to_char(c.effective_date, 'DD.MM.YYYY'), ''),
         c.notified_at, c.response_due, c.responded_at,
         case c.response when 'accepted' then 'Kabul ediyorum' when 'rejected' then 'Kabul etmiyorum' end || coalesce(' · ' || c.response_note, '')
  from condition_changes c where is_self_employee(c.employee_id)
  order by 5 desc;
$$;
grant execute on function my_letters() to authenticated;

create or replace function submit_defense(p_case uuid, p_text text) returns void
language plpgsql security definer set search_path = public as $$
declare d disciplinary_cases;
begin
  select * into d from disciplinary_cases where id = p_case;
  if d.id is null or not is_self_employee(d.employee_id) or d.defense_requested_at is null then raise exception 'Kayıt bulunamadı'; end if;
  if d.decided_at is not null then raise exception 'Karar verildi; savunma değiştirilemez'; end if;
  if length(trim(coalesce(p_text, ''))) < 3 then raise exception 'Savunmanızı yazın'; end if;
  update disciplinary_cases set defense_text = left(p_text, 5000), defense_received_at = now(), defense_channel = 'mobil' where id = p_case;
  perform deliver(d.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = d.company_id and role in ('owner', 'hr')),
    'Savunma geldi', (select first_name || ' ' || last_name from employees where id = d.employee_id), '/is-hukuku?sekme=disiplin');
end $$;
grant execute on function submit_defense(uuid, text) to authenticated;

create or replace function respond_change(p_change uuid, p_accept boolean, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare c condition_changes;
begin
  select * into c from condition_changes where id = p_change;
  if c.id is null or not is_self_employee(c.employee_id) then raise exception 'Kayıt bulunamadı'; end if;
  if c.responded_at is not null then raise exception 'Yanıt verildi'; end if;
  update condition_changes set response = case when p_accept then 'accepted' else 'rejected' end, response_note = left(p_note, 1000), responded_at = now() where id = p_change;
  perform deliver(c.company_id, (select coalesce(array_agg(user_id), '{}') from memberships where company_id = c.company_id and role in ('owner', 'hr')),
    case when p_accept then 'Değişiklik kabul edildi' else 'Değişiklik kabul edilmedi' end, (select first_name || ' ' || last_name from employees where id = c.employee_id) || ' · ' || c.change_type, '/is-hukuku?sekme=degisiklik');
end $$;
grant execute on function respond_change(uuid, boolean, text) to authenticated;

-- Personele bildirim: savunma istendi, değişiklik bildirildi
create or replace function trg_letter_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  select user_id into u from employees where id = new.employee_id;
  if u is null then return new; end if;
  if tg_table_name = 'disciplinary_cases' then
    if new.defense_requested_at is not null and (tg_op = 'INSERT' or old.defense_requested_at is null) then
      perform deliver(new.company_id, array[u], 'Savunmanız isteniyor', 'Son gün ' || to_char(new.defense_due, 'DD.MM.YYYY') || '. Uygulamadan yazılı savunma verebilirsiniz.', '/benim/yazilar');
    end if;
  elsif tg_op = 'INSERT' then
    perform deliver(new.company_id, array[u], 'Çalışma koşullarınızda değişiklik bildirimi', new.change_type || ' · yanıt için son gün ' || to_char(new.response_due, 'DD.MM.YYYY'), '/benim/yazilar');
  end if;
  return new;
end $$;
drop trigger if exists disc_notify on disciplinary_cases;
create trigger disc_notify after insert or update on disciplinary_cases for each row execute function trg_letter_notify();
drop trigger if exists change_notify on condition_changes;
create trigger change_notify after insert on condition_changes for each row execute function trg_letter_notify();

-- Personel kendi izin planını ve analık tarihlerini görür
create or replace function my_maternity()
returns table (expected_birth date, birth_date date, leave_start date, leave_end date, milk_until date)
language sql stable security definer set search_path = public as $$
  select m.expected_birth, m.birth_date, m.leave_start, m.leave_end, m.milk_until from maternity_records m where is_self_employee(m.employee_id) order by m.created_at desc limit 1;
$$;
grant execute on function my_maternity() to authenticated;

-- Fazla çalışma onayı (Fazla Çalışma Yönetmeliği md. 9: işçinin yazılı onayı, her yıl başında): bu yıl imzalamayanlara bildirim
create or replace function request_overtime_consent() returns int
language plpgsql security definer set search_path = public as $$
declare cid uuid; users uuid[];
begin
  select company_id into cid from memberships where user_id = auth.uid() and role in ('owner', 'hr') limit 1;
  if cid is null then raise exception 'Yetkiniz yok'; end if;
  select coalesce(array_agg(e.user_id), '{}') into users from employees e
  where e.company_id = cid and e.status <> 'terminated' and e.user_id is not null
    and not exists (select 1 from document_signatures s where s.employee_id = e.id and s.template_key = 'fazla-calisma-muvafakat'
                    and s.signed_at >= date_trunc('year', now()));
  perform deliver(cid, users, 'Fazla çalışma onay formu', 'Bu yıl için fazla çalışma onayınızı uygulamadan imzalayın.', '/benim/imza');
  return coalesce(array_length(users, 1), 0);
end $$;
grant execute on function request_overtime_consent() to authenticated;
