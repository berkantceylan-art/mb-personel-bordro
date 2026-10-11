-- =====================================================================
-- Üretim: istasyonlar, ürün rotaları, iş (vaka) operasyonları, barkodla başla / bitir,
-- reçeteden otomatik malzeme düşümü (lot izlenebilirliği), yeniden yapım (remake) takibi
--  prd_stations / prd_route_steps : ürün başına istasyon sırası ve standart süre
--  prd_job_ops                    : işin istasyonlardaki adımları
--  prd_job_materials              : işte kullanılan malzeme ve lotlar (MDR izlenebilirlik)
--  prd_remakes                    : yeniden yapım nedenleri
--  prd_plan(job) / prd_scan(code, station, employee) / prd_op_action / prd_remake / prd_material_add
-- Tekrar çalıştırılabilir. Önce 20261203000000_stock.sql.
-- =====================================================================

create table if not exists prd_stations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  code text check (code is null or length(code) <= 20),
  name text not null check (length(name) between 1 and 80),
  kind text not null default 'other' check (kind in ('model', 'cad', 'milling', 'printing', 'sintering', 'casting', 'porcelain', 'finishing', 'qc', 'packing', 'other')),
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  sort int not null default 0,
  daily_capacity int check (daily_capacity is null or daily_capacity > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
insert into prd_stations (company_id, code, name, kind, color, sort)
select lab_company(), v.code, v.name, v.kind, v.color, v.sort
from (values ('MDL', 'Model / alçı', 'model', '#8B6F47', 10), ('CAD', 'CAD tasarım', 'cad', '#2563EB', 20), ('FRZ', 'Kazıma (frez)', 'milling', '#0891B2', 30),
             ('SNT', 'Sinterleme', 'sintering', '#DC2626', 40), ('POR', 'Porselen / seramik', 'porcelain', '#DB2777', 50), ('BIT', 'Bitirme / cila', 'finishing', '#7C3AED', 60),
             ('QC', 'Kalite kontrol', 'qc', '#059669', 70), ('PAK', 'Paketleme', 'packing', '#64748B', 80)) as v(code, name, kind, color, sort)
where lab_company() is not null and not exists (select 1 from prd_stations s where s.company_id = lab_company());

create table if not exists prd_route_steps (
  id uuid primary key default gen_random_uuid(),
  lab_product_id uuid not null references lab_products (id) on delete cascade,
  station_id uuid not null references prd_stations (id) on delete cascade,
  sort int not null default 0,
  std_minutes int check (std_minutes is null or std_minutes between 0 and 10000),   -- birim (diş) başına
  consume boolean not null default false,                                           -- bu adım bitince reçete malzemesi düşer
  unique (lab_product_id, station_id)
);

create table if not exists prd_job_ops (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  station_id uuid not null references prd_stations (id) on delete restrict,
  sort int not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'ready', 'in_progress', 'paused', 'done', 'skipped')),
  qty int not null default 1,
  std_minutes int,
  consume boolean not null default false,
  employee_id uuid references employees (id) on delete set null,
  started_at timestamptz, finished_at timestamptz,
  started_by uuid, finished_by uuid,
  work_minutes int,
  round int not null default 1,                      -- yeniden yapımda artar
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (job_id, station_id, round)
);
create index if not exists prd_job_ops_station_idx on prd_job_ops (station_id, status);
create index if not exists prd_job_ops_job_idx on prd_job_ops (job_id, round, sort);

