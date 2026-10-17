-- =====================================================================
-- PUANTAJ KONTROL MERKEZİ
--  att_days        : personel × gün puantaj kaydı (okutma + vardiya + izin + tatilden hesaplanır; uygulama yazar)
--                    hata kodları (issues) + durum: ok | open (düzeltilecek) | fixed (düzeltildi) | accepted (olduğu gibi kabul)
--  att_corrections : kontrol merkezinde yapılan her düzeltme (kim, ne zaman, ne, neden) — orijinal okutma silinmez
--  att_settings    : kart unuttu aylık hakkı (varsayılan 2; aşan kısım onaya gider)
--  att_months      : ay kapanışı — açık hatalı gün varken kapanmaz; kapalı ayın elle okutma / izin / mesai / vardiya kaydı değişmez
--  Personelin "okutmayı unuttum" bildirimi aylık hak içindeyse otomatik onaylanır.
--  Yetki: sahip ve İK herkesi; şube müdürü kendi şubesini; bölüm şefi (bölüm atanmış şef) yalnız kendi ekibini düzeltir.
-- Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists att_days (
  employee_id uuid not null references employees (id) on delete cascade,
  work_date date not null,
  company_id uuid not null references companies (id) on delete cascade,
  shift_code text,
  shift_start time,
  shift_end time,
  status text not null,                                   -- WORKED | INCOMPLETE | ABSENT | WEEKLY_OFF | HOLIDAY | LEAVE | NO_SHIFT
  leave_code text,
  first_in timestamp,
  last_out timestamp,
  worked_min int not null default 0,
  late_min int not null default 0,
  early_min int not null default 0,
  overtime_min int not null default 0,
  overtime_rate numeric(4, 2) not null default 1.5,
  punch_count int not null default 0,
  issues text[] not null default '{}',
  state text not null default 'ok' check (state in ('ok', 'open', 'fixed', 'accepted')),
  accepted_issues text[] not null default '{}',
  resolution text,
  resolved_by uuid references auth.users (id),
  resolved_at timestamptz,
  computed_at timestamptz not null default now(),
  primary key (employee_id, work_date)
);
create index if not exists att_days_company_date_idx on att_days (company_id, work_date);
create index if not exists att_days_open_idx on att_days (company_id, work_date) where state = 'open';

create table if not exists att_corrections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  work_date date not null,
  action text not null check (action in ('forgot_card', 'shift_fill', 'overtime', 'leave', 'absent', 'accept', 'shift_change', 'reopen')),
  status text not null default 'applied' check (status in ('applied', 'pending')),
  over_limit boolean not null default false,
  detail jsonb not null default '{}',
  reason text check (reason is null or length(reason) <= 500),
  issues_before text[] not null default '{}',
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists att_corrections_emp_idx on att_corrections (employee_id, work_date desc);
create index if not exists att_corrections_company_idx on att_corrections (company_id, created_at desc);

create table if not exists att_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  forgot_free int not null default 2 check (forgot_free between 0 and 31),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);

create table if not exists att_months (
  company_id uuid not null references companies (id) on delete cascade,
  period char(7) not null,
  closed_at timestamptz not null default now(),
  closed_by uuid references auth.users (id) default auth.uid(),
  primary key (company_id, period)
);

-- ---------------------------------------------------------------------
-- Yetki
-- ---------------------------------------------------------------------
create or replace function att_can_view() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role in ('owner', 'hr', 'accountant', 'branch_manager'));
$$;

-- Sahip / İK herkesi; şube müdürü ve bölüm şefi görebildiği (şube / bölüm) personeli düzeltir
create or replace function att_can_fix(p_employee uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from employees e join memberships m on m.company_id = e.company_id and m.user_id = auth.uid()
     where e.id = p_employee
       and (m.role in ('owner', 'hr') or (m.role = 'branch_manager' and can_see_employee(e.id)))
  );
$$;

