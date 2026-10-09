-- Yıllık izin modülü (İş K. md. 53-61, Yıllık Ücretli İzin Yönetmeliği)
-- Şef → İK iki aşamalı onay, bölüm bazında eşzamanlı izin sınırı, yol izni, geri çağırma, vekil,
-- hak edişi öteleyen süreler, kıdem başlangıcı düzeltmesi, personel izin tercihi, toplu izin.

-- 1) Bölüm bazında aynı anda izinde olabilecek kişi sınırı
alter table departments
  add column if not exists leave_max_pct numeric(5,2) check (leave_max_pct is null or (leave_max_pct > 0 and leave_max_pct <= 100)),
  add column if not exists leave_max_people int check (leave_max_people is null or leave_max_people > 0);

-- 2) Kıdem başlangıcı (aynı işverenin başka işyerinde geçen süre vb.)
alter table employees add column if not exists leave_seniority_start date;

-- 3) Talep ayrıntıları
alter table leave_requests
  add column if not exists stage text check (stage in ('chief', 'hr')),
  add column if not exists chief_by uuid references auth.users(id),
  add column if not exists chief_at timestamptz,
  add column if not exists substitute_employee_id uuid references employees(id) on delete set null,
  add column if not exists travel_days int not null default 0 check (travel_days between 0 and 4),
  add column if not exists destination text,
  add column if not exists parent_id uuid references leave_requests(id) on delete cascade,
  add column if not exists recalled_at timestamptz,
  add column if not exists recall_note text,
  add column if not exists decision_note text,
  add column if not exists collective_id uuid;
create index if not exists leave_requests_parent_idx on leave_requests (parent_id);

-- Babalık izni adı (7578 s. Kanun ile 10 gün) — mevzuat SQL'i çalışmadıysa
update leave_types set name = 'Babalık izni (10 gün)' where code = 'BABALIK' and company_id is null and name <> 'Babalık izni (10 gün)';

-- 4) Hak edişe sayılmayan süreler (md. 55 dışında kalanlar; ör. uzun ücretsiz izin, askerlik). Ücretsiz izin talepleri ayrıca otomatik sayılır.
create table if not exists leave_service_gaps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text not null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table leave_service_gaps enable row level security;
drop policy if exists lsg_read on leave_service_gaps;
create policy lsg_read on leave_service_gaps for select using (can_see_employee(employee_id));
drop policy if exists lsg_write on leave_service_gaps;
create policy lsg_write on leave_service_gaps for all using (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'accountant', 'hr']::app_role[]));

