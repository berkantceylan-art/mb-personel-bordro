-- =====================================================================
-- MAKİNE VE KAPASİTE PLANLAMA
--  prd_machines        : frez, 3D yazıcı, sinter fırını, tarayıcı… (istasyona ve demirbaşa bağlanır)
--                        günlük kapasite (ünit), takım (frez ucu) ömrü, bakım aralığı (ünit / tarih), durum
--  prd_machine_queue   : makine iş kuyruğu (sıra, planlanan gün, ünit, durum)
--  prd_machine_events  : arıza / bakım / takım değişimi kayıtları (duruş süresi)
--  prd_machine_*       : kaydet, kuyruğa ekle, başlat / bitir, takım değiştir, arıza başlat / bitir
--  prd_capacity(gün)   : istasyon bazında günlük yük (açık iş adımları, teslim gününe göre) ve kapasite
--  prd_machine_alerts(): takım ömrü %90, bakım günü / ünit sınırı (günlük cron, her durum için bir kez)
-- Tekrar çalıştırılabilir. Önce 20261222000000_lots.sql.
-- =====================================================================

create table if not exists prd_machines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'mill' check (kind in ('mill', 'printer', 'furnace', 'scanner', 'casting', 'other')),
  station_id uuid references prd_stations (id) on delete set null,
  asset_id uuid references assets (id) on delete set null,
  brand_model text check (brand_model is null or length(brand_model) <= 120),
  status text not null default 'idle' check (status in ('running', 'idle', 'down', 'maintenance')),
  daily_units int check (daily_units is null or daily_units between 1 and 10000),
  tool_name text check (tool_name is null or length(tool_name) <= 80),
  tool_life_units int check (tool_life_units is null or tool_life_units > 0),
  tool_used_units int not null default 0,
  tool_changed_at timestamptz,
  maint_every_units int check (maint_every_units is null or maint_every_units > 0),
  units_since_maint int not null default 0,
  next_maintenance date,
  total_units bigint not null default 0,
  alert_tool_at timestamptz,
  alert_maint_at timestamptz,
  is_active boolean not null default true,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);