-- Bölüm şefi = bölüm atanmış şube / bölüm şefi; aylık hakkı aşan kart unuttu onaya gider
create or replace function att_is_chief() returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
     where m.user_id = auth.uid() and m.role = 'branch_manager'
       and exists (select 1 from membership_departments d where d.user_id = m.user_id and d.company_id = m.company_id)
  );
$$;

create or replace function att_month_closed(p_company uuid, p_date date) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from att_months where company_id = p_company and period = to_char(p_date, 'YYYY-MM'));
$$;

-- Bu ay kullanılan kart unuttu hakkı (kontrol merkezi + onaylanan personel bildirimi)
create or replace function att_forgot_used(p_employee uuid, p_date date) returns int language sql stable security definer set search_path = public as $$
  select (select count(*) from att_corrections c where c.employee_id = p_employee and c.action = 'forgot_card' and c.status = 'applied'
            and date_trunc('month', c.work_date) = date_trunc('month', p_date))::int
       + (select count(*) from punch_requests r where r.employee_id = p_employee and r.status = 'approved'
            and date_trunc('month', r.on_date) = date_trunc('month', p_date))::int;
$$;

create or replace function att_forgot_free(p_company uuid) returns int language sql stable security definer set search_path = public as $$
  select coalesce((select forgot_free from att_settings where company_id = p_company), 2);
$$;

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table att_days enable row level security;
alter table att_corrections enable row level security;
alter table att_settings enable row level security;
alter table att_months enable row level security;
drop policy if exists att_days_read on att_days;
drop policy if exists att_corr_read on att_corrections;
drop policy if exists att_settings_read on att_settings;
drop policy if exists att_months_read on att_months;
create policy att_days_read on att_days for select to authenticated using ((select can_see_employee(employee_id)));
create policy att_corr_read on att_corrections for select to authenticated using ((select can_see_employee(employee_id)));
create policy att_settings_read on att_settings for select to authenticated using (company_id = (select lab_company()));
create policy att_months_read on att_months for select to authenticated using (company_id = (select lab_company()));
revoke all on att_days, att_corrections, att_settings, att_months from anon;
grant select on att_days, att_corrections, att_settings, att_months to authenticated;