-- 5) Toplu izin (Yönetmelik: işveren toplu izin uygulayabilir)
create table if not exists collective_leaves (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  start_date date not null,
  end_date date not null,
  department_ids uuid[],
  note text,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table collective_leaves enable row level security;
drop policy if exists cl_read on collective_leaves;
create policy cl_read on collective_leaves for select using (is_member(company_id));
drop policy if exists cl_write on collective_leaves;
create policy cl_write on collective_leaves for all using (has_role(company_id, array['owner', 'hr']::app_role[])) with check (has_role(company_id, array['owner', 'hr']::app_role[]));

-- 6) İzin planı: personel tercihi + İK onayı (leave_plans İş Kanunu SQL'inde oluşturuldu)
alter table leave_plans
  add column if not exists status text not null default 'onayli' check (status in ('tercih', 'onayli', 'reddedildi', 'talebe-donustu')),
  add column if not exists source text not null default 'hr' check (source in ('hr', 'employee'));

create or replace function submit_leave_preference(p_start date, p_end date, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare e employees; n numeric;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  if p_end < p_start then raise exception 'Bitiş başlangıçtan önce olamaz'; end if;
  if p_start < current_date then raise exception 'Geçmiş tarih seçilemez'; end if;
  select count(*) into n from generate_series(p_start, p_end, interval '1 day') g(day)
  where extract(isodow from g.day) <> 7 and not exists (select 1 from public_holidays h where h.date = g.day::date and not h.half_day);
  insert into leave_plans (company_id, employee_id, year, start_date, end_date, days, note, status, source)
  values (e.company_id, e.id, extract(year from p_start)::int, p_start, p_end, greatest(n, 1), nullif(trim(p_note), ''), 'tercih', 'employee');
  perform deliver(e.company_id, managers_for_employee(e.id), 'Yıllık izin tercihi', e.first_name || ' ' || e.last_name || ' · ' || to_char(p_start, 'DD.MM.YYYY') || ' – ' || to_char(p_end, 'DD.MM.YYYY'), '/yillik-izin?sekme=plan');
end $$;
grant execute on function submit_leave_preference(date, date, text) to authenticated;

-- 7) Personelin kendi talebi: yol izni, arife yarım gün
drop function if exists request_leave_self(uuid, date, date, text, boolean, time, time, text);
create or replace function request_leave_self(p_type uuid, p_start date, p_end date default null, p_note text default null, p_half_day boolean default false,
                                               p_start_time time default null, p_end_time time default null, p_document text default null,
                                               p_travel_days int default 0, p_destination text default null)
returns json language plpgsql security definer set search_path = public as $$
declare e employees; t leave_types; n numeric; v_end date := coalesce(p_end, p_start); v_hours numeric; v_id uuid;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select * into t from leave_types where id = p_type and (company_id is null or company_id = e.company_id);
  if t.id is null then raise exception 'İzin türü bulunamadı'; end if;
  if v_end < p_start then raise exception 'Bitiş tarihi başlangıçtan önce olamaz'; end if;
  if v_end - p_start > 120 then raise exception 'Tek talepte en fazla 120 gün girilebilir'; end if;
  if coalesce(p_travel_days, 0) not between 0 and 4 then raise exception 'Yol izni en fazla 4 gün olabilir'; end if;
  if coalesce(p_travel_days, 0) > 0 and t.code <> 'YILLIK' then raise exception 'Yol izni yalnız yıllık izinle birlikte istenebilir'; end if;
  if t.code = 'SAATLIK' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then raise exception 'Saatlik izin için başlangıç ve bitiş saati girin'; end if;
    v_end := p_start;
    v_hours := round(extract(epoch from (p_end_time - p_start_time)) / 3600.0, 2);
    if v_hours > 7.5 then raise exception 'Saatlik izin en fazla 7,5 saat olabilir; daha uzunu için günlük izin isteyin'; end if;
    n := greatest(0.1, round(v_hours / 7.5, 1));
  elsif t.is_sick_leave or t.code = 'DOGUM' then
    n := v_end - p_start + 1;
  else
    -- Pazar ve resmi tatil sayılmaz; arife (yarım gün tatil) yarım gün sayılır
    select coalesce(sum(case when exists (select 1 from public_holidays h where h.date = g.day::date and h.half_day) then 0.5 else 1 end), 0) into n
    from generate_series(p_start, v_end, interval '1 day') g(day)
    where extract(isodow from g.day) <> 7
      and not exists (select 1 from public_holidays h where h.date = g.day::date and not h.half_day);
    if p_half_day and n = 1 then n := 0.5; end if;
  end if;
  if n = 0 then raise exception 'Seçilen günler tatil'; end if;
  if p_document is not null and p_document not like e.company_id || '/employees/' || e.id || '/%' then raise exception 'Belge yolu geçersiz'; end if;
  if exists (select 1 from leave_requests r where r.employee_id = e.id and r.status in ('pending', 'approved') and r.start_date <= v_end and r.end_date >= p_start and r.hours is null and v_hours is null) then
    raise exception 'Bu tarihlerde başka bir izniniz var';
  end if;
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, half_day, note, status, start_time, end_time, hours, document_path, travel_days, destination)
  values (e.company_id, e.id, t.id, p_start, v_end, n, n = 0.5, nullif(trim(p_note), ''), 'pending', p_start_time, p_end_time, v_hours, p_document, coalesce(p_travel_days, 0), nullif(trim(p_destination), ''))
  returning id into v_id;
  return json_build_object('id', v_id, 'days', n, 'hours', v_hours);
end $$;
grant execute on function request_leave_self(uuid, date, date, text, boolean, time, time, text, int, text) to authenticated;

-- 8) İki aşamalı onay: talep şefe düşer; şef onaylayınca İK'ya geçer. Yalnız sahip / İK / muhasebe son onayı verebilir.
create or replace function trg_leave_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare chiefs uuid[];
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending' and new.stage is null then
      chiefs := managers_for_employee(new.employee_id, array[]::app_role[]);
      new.stage := case when coalesce(array_length(chiefs, 1), 0) > 0 and not (coalesce(new.created_by = any (chiefs), false))
                          and not (new.created_by is not null and exists (select 1 from memberships m where m.user_id = new.created_by and m.company_id = new.company_id and m.role in ('owner', 'hr', 'accountant')))
                     then 'chief' else 'hr' end;
    end if;
    return new;
  end if;
  -- Onaya geçiş: son onay yetkisi olmayan (şef) onaylarsa talep İK aşamasına geçer
  if old.status = 'pending' and new.status = 'approved' and auth.uid() is not null
     and not has_role(new.company_id, array['owner', 'hr', 'accountant']::app_role[]) then
    if old.stage = 'hr' then raise exception 'Bu talep İK onayında; şef onayı verildi'; end if;
    new.status := 'pending';
    new.stage := 'hr';
    new.chief_by := auth.uid();
    new.chief_at := now();
    new.decided_by := null;
    new.decided_at := null;
  elsif old.status = 'pending' and new.status = 'approved' then
    new.stage := 'hr';
  end if;
  return new;
