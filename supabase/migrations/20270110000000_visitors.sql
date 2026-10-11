-- =====================================================================
-- ZİYARETÇİ + GÜVENLİK PANELİ
--  vis_guards : güvenlik görevlileri (güvenlik panelini kullanır, tüm ziyaretleri görür)
--  vis_visits : ziyaret (ZY-). Personel önceden davet eder (QR davetiye) ya da güvenlik hızlı kayıt yapar.
--               Durum: expected (bekleniyor) → in (içeride, kart verildi) → out (çıktı) | cancelled
--  vis_public(token) : davetiye sayfası (giriş gerektirmez) için yalnız gerekli bilgiler
-- Tekrar çalıştırılabilir.
-- =====================================================================
create table if not exists vis_guards (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  user_id uuid not null references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (company_id, user_id)
);

create table if not exists vis_visits (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  token text not null unique default substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 24),
  visitor_name text not null check (length(visitor_name) between 2 and 120),
  visitor_company text check (visitor_company is null or length(visitor_company) <= 120),
  phone text check (phone is null or length(phone) <= 40),
  id_last4 text check (id_last4 is null or id_last4 ~ '^[0-9A-Za-z]{2,4}$'),
  plate text check (plate is null or length(plate) <= 20),
  purpose text check (purpose is null or length(purpose) <= 200),
  host_user uuid references auth.users (id) on delete set null,
  expected_at timestamptz,
  status text not null default 'expected' check (status in ('expected', 'in', 'out', 'cancelled')),
  badge_no text check (badge_no is null or length(badge_no) <= 30),
  photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) <= 900000)),
  kvkk_ok boolean not null default false,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  checked_in_at timestamptz, checkin_by uuid,
  checked_out_at timestamptz, checkout_by uuid,
  unique (company_id, year, no)
);
create index if not exists vis_visits_status_idx on vis_visits (company_id, status, expected_at);
create index if not exists vis_visits_host_idx on vis_visits (host_user, created_at desc);
create index if not exists vis_visits_badge_idx on vis_visits (company_id, badge_no) where status = 'in';

create or replace function vis_is_guard() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from vis_guards g where g.user_id = auth.uid() and g.company_id = lab_company() and g.is_active)
      or exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and m.role in ('owner', 'hr', 'branch_manager'));
$$;
revoke execute on function vis_is_guard() from public, anon;
grant execute on function vis_is_guard() to authenticated;

alter table vis_guards enable row level security;
alter table vis_visits enable row level security;
drop policy if exists vis_guards_read on vis_guards;
create policy vis_guards_read on vis_guards for select to authenticated using (company_id = lab_company());
drop policy if exists vis_guards_write on vis_guards;
create policy vis_guards_write on vis_guards for all to authenticated
  using (company_id = lab_company() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = vis_guards.company_id and m.role in ('owner', 'hr')))
  with check (company_id = lab_company() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = vis_guards.company_id and m.role in ('owner', 'hr')));
grant select, insert, update, delete on vis_guards to authenticated;
drop policy if exists vis_visits_read on vis_visits;
create policy vis_visits_read on vis_visits for select to authenticated
  using (company_id = lab_company() and (vis_is_guard() or host_user = auth.uid() or created_by = auth.uid()));
grant select on vis_visits to authenticated;

create or replace function vis_no(v vis_visits) returns text language sql immutable as $$ select 'ZY-' || v.year || '-' || lpad(v.no::text, 4, '0'); $$;