-- ---------------------------------------------------------------------
-- Günlük kayıtları yaz (uygulama hesaplar, burada durum birleştirilir)
--  p_rows: [{employee_id, work_date, shift_code, shift_start, shift_end, status, leave_code, first_in, last_out,
--            worked_min, late_min, early_min, overtime_min, overtime_rate, punch_count, issues[]}]
--  Kapalı ayın günleri yazılmaz. Fazla mesai kaydı açılmış günde OVERTIME hatası kalkar.
-- ---------------------------------------------------------------------
create or replace function att_days_sync(p_company uuid, p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare r jsonb; v_iss text[]; o att_days; v_state text; n int := 0; v_emp uuid; v_date date;
begin
  if auth.uid() is not null and not att_can_view() then raise exception 'not_allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    v_emp := (r->>'employee_id')::uuid; v_date := (r->>'work_date')::date;
    if att_month_closed(p_company, v_date) then continue; end if;
    select coalesce(array_agg(x), '{}') into v_iss from jsonb_array_elements_text(coalesce(r->'issues', '[]')) x;
    if 'OVERTIME' = any (v_iss) and exists (select 1 from overtime_records t where t.employee_id = v_emp and t.work_date = v_date) then
      v_iss := array_remove(v_iss, 'OVERTIME');
    end if;
    select * into o from att_days where employee_id = v_emp and work_date = v_date;
    if cardinality(v_iss) = 0 then
      v_state := case when o.state in ('fixed', 'accepted') then o.state else 'ok' end;
    elsif o.state is not null and v_iss <@ o.accepted_issues then
      v_state := 'accepted';
    else
      v_state := 'open';
    end if;
    insert into att_days (employee_id, work_date, company_id, shift_code, shift_start, shift_end, status, leave_code, first_in, last_out,
                          worked_min, late_min, early_min, overtime_min, overtime_rate, punch_count, issues, state, computed_at)
    values (v_emp, v_date, p_company, nullif(r->>'shift_code', ''), nullif(r->>'shift_start', '')::time, nullif(r->>'shift_end', '')::time,
            r->>'status', nullif(r->>'leave_code', ''), nullif(r->>'first_in', '')::timestamp, nullif(r->>'last_out', '')::timestamp,
            coalesce((r->>'worked_min')::int, 0), coalesce((r->>'late_min')::int, 0), coalesce((r->>'early_min')::int, 0),
            coalesce((r->>'overtime_min')::int, 0), coalesce((r->>'overtime_rate')::numeric, 1.5), coalesce((r->>'punch_count')::int, 0), v_iss, v_state, now())
    on conflict (employee_id, work_date) do update set
      shift_code = excluded.shift_code, shift_start = excluded.shift_start, shift_end = excluded.shift_end, status = excluded.status,
      leave_code = excluded.leave_code, first_in = excluded.first_in, last_out = excluded.last_out, worked_min = excluded.worked_min,
      late_min = excluded.late_min, early_min = excluded.early_min, overtime_min = excluded.overtime_min, overtime_rate = excluded.overtime_rate,
      punch_count = excluded.punch_count, issues = excluded.issues, state = excluded.state, computed_at = now();
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function att_days_sync(uuid, jsonb) from public, anon;
grant execute on function att_days_sync(uuid, jsonb) to authenticated;

-- Düzeltme kaydı + günün durumunu işaretle (fixed / accepted)
create or replace function att_log(p_employee uuid, p_date date, p_action text, p_detail jsonb, p_reason text,
                                   p_status text default 'applied', p_over_limit boolean default false, p_mark text default 'fixed') returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid; v_id uuid; v_iss text[];
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  select company_id into c from employees where id = p_employee;
  if att_month_closed(c, p_date) then raise exception 'period_closed'; end if;
  select issues into v_iss from att_days where employee_id = p_employee and work_date = p_date;
  insert into att_corrections (company_id, employee_id, work_date, action, status, over_limit, detail, reason, issues_before)
  values (c, p_employee, p_date, p_action, coalesce(p_status, 'applied'), coalesce(p_over_limit, false), coalesce(p_detail, '{}'), nullif(left(trim(coalesce(p_reason, '')), 500), ''), coalesce(v_iss, '{}'))
  returning id into v_id;
  if p_status = 'applied' and p_mark in ('fixed', 'accepted') then
    update att_days set state = p_mark, accepted_issues = case when p_mark = 'accepted' then issues else accepted_issues end,
           resolution = p_action, resolved_by = auth.uid(), resolved_at = now()
     where employee_id = p_employee and work_date = p_date;
  elsif p_mark = 'reopen' then
    update att_days set state = case when cardinality(issues) > 0 then 'open' else 'ok' end, accepted_issues = '{}', resolution = null, resolved_by = null, resolved_at = null
     where employee_id = p_employee and work_date = p_date;
  end if;
  return v_id;
end $$;
revoke execute on function att_log(uuid, date, text, jsonb, text, text, boolean, text) from public, anon;
grant execute on function att_log(uuid, date, text, jsonb, text, text, boolean, text) to authenticated;

-- Kart unuttu: hak içindeyse (ya da yapan şef değilse) okutma yazılır; şef hakkı aşarsa onaya gider
create or replace function att_forgot_card(p_employee uuid, p_date date, p_items jsonb, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare e employees; it jsonb; v_used int; v_free int; v_over boolean; v_res text;
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  select * into e from employees where id = p_employee;
  if att_month_closed(e.company_id, p_date) then raise exception 'period_closed'; end if;
  v_used := att_forgot_used(p_employee, p_date);
  v_free := att_forgot_free(e.company_id);
  v_over := v_used >= v_free;
  if v_over and att_is_chief() then
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
      insert into punch_requests (company_id, employee_id, on_date, direction, at_time, note)
      values (e.company_id, e.id, p_date, (it->>'direction')::punch_direction, (it->>'time')::time,
              'Kontrol merkezi (aylık hak aşıldı): ' || left(trim(p_reason), 400));
    end loop;
    perform att_log(p_employee, p_date, 'forgot_card', jsonb_build_object('items', p_items, 'used', v_used, 'free', v_free), p_reason, 'pending', true, 'none');
    v_res := 'pending';
  else
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
      insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, reason, created_by)
      values (e.company_id, e.branch_id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, 'KONTROL', (it->>'direction')::punch_direction,
              (p_date + (it->>'time')::time + case when (it->>'next_day')::boolean then interval '1 day' else interval '0' end)::timestamp,
              'MANUAL', 'Kart unuttu: ' || left(trim(p_reason), 400), auth.uid())
      on conflict do nothing;
    end loop;
    perform att_log(p_employee, p_date, 'forgot_card', jsonb_build_object('items', p_items, 'used', v_used + 1, 'free', v_free), p_reason, 'applied', v_over, 'fixed');
    v_res := case when v_over then 'applied_over' else 'applied' end;
  end if;
  return v_res;
end $$;
revoke execute on function att_forgot_card(uuid, date, jsonb, text) from public, anon;
grant execute on function att_forgot_card(uuid, date, jsonb, text) to authenticated;

-- Vardiyasına göre işle: eksik giriş / çıkışı vardiya saatlerinden yazar (hak sayılmaz)
create or replace function att_shift_fill(p_employee uuid, p_date date, p_items jsonb, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e employees; it jsonb;
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  select * into e from employees where id = p_employee;
  if att_month_closed(e.company_id, p_date) then raise exception 'period_closed'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
    insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, reason, created_by)
    values (e.company_id, e.branch_id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, 'KONTROL', (it->>'direction')::punch_direction,
            (p_date + (it->>'time')::time + case when (it->>'next_day')::boolean then interval '1 day' else interval '0' end)::timestamp,
            'MANUAL', 'Vardiyasına göre işlendi: ' || left(trim(p_reason), 400), auth.uid())
    on conflict do nothing;
  end loop;
  perform att_log(p_employee, p_date, 'shift_fill', jsonb_build_object('items', p_items), p_reason, 'applied', false, 'fixed');
end $$;
revoke execute on function att_shift_fill(uuid, date, jsonb, text) from public, anon;
grant execute on function att_shift_fill(uuid, date, jsonb, text) to authenticated;

-- Mesai işle: fazla mesai kaydı onaya gönderilir (Fazla mesai ekranında onaylanır)
create or replace function att_overtime(p_employee uuid, p_date date, p_minutes int, p_rate numeric, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e employees;
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  if coalesce(p_minutes, 0) <= 0 then raise exception 'no_overtime'; end if;
  select * into e from employees where id = p_employee;
  if att_month_closed(e.company_id, p_date) then raise exception 'period_closed'; end if;
  if exists (select 1 from overtime_records where employee_id = p_employee and work_date = p_date and status = 'approved') then raise exception 'overtime_exists'; end if;
  insert into overtime_records (company_id, employee_id, work_date, period, minutes, rate, source, status, note)
  values (e.company_id, e.id, p_date, to_char(p_date, 'YYYY-MM'), p_minutes, coalesce(p_rate, 1.5), 'MANUAL', 'pending',
          'Puantaj kontrol merkezi' || coalesce(': ' || nullif(trim(p_reason), ''), ''))
  on conflict (employee_id, work_date) do update set minutes = excluded.minutes, rate = excluded.rate, status = 'pending', note = excluded.note, decided_by = null, decided_at = null;
  perform att_log(p_employee, p_date, 'overtime', jsonb_build_object('minutes', p_minutes, 'rate', p_rate), p_reason, 'applied', false, 'fixed');
  perform deliver(e.company_id, managers_for_employee(e.id, array['owner', 'hr']::app_role[]), 'Fazla mesai onayı bekliyor',
                  e.first_name || ' ' || e.last_name || ' · ' || to_char(p_date, 'DD.MM.YYYY') || ' · ' || (p_minutes / 60) || ' sa ' || (p_minutes % 60) || ' dk', '/fazla-mesai');
end $$;
revoke execute on function att_overtime(uuid, date, int, numeric, text) from public, anon;
grant execute on function att_overtime(uuid, date, int, numeric, text) to authenticated;

-- İzinli / raporlu say: tek günlük izin kaydı (sahip / İK / şube müdürü onaylı, bölüm şefi onaya)
create or replace function att_leave(p_employee uuid, p_date date, p_type uuid, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare e employees; v_status text;
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  select * into e from employees where id = p_employee;
  if att_month_closed(e.company_id, p_date) then raise exception 'period_closed'; end if;
  if exists (select 1 from leave_requests where employee_id = p_employee and status in ('pending', 'approved') and start_date <= p_date and end_date >= p_date and hours is null) then
    raise exception 'leave_exists';
  end if;
  v_status := case when att_is_chief() then 'pending' else 'approved' end;
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status, note, decided_by, decided_at)
  values (e.company_id, e.id, p_type, p_date, p_date, 1, v_status::leave_status, 'Puantaj kontrol merkezi' || coalesce(': ' || nullif(trim(p_reason), ''), ''),
          case when v_status = 'approved' then auth.uid() end, case when v_status = 'approved' then now() end);
  perform att_log(p_employee, p_date, 'leave', jsonb_build_object('leave_type_id', p_type, 'status', v_status), p_reason,
                  case when v_status = 'approved' then 'applied' else 'pending' end, false, case when v_status = 'approved' then 'fixed' else 'none' end);
  return v_status;
end $$;
revoke execute on function att_leave(uuid, date, uuid, text) from public, anon;
grant execute on function att_leave(uuid, date, uuid, text) to authenticated;

-- Vardiya değiştir / hafta tatili yap (o güne özel atama)
create or replace function att_shift_change(p_employee uuid, p_date date, p_shift uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare e employees;
begin
  if not att_can_fix(p_employee) then raise exception 'not_allowed'; end if;
  select * into e from employees where id = p_employee;
  if att_month_closed(e.company_id, p_date) then raise exception 'period_closed'; end if;
  insert into shift_assignments (company_id, employee_id, shift_id, work_date, day_type)
  values (e.company_id, p_employee, p_shift, p_date, case when p_shift is null then 'WEEKLY_OFF' else 'WORK' end)
  on conflict (employee_id, work_date) do update set shift_id = excluded.shift_id, day_type = excluded.day_type;
  perform att_log(p_employee, p_date, 'shift_change', jsonb_build_object('shift_id', p_shift), p_reason, 'applied', false, 'fixed');
end $$;
revoke execute on function att_shift_change(uuid, date, uuid, text) from public, anon;
grant execute on function att_shift_change(uuid, date, uuid, text) to authenticated;

-- Ay kapanışı / açılışı (sahip ve İK)
create or replace function att_month_close(p_period text) returns void
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); n int;
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = c and role in ('owner', 'hr')) then raise exception 'not_allowed'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  select count(*) into n from att_days where company_id = c and to_char(work_date, 'YYYY-MM') = p_period and state = 'open';
  if n > 0 then raise exception 'open_days:%', n; end if;
  insert into att_months (company_id, period) values (c, p_period) on conflict do nothing;
end $$;
create or replace function att_month_reopen(p_period text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company() and role = 'owner') then raise exception 'not_allowed'; end if;
  delete from att_months where company_id = lab_company() and period = p_period;
end $$;
revoke execute on function att_month_close(text) from public, anon;
revoke execute on function att_month_reopen(text) from public, anon;
grant execute on function att_month_close(text) to authenticated;
grant execute on function att_month_reopen(text) to authenticated;

create or replace function att_settings_save(p_forgot_free int) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company() and role in ('owner', 'hr')) then raise exception 'not_allowed'; end if;
  insert into att_settings (company_id, forgot_free) values (lab_company(), least(greatest(coalesce(p_forgot_free, 2), 0), 31))
  on conflict (company_id) do update set forgot_free = excluded.forgot_free, updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function att_settings_save(int) from public, anon;