create table if not exists prd_job_materials (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  op_id uuid references prd_job_ops (id) on delete set null,
  item_id uuid not null references stk_items (id) on delete restrict,
  qty numeric(14, 3) not null,
  lot_no text, expiry_date date,
  source text not null default 'bom' check (source in ('bom', 'manual')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists prd_job_materials_job_idx on prd_job_materials (job_id);
create index if not exists prd_job_materials_lot_idx on prd_job_materials (item_id, lot_no);

create table if not exists prd_remakes (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  reason text not null check (reason in ('fit', 'color', 'fracture', 'margin', 'occlusion', 'contact', 'doctor_change', 'lab_error', 'other')),
  description text check (description is null or length(description) <= 500),
  station_id uuid references prd_stations (id) on delete set null,      -- hatanın kaynağı
  employee_id uuid references employees (id) on delete set null,
  restart_station_id uuid references prd_stations (id) on delete set null,
  chargeable boolean not null default false,                            -- hekime ücretlendirilir mi
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists prd_remakes_job_idx on prd_remakes (job_id);

alter table prd_stations enable row level security;
alter table prd_route_steps enable row level security;
alter table prd_job_ops enable row level security;
alter table prd_job_materials enable row level security;
alter table prd_remakes enable row level security;
do $$ declare t text; begin
  foreach t in array array['prd_stations', 'prd_route_steps', 'prd_job_ops', 'prd_job_materials', 'prd_remakes'] loop
    execute format('drop policy if exists %1$s_read on %1$s', t);
    execute format('create policy %1$s_read on %1$s for select to authenticated using (can_module(''production'') or can_logistics())', t);
    execute format('grant select on %s to authenticated', t);
  end loop;
end $$;
drop policy if exists prd_stations_write on prd_stations;
create policy prd_stations_write on prd_stations for all to authenticated using (can_module('production', 3)) with check (can_module('production', 3));
drop policy if exists prd_route_steps_write on prd_route_steps;
create policy prd_route_steps_write on prd_route_steps for all to authenticated using (can_module('production', 2)) with check (can_module('production', 2));
grant insert, update, delete on prd_stations, prd_route_steps to authenticated;

create or replace function prd_allowed() returns boolean language sql stable security definer set search_path = public as $$
  select can_module('production', 2) or can_logistics();
$$;

-- Kullanıcının personel kaydı (okutmayı yapan teknisyen)
create or replace function prd_my_employee() returns uuid language sql stable security definer set search_path = public as $$
  select id from employees where user_id = auth.uid() limit 1;
$$;

-- İş planı: işin ürünlerinin rotalarından istasyon adımları (aynı istasyon bir kez, en küçük sıra)
create or replace function prd_plan(p_job uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_round int;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select coalesce(max(round), 1) into v_round from prd_job_ops where job_id = p_job;
  if exists (select 1 from prd_job_ops where job_id = p_job and round = v_round) then return 0; end if;
  insert into prd_job_ops (job_id, station_id, sort, qty, std_minutes, consume, round)
  select p_job, r.station_id, min(s.sort * 100 + r.sort), greatest(sum(i.qty)::int, 1),
         sum(coalesce(r.std_minutes, 0) * i.qty)::int, bool_or(r.consume), v_round
  from job_items i
  join prd_route_steps r on r.lab_product_id = i.product_id
  join prd_stations s on s.id = r.station_id and s.is_active
  where i.job_id = p_job
  group by r.station_id;
  get diagnostics n = row_count;
  -- rota tanımlı değilse varsayılan: tüm aktif istasyonlar değil, yalnız kalite kontrol
  if n = 0 then
    insert into prd_job_ops (job_id, station_id, sort, qty, consume, round)
    select p_job, s.id, s.sort * 100, greatest((select coalesce(sum(qty), 1) from job_items where job_id = p_job)::int, 1), true, v_round
    from prd_stations s where s.company_id = lab_company() and s.is_active and s.kind = 'qc' order by s.sort limit 1;
    get diagnostics n = row_count;
  end if;
  -- ilk adım hazır
  update prd_job_ops set status = 'ready' where id = (select id from prd_job_ops where job_id = p_job and round = v_round order by sort limit 1);
  return n;
end $$;
revoke execute on function prd_plan(uuid) from public, anon;
grant execute on function prd_plan(uuid) to authenticated;

-- Reçeteden malzeme düşümü: önce üretim deposu, yetmezse ana depo; kullanılan lotlar işe yazılır
create or replace function prd_consume(p_op uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  o prd_job_ops; j jobs; b record; v_need numeric; v_have numeric; v_take numeric; v_prod uuid; v_main uuid; v_used jsonb; u jsonb; v_warn jsonb := '[]'::jsonb;
begin
  select * into o from prd_job_ops where id = p_op;
  select * into j from jobs where id = o.job_id;
  select id into v_prod from stk_warehouses where company_id = lab_company() and kind = 'production' and is_active order by created_at limit 1;
  v_main := stk_default_warehouse();
  for b in
    select bm.item_id, si.name, si.unit, sum(i.qty * bm.qty * (1 + bm.waste_pct / 100)) as qty
    from job_items i join stk_boms bm on bm.lab_product_id = i.product_id join stk_items si on si.id = bm.item_id
    where i.job_id = j.id and si.kind <> 'service'
      -- işin birden çok tüketim adımı varsa malzeme yalnız ilk biten tüketim adımında düşer
      and not exists (select 1 from prd_job_materials m where m.job_id = j.id and m.source = 'bom' and m.item_id = bm.item_id
                      and m.op_id in (select id from prd_job_ops where job_id = j.id and round = o.round))
    group by bm.item_id, si.name, si.unit
  loop
    v_need := round(b.qty, 3);
    if v_need <= 0 then continue; end if;
    -- üretim deposundan
    if v_prod is not null then
      select greatest(coalesce(sum(qty), 0), 0) into v_have from stk_moves where item_id = b.item_id and warehouse_id = v_prod;
      v_take := least(v_need, v_have);
      if v_take > 0 then
        v_used := stk_consume_fifo(b.item_id, v_prod, v_take, 'consume', current_date, 'job', j.id, j.id, 'İş #' || j.no);
        for u in select * from jsonb_array_elements(v_used) loop
          insert into prd_job_materials (job_id, op_id, item_id, qty, lot_no, expiry_date, source) values (j.id, o.id, b.item_id, (u->>'qty')::numeric, u->>'lot', nullif(u->>'expiry', '')::date, 'bom');
        end loop;
        v_need := v_need - v_take;
      end if;
    end if;
    -- ana depodan
    if v_need > 0 and v_main is not null and v_main is distinct from v_prod then
      select greatest(coalesce(sum(qty), 0), 0) into v_have from stk_moves where item_id = b.item_id and warehouse_id = v_main;
      v_take := least(v_need, v_have);
      if v_take > 0 then
        v_used := stk_consume_fifo(b.item_id, v_main, v_take, 'consume', current_date, 'job', j.id, j.id, 'İş #' || j.no);
        for u in select * from jsonb_array_elements(v_used) loop
          insert into prd_job_materials (job_id, op_id, item_id, qty, lot_no, expiry_date, source) values (j.id, o.id, b.item_id, (u->>'qty')::numeric, u->>'lot', nullif(u->>'expiry', '')::date, 'bom');
        end loop;
        v_need := v_need - v_take;
      end if;
    end if;
    -- stok yetmedi: eksi stok yazılır, uyarı döner (üretim durmasın)
    if v_need > 0 then
      perform stk_move_sys(b.item_id, coalesce(v_prod, v_main), -v_need, 'consume', null, null, null, current_date, 'job', j.id, j.id, null, 'İş #' || j.no || ' (stok yetersiz)');
      insert into prd_job_materials (job_id, op_id, item_id, qty, source) values (j.id, o.id, b.item_id, v_need, 'bom');
      v_warn := v_warn || jsonb_build_object('item', b.name, 'missing', v_need, 'unit', b.unit);
    end if;
  end loop;
  return v_warn;
end $$;
revoke execute on function prd_consume(uuid) from public, anon, authenticated;

-- Operasyon işlemi: start | finish | pause | skip | reset
create or replace function prd_op_action(p_op uuid, p_action text, p_employee uuid default null, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o prd_job_ops; v_emp uuid := coalesce(p_employee, prd_my_employee()); v_next uuid; v_warn jsonb := '[]'::jsonb; v_left int; j jobs;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into o from prd_job_ops where id = p_op for update;
  if o.id is null then raise exception 'not_found'; end if;
  if p_action = 'start' then
    if o.status not in ('waiting', 'ready', 'paused') then raise exception 'bad_status'; end if;
    update prd_job_ops set status = 'in_progress', started_at = coalesce(started_at, now()), started_by = auth.uid(), employee_id = coalesce(v_emp, employee_id), note = coalesce(nullif(p_note, ''), note) where id = o.id;
    -- işin durumu: açık
    update jobs set status = 'open' where id = o.job_id and status = 'ready';
  elsif p_action = 'pause' then
    if o.status <> 'in_progress' then raise exception 'bad_status'; end if;
    update prd_job_ops set status = 'paused', work_minutes = coalesce(work_minutes, 0) + greatest(0, extract(epoch from now() - started_at) / 60)::int, started_at = null where id = o.id;
  elsif p_action in ('finish', 'skip') then
    if o.status in ('done', 'skipped') then raise exception 'bad_status'; end if;
    update prd_job_ops set status = case when p_action = 'skip' then 'skipped' else 'done' end, finished_at = now(), finished_by = auth.uid(),
      employee_id = coalesce(employee_id, v_emp),
      started_at = coalesce(started_at, now()),
      work_minutes = case when p_action = 'skip' then work_minutes else coalesce(work_minutes, 0) + case when o.started_at is not null then greatest(0, extract(epoch from now() - o.started_at) / 60)::int else 0 end end,
      note = coalesce(nullif(p_note, ''), note)
    where id = o.id;
    if p_action = 'finish' and o.consume then v_warn := prd_consume(o.id); end if;
    select id into v_next from prd_job_ops where job_id = o.job_id and round = o.round and status = 'waiting' order by sort limit 1;
    if v_next is not null then update prd_job_ops set status = 'ready' where id = v_next; end if;
    select count(*) into v_left from prd_job_ops where job_id = o.job_id and round = o.round and status not in ('done', 'skipped');
    if v_left = 0 then
      update jobs set status = 'ready' where id = o.job_id and status in ('open', 'tryin');
    end if;
  elsif p_action = 'reset' then
    if not can_module('production', 3) and not can_logistics() then raise exception 'not_allowed'; end if;
    update prd_job_ops set status = 'ready', started_at = null, finished_at = null, work_minutes = null where id = o.id;
  else
    raise exception 'bad_action';
  end if;
  select * into j from jobs where id = o.job_id;
  return jsonb_build_object('job', j.no, 'status', (select status from prd_job_ops where id = o.id), 'warnings', v_warn);
end $$;
revoke execute on function prd_op_action(uuid, text, uuid, text) from public, anon;
grant execute on function prd_op_action(uuid, text, uuid, text) to authenticated;

-- Barkod / iş no okutma: istasyondaki adımı başlatır, başlamışsa bitirir
--  kod: 539340 | IS539340 | iş kaydı uuid'i | .../isler/<uuid>
create or replace function prd_scan(p_code text, p_station uuid, p_employee uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_code text := upper(trim(coalesce(p_code, ''))); j jobs; o prd_job_ops; v_uuid text; r jsonb; v_station prd_stations;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  v_uuid := substring(lower(v_code) from '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})');
  if v_uuid is not null then select * into j from jobs where id = v_uuid::uuid;
  else
    v_code := regexp_replace(v_code, '^(IS|İŞ|IŞ|JOB)[- ]?', '');
    if v_code ~ '^[0-9]{1,12}$' then select * into j from jobs where no = v_code::bigint; end if;
    if j.id is null then select * into j from jobs where upper(slip_no) = v_code order by created_at desc limit 1; end if;
  end if;
  if j.id is null then raise exception 'job_not_found'; end if;
  if j.status = 'cancelled' then raise exception 'job_cancelled'; end if;
  perform prd_plan(j.id);
  select * into v_station from prd_stations where id = p_station;
  select * into o from prd_job_ops where job_id = j.id and station_id = p_station and round = (select max(round) from prd_job_ops where job_id = j.id);
  if o.id is null then
    -- rotada yoksa istasyon adımı eklenir (ör. ek rötuş)
    insert into prd_job_ops (job_id, station_id, sort, qty, status, round)
    values (j.id, p_station, coalesce(v_station.sort, 0) * 100, greatest((select coalesce(sum(qty), 1) from job_items where job_id = j.id)::int, 1), 'ready',
            (select max(round) from prd_job_ops where job_id = j.id))
    returning * into o;
  end if;
  if o.status in ('done', 'skipped') then
    return jsonb_build_object('job', j.no, 'job_id', j.id, 'patient', j.patient, 'action', 'already_done', 'status', o.status);
  end if;
  r := prd_op_action(o.id, case when o.status = 'in_progress' then 'finish' else 'start' end, p_employee, null);
  return r || jsonb_build_object('job_id', j.id, 'patient', j.patient, 'action', case when o.status = 'in_progress' then 'finished' else 'started' end, 'due', j.due_date);
end $$;
revoke execute on function prd_scan(text, uuid, uuid) from public, anon;
grant execute on function prd_scan(text, uuid, uuid) to authenticated;

-- Yeniden yapım: neden kaydı + seçilen istasyondan itibaren yeni tur
create or replace function prd_remake(p_job uuid, p_reason text, p_description text, p_station uuid, p_restart uuid, p_chargeable boolean default false, p_employee uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_round int; v_restart_sort int;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  insert into prd_remakes (job_id, reason, description, station_id, employee_id, restart_station_id, chargeable)
  values (p_job, p_reason, nullif(left(coalesce(p_description, ''), 500), ''), p_station, p_employee, p_restart, coalesce(p_chargeable, false))
  returning id into v_id;
  select coalesce(max(round), 0) into v_round from prd_job_ops where job_id = p_job;
  if v_round = 0 then perform prd_plan(p_job); v_round := 1; end if;
  select sort into v_restart_sort from prd_job_ops where job_id = p_job and round = v_round and station_id = p_restart;
  -- yeni tur: yeniden başlanan istasyon ve sonrası
  insert into prd_job_ops (job_id, station_id, sort, qty, std_minutes, consume, round, status)
  select job_id, station_id, sort, qty, std_minutes, consume, v_round + 1, 'waiting'
  from prd_job_ops where job_id = p_job and round = v_round and (v_restart_sort is null or sort >= v_restart_sort);
  update prd_job_ops set status = 'ready' where id = (select id from prd_job_ops where job_id = p_job and round = v_round + 1 order by sort limit 1);
  update jobs set status = 'open' where id = p_job and status in ('ready', 'tryin');
  return v_id;
end $$;
revoke execute on function prd_remake(uuid, text, text, uuid, uuid, boolean, uuid) from public, anon;
grant execute on function prd_remake(uuid, text, text, uuid, uuid, boolean, uuid) to authenticated;

-- Elle malzeme / lot girişi (ör. reçetede olmayan, implant parçası)
create or replace function prd_material_add(p_job uuid, p_item uuid, p_qty numeric, p_lot text, p_warehouse uuid) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; it stk_items; v_wh uuid; v_used jsonb; u jsonb;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into j from jobs where id = p_job;
  select * into it from stk_items where id = p_item;
  if j.id is null or it.id is null then raise exception 'not_found'; end if;
  if p_qty is null or p_qty <= 0 then raise exception 'qty'; end if;
  v_wh := coalesce(p_warehouse, (select id from stk_warehouses where company_id = lab_company() and kind = 'production' and is_active limit 1), stk_default_warehouse());
  if nullif(trim(coalesce(p_lot, '')), '') is not null then
    perform stk_move_sys(p_item, v_wh, -p_qty, 'consume', null, trim(p_lot), (select max(expiry_date) from stk_moves where item_id = p_item and lot_no = trim(p_lot)), current_date, 'job', j.id, j.id, null, 'İş #' || j.no);
    insert into prd_job_materials (job_id, item_id, qty, lot_no, expiry_date, source)
    values (j.id, p_item, p_qty, trim(p_lot), (select max(expiry_date) from stk_moves where item_id = p_item and lot_no = trim(p_lot)), 'manual');
  else
    v_used := stk_consume_fifo(p_item, v_wh, p_qty, 'consume', current_date, 'job', j.id, j.id, 'İş #' || j.no);
    for u in select * from jsonb_array_elements(v_used) loop
      insert into prd_job_materials (job_id, item_id, qty, lot_no, expiry_date, source) values (j.id, p_item, (u->>'qty')::numeric, u->>'lot', nullif(u->>'expiry', '')::date, 'manual');
    end loop;
  end if;
end $$;
revoke execute on function prd_material_add(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function prd_material_add(uuid, uuid, numeric, text, uuid) to authenticated;

-- Lot geri çağırma: bu lot hangi işlerde / hangi hekimlerde kullanıldı
create or replace function prd_lot_trace(p_item uuid, p_lot text) returns table (job_id uuid, job_no bigint, patient text, customer text, used_at timestamptz, qty numeric)
language sql stable security definer set search_path = public as $$
  select j.id, j.no, j.patient, c.name, m.created_at, m.qty
  from prd_job_materials m join jobs j on j.id = m.job_id left join lab_customers c on c.id = j.customer_id
  where m.item_id = p_item and m.lot_no = p_lot and (can_module('production') or can_module('stock') or can_logistics())
  order by m.created_at desc;
$$;
revoke execute on function prd_lot_trace(uuid, text) from public, anon;
grant execute on function prd_lot_trace(uuid, text) to authenticated;

notify pgrst, 'reload schema';