-- Davet (personel) ya da hızlı kayıt (güvenlik; p.checkin = true ise hemen içeri alınır)
--  p: { visitor_name, visitor_company, phone, id_last4, plate, purpose, host_user, expected_at, note, kvkk_ok, badge_no, photo, checkin }
create or replace function vis_save(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vis_visits; v_year int := extract(year from now())::int; v_host uuid := coalesce(nullif(p ->> 'host_user', '')::uuid, auth.uid()); v_in boolean := coalesce((p ->> 'checkin')::boolean, false);
begin
  if not exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company()) then raise exception 'not_allowed'; end if;
  if v_in and not vis_is_guard() then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p ->> 'visitor_name', ''))) < 2 then raise exception 'name_required'; end if;
  if v_host is not null and not exists (select 1 from memberships where user_id = v_host and company_id = lab_company()) then raise exception 'bad_host'; end if;
  insert into vis_visits (year, no, visitor_name, visitor_company, phone, id_last4, plate, purpose, host_user, expected_at, note, kvkk_ok, badge_no, photo, status, checked_in_at, checkin_by)
  values (v_year, lab_next_no('zy', v_year), left(trim(p ->> 'visitor_name'), 120), nullif(left(trim(p ->> 'visitor_company'), 120), ''), nullif(left(trim(p ->> 'phone'), 40), ''),
          nullif(left(regexp_replace(coalesce(p ->> 'id_last4', ''), '[^0-9A-Za-z]', '', 'g'), 4), ''), nullif(upper(left(trim(p ->> 'plate'), 20)), ''), nullif(left(trim(p ->> 'purpose'), 200), ''),
          v_host, coalesce(nullif(p ->> 'expected_at', '')::timestamptz, case when v_in then now() end), nullif(left(trim(p ->> 'note'), 300), ''),
          coalesce((p ->> 'kvkk_ok')::boolean, false), nullif(left(trim(p ->> 'badge_no'), 30), ''),
          case when coalesce(p ->> 'photo', '') like 'data:image/jpeg;base64,%' and length(p ->> 'photo') <= 900000 then p ->> 'photo' end,
          case when v_in then 'in' else 'expected' end, case when v_in then now() end, case when v_in then auth.uid() end)
  returning * into v;
  if v_in and v.host_user is not null then
    perform deliver(v.company_id, array[v.host_user], '🚪 Misafiriniz geldi', v.visitor_name || coalesce(' · ' || v.visitor_company, '') || coalesce(' · kart ' || v.badge_no, ''), '/ziyaretci');
  elsif not v_in then
    perform deliver(v.company_id, array(select g.user_id from vis_guards g where g.company_id = v.company_id and g.is_active),
      'Beklenen ziyaretçi · ' || v.visitor_name, coalesce(to_char(v.expected_at at time zone 'Europe/Istanbul', 'DD.MM HH24:MI') || ' · ', '') || coalesce(req_user_name(v.host_user), ''), '/guvenlik');
  end if;
  return jsonb_build_object('id', v.id, 'token', v.token, 'no', vis_no(v));
end $$;
revoke execute on function vis_save(jsonb) from public, anon;
grant execute on function vis_save(jsonb) to authenticated;

-- Güvenlik: QR (token / bağlantı) ya da kart no ile bul
create or replace function vis_find(p_code text) returns vis_visits
language plpgsql stable security definer set search_path = public as $$
declare v vis_visits; c text := trim(coalesce(p_code, ''));
begin
  c := coalesce(substring(c from '([0-9a-f]{24})'), c);
  select * into v from vis_visits where company_id = lab_company() and token = c;
  if v.id is null then select * into v from vis_visits where company_id = lab_company() and status = 'in' and lower(badge_no) = lower(c) order by checked_in_at desc limit 1; end if;
  if v.id is null and c ~* '^zy-?[0-9]{4}-?[0-9]+$' then
    select * into v from vis_visits where company_id = lab_company() and year = substring(c from '([0-9]{4})')::int and no = substring(c from '([0-9]+)$')::int;
  end if;
  return v;
end $$;
revoke execute on function vis_find(text) from public, anon, authenticated;

