-- 1) Özlük bilgisi değişiklik talebi (personel ister, İK onaylar, onayda uygulanır)
-- 2) Ofise çağırma
-- 3) İşten çıkış sihirbazı: çıkış kodu, belge türleri, erişim kapatma

-- ---------------------------------------------------------------------
-- 1) Özlük değişiklik talepleri
-- ---------------------------------------------------------------------
create table if not exists profile_change_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  -- {"phone": {"old": "...", "new": "..."}, ...}
  changes jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note text,
  decision_note text,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists profile_change_requests_emp_idx on profile_change_requests (employee_id, created_at desc);
create index if not exists profile_change_requests_status_idx on profile_change_requests (company_id, status);
alter table profile_change_requests enable row level security;
drop policy if exists pcr_read on profile_change_requests;
create policy pcr_read on profile_change_requests for select using (can_see_employee(employee_id));
drop policy if exists pcr_self_insert on profile_change_requests;
create policy pcr_self_insert on profile_change_requests for insert
  with check (status = 'pending' and is_self_employee(employee_id));
drop policy if exists pcr_hr on profile_change_requests;
create policy pcr_hr on profile_change_requests for all using (can_manage_hr(company_id)) with check (can_manage_hr(company_id));

-- Personelin değiştirebileceği alanlar
create or replace function profile_editable_fields() returns text[] language sql immutable as $$
  select array['phone', 'phone2', 'email', 'address', 'city', 'district', 'emergency_contact_name', 'emergency_contact_relation', 'emergency_contact_phone',
               'marital_status', 'children_count', 'blood_type', 'education_level', 'school', 'school_department', 'graduation_year',
               'license_class', 'license_no', 'license_date', 'military_status', 'bank_name', 'iban', 'iban_holder'];
$$;

-- Personel talebi: yalnız izinli alanlar, eski değerler sunucuda doldurulur
create or replace function request_profile_change(p_changes jsonb, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare e employees; cur jsonb; out jsonb := '{}'::jsonb; k text; v text; old text; v_id uuid;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select to_jsonb(p) into cur from employee_private p where p.employee_id = e.id;
  cur := coalesce(cur, '{}'::jsonb);
  for k, v in select * from jsonb_each_text(p_changes) loop
    if not (k = any (profile_editable_fields())) then raise exception '% alanı personel tarafından değiştirilemez', k; end if;
    old := cur ->> k;
    v := nullif(trim(v), '');
    if k = 'iban' and v is not null then
      v := upper(replace(v, ' ', ''));
      if v !~ '^TR\d{24}$' then raise exception 'IBAN TR ile başlayıp 26 karakter olmalı'; end if;
    end if;
    if coalesce(old, '') <> coalesce(v, '') then
      out := out || jsonb_build_object(k, jsonb_build_object('old', old, 'new', v));
    end if;
  end loop;
  if out = '{}'::jsonb then raise exception 'Değişen bir bilgi yok'; end if;
  if exists (select 1 from profile_change_requests r where r.employee_id = e.id and r.status = 'pending') then
    raise exception 'Bekleyen bir değişiklik talebiniz var; karar verilince yenisini gönderebilirsiniz';
  end if;
  insert into profile_change_requests (company_id, employee_id, changes, note) values (e.company_id, e.id, out, nullif(trim(p_note), '')) returning id into v_id;
  return v_id;
end $$;

-- İK kararı: onayda employee_private güncellenir
create or replace function decide_profile_change(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare r profile_change_requests; k text; v jsonb; sets text := '';
begin
  select * into r from profile_change_requests where id = p_id;
  if r.id is null then raise exception 'Talep bulunamadı'; end if;
  if not can_manage_hr(r.company_id) then raise exception 'Yetkiniz yok'; end if;
  if r.status <> 'pending' then raise exception 'Bu talep zaten karara bağlanmış'; end if;
  if p_status not in ('approved', 'rejected') then raise exception 'Geçersiz karar'; end if;
  if p_status = 'approved' then
    insert into employee_private (employee_id, company_id) values (r.employee_id, r.company_id) on conflict (employee_id) do nothing;
    for k, v in select * from jsonb_each(r.changes) loop
      if not (k = any (profile_editable_fields())) then continue; end if;
      if k in ('children_count', 'graduation_year') then
        execute format('update employee_private set %I = $1::int, updated_at = now() where employee_id = $2', k) using nullif(v ->> 'new', ''), r.employee_id;
      elsif k = 'license_date' then
        execute format('update employee_private set %I = $1::date, updated_at = now() where employee_id = $2', k) using nullif(v ->> 'new', ''), r.employee_id;
      else
        execute format('update employee_private set %I = $1, updated_at = now() where employee_id = $2', k) using nullif(v ->> 'new', ''), r.employee_id;
      end if;
    end loop;
  end if;
  update profile_change_requests set status = p_status, decision_note = nullif(trim(p_note), ''), decided_by = auth.uid(), decided_at = now() where id = p_id;
end $$;

-- Bildirimler: yeni talep → İK; karar → personel
create or replace function trg_profile_change_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; users uuid[]; n int;
begin
  select * into e from employees where id = new.employee_id;
  if tg_op = 'INSERT' then
    select coalesce(array_agg(m.user_id), '{}') into users from memberships m where m.company_id = new.company_id and m.role in ('owner', 'hr');
    select count(*) into n from jsonb_object_keys(new.changes);
    perform deliver(new.company_id, users, 'Özlük bilgisi değişiklik talebi', e.first_name || ' ' || e.last_name || ' · ' || n || ' alan', '/talepler?sekme=ozluk');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status <> 'pending' and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id],
      case new.status when 'approved' then 'Bilgi değişikliğiniz onaylandı' else 'Bilgi değişikliğiniz reddedildi' end,
      coalesce(new.decision_note, 'Özlük bilgilerim sayfasından kontrol edebilirsiniz'), '/benim/ozluk');
  end if;
  return new;
