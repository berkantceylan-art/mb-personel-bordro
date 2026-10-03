-- =====================================================================
-- Migration 6: Mobil uygulama, duyurular, mesajlaşma, talepler, yönetim
-- =====================================================================

-- ---------------------------------------------------------------------
-- Kullanıcı adı / görünen ad
-- ---------------------------------------------------------------------
alter table memberships add column if not exists display_name text;

-- Aynı şirketteki kullanıcıların rehberi (mesajlaşma ve atamalar için)
create or replace function company_directory()
returns table (user_id uuid, display_name text, role app_role, employee_id uuid, department text)
language sql stable security definer set search_path = public as $$
  select m.user_id,
         coalesce(m.display_name, e.first_name || ' ' || e.last_name, 'Kullanıcı'),
         m.role, e.id, d.name
  from memberships m
  left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  left join departments d on d.id = e.department_id
  where m.company_id in (select company_id from memberships where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Davet kodları (personel mobil hesabı, yönetici hesapları)
-- ---------------------------------------------------------------------
create table invites (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  code text not null unique,
  role app_role not null default 'employee',
  employee_id uuid references employees(id) on delete cascade,
  display_name text,
  login_email text not null,
  all_branches boolean not null default false,
  expires_at timestamptz not null default now() + interval '30 days',
  used_by uuid references auth.users(id),
  used_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table invites enable row level security;
create policy invites_manage on invites for all
  using (has_role(company_id, array['owner', 'hr']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr']::app_role[]));

create or replace function invite_preview(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'company', c.name,
    'role', i.role,
    'display_name', coalesce(i.display_name, e.first_name || ' ' || e.last_name),
    'login_email', i.login_email,
    'valid', i.used_at is null and i.expires_at > now()
  )
  from invites i
  join companies c on c.id = i.company_id
  left join employees e on e.id = i.employee_id
  where i.code = upper(trim(p_code));
$$;
grant execute on function invite_preview(text) to anon, authenticated;

create or replace function claim_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare inv invites; name text;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapın'; end if;
  select * into inv from invites where code = upper(trim(p_code)) for update;
  if inv.id is null then raise exception 'Davet kodu bulunamadı'; end if;
  if inv.used_at is not null and inv.used_by <> auth.uid() then raise exception 'Bu davet kodu kullanılmış'; end if;
  if inv.expires_at < now() then raise exception 'Davet kodunun süresi dolmuş'; end if;

  select coalesce(inv.display_name, e.first_name || ' ' || e.last_name) into name from employees e where e.id = inv.employee_id;
  insert into memberships (user_id, company_id, role, all_branches, display_name)
  values (auth.uid(), inv.company_id, inv.role, inv.all_branches or inv.role in ('owner', 'accountant', 'hr', 'safety'), coalesce(name, inv.display_name))
  on conflict (user_id, company_id) do update set role = excluded.role, display_name = excluded.display_name, all_branches = excluded.all_branches;

  if inv.employee_id is not null then
    update employees set user_id = auth.uid() where id = inv.employee_id;
  end if;
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return json_build_object('company_id', inv.company_id, 'role', inv.role);
end $$;

-- ---------------------------------------------------------------------
-- Şube konumu ve QR ile mobil giriş-çıkış
-- ---------------------------------------------------------------------
alter table branches
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists radius_m int not null default 150,
  add column if not exists qr_secret text not null default encode(gen_random_bytes(16), 'hex'),
  add column if not exists mobile_punch_enabled boolean not null default true;

alter table attendance_punches
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy_m double precision,
  add column if not exists distance_m double precision;

create or replace function distance_m(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Saatlik değişen QR kodu (kiosk ekranında gösterilir)
create or replace function branch_qr_token(p_branch uuid, p_hours_ago int default 0)
returns text language sql stable security definer set search_path = public as $$
  select upper(left(md5(b.qr_secret || to_char((now() at time zone 'Europe/Istanbul') - make_interval(hours => p_hours_ago), 'YYYYMMDDHH24')), 10))
  from branches b where b.id = p_branch;
$$;
revoke execute on function branch_qr_token(uuid, int) from public, anon;

create or replace function kiosk_qr(p_branch uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare b branches;
begin
  select * into b from branches where id = p_branch;
  if b.id is null or not has_role(b.company_id, array['owner', 'hr', 'branch_manager']::app_role[]) then raise exception 'Yetki yok'; end if;
  return json_build_object('branch', b.name, 'token', 'MBQR:' || b.id || ':' || branch_qr_token(b.id, 0));
end $$;

create or replace function mobile_punch(p_lat double precision default null, p_lng double precision default null, p_accuracy double precision default null, p_qr text default null)
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
  dir := case when last.direction = 'IN' then 'OUT' else 'IN' end;

  insert into attendance_punches (company_id, branch_id, card_no, employee_id, device_code, direction, punched_at, source, lat, lng, accuracy_m, distance_m, created_by)
  values (e.company_id, b.id, coalesce(e.card_no, 'M-' || left(e.id::text, 8)), e.id, case when p_qr is not null then 'QR' else 'GPS' end,
          dir, local_now, 'MOBILE', p_lat, p_lng, p_accuracy, dist, auth.uid());
  return json_build_object('direction', dir, 'at', local_now, 'distance', round(coalesce(dist, 0)), 'branch', b.name);
end $$;

-- ---------------------------------------------------------------------
-- Duyurular
-- ---------------------------------------------------------------------
create table announcements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  title text not null,
  body text not null,
  audience text not null default 'ALL' check (audience in ('ALL', 'DEPARTMENT', 'BRANCH')),
  department_ids uuid[] not null default '{}',
  branch_ids uuid[] not null default '{}',
  pinned boolean not null default false,
  push boolean not null default true,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index on announcements (company_id, published_at desc);

create or replace function announcement_visible(a announcements)
returns boolean language sql stable security definer set search_path = public as $$
  select is_member(a.company_id) and (
    has_role(a.company_id, array['owner', 'accountant', 'hr', 'branch_manager', 'safety']::app_role[])
    or a.audience = 'ALL'
    or exists (
      select 1 from employees e where e.user_id = auth.uid() and e.company_id = a.company_id
        and ((a.audience = 'DEPARTMENT' and e.department_id = any (a.department_ids))
          or (a.audience = 'BRANCH' and e.branch_id = any (a.branch_ids)))
    )
  );
$$;

alter table announcements enable row level security;
create policy ann_read on announcements for select using (announcement_visible(announcements));
create policy ann_write on announcements for all
  using (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]))
  with check (has_role(company_id, array['owner', 'hr', 'branch_manager']::app_role[]));

create table announcement_reads (
  announcement_id uuid not null references announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);
alter table announcement_reads enable row level security;
create policy ar_own on announcement_reads for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ar_staff on announcement_reads for select
  using (exists (select 1 from announcements a where a.id = announcement_id and has_role(a.company_id, array['owner', 'hr', 'branch_manager']::app_role[])));

-- ---------------------------------------------------------------------
-- Mesajlaşma
-- ---------------------------------------------------------------------
create table conversations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  kind text not null default 'DIRECT' check (kind in ('DIRECT', 'GROUP')),
  title text,
  department_id uuid references departments(id) on delete set null,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create table conversation_members (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) default auth.uid(),
  body text not null check (length(body) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index on messages (conversation_id, created_at desc);
create index on conversation_members (user_id);

create or replace function is_conversation_member(p_conv uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from conversation_members where conversation_id = p_conv and user_id = auth.uid());
$$;

alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
create policy conv_read on conversations for select using (is_conversation_member(id));
create policy conv_insert on conversations for insert with check (is_member(company_id) and created_by = auth.uid());
create policy conv_update on conversations for update using (is_conversation_member(id));
create policy cm_read on conversation_members for select using (is_conversation_member(conversation_id));
create policy cm_insert on conversation_members for insert
  with check (exists (select 1 from conversations c where c.id = conversation_id and (c.created_by = auth.uid() or has_role(c.company_id, array['owner', 'hr']::app_role[]))));
create policy cm_update_own on conversation_members for update using (user_id = auth.uid());
create policy msg_read on messages for select using (is_conversation_member(conversation_id));
create policy msg_insert on messages for insert with check (sender_id = auth.uid() and is_conversation_member(conversation_id));

create or replace function touch_conversation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversations set last_message_at = new.created_at where id = new.conversation_id;
  update conversation_members set last_read_at = new.created_at where conversation_id = new.conversation_id and user_id = new.sender_id;
  return new;
end $$;
create trigger messages_touch after insert on messages for each row execute function touch_conversation();

-- Birebir konuşmayı bul veya oluştur
create or replace function open_direct_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_conv uuid;
begin
  select m1.company_id into v_company from memberships m1 join memberships m2 on m2.company_id = m1.company_id
  where m1.user_id = auth.uid() and m2.user_id = p_other limit 1;
  if v_company is null then raise exception 'Kullanıcı bulunamadı'; end if;
  select c.id into v_conv from conversations c
  where c.kind = 'DIRECT' and c.company_id = v_company
    and exists (select 1 from conversation_members where conversation_id = c.id and user_id = auth.uid())
    and exists (select 1 from conversation_members where conversation_id = c.id and user_id = p_other)
    and (select count(*) from conversation_members where conversation_id = c.id) = 2
  limit 1;
  if v_conv is null then
    insert into conversations (company_id, kind, created_by) values (v_company, 'DIRECT', auth.uid()) returning id into v_conv;
    insert into conversation_members (conversation_id, user_id) values (v_conv, auth.uid()), (v_conv, p_other);
  end if;
  return v_conv;
end $$;

-- Bölüm grubu: bölümdeki hesabı olan herkes + oluşturan
create or replace function open_department_group(p_department uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare d departments; v_conv uuid;
begin
  select * into d from departments where id = p_department;
  if d.id is null or not has_role(d.company_id, array['owner', 'hr', 'branch_manager']::app_role[]) then raise exception 'Yetki yok'; end if;
  select id into v_conv from conversations where kind = 'GROUP' and department_id = d.id limit 1;
  if v_conv is null then
    insert into conversations (company_id, kind, title, department_id, created_by) values (d.company_id, 'GROUP', d.name || ' grubu', d.id, auth.uid()) returning id into v_conv;
  end if;
  insert into conversation_members (conversation_id, user_id)
  select v_conv, u from (
    select e.user_id as u from employees e where e.department_id = d.id and e.user_id is not null and e.status = 'active'
    union select auth.uid()
  ) x
  on conflict do nothing;
  return v_conv;
end $$;

do $$ begin
  alter publication supabase_realtime add table messages;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------
-- Avans talepleri
-- ---------------------------------------------------------------------
create table advance_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  employee_id uuid not null references employees(id) on delete cascade,
  amount bigint not null check (amount > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  channel text check (channel in ('BANK', 'CASH')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  decision_note text,
  ledger_entry_id uuid references ledger_entries(id),
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table advance_requests enable row level security;
create policy adv_read on advance_requests for select
  using (can_manage_pay(company_id) or exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy adv_self_insert on advance_requests for insert
  with check (status = 'pending' and exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()));
create policy adv_self_cancel on advance_requests for update
  using (status = 'pending' and exists (select 1 from employees e where e.id = employee_id and e.user_id = auth.uid()))
  with check (status = 'cancelled');
create policy adv_manage on advance_requests for all using (can_manage_pay(company_id)) with check (can_manage_pay(company_id));

-- ---------------------------------------------------------------------
-- Bildirimler ve push token
-- ---------------------------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);
alter table notifications enable row level security;
create policy notif_own on notifications for select using (user_id = auth.uid());
create policy notif_own_update on notifications for update using (user_id = auth.uid());
create policy notif_insert on notifications for insert with check (is_member(company_id));

create table push_tokens (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  company_id uuid not null references companies(id) on delete cascade,
  platform text,
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;
create policy push_own on push_tokens for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Personel kendi okutma kaydını görebilir; kendi talebini oluşturabilir (izin: migration 3)
create trigger audit_invites after insert or update or delete on invites for each row execute function audit_trigger();
create trigger audit_advance after insert or update or delete on advance_requests for each row execute function audit_trigger();

-- =====================================================================
-- Bildirim üretimi ve telefon bildirimi (push) veritabanında yapılır;
-- web ve mobil uygulama aynı davranır, kimse başkasının push token'ını görmez.
-- =====================================================================
do $$ begin
  create extension if not exists pg_net;
exception when others then raise notice 'pg_net kurulamadı: telefon bildirimleri gönderilmez, uygulama içi bildirimler çalışır';
end $$;

-- Expo push servisine gönderim (hata olursa ana işlem etkilenmez)
create or replace function push_to(p_users uuid[], p_title text, p_body text, p_link text)
returns void language plpgsql security definer set search_path = public as $$
declare msgs jsonb;
begin
  select jsonb_agg(jsonb_build_object('to', t.token, 'title', p_title, 'body', coalesce(p_body, ''), 'sound', 'default', 'data', jsonb_build_object('link', p_link)))
    into msgs
  from push_tokens t where t.user_id = any (p_users);
  if msgs is null then return; end if;
  begin
    execute 'select net.http_post(url := $1, body := $2, headers := $3)'
      using 'https://exp.host/--/api/v2/push/send', msgs, '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb;
  exception when others then null;
  end;
end $$;

-- Kullanıcılara bildirim: işlemi yapan kişi hariç; p_store = bildirim listesinde de görünsün
create or replace function deliver(p_company uuid, p_users uuid[], p_title text, p_body text, p_link text, p_store boolean default true)
returns void language plpgsql security definer set search_path = public as $$
declare targets uuid[];
begin
  select coalesce(array_agg(distinct u), '{}') into targets
  from unnest(coalesce(p_users, '{}')) u
  where u is not null and u is distinct from auth.uid();
  if cardinality(targets) = 0 then return; end if;
  if p_store then
    insert into notifications (company_id, user_id, title, body, link)
    select p_company, u, p_title, left(coalesce(p_body, ''), 300), p_link from unnest(targets) u;
  end if;
  perform push_to(targets, p_title, left(coalesce(p_body, ''), 180), p_link);
end $$;
revoke execute on function push_to(uuid[], text, text, text) from public, anon, authenticated;
revoke execute on function deliver(uuid, uuid[], text, text, text, boolean) from public, anon, authenticated;

create or replace function tl_text(k bigint) returns text language sql immutable as $$
  select translate(trim(to_char(k / 100.0, '999G999G990D00')), ',.', '.,') || ' TL';
$$;

create or replace function role_users(p_company uuid, p_roles app_role[]) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(user_id), '{}') from memberships where company_id = p_company and role = any (p_roles);
$$;

create or replace function employee_name(p_employee uuid) returns text
language sql stable security definer set search_path = public as $$
  select first_name || ' ' || last_name from employees where id = p_employee;
$$;

-- Mesaj: yalnız telefon bildirimi (listeyi doldurmasın; mesaj sayacı ayrıca var)
create or replace function trg_message_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare c conversations; sender text; users uuid[];
begin
  select * into c from conversations where id = new.conversation_id;
  select coalesce(m.display_name, e.first_name || ' ' || e.last_name, 'Mesaj') into sender
  from memberships m left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  where m.user_id = new.sender_id and m.company_id = c.company_id;
  select array_agg(user_id) into users from conversation_members where conversation_id = c.id and user_id <> new.sender_id;
  perform deliver(c.company_id, users,
    case when c.kind = 'GROUP' then coalesce(c.title, 'Grup') || ' · ' || coalesce(sender, '') else coalesce(sender, 'Mesaj') end,
    new.body, '/mesajlar/' || c.id, false);
  return new;
end $$;
create trigger messages_notify after insert on messages for each row execute function trg_message_notify();

-- Avans talebi: yeni talep → owner/muhasebe; karar → personel
create or replace function trg_advance_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if tg_op = 'INSERT' and new.status = 'pending' then
    perform deliver(new.company_id, role_users(new.company_id, array['owner', 'accountant']::app_role[]),
      'Yeni avans talebi', employee_name(new.employee_id) || ' · ' || tl_text(new.amount) || coalesce(' · ' || new.reason, ''), '/talepler');
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status in ('approved', 'rejected') then
    select user_id into uid from employees where id = new.employee_id;
    perform deliver(new.company_id, array[uid],
      case when new.status = 'approved' then 'Avans talebiniz onaylandı' else 'Avans talebiniz reddedildi' end,
      case when new.status = 'approved' then tl_text(new.amount) || case new.channel when 'BANK' then ' · bankaya' when 'CASH' then ' · elden' else '' end else '' end
        || coalesce(' · ' || new.decision_note, ''),
      '/benim');
  end if;
  return new;
end $$;
create trigger advance_notify after insert or update on advance_requests for each row execute function trg_advance_notify();

-- İzin talebi: yeni talep → owner/İK + o şubenin sorumlusu; karar → personel
create or replace function trg_leave_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare e employees; users uuid[]; t text;
begin
  select * into e from employees where id = new.employee_id;
  select name into t from leave_types where id = new.leave_type_id;
  if tg_op = 'INSERT' and new.status = 'pending' then
    select coalesce(array_agg(m.user_id), '{}') into users from memberships m
    where m.company_id = new.company_id
      and (m.role in ('owner', 'hr')
        or (m.role = 'branch_manager' and (m.all_branches or exists (select 1 from membership_branches mb where mb.user_id = m.user_id and mb.branch_id = e.branch_id))));
    perform deliver(new.company_id, users, 'Yeni izin talebi',
      e.first_name || ' ' || e.last_name || ' · ' || coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün', '/talepler');
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status in ('approved', 'rejected', 'cancelled') and old.status in ('pending', 'approved') then
    perform deliver(new.company_id, array[e.user_id],
      'İzin talebiniz ' || case new.status when 'approved' then 'onaylandı' when 'rejected' then 'reddedildi' else 'iptal edildi' end,
      coalesce(t, 'İzin') || ' · ' || to_char(new.start_date, 'DD.MM.YYYY') || ' · ' || trim_scale(new.days) || ' gün', '/benim');
  end if;
  return new;
end $$;
create trigger leave_notify after insert or update on leave_requests for each row execute function trg_leave_notify();

-- Duyuru: hedef kitleye
create or replace function trg_announcement_notify() returns trigger
language plpgsql security definer set search_path = public as $$
declare users uuid[];
begin
  if not new.push then return new; end if;
  select coalesce(array_agg(m.user_id), '{}') into users
  from memberships m
  left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
  where m.company_id = new.company_id
    and (new.audience = 'ALL' or m.role <> 'employee'
      or (new.audience = 'DEPARTMENT' and e.department_id = any (new.department_ids))
      or (new.audience = 'BRANCH' and e.branch_id = any (new.branch_ids)));
  perform deliver(new.company_id, users, '📢 ' || new.title, new.body, '/duyurular');
  return new;
end $$;
create trigger announcement_notify after insert on announcements for each row execute function trg_announcement_notify();

-- ---------------------------------------------------------------------
-- Personelin kendi izin talebi (gün sayısı sunucuda hesaplanır)
-- ---------------------------------------------------------------------
create or replace function request_leave_self(p_type uuid, p_start date, p_end date default null, p_note text default null, p_half_day boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare e employees; t leave_types; n numeric; v_end date := coalesce(p_end, p_start);
begin
  select * into e from employees where user_id = auth.uid() and status = 'active' limit 1;
  if e.id is null then raise exception 'Hesabınız bir personel kaydına bağlı değil'; end if;
  select * into t from leave_types where id = p_type and (company_id is null or company_id = e.company_id);
  if t.id is null then raise exception 'İzin türü bulunamadı'; end if;
  if v_end < p_start then raise exception 'Bitiş tarihi başlangıçtan önce olamaz'; end if;
  if v_end - p_start > 120 then raise exception 'Tek talepte en fazla 120 gün girilebilir'; end if;
  if t.is_sick_leave or t.code = 'DOGUM' then
    n := v_end - p_start + 1;
  else
    select count(*) into n from generate_series(p_start, v_end, interval '1 day') g(day)
    where extract(isodow from g.day) <> 7
      and not exists (select 1 from public_holidays h where h.date = g.day::date and not h.half_day);
    if p_half_day and n = 1 then n := 0.5; end if;
  end if;
  if n = 0 then raise exception 'Seçilen günler tatil'; end if;
  insert into leave_requests (company_id, employee_id, leave_type_id, start_date, end_date, days, half_day, note, status)
  values (e.company_id, e.id, t.id, p_start, v_end, n, n = 0.5, nullif(trim(p_note), ''), 'pending');
  return json_build_object('days', n);
end $$;

-- ---------------------------------------------------------------------
-- Avans talebine karar (onayda cari hesaba avans işlenir)
-- ---------------------------------------------------------------------
create or replace function decide_advance(p_id uuid, p_approve boolean, p_channel text default 'CASH', p_date date default null, p_amount bigint default null, p_note text default null)
returns json language plpgsql security definer set search_path = public as $$
declare r advance_requests; v_date date := coalesce(p_date, (now() at time zone 'Europe/Istanbul')::date); v_amount bigint; v_entry uuid;
begin
  select * into r from advance_requests where id = p_id for update;
  if r.id is null then raise exception 'Talep bulunamadı'; end if;
  if not can_manage_pay(r.company_id) then raise exception 'Yetki yok'; end if;
  if r.status <> 'pending' then raise exception 'Bu talep zaten sonuçlanmış'; end if;
  if p_approve then
    if p_channel not in ('BANK', 'CASH') then raise exception 'Geçersiz ödeme kanalı'; end if;
    v_amount := coalesce(nullif(p_amount, 0), r.amount);
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note)
    values (r.company_id, r.employee_id, to_char(v_date, 'YYYY-MM'), v_date, 'ADVANCE', p_channel::ledger_channel, v_amount,
            'Avans talebi' || coalesce(': ' || r.reason, ''))
    returning id into v_entry;
    update advance_requests set status = 'approved', channel = p_channel, amount = v_amount, decided_by = auth.uid(), decided_at = now(),
      decision_note = nullif(trim(p_note), ''), ledger_entry_id = v_entry where id = r.id;
  else
    update advance_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(p_note), '') where id = r.id;
  end if;
  return json_build_object('status', case when p_approve then 'approved' else 'rejected' end, 'ledger_entry_id', v_entry);
end $$;