grant execute on function att_settings_save(int) to authenticated;

-- ---------------------------------------------------------------------
-- Kapalı ay koruması: elle okutma, fazla mesai, izin ve vardiya ataması değişmez
--  (cihazdan gelen okutmalar engellenmez: geç aktarılan cihaz verisi aktarımı bozmasın)
-- ---------------------------------------------------------------------
create or replace function att_guard_closed() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; c uuid; d1 date; d2 date;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  if tg_table_name = 'attendance_punches' then
    if r.source <> 'MANUAL' then return case when tg_op = 'DELETE' then old else new end; end if;
    c := r.company_id; d1 := r.punched_at::date; d2 := d1;
  elsif tg_table_name = 'overtime_records' then
    c := r.company_id; d1 := r.work_date; d2 := d1;
  elsif tg_table_name = 'leave_requests' then
    c := r.company_id; d1 := r.start_date; d2 := r.end_date;
  elsif tg_table_name = 'shift_assignments' then
    c := r.company_id; d1 := r.work_date; d2 := d1;
  end if;
  if c is not null and (att_month_closed(c, d1) or att_month_closed(c, d2)) then
    raise exception 'Bu ayın puantajı kapatıldı; değişiklik için önce ayı açın (period_closed)';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
drop trigger if exists att_guard_punches on attendance_punches;
create trigger att_guard_punches before insert or update or delete on attendance_punches for each row execute function att_guard_closed();
drop trigger if exists att_guard_overtime on overtime_records;
create trigger att_guard_overtime before insert or update or delete on overtime_records for each row execute function att_guard_closed();
drop trigger if exists att_guard_leave on leave_requests;
create trigger att_guard_leave before insert or update or delete on leave_requests for each row execute function att_guard_closed();
drop trigger if exists att_guard_shift on shift_assignments;
create trigger att_guard_shift before insert or update or delete on shift_assignments for each row execute function att_guard_closed();