end $$;
drop trigger if exists profile_change_notify on profile_change_requests;
create trigger profile_change_notify after insert or update on profile_change_requests for each row execute function trg_profile_change_notify();

-- ---------------------------------------------------------------------
-- 2) Ofise çağırma
-- ---------------------------------------------------------------------
create table if not exists office_calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  on_date date not null,
  at_time time,
  reason text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists office_calls_emp_idx on office_calls (employee_id, on_date desc);
alter table office_calls enable row level security;
drop policy if exists office_calls_read on office_calls;
create policy office_calls_read on office_calls for select using (can_see_employee(employee_id));
drop policy if exists office_calls_hr on office_calls;
create policy office_calls_hr on office_calls for all
  using (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]))
  with check (can_manage_hr(company_id) or has_role(company_id, array['branch_manager']::app_role[]));
drop policy if exists office_calls_self_ack on office_calls;
create policy office_calls_self_ack on office_calls for update
  using (is_self_employee(employee_id)) with check (is_self_employee(employee_id));

create or replace function trg_office_call_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; users uuid[];
begin
  select * into e from employees where id = new.employee_id;
  if tg_op = 'INSERT' and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id], 'Ofise çağrıldınız',
      to_char(new.on_date, 'DD.MM.YYYY') || coalesce(' ' || to_char(new.at_time, 'HH24:MI'), '') || coalesce(' · ' || new.reason, ''), '/benim');
  elsif tg_op = 'UPDATE' and old.acknowledged_at is null and new.acknowledged_at is not null then
    select coalesce(array_agg(u), '{}') into users from (
      select new.created_by as u union
      select m.user_id from memberships m where m.company_id = new.company_id and m.role in ('owner', 'hr')
    ) t where u is not null;
    perform deliver(new.company_id, users, 'Ofis çağrısı onaylandı',
      e.first_name || ' ' || e.last_name || ' · ' || to_char(new.on_date, 'DD.MM.YYYY') || ' geleceğini bildirdi', '/personel/' || e.id);
  end if;
  return new;
end $$;
drop trigger if exists office_call_notify on office_calls;
create trigger office_call_notify after insert or update on office_calls for each row execute function trg_office_call_notify();

-- ---------------------------------------------------------------------
-- 3) İşten çıkış
-- ---------------------------------------------------------------------
alter table employees
  add column if not exists termination_code text,
  add column if not exists former_card_no text,
  add column if not exists exit_done_at timestamptz;

insert into document_types (company_id, name, category, required, has_expiry, sort_order, template_key, description)
select * from (values
  (null::uuid, 'Çalışma belgesi',              'cikis', true,  false, 205, 'calisma-belgesi', 'İş Kanunu md. 28; personele verilir'),
  (null::uuid, 'Fesih bildirimi',              'cikis', false, false, 206, 'fesih-bildirimi', 'İşveren feshinde; tebliğ edilip imzalatılır'),
  (null::uuid, 'İstifa dilekçesi',             'cikis', false, false, 207, null, 'Personel kendi el yazısıyla; istifa halinde'),
  (null::uuid, 'Zimmet iade tutanağı',         'cikis', false, false, 215, null, 'Teslim alınan malzemeler'),
  (null::uuid, 'Son bordro / hesap pusulası',  'cikis', false, false, 220, null, 'Kıdem, ihbar, izin ücreti dökümü imzalı')
) as v(company_id, name, category, required, has_expiry, sort_order, template_key, description)
where not exists (select 1 from document_types d where d.company_id is null and d.name = v.name);
update document_types set template_key = 'ibraname', required = true, description = 'Tüm alacaklar ödendikten sonra imzalatılır' where company_id is null and name = 'İbraname' and template_key is null;

-- Erişim kapatma: mobil hesap ve PDKS kartı (sadece İK)
create or replace function close_employee_access(p_employee uuid)
returns json language plpgsql security definer set search_path = public as $$
declare e employees; n int := 0;
begin
  select * into e from employees where id = p_employee;
  if e.id is null then raise exception 'Personel bulunamadı'; end if;
  if not can_manage_hr(e.company_id) then raise exception 'Yetkiniz yok'; end if;
  if e.user_id is not null then
    delete from memberships where user_id = e.user_id and company_id = e.company_id;
    delete from web_push_subscriptions where user_id = e.user_id;
    get diagnostics n = row_count;
    update employees set user_id = null where id = e.id;
  end if;
  update employees set former_card_no = coalesce(former_card_no, card_no), card_no = null where id = e.id and card_no is not null;
  return json_build_object('account_closed', e.user_id is not null, 'card_removed', e.card_no is not null);
end $$;

-- ---------------------------------------------------------------------
-- 4) Personel kendi İSG sertifikasını ve sağlık rapor dosyasını görebilsin (depo okuma)
-- ---------------------------------------------------------------------
drop policy if exists "documents_self_isg_read" on storage.objects;
create policy "documents_self_isg_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'documents' and (
      exists (select 1 from training_records t join employees e on e.id = t.employee_id where e.user_id = auth.uid() and t.certificate_path = name)
      or exists (select 1 from health_exams h join employees e on e.id = h.employee_id where e.user_id = auth.uid() and h.report_path = name)
    )
  );
