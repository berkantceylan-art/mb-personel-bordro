-- Ziyaret randevusu: ziyaretçi siteden randevu ister → ziyaret edilecek kişi / birim onaylar (saati değiştirebilir)
-- → güvenlik "beklenen" listesinde görür → ziyaretçi kapıda QR davetiyesiyle girer.
--  vis_hosts : sitede seçilebilen "kimi ziyaret edeceksiniz" kayıtları (kişi ya da birim), onaylayıcılar, gün / saat aralığı
-- Sitede tanıtım slaytı da eklenir. Tekrar çalıştırılabilir.

alter table vis_visits drop constraint if exists vis_visits_status_check;
alter table vis_visits add constraint vis_visits_status_check check (status in ('requested', 'expected', 'in', 'out', 'cancelled', 'rejected'));
alter table vis_visits add column if not exists source text not null default 'erp';
alter table vis_visits add column if not exists visitor_email text check (visitor_email is null or length(visitor_email) <= 200);
alter table vis_visits add column if not exists host_target uuid;
alter table vis_visits add column if not exists requested_at timestamptz;
alter table vis_visits add column if not exists decided_by uuid;
alter table vis_visits add column if not exists decided_at timestamptz;
alter table vis_visits add column if not exists reject_reason text check (reject_reason is null or length(reject_reason) <= 300);
alter table vis_visits add column if not exists visitor_count int not null default 1 check (visitor_count between 1 and 20);

create table if not exists vis_hosts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  label text not null check (length(label) between 2 and 80),
  description text check (description is null or length(description) <= 200),
  approver_ids uuid[] not null default '{}',
  weekdays int[] not null default '{1,2,3,4,5}' check (weekdays <@ array[1, 2, 3, 4, 5, 6, 7]),
  hour_from int not null default 9 check (hour_from between 0 and 23),
  hour_to int not null default 18 check (hour_to between 1 and 24),
  slot_minutes int not null default 30 check (slot_minutes in (15, 30, 60)),
  is_active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  check (hour_to > hour_from)
);
do $$ begin
  alter table vis_visits add constraint vis_visits_host_target_fkey foreign key (host_target) references vis_hosts (id) on delete set null;
exception when duplicate_object then null; end $$;
create index if not exists vis_visits_requested_idx on vis_visits (company_id, status) where status = 'requested';

alter table vis_hosts enable row level security;
drop policy if exists vis_hosts_read on vis_hosts;
create policy vis_hosts_read on vis_hosts for select to authenticated using (company_id = lab_company());
grant select on vis_hosts to authenticated;
revoke insert, update, delete on vis_hosts from authenticated;

-- Onaylayıcılar kendilerine gelen talepleri görür
drop policy if exists vis_visits_approver on vis_visits;
create policy vis_visits_approver on vis_visits for select to authenticated
  using (host_target is not null and exists (select 1 from vis_hosts h where h.id = vis_visits.host_target and auth.uid() = any (h.approver_ids)));

create or replace function vis_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and m.role in ('owner', 'hr'));
$$;
grant execute on function vis_is_admin() to authenticated;

-- Randevu verilebilir kişi / birim kaydet (sahip, İK)
create or replace function vis_host_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_appr uuid[];
begin
  if not vis_is_admin() then raise exception 'not_allowed'; end if;
  if p->>'delete' = 'true' then delete from vis_hosts where id = v_id and company_id = lab_company(); return v_id; end if;
  v_appr := array(select x::uuid from jsonb_array_elements_text(coalesce(p->'approver_ids', '[]')) x
                   where exists (select 1 from memberships m where m.user_id = x::uuid and m.company_id = lab_company()));
  if cardinality(v_appr) = 0 then raise exception 'approver_required'; end if;
  if length(trim(coalesce(p->>'label', ''))) < 2 then raise exception 'label_required'; end if;
  if v_id is null then
    insert into vis_hosts (label) values (left(trim(p->>'label'), 80)) returning id into v_id;
  end if;
  update vis_hosts set label = left(trim(p->>'label'), 80), description = nullif(left(trim(coalesce(p->>'description', '')), 200), ''), approver_ids = v_appr,
    weekdays = coalesce(array(select x::int from jsonb_array_elements_text(p->'weekdays') x where x ~ '^[1-7]$'), '{1,2,3,4,5}'),
    hour_from = coalesce(nullif(p->>'hour_from', '')::int, 9), hour_to = coalesce(nullif(p->>'hour_to', '')::int, 18),
    slot_minutes = coalesce(nullif(p->>'slot_minutes', '')::int, 30), is_active = coalesce((p->>'is_active')::boolean, true), sort = coalesce(nullif(p->>'sort', '')::int, 0)
  where id = v_id and company_id = lab_company();
  return v_id;