-- ---------------------------------------------------------------------
-- Personelin "okutmayı unuttum" bildirimi: aylık hak içindeyse otomatik onay
-- ---------------------------------------------------------------------
create or replace function att_punch_request_auto() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees;
begin
  if new.status <> 'pending' or coalesce(new.note, '') like 'Kontrol merkezi%' then return new; end if;
  if att_month_closed(new.company_id, new.on_date) then return new; end if;
  if att_forgot_used(new.employee_id, new.on_date) >= att_forgot_free(new.company_id) then return new; end if;
  select * into e from employees where id = new.employee_id;
  insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, reason)
  values (new.company_id, e.branch_id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, 'TALEP', new.direction, (new.on_date + new.at_time)::timestamp, 'MANUAL',
          'Personel bildirimi (aylık hak içinde otomatik onay)' || coalesce(': ' || new.note, ''))
  on conflict do nothing;
  update punch_requests set status = 'approved', decision_note = 'Otomatik onay: aylık kart unuttu hakkı içinde', decided_at = now() where id = new.id;
  return new;
end $$;
drop trigger if exists att_punch_request_auto on punch_requests;
create trigger att_punch_request_auto after insert on punch_requests for each row execute function att_punch_request_auto();

drop trigger if exists audit_punch_requests on punch_requests;
create trigger audit_punch_requests after insert or update or delete on punch_requests for each row execute function audit_trigger();
drop trigger if exists audit_att_corrections on att_corrections;
create trigger audit_att_corrections after insert or update or delete on att_corrections for each row execute function audit_trigger();

insert into att_settings (company_id) select lab_company() where lab_company() is not null on conflict do nothing;

notify pgrst, 'reload schema';
