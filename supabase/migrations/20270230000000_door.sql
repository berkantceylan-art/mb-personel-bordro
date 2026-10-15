-- Kapı rölesi: QR / konumla girişte kapıyı otomatik açma (Shelly Wi-Fi röle, Erom panelinin çıkış butonu uçlarına paralel)
--  * Şubeye kapı ayarları (röle cihaz kimliği, açık kalma süresi, konumla açma mesafesi)
--  * Kiosk QR'ına 20 saniyede bir değişen kapı kodu eklenir (fotoğrafı paylaşılan QR kapıyı açmaz)
--  * Her açılış door_events'e yazılır; röleyi sunucu tetikler (door_claim → Shelly → door_result)
-- Önce 20261031000000_mobile_self_service.sql. Tekrar çalıştırılabilir.

alter table branches add column if not exists door_enabled boolean not null default false;
alter table branches add column if not exists door_device_id text check (door_device_id is null or door_device_id ~ '^[A-Za-z0-9_-]{4,64}$');
alter table branches add column if not exists door_channel int not null default 0 check (door_channel between 0 and 3);
alter table branches add column if not exists door_pulse_s int not null default 1 check (door_pulse_s between 1 and 10);
-- Konumla kapı açma: kişi bu mesafeden yakınsa ve konum doğruluğu bu değerden iyiyse (0 = konumla açma kapalı, sadece QR)
alter table branches add column if not exists door_gps_m int not null default 30 check (door_gps_m between 0 and 200);

create table if not exists door_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  branch_id uuid not null references branches (id) on delete cascade,
  employee_id uuid references employees (id) on delete set null,
  user_id uuid,
  source text not null check (source in ('QR', 'GPS', 'MANUAL')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'ok', 'error')),
  message text check (message is null or length(message) <= 300),
  distance_m int,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists door_events_branch_idx on door_events (branch_id, created_at desc);
alter table door_events enable row level security;
revoke all on door_events from anon, authenticated;