end $$;
drop trigger if exists leave_stage on leave_requests;
create trigger leave_stage before insert or update on leave_requests for each row execute function trg_leave_stage();

-- Bildirimler: yeni talep şefe (yoksa İK'ya), şef onayı İK'ya, sonuç personele
create or replace function trg_leave_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; t text; hr uuid[]; info text;
begin
  select * into e from employees where id = new.employee_id;
  select name into t from leave_types where id = new.leave_type_id;
  info := e.first_name || ' ' || e.last_name || ' · ' || coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün';
  select coalesce(array_agg(user_id), '{}') into hr from memberships where company_id = new.company_id and role in ('owner', 'hr');
  if new.parent_id is not null then return new; end if;
  if tg_op = 'UPDATE' and old.recalled_at is null and new.recalled_at is not null and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id], 'İzinden geri çağrıldınız',
      'İşbaşı: ' || to_char(new.end_date + 1, 'DD.MM.YYYY') || coalesce(' · ' || new.recall_note, '') || ' · kalan gün bakiyenize iade edildi', '/benim/izin');
    return new;
  end if;
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform deliver(new.company_id, case when new.stage = 'chief' then managers_for_employee(new.employee_id, array[]::app_role[]) else hr end,
      case when new.stage = 'chief' then 'Yeni izin talebi (şef onayı)' else 'Yeni izin talebi' end, info, '/yillik-izin?sekme=onay');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'pending' and old.stage = 'chief' and new.stage = 'hr' then
    perform deliver(new.company_id, hr, 'Şef onayladı · İK onayı bekliyor', info, '/yillik-izin?sekme=onay');
    if e.user_id is not null then perform deliver(new.company_id, array[e.user_id], 'İzin talebiniz şef onayından geçti', coalesce(t, 'İzin') || ' · İK onayı bekleniyor', '/benim/izin'); end if;
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('approved', 'rejected', 'cancelled') and old.status in ('pending', 'approved') and e.user_id is not null then
    perform deliver(new.company_id, array[e.user_id],
      'İzin talebiniz ' || case new.status when 'approved' then 'onaylandı' when 'rejected' then 'reddedildi' else 'iptal edildi' end,
      coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün' || coalesce(' · ' || new.decision_note, ''), '/benim/izin');
  end if;
  return new;
end $$;

-- Yol izni: yıllık izin onaylanınca bitişinden sonraki iş günlerine ücretsiz "yol izni" kaydı açılır; iptalde silinir
create or replace function trg_leave_travel() returns trigger
language plpgsql security definer set search_path = public as $$
declare d date; left_days int; uid uuid;
begin
  if new.parent_id is not null then return new; end if;
  if new.status = 'approved' and old.status is distinct from 'approved' and new.travel_days > 0 then
    select id into uid from leave_types where company_id is null and code = 'UCRETSIZ';
    d := new.end_date; left_days := new.travel_days;
    while left_days > 0 loop
      d := d + 1;
      if extract(isodow from d) <> 7 and not exists (select 1 from public_holidays h where h.date = d and not h.half_day) then left_days := left_days - 1; end if;
    end loop;
    insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, status, note, parent_id, stage, decided_by, decided_at)
    values (new.company_id, new.employee_id, uid, new.end_date + 1, d, new.travel_days, 'approved', 'Yol izni (md. 56, ücretsiz)' || coalesce(' · ' || new.destination, ''), new.id, 'hr', new.decided_by, now());
  elsif new.status in ('cancelled', 'rejected') and old.status = 'approved' then
    delete from leave_requests where parent_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists leave_travel on leave_requests;
create trigger leave_travel after update on leave_requests for each row execute function trg_leave_travel();

-- 9) Personel kendi izin planını ve tercihlerini görür (lp_self İş Kanunu SQL'inde)