end $$;
grant execute on function vis_host_save(jsonb) to authenticated;

-- Site formu için (giriş gerektirmez): yalnız etiket, açıklama, gün / saat
create or replace function vis_hosts_public() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'description', description, 'weekdays', weekdays, 'hour_from', hour_from, 'hour_to', hour_to, 'slot', slot_minutes) order by sort, label), '[]')
  from vis_hosts where company_id = lab_company() and is_active and cardinality(approver_ids) > 0;
$$;
grant execute on function vis_hosts_public() to anon, authenticated;

-- Ziyaretçi randevu talebi (siteden, giriş gerektirmez)
--  p: { host_id, at (ISO, İstanbul saati), visitor_name, visitor_company, phone, email, purpose, count, kvkk }
create or replace function vis_request(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h vis_hosts; v vis_visits; v_at timestamptz; v_local timestamp; v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'); v_year int := extract(year from now())::int;
begin
  select * into h from vis_hosts where id = nullif(p->>'host_id', '')::uuid and company_id = lab_company() and is_active;
  if h.id is null or cardinality(h.approver_ids) = 0 then raise exception 'host_required'; end if;
  if length(trim(coalesce(p->>'visitor_name', ''))) < 2 then raise exception 'name_required'; end if;
  if length(v_phone) < 10 then raise exception 'phone_required'; end if;
  if coalesce((p->>'kvkk')::boolean, false) is not true then raise exception 'kvkk_required'; end if;
  begin v_at := (p->>'at')::timestamptz; exception when others then raise exception 'bad_time'; end;
  if v_at is null or v_at < now() + interval '30 minutes' or v_at > now() + interval '60 days' then raise exception 'bad_time'; end if;
  v_local := v_at at time zone 'Europe/Istanbul';
  if not (extract(isodow from v_local)::int = any (h.weekdays)) or extract(hour from v_local) < h.hour_from or (extract(hour from v_local) * 60 + extract(minute from v_local)) > h.hour_to * 60 - h.slot_minutes then
    raise exception 'outside_hours';
  end if;
  -- kötüye kullanım sınırı
  if (select count(*) from vis_visits where source = 'site' and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone and requested_at > now() - interval '1 day') >= 3 then raise exception 'too_many'; end if;
  if (select count(*) from vis_visits where source = 'site' and requested_at > now() - interval '1 hour') >= 40 then raise exception 'too_many'; end if;

  insert into vis_visits (company_id, year, no, visitor_name, visitor_company, phone, visitor_email, purpose, host_user, host_target, expected_at, status, source, requested_at, kvkk_ok, visitor_count, created_by)
  values (h.company_id, v_year, lab_next_no('zy', v_year), left(trim(p->>'visitor_name'), 120), nullif(left(trim(coalesce(p->>'visitor_company', '')), 120), ''), left(trim(p->>'phone'), 40),
          nullif(left(lower(trim(coalesce(p->>'email', ''))), 200), ''), nullif(left(trim(coalesce(p->>'purpose', '')), 200), ''), h.approver_ids[1], h.id, v_at, 'requested', 'site', now(), true,
          least(greatest(coalesce(nullif(p->>'count', '')::int, 1), 1), 20), null)
  returning * into v;
  perform deliver(v.company_id, h.approver_ids, '📅 Yeni ziyaret randevusu talebi',
    v.visitor_name || coalesce(' · ' || v.visitor_company, '') || ' · ' || to_char(v_local, 'DD.MM HH24:MI') || coalesce(' · ' || v.purpose, ''), '/ziyaretci');
  return jsonb_build_object('token', v.token, 'no', vis_no(v));
end $$;
revoke execute on function vis_request(jsonb) from public;
grant execute on function vis_request(jsonb) to anon, authenticated;

-- Talebi onayla (saat değiştirilebilir) ya da reddet
create or replace function vis_decide(p_id uuid, p_ok boolean, p_at timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vis_visits;
begin
  select * into v from vis_visits where id = p_id and company_id = lab_company() for update;
  if v.id is null then raise exception 'visit_not_found'; end if;
  if not (vis_is_admin() or v.host_user = auth.uid() or exists (select 1 from vis_hosts h where h.id = v.host_target and auth.uid() = any (h.approver_ids))) then raise exception 'not_allowed'; end if;
  if v.status <> 'requested' then raise exception 'bad_status'; end if;
  if p_ok then
    update vis_visits set status = 'expected', expected_at = coalesce(p_at, expected_at), host_user = auth.uid(), decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
    perform deliver(v.company_id, array(select g.user_id from vis_guards g where g.company_id = v.company_id and g.is_active),
      'Beklenen ziyaretçi · ' || v.visitor_name, coalesce(to_char(v.expected_at at time zone 'Europe/Istanbul', 'DD.MM HH24:MI') || ' · ', '') || coalesce(req_user_name(v.host_user), ''), '/guvenlik');
  else
    if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'reason_required'; end if;
    update vis_visits set status = 'rejected', reject_reason = left(trim(p_reason), 300), decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
  end if;
  return jsonb_build_object('token', v.token, 'no', vis_no(v), 'phone', v.phone, 'email', v.visitor_email, 'name', v.visitor_name, 'status', v.status,
                            'expected_at', v.expected_at, 'host', req_user_name(v.host_user), 'reason', v.reject_reason);
end $$;
revoke execute on function vis_decide(uuid, boolean, timestamptz, text) from public, anon;
grant execute on function vis_decide(uuid, boolean, timestamptz, text) to authenticated;

-- Davetiye / takip sayfası: talep durumunu da gösterir
create or replace function vis_public(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', v.visitor_name, 'company', c.name, 'host', coalesce(
            (select nullif(m.display_name, '') from memberships m where m.user_id = v.host_user and m.company_id = v.company_id limit 1),
            (select e.first_name || ' ' || e.last_name from employees e where e.user_id = v.host_user and e.company_id = v.company_id limit 1)),
         'target', (select label from vis_hosts h where h.id = v.host_target),
         'expected_at', v.expected_at, 'status', v.status, 'no', vis_no(v), 'purpose', v.purpose, 'reason', v.reject_reason,
         'address', concat_ws(', ', c.address, c.district, c.city), 'phone', c.phone)
  from vis_visits v join companies c on c.id = v.company_id
  where p_token ~ '^[0-9a-f]{24}$' and v.token = p_token and v.status <> 'cancelled';
$$;
revoke execute on function vis_public(text) from public;
grant execute on function vis_public(text) to anon, authenticated;

-- Kapıda okutma: onaylanmamış talep içeri alınamaz
create or replace function vis_scan(p_code text, p_badge text default null, p_photo text default null, p_kvkk boolean default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vis_visits; v_act text;
begin
  if not vis_is_guard() then raise exception 'not_allowed'; end if;
  v := vis_find(p_code);
  if v.id is null then raise exception 'visit_not_found'; end if;
  if v.status = 'requested' then raise exception 'visit_not_approved'; end if;
  if v.status = 'rejected' then raise exception 'visit_rejected'; end if;
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

-- Sitede tanıtım slaytı (kodla çizilir; görsel gerekmez)
alter table cms_slides drop constraint if exists cms_slides_builtin_check;
alter table cms_slides add constraint cms_slides_builtin_check check (builtin is null or builtin in ('portal-promo', 'portal-tracking', 'visit-booking'));
insert into cms_slides (placement, builtin, button_href, sort, is_active)
select 'home', 'visit-booking', '/tr/ziyaret', -5, true
where not exists (select 1 from cms_slides x where x.builtin = 'visit-booking');

notify pgrst, 'reload schema';