-- Okut: bekleniyorsa içeri al (kart, fotoğraf), içerideyse çıkış yap
create or replace function vis_scan(p_code text, p_badge text default null, p_photo text default null, p_kvkk boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vis_visits; v_act text;
begin
  if not vis_is_guard() then raise exception 'not_allowed'; end if;
  v := vis_find(p_code);
  if v.id is null then raise exception 'visit_not_found'; end if;
  if v.status = 'expected' then
    update vis_visits set status = 'in', checked_in_at = now(), checkin_by = auth.uid(), badge_no = coalesce(nullif(left(trim(p_badge), 30), ''), badge_no),
      kvkk_ok = coalesce(p_kvkk, kvkk_ok),
      photo = case when coalesce(p_photo, '') like 'data:image/jpeg;base64,%' and length(p_photo) <= 900000 then p_photo else photo end
    where id = v.id returning * into v;
    v_act := 'in';
    if v.host_user is not null then perform deliver(v.company_id, array[v.host_user], '🚪 Misafiriniz geldi', v.visitor_name || coalesce(' · ' || v.visitor_company, '') || coalesce(' · kart ' || v.badge_no, ''), '/ziyaretci'); end if;
  elsif v.status = 'in' then
    update vis_visits set status = 'out', checked_out_at = now(), checkout_by = auth.uid() where id = v.id returning * into v;
    v_act := 'out';
  elsif v.status = 'out' then raise exception 'already_out';
  else raise exception 'visit_cancelled';
  end if;
  return jsonb_build_object('id', v.id, 'no', vis_no(v), 'action', v_act, 'name', v.visitor_name, 'company', v.visitor_company, 'host', req_user_name(v.host_user), 'badge', v.badge_no,
                            'minutes', case when v_act = 'out' then extract(epoch from v.checked_out_at - v.checked_in_at)::int / 60 end);
end $$;
revoke execute on function vis_scan(text, text, text, boolean) from public, anon;
grant execute on function vis_scan(text, text, text, boolean) to authenticated;

create or replace function vis_action(p_id uuid, p_action text, p_badge text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v vis_visits;
begin
  select * into v from vis_visits where id = p_id and company_id = lab_company() for update;
  if v.id is null then raise exception 'visit_not_found'; end if;
  if p_action = 'cancel' then
    if not (vis_is_guard() or v.host_user = auth.uid() or v.created_by = auth.uid()) then raise exception 'not_allowed'; end if;
    if v.status <> 'expected' then raise exception 'bad_status'; end if;
    update vis_visits set status = 'cancelled' where id = p_id;
  elsif p_action = 'checkout' then
    if not vis_is_guard() then raise exception 'not_allowed'; end if;
    if v.status <> 'in' then raise exception 'bad_status'; end if;
    update vis_visits set status = 'out', checked_out_at = now(), checkout_by = auth.uid() where id = p_id;
  elsif p_action = 'checkin' then
    if not vis_is_guard() then raise exception 'not_allowed'; end if;
    perform vis_scan(v.token, p_badge, null, null);
  elsif p_action = 'badge' then
    if not vis_is_guard() then raise exception 'not_allowed'; end if;
    update vis_visits set badge_no = nullif(left(trim(p_badge), 30), '') where id = p_id;
  else raise exception 'bad_action';
  end if;
end $$;
revoke execute on function vis_action(uuid, text, text) from public, anon;
grant execute on function vis_action(uuid, text, text) to authenticated;

-- Davetiye sayfası (giriş gerektirmez): yalnız ad, tarih, şirket, ev sahibi adı
create or replace function vis_public(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', v.visitor_name, 'company', c.name, 'host', coalesce(
            (select nullif(m.display_name, '') from memberships m where m.user_id = v.host_user and m.company_id = v.company_id limit 1),
            (select e.first_name || ' ' || e.last_name from employees e where e.user_id = v.host_user and e.company_id = v.company_id limit 1)),
         'expected_at', v.expected_at, 'status', v.status, 'no', vis_no(v), 'purpose', v.purpose)
  from vis_visits v join companies c on c.id = v.company_id
  where p_token ~ '^[0-9a-f]{24}$' and v.token = p_token and v.status <> 'cancelled';
$$;
revoke execute on function vis_public(text) from public;
grant execute on function vis_public(text) to anon, authenticated;

notify pgrst, 'reload schema';