-- 20 saniyelik kapı kodu (kiosk ekranındaki QR'da)
create or replace function branch_door_token(p_branch uuid, p_slots_ago int default 0)
returns text language sql stable security definer set search_path = public as $$
  select upper(left(md5(b.qr_secret || ':door:' || (floor(extract(epoch from now()) / 20)::bigint - p_slots_ago)::text), 8))
  from branches b where b.id = p_branch;
$$;
revoke execute on function branch_door_token(uuid, int) from public, anon, authenticated;

create or replace function kiosk_qr(p_branch uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare b branches;
begin
  select * into b from branches where id = p_branch;
  if b.id is null or not has_role(b.company_id, array['owner', 'hr', 'branch_manager']::app_role[]) then raise exception 'Yetki yok'; end if;
  return json_build_object('branch', b.name, 'door', b.door_enabled,
    'token', 'MBQR:' || b.id || ':' || branch_qr_token(b.id, 0) || case when b.door_enabled then ':' || branch_door_token(b.id, 0) else '' end);
end $$;

create or replace function mobile_punch(p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null, p_qr text default null, p_direction text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  e employees; b branches; dist double precision; dir punch_direction; last attendance_punches;
  local_now timestamp := (now() at time zone 'Europe/Istanbul')::timestamp(0);
  qr_branch uuid; qr_code text; door_code text; ok boolean := false;
  v_door uuid; v_note text; v_src text;
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select * into b from branches where id = e.branch_id;
  if not b.mobile_punch_enabled then raise exception 'Bu şubede mobil giriş kapalı'; end if;

  if p_qr is not null and p_qr like 'MBQR:%' then
    qr_branch := split_part(p_qr, ':', 2)::uuid;
    qr_code := split_part(p_qr, ':', 3);
    door_code := nullif(split_part(p_qr, ':', 4), '');
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

  -- Kapı: sadece girişte; QR'da 20 sn'lik kapı kodu (son ~1 dk), konumda kapıya yakınlık ve iyi konum doğruluğu
  if dir = 'IN' and b.door_enabled and b.door_device_id is not null then
    if p_qr is not null then
      if door_code is not null and door_code in (branch_door_token(b.id, 0), branch_door_token(b.id, 1), branch_door_token(b.id, 2)) then v_src := 'QR';
      else v_note := 'Kapı açılmadı: QR kodu eski. Kapıdaki ekranda görünen güncel kodu okutun.'; end if;
    elsif b.door_gps_m = 0 then
      v_note := 'Kapı konumla açılmıyor; kapıdaki QR kodu okutun.';
    elsif dist <= b.door_gps_m and coalesce(p_accuracy, 999) <= greatest(b.door_gps_m, 15) then
      v_src := 'GPS';
    else
      v_note := format('Kapı açılmadı: kapıya %s m''den yakın olmalısınız (şu an ~%s m, konum doğruluğu ±%s m). Kapıdaki QR kodu okutun.',
                       b.door_gps_m, round(dist), coalesce(round(p_accuracy)::text, '?'));
    end if;
    if v_src is not null then
      insert into door_events (company_id, branch_id, employee_id, user_id, source, distance_m)
      values (e.company_id, b.id, e.id, auth.uid(), v_src, round(dist)) returning id into v_door;
    end if;
  end if;

  return json_build_object('direction', dir, 'at', local_now, 'distance', round(coalesce(dist, 0)), 'branch', b.name, 'door', v_door, 'door_note', v_note);
end $$;

-- Güvenlik / yönetici: kapıyı elle aç
create or replace function door_manual(p_branch uuid, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare b branches; v uuid;
begin
  select * into b from branches where id = p_branch and company_id = lab_company();
  if b.id is null then raise exception 'Şube bulunamadı'; end if;
  if not vis_is_guard() then raise exception 'Kapıyı açma yetkiniz yok'; end if;
  if not b.door_enabled or b.door_device_id is null then raise exception 'Bu şubede kapı rölesi tanımlı değil (Yönetim › Şirket › Şube)'; end if;
  insert into door_events (company_id, branch_id, user_id, source, message)
  values (b.company_id, b.id, auth.uid(), 'MANUAL', left(nullif(trim(p_note), ''), 300)) returning id into v;
  return v;
end $$;

-- Sunucu tetiklemeden önce: olay bu kullanıcıya ait, bekliyor ve taze olmalı (aynı olay iki kez açmaz)
create or replace function door_claim(p_id uuid) returns json
language plpgsql security definer set search_path = public as $$
declare d door_events; b branches;
begin
  update door_events set status = 'sent', sent_at = now()
  where id = p_id and user_id = auth.uid() and status = 'pending' and created_at > now() - interval '60 seconds'
  returning * into d;
  if d.id is null then raise exception 'Kapı isteği geçersiz ya da süresi doldu'; end if;
  select * into b from branches where id = d.branch_id;
  if not b.door_enabled or b.door_device_id is null then
    update door_events set status = 'error', message = 'Kapı rölesi kapalı' where id = d.id;
    raise exception 'Bu şubede kapı rölesi kapalı';
  end if;
  return json_build_object('device', b.door_device_id, 'channel', b.door_channel, 'pulse', b.door_pulse_s, 'branch', b.name);
end $$;

create or replace function door_result(p_id uuid, p_ok boolean, p_message text default null) returns void
language sql security definer set search_path = public as $$
  update door_events set status = case when p_ok then 'ok' else 'error' end,
         message = coalesce(left(p_message, 300), message)
  where id = p_id and user_id = auth.uid() and status = 'sent';
$$;

-- Son kapı açılışları (yönetici / güvenlik)
create or replace function door_log(p_branch uuid default null, p_limit int default 50) returns json
language sql stable security definer set search_path = public as $$
  select case when vis_is_guard() then coalesce(json_agg(x order by x.at desc), '[]'::json) end from (
    select d.id, d.created_at at time zone 'Europe/Istanbul' as at, d.source, d.status, d.message, d.distance_m,
           b.name as branch, coalesce(nullif(trim(coalesce(em.first_name, '') || ' ' || coalesce(em.last_name, '')), ''), 'Yönetici / güvenlik') as who
    from door_events d join branches b on b.id = d.branch_id left join employees em on em.id = d.employee_id
    where d.company_id = lab_company() and (p_branch is null or d.branch_id = p_branch)
    order by d.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 300)
  ) x
$$;

-- Güvenlik panelindeki "Kapıyı aç" düğmeleri için kapısı tanımlı şubeler
create or replace function door_branches() returns json
language sql stable security definer set search_path = public as $$
  select case when vis_is_guard() then coalesce(json_agg(json_build_object('id', b.id, 'name', b.name) order by b.name), '[]'::json) end
  from branches b where b.company_id = lab_company() and b.door_enabled and b.door_device_id is not null
$$;
revoke execute on function door_branches() from public, anon;
grant execute on function door_branches() to authenticated;

revoke execute on function door_manual(uuid, text) from public, anon;
revoke execute on function door_claim(uuid) from public, anon;
revoke execute on function door_result(uuid, boolean, text) from public, anon;
revoke execute on function door_log(uuid, int) from public, anon;
grant execute on function door_manual(uuid, text) to authenticated;
grant execute on function door_claim(uuid) to authenticated;
grant execute on function door_result(uuid, boolean, text) to authenticated;
grant execute on function door_log(uuid, int) to authenticated;

notify pgrst, 'reload schema';
