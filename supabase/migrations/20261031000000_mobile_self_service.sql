-- Mobil self-servis: yönlü giriş/çıkış, rapor bildirimi (belgeli), saatlik izin, imzalı bordro indirme

-- 1) Giriş/çıkış: personel yönü kendisi seçebilir (boşsa son okutmaya göre otomatik)
drop function if exists mobile_punch(double precision, double precision, double precision, text);
create or replace function mobile_punch(p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null, p_qr text default null, p_direction text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  e employees; b branches; dist double precision; dir punch_direction; last attendance_punches;
  local_now timestamp := (now() at time zone 'Europe/Istanbul')::timestamp(0);
  qr_branch uuid; qr_code text; ok boolean := false;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select * into b from branches where id = e.branch_id;
  if not b.mobile_punch_enabled then raise exception 'Bu şubede mobil giriş kapalı'; end if;

  if p_qr is not null and p_qr like 'MBQR:%' then
    qr_branch := split_part(p_qr, ':', 2)::uuid;
    qr_code := split_part(p_qr, ':', 3);
    select * into b from branches where id = qr_branch and company_id = e.company_id;
    if b.id is null then raise exception 'QR kodu bu şirkete ait değil'; end if;
    ok := qr_code in (branch_qr_token(b.id, 0), branch_qr_token(b.id, 1));
    if not ok then raise exception 'QR kodunun süresi dolmuş; ekrandaki güncel kodu okutun'; end if;
  else
    if b.lat is null or b.lng is null then raise exception 'Şube konumu tanımlı değil; QR kod ile okutun'; end if;
    if p_lat is null or p_lng is null then raise exception 'Konum alınamadı'; end if;
    dist := distance_m(p_lat, p_lng, b.lat, b.lng);
    if dist > b.radius_m + least(coalesce(p_accuracy, 0), 100) then
      raise exception 'İşyeri konumunda değilsiniz (yaklaşık % m uzakta)', round(dist);
    end if;
  end if;

  select * into last from attendance_punches
  where employee_id = e.id and punched_at > local_now - interval '18 hours'
  order by punched_at desc limit 1;
  if last.id is not null and last.punched_at > local_now - interval '1 minute' then
    raise exception 'Az önce okutma yaptınız';
  end if;
  dir := case when p_direction in ('IN', 'OUT') then p_direction::punch_direction
              when last.direction = 'IN' then 'OUT' else 'IN' end;

  insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, lat, lng, accuracy_m, distance_m, created_by)
  values (e.company_id, b.id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, case when p_qr is not null then 'QR' else 'GPS' end,
          dir, local_now, 'MOBILE', p_lat, p_lng, p_accuracy, dist, auth.uid());
  return json_build_object('direction', dir, 'at', local_now, 'distance', round(coalesce(dist, 0)), 'branch', b.name);
end $$;

-- 2) Saatlik izin: izin türü ve saat alanları
alter table leave_requests
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists hours numeric(4,2);

insert into leave_types (company_id, code, name, paid, deducts_annual, is_sick_leave, color, sort_order)
select null, 'SAATLIK', 'Saatlik izin (ücretli)', true, false, false, '#E7F1FB', 25
where not exists (select 1 from leave_types where company_id is null and code = 'SAATLIK');

-- 3) Personelin kendi talebi: saatlik izin ve rapor belgesi desteği
drop function if exists request_leave_self(uuid, date, date, text, boolean);
create or replace function request_leave_self(p_type uuid, p_start date, p_end date default null, p_note text default null, p_half_day boolean default false,
                                               p_start_time time default null, p_end_time time default null, p_document text default null)
returns json language plpgsql security definer set search_path = public as $$
declare e employees; t leave_types; n numeric; v_end date := coalesce(p_end, p_start); v_hours numeric;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select * into t from leave_types where id = p_type and (company_id is null or company_id = e.company_id);
  if t.id is null then raise exception 'İzin türü bulunamadı'; end if;
  if v_end < p_start then raise exception 'Bitiş tarihi başlangıçtan önce olamaz'; end if;
  if v_end - p_start > 120 then raise exception 'Tek talepte en fazla 120 gün girilebilir'; end if;
  if t.code = 'SAATLIK' then
    if p_start_time is null or p_end_time is null or p_end_time <= p_start_time then raise exception 'Saatlik izin için başlangıç ve bitiş saati girin'; end if;
    v_end := p_start;
    v_hours := round(extract(epoch from (p_end_time - p_start_time)) / 3600.0, 2);
    if v_hours > 7.5 then raise exception 'Saatlik izin en fazla 7,5 saat olabilir; daha uzunu için günlük izin isteyin'; end if;
    n := greatest(0.1, round(v_hours / 7.5, 1));
  elsif t.is_sick_leave or t.code = 'DOGUM' then
    n := v_end - p_start + 1;
  else
    select count(*) into n from generate_series(p_start, v_end, interval '1 day') g(day)
    where extract(isodow from g.day) <> 7
      and not exists (select 1 from public_holidays h where h.date = g.day::date and not h.half_day);
    if p_half_day and n = 1 then n := 0.5; end if;
  end if;
  if n = 0 then raise exception 'Seçilen günler tatil'; end if;
  if p_document is not null and p_document not like e.company_id || '/employees/' || e.id || '/%' then raise exception 'Belge yolu geçersiz'; end if;
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, half_day, note, status, start_time, end_time, hours, document_path)
  values (e.company_id, e.id, t.id, p_start, v_end, n, n = 0.5, nullif(trim(p_note), ''), 'pending', p_start_time, p_end_time, v_hours, p_document);
  return json_build_object('days', n, 'hours', v_hours);
end $$;

-- 4) İmzalı bordro: belge türü ve dönem alanı (personel kendi belgesini okur, İK yükler)
alter table employee_documents add column if not exists period char(7) check (period is null or period ~ '^\d{4}-(0[1-9]|1[0-2])$');
create index if not exists employee_documents_period_idx on employee_documents (employee_id, period);
insert into document_types (company_id, name, category, required, has_expiry, sort_order, description)
select null, 'İmzalı bordro', 'bordro', false, false, 300, 'Islak imzalı aylık bordro; personel mobilden indirir'
where not exists (select 1 from document_types where company_id is null and name = 'İmzalı bordro');