create table if not exists prd_machine_queue (
  id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references prd_machines (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  units int not null default 1 check (units between 1 and 500),
  planned_date date not null default current_date,
  sort int not null default 0,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  started_at timestamptz, finished_at timestamptz,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists prd_machine_queue_idx on prd_machine_queue (machine_id, status, planned_date, sort);
create index if not exists prd_machine_queue_job_idx on prd_machine_queue (job_id);

create table if not exists prd_machine_events (
  id bigint generated always as identity primary key,
  machine_id uuid not null references prd_machines (id) on delete cascade,
  kind text not null check (kind in ('down', 'maintenance', 'tool_change', 'note')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  reason text check (reason is null or length(reason) <= 300),
  units_at bigint,
  created_by uuid default auth.uid()
);
create index if not exists prd_machine_events_idx on prd_machine_events (machine_id, started_at desc);

alter table prd_machines enable row level security;
alter table prd_machine_queue enable row level security;
alter table prd_machine_events enable row level security;
drop policy if exists prd_machines_read on prd_machines;
create policy prd_machines_read on prd_machines for select to authenticated using (can_module('production') or can_logistics() or can_module('assets'));
drop policy if exists prd_machine_queue_read on prd_machine_queue;
create policy prd_machine_queue_read on prd_machine_queue for select to authenticated using (can_module('production') or can_logistics());
drop policy if exists prd_machine_events_read on prd_machine_events;
create policy prd_machine_events_read on prd_machine_events for select to authenticated using (can_module('production') or can_logistics() or can_module('assets'));
grant select on prd_machines, prd_machine_queue, prd_machine_events to authenticated;

create or replace function prd_machine_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not can_module('production', 3) then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'name_required'; end if;
  if v_id is null then
    insert into prd_machines (name, kind, station_id, asset_id, brand_model, daily_units, tool_name, tool_life_units, maint_every_units, next_maintenance, note)
    values (left(trim(p->>'name'), 80), coalesce(nullif(p->>'kind', ''), 'mill'), nullif(p->>'station_id', '')::uuid, nullif(p->>'asset_id', '')::uuid,
            nullif(left(trim(coalesce(p->>'brand_model', '')), 120), ''), nullif(p->>'daily_units', '')::int, nullif(left(trim(coalesce(p->>'tool_name', '')), 80), ''),
            nullif(p->>'tool_life_units', '')::int, nullif(p->>'maint_every_units', '')::int, nullif(p->>'next_maintenance', '')::date, nullif(left(trim(coalesce(p->>'note', '')), 500), ''))
    returning id into v_id;
  else
    update prd_machines set name = left(trim(p->>'name'), 80), kind = coalesce(nullif(p->>'kind', ''), kind), station_id = nullif(p->>'station_id', '')::uuid,
      asset_id = nullif(p->>'asset_id', '')::uuid, brand_model = nullif(left(trim(coalesce(p->>'brand_model', '')), 120), ''),
      daily_units = nullif(p->>'daily_units', '')::int, tool_name = nullif(left(trim(coalesce(p->>'tool_name', '')), 80), ''),
      tool_life_units = nullif(p->>'tool_life_units', '')::int, maint_every_units = nullif(p->>'maint_every_units', '')::int,
      next_maintenance = nullif(p->>'next_maintenance', '')::date, note = nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
      is_active = coalesce((p->>'is_active')::boolean, is_active)
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function prd_machine_save(jsonb) from public, anon;
grant execute on function prd_machine_save(jsonb) to authenticated;

-- Kuyruğa ekle: iş numarası ya da id; ünit boşsa işin ünit sayısı (dişler)
create or replace function prd_machine_enqueue(p_machine uuid, p_job_no bigint, p_units int default null, p_date date default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare j jobs; v_id uuid; v_units int;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into j from jobs where no = p_job_no;
  if j.id is null then raise exception 'job_not_found'; end if;
  if j.status = 'cancelled' then raise exception 'job_cancelled'; end if;
  if not exists (select 1 from prd_machines where id = p_machine and is_active) then raise exception 'not_found'; end if;
  v_units := coalesce(p_units, nullif(round(job_units(j.id))::int, 0), 1);
  insert into prd_machine_queue (machine_id, job_id, units, planned_date, sort, note)
  values (p_machine, j.id, greatest(1, least(500, v_units)), coalesce(p_date, current_date),
          coalesce((select max(sort) + 1 from prd_machine_queue where machine_id = p_machine and status in ('queued', 'running')), 1),
          nullif(left(trim(coalesce(p_note, '')), 300), ''))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function prd_machine_enqueue(uuid, bigint, int, date, text) from public, anon;
grant execute on function prd_machine_enqueue(uuid, bigint, int, date, text) to authenticated;

-- Kuyruk adımı: start / done / failed / cancel / up / down (sıra)
create or replace function prd_machine_queue_action(p_id uuid, p_action text) returns void
language plpgsql security definer set search_path = public as $$
declare q prd_machine_queue; m prd_machines; v_swap uuid; v_sort int;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into q from prd_machine_queue where id = p_id for update;
  if q.id is null then raise exception 'not_found'; end if;
  select * into m from prd_machines where id = q.machine_id for update;
  if p_action = 'start' then
    if q.status <> 'queued' then raise exception 'bad_status'; end if;
    if m.status in ('down', 'maintenance') then raise exception 'machine_down'; end if;
    update prd_machine_queue set status = 'running', started_at = now() where id = p_id;
    update prd_machines set status = 'running' where id = m.id;
  elsif p_action in ('done', 'failed') then
    if q.status not in ('queued', 'running') then raise exception 'bad_status'; end if;
    update prd_machine_queue set status = p_action, started_at = coalesce(started_at, now()), finished_at = now() where id = p_id;
    -- takım ve bakım sayaçları başarısız kazımda da ilerler (malzeme işlendi)
    update prd_machines set tool_used_units = tool_used_units + q.units, units_since_maint = units_since_maint + q.units, total_units = total_units + q.units,
      status = case when exists (select 1 from prd_machine_queue x where x.machine_id = m.id and x.status = 'running' and x.id <> p_id) then 'running' else 'idle' end
    where id = m.id and status not in ('down', 'maintenance');
    update prd_machines set tool_used_units = tool_used_units + q.units, units_since_maint = units_since_maint + q.units, total_units = total_units + q.units
    where id = m.id and status in ('down', 'maintenance');
  elsif p_action = 'cancel' then
    if q.status not in ('queued', 'running') then raise exception 'bad_status'; end if;
    update prd_machine_queue set status = 'cancelled', finished_at = now() where id = p_id;
    update prd_machines set status = 'idle' where id = m.id and status = 'running'
      and not exists (select 1 from prd_machine_queue x where x.machine_id = m.id and x.status = 'running');
  elsif p_action in ('up', 'down') then
    select id, sort into v_swap, v_sort from prd_machine_queue
    where machine_id = q.machine_id and status = 'queued' and id <> q.id
      and case when p_action = 'up' then sort < q.sort else sort > q.sort end
    order by case when p_action = 'up' then -sort else sort end limit 1;
    if v_swap is not null then
      update prd_machine_queue set sort = q.sort where id = v_swap;
      update prd_machine_queue set sort = v_sort where id = q.id;
    end if;
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function prd_machine_queue_action(uuid, text) from public, anon;
grant execute on function prd_machine_queue_action(uuid, text) to authenticated;

-- Makine olayları: tool_change (sayaç sıfırlanır), down / maintenance başlat, up (bitir; bakım bitince sayaç ve sonraki tarih)
create or replace function prd_machine_event(p_machine uuid, p_kind text, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare m prd_machines; v_open bigint; v_was text;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into m from prd_machines where id = p_machine for update;
  if m.id is null then raise exception 'not_found'; end if;
  if p_kind = 'tool_change' then
    insert into prd_machine_events (machine_id, kind, started_at, ended_at, reason, units_at) values (m.id, 'tool_change', now(), now(), coalesce(nullif(left(trim(coalesce(p_reason, '')), 300), ''), m.tool_used_units || ' ünitte değişti'), m.total_units);
    update prd_machines set tool_used_units = 0, tool_changed_at = now(), alert_tool_at = null where id = m.id;
  elsif p_kind in ('down', 'maintenance') then
    if m.status in ('down', 'maintenance') then raise exception 'already_down'; end if;
    insert into prd_machine_events (machine_id, kind, reason, units_at) values (m.id, p_kind, nullif(left(trim(coalesce(p_reason, '')), 300), ''), m.total_units);
    update prd_machines set status = p_kind where id = m.id;
  elsif p_kind = 'up' then
    select id, kind into v_open, v_was from prd_machine_events where machine_id = m.id and kind in ('down', 'maintenance') and ended_at is null order by started_at desc limit 1;
    update prd_machine_events set ended_at = now(), reason = coalesce(reason, '') || case when nullif(trim(coalesce(p_reason, '')), '') is not null then ' · ' || left(trim(p_reason), 200) else '' end where id = v_open;
    update prd_machines set status = case when exists (select 1 from prd_machine_queue x where x.machine_id = m.id and x.status = 'running') then 'running' else 'idle' end,
      units_since_maint = case when v_was = 'maintenance' then 0 else units_since_maint end,
      alert_maint_at = case when v_was = 'maintenance' then null else alert_maint_at end,
      next_maintenance = case when v_was = 'maintenance' and next_maintenance is not null and next_maintenance <= current_date
        then current_date + coalesce((select maintenance_interval_months from assets a where a.id = m.asset_id), 3) * interval '1 month' else next_maintenance end
    where id = m.id;
    if v_was = 'maintenance' and m.asset_id is not null then
      insert into asset_maintenance (asset_id, done_on, kind, description) values (m.asset_id, current_date, 'maintenance', left('Makine bakımı · ' || coalesce(p_reason, ''), 500));
    end if;
  elsif p_kind = 'note' then
    insert into prd_machine_events (machine_id, kind, started_at, ended_at, reason, units_at) values (m.id, 'note', now(), now(), nullif(left(trim(coalesce(p_reason, '')), 300), ''), m.total_units);
  else
    raise exception 'bad_action';
  end if;
end $$;
revoke execute on function prd_machine_event(uuid, text, text) from public, anon;
grant execute on function prd_machine_event(uuid, text, text) to authenticated;

-- Kapasite: önümüzdeki günler için istasyon bazında yük (açık adımların ünitleri, işin teslim gününden bir gün önce; gecikmiş → bugün) ve kapasite
create or replace function prd_capacity(p_days int default 10)
returns table (station_id uuid, station text, color text, day date, load int, capacity int)
language sql stable security definer set search_path = public as $$
  with days as (select (current_date + g)::date d from generate_series(0, greatest(1, least(p_days, 31)) - 1) g),
  st as (
    select s.id, s.name, s.color, s.sort,
      coalesce(s.daily_capacity, (select sum(m.daily_units)::int from prd_machines m where m.station_id = s.id and m.is_active and m.status <> 'down')) cap
    from prd_stations s where s.is_active
  ),
  ops as (
    select o.station_id, greatest(current_date, coalesce(j.due_date - 1, current_date)) d, sum(o.qty)::int units
    from prd_job_ops o join jobs j on j.id = o.job_id
    where o.status in ('waiting', 'ready', 'in_progress', 'paused') and j.status not in ('delivered', 'cancelled')
      and o.round = (select max(round) from prd_job_ops x where x.job_id = o.job_id)
    group by 1, 2
  )
  select st.id, st.name, st.color, days.d, coalesce(ops.units, 0), st.cap
  from st cross join days left join ops on ops.station_id = st.id and ops.d = days.d
  where can_module('production') or can_logistics()
  order by st.sort, days.d;
$$;
revoke execute on function prd_capacity(int) from public, anon;
grant execute on function prd_capacity(int) to authenticated;

-- Günlük uyarılar: takım ömrü %90, bakım zamanı (tarih ya da ünit)
create or replace function prd_machine_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare m record; n int := 0;
begin
  for m in select * from prd_machines where is_active loop
    if m.tool_life_units is not null and m.tool_used_units >= m.tool_life_units * 0.9 and m.alert_tool_at is null then
      perform deliver(lab_company(), module_recipients('production', 3), 'Takım ömrü doluyor: ' || m.name,
                      coalesce(m.tool_name, 'Takım') || ' · ' || m.tool_used_units || ' / ' || m.tool_life_units || ' ünit', '/uretim/makineler/' || m.id);
      update prd_machines set alert_tool_at = now() where id = m.id;
      n := n + 1;
    end if;
    if m.alert_maint_at is null and ((m.next_maintenance is not null and m.next_maintenance <= current_date + 3)
       or (m.maint_every_units is not null and m.units_since_maint >= m.maint_every_units)) then
      perform deliver(lab_company(), module_recipients('production', 3), 'Bakım zamanı: ' || m.name,
                      case when m.next_maintenance is not null then 'Planlanan: ' || to_char(m.next_maintenance, 'DD.MM.YYYY') else m.units_since_maint || ' ünit işlendi' end,
                      '/uretim/makineler/' || m.id);
      update prd_machines set alert_maint_at = now() where id = m.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function prd_machine_alerts() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function prd_machine_alerts() to service_role; end if; end $$;

notify pgrst, 'reload schema';
