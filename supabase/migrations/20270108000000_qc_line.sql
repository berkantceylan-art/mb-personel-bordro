-- =====================================================================
-- KALİTE KONTROL HATTI: birinci kontrol → son kontrol → paketleme / çıkış (kutu akışı üzerine)
--  Mevcut akış rolleri: chief = birinci kontrol, qc = son kontrol, dispatch = paketleme / çıkış
--  job_qc_checks  : her kontrolün kontrol listesi, sonucu (geçti / kaldı), notu ve fotoğrafı
--  job_packages   : paket (PK-), hekime göre; paketleyen kişi kayıtlı; kapatınca isteğe bağlı toplu çıkış
--  prd_qc_decide  : kontrol listesiyle onayla / geri gönder (prd_flow_scan üzerinden)
--  prd_pack_scan / prd_pack_remove / prd_pack_close / prd_pack_list
-- Tekrar çalıştırılabilir. Önce 20261209000000_job_flow.sql.
-- =====================================================================

alter table job_handoffs drop constraint if exists job_handoffs_action_check;
alter table job_handoffs add constraint job_handoffs_action_check check (action in ('take', 'done', 'approve', 'reject', 'exit', 'tryin_out', 'note', 'pack'));

create table if not exists job_qc_checks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  job_id uuid not null references jobs (id) on delete cascade,
  stage text not null check (stage in ('chief', 'qc')),
  employee_id uuid references employees (id) on delete set null,
  passed boolean not null,
  items jsonb not null default '[]'::jsonb,                 -- [{key, label, ok}]
  note text check (note is null or length(note) <= 500),
  target_employee_id uuid references employees (id) on delete set null,
  photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) <= 900000)),
  at timestamptz not null default now()
);
create index if not exists job_qc_checks_job_idx on job_qc_checks (job_id, at);
create index if not exists job_qc_checks_at_idx on job_qc_checks (company_id, at desc);
alter table job_qc_checks enable row level security;
drop policy if exists job_qc_checks_read on job_qc_checks;
create policy job_qc_checks_read on job_qc_checks for select to authenticated using (company_id = lab_company() and (can_module('production') or can_logistics() or prd_in_flow()));
grant select on job_qc_checks to authenticated;

create table if not exists job_packages (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null default extract(year from now())::int,
  no int not null,
  customer_id uuid references lab_customers (id) on delete set null,
  packer_employee_id uuid references employees (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  exited boolean not null default false,
  note text check (note is null or length(note) <= 300),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (company_id, year, no)
);
create index if not exists job_packages_open_idx on job_packages (company_id, status, created_at desc);
alter table jobs add column if not exists package_id uuid references job_packages (id) on delete set null;
alter table jobs add column if not exists packed_by uuid references employees (id) on delete set null;
alter table jobs add column if not exists packed_at timestamptz;
alter table job_packages enable row level security;
drop policy if exists job_packages_read on job_packages;
create policy job_packages_read on job_packages for select to authenticated using (company_id = lab_company() and (can_module('production') or can_logistics() or prd_in_flow()));
grant select on job_packages to authenticated;

-- Kontrol kararı: p_stage chief | qc; p_pass true → onay (bir sonraki aşamaya), false → geri gönder (p_target / son teknisyen)
create or replace function prd_qc_decide(p_code text, p_employee uuid, p_stage text, p_pass boolean, p_items jsonb default '[]', p_note text default null, p_target uuid default null, p_photo text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jobs; v_emp uuid := coalesce(p_employee, prd_my_employee()); v_role text; r jsonb;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  if p_stage not in ('chief', 'qc') then raise exception 'bad_action'; end if;
  select flow_role into v_role from prd_people where employee_id = v_emp and is_active;
  if coalesce(v_role, '') <> p_stage then raise exception 'role_required'; end if;
  j := prd_find_job(p_code);
  if j.id is null then raise exception 'job_not_found'; end if;
  if not p_pass and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'reason_required'; end if;
  -- elinde değilse önce al
  if j.holder_employee_id is distinct from v_emp then perform prd_flow_scan(j.no::text, v_emp, 'take', null, null); end if;
  r := prd_flow_scan(j.no::text, v_emp, case when p_pass then 'approve' else 'reject' end, case when p_pass then null else p_note end, p_target);
  insert into job_qc_checks (job_id, stage, employee_id, passed, items, note, target_employee_id, photo)
  values (j.id, p_stage, v_emp, p_pass, coalesce(p_items, '[]'::jsonb), nullif(left(trim(coalesce(p_note, '')), 500), ''),
          case when not p_pass then (select target_employee_id from job_handoffs where job_id = j.id and action = 'reject' order by at desc limit 1) end,
          case when coalesce(p_photo, '') like 'data:image/jpeg;base64,%' and length(p_photo) <= 900000 then p_photo end);
  return r;
end $$;
revoke execute on function prd_qc_decide(text, uuid, text, boolean, jsonb, text, uuid, text) from public, anon;
grant execute on function prd_qc_decide(text, uuid, text, boolean, jsonb, text, uuid, text) to authenticated;

-- Paket satırları ve özet
create or replace function prd_pack_get(p_package uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', p.id, 'no', 'PK-' || p.year || '-' || lpad(p.no::text, 4, '0'), 'status', p.status, 'exited', p.exited, 'customer', c.name, 'customer_id', p.customer_id,
    'packer', e.first_name || ' ' || e.last_name, 'created_at', p.created_at, 'closed_at', p.closed_at,
    'jobs', coalesce((select jsonb_agg(jsonb_build_object('id', j.id, 'no', j.no, 'patient', j.patient, 'doctor', j.doctor_name, 'status', j.status, 'due', j.due_date,
                                                       'qty', (select coalesce(sum(i.qty), 0) from job_items i where i.job_id = j.id),
                                                       'items', (select string_agg(i.name || ' ×' || i.qty, ', ' order by i.sort) from job_items i where i.job_id = j.id)) order by j.packed_at)
                      from jobs j where j.package_id = p.id), '[]'::jsonb))
  from job_packages p left join lab_customers c on c.id = p.customer_id left join employees e on e.id = p.packer_employee_id
  where p.id = p_package and p.company_id = lab_company() and (can_module('production') or can_logistics() or prd_in_flow());
$$;
revoke execute on function prd_pack_get(uuid) from public, anon;
grant execute on function prd_pack_get(uuid) to authenticated;

-- Okut ve pakete koy: son kontrolden geçmiş olmalı; hekimin bu paketleyicideki açık paketine eklenir (yoksa açılır)
create or replace function prd_pack_scan(p_code text, p_employee uuid default null, p_package uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare j jobs; v_emp uuid := coalesce(p_employee, prd_my_employee()); v_role text; v_pkg job_packages; v_year int := extract(year from now())::int; v_warn text;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select flow_role into v_role from prd_people where employee_id = v_emp and is_active;
  if coalesce(v_role, '') <> 'dispatch' and not can_module('production', 3) then raise exception 'role_required'; end if;
  j := prd_find_job(p_code);
  if j.id is null then raise exception 'job_not_found'; end if;
  select * into j from jobs where id = j.id for update;
  if j.status in ('cancelled') then raise exception 'job_cancelled'; end if;
  if j.status = 'delivered' then raise exception 'already_out'; end if;
  if j.qc_passed_at is null then raise exception 'qc_required'; end if;
  if j.package_id is not null and exists (select 1 from job_packages where id = j.package_id and status = 'open') then
    return jsonb_build_object('package', j.package_id, 'job', j.no, 'patient', j.patient, 'duplicate', true);
  end if;
  if p_package is not null then
    select * into v_pkg from job_packages where id = p_package and company_id = lab_company() and status = 'open';
    if v_pkg.id is not null and v_pkg.customer_id is distinct from j.customer_id then
      v_warn := 'Farklı hekim: bu iş kendi paketine konuldu';
      v_pkg := null;
    end if;
  end if;
  if v_pkg.id is null then
    select * into v_pkg from job_packages where company_id = lab_company() and status = 'open' and customer_id is not distinct from j.customer_id
      and packer_employee_id = v_emp and created_at > now() - interval '18 hours' order by created_at desc limit 1;
  end if;
  if v_pkg.id is null then
    insert into job_packages (year, no, customer_id, packer_employee_id) values (v_year, lab_next_no('pk', v_year), j.customer_id, v_emp) returning * into v_pkg;
  end if;
  update jobs set package_id = v_pkg.id, packed_by = v_emp, packed_at = now(), holder_employee_id = v_emp, holder_since = now(), flow_stage = 'dispatch' where id = j.id;
  insert into job_handoffs (job_id, employee_id, action, stage, reason, qty)
  values (j.id, v_emp, 'pack', 'dispatch', 'PK-' || v_pkg.year || '-' || lpad(v_pkg.no::text, 4, '0'), (select coalesce(sum(qty), 1) from job_items where job_id = j.id));
  return jsonb_build_object('package', v_pkg.id, 'job', j.no, 'patient', j.patient, 'duplicate', false, 'warning', v_warn);
end $$;
revoke execute on function prd_pack_scan(text, uuid, uuid) from public, anon;
grant execute on function prd_pack_scan(text, uuid, uuid) to authenticated;

create or replace function prd_pack_remove(p_job uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  update jobs j set package_id = null, packed_by = null, packed_at = null
  from job_packages p where j.id = p_job and p.id = j.package_id and p.status = 'open' and p.company_id = lab_company();
end $$;
revoke execute on function prd_pack_remove(uuid) from public, anon;
grant execute on function prd_pack_remove(uuid) to authenticated;

-- Paketi kapat; p_exit → paketteki işlerin çıkışı yapılır (teslim, cariye işlenir)
create or replace function prd_pack_close(p_package uuid, p_exit boolean, p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare p job_packages; j record; n int := 0;
begin
  if not prd_allowed() then raise exception 'not_allowed'; end if;
  select * into p from job_packages where id = p_package and company_id = lab_company() for update;
  if p.id is null or p.status <> 'open' then raise exception 'bad_status'; end if;
  if not exists (select 1 from jobs where package_id = p.id) then raise exception 'empty_package'; end if;
  if p_exit then
    for j in select no from jobs where package_id = p.id and status <> 'delivered' loop
      perform prd_flow_scan(j.no::text, p.packer_employee_id, 'exit', null, null);
      n := n + 1;
    end loop;
  end if;
  update job_packages set status = 'closed', closed_at = now(), exited = p_exit, note = nullif(left(trim(coalesce(p_note, '')), 300), '') where id = p.id;
  return n;
end $$;
revoke execute on function prd_pack_close(uuid, boolean, text) from public, anon;
grant execute on function prd_pack_close(uuid, boolean, text) to authenticated;

-- Açık paketler (paketleme ekranı) ve bugün kapananlar
create or replace function prd_pack_list() returns table (id uuid, no text, status text, exited boolean, customer text, packer text, packer_id uuid, jobs int, created_at timestamptz, closed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select p.id, 'PK-' || p.year || '-' || lpad(p.no::text, 4, '0'), p.status, p.exited, c.name, e.first_name || ' ' || e.last_name, p.packer_employee_id,
         (select count(*)::int from jobs j where j.package_id = p.id), p.created_at, p.closed_at
  from job_packages p left join lab_customers c on c.id = p.customer_id left join employees e on e.id = p.packer_employee_id
  where p.company_id = lab_company() and (can_module('production') or can_logistics() or prd_in_flow())
    and (p.status = 'open' or p.closed_at > now() - interval '24 hours')
  order by p.status, p.created_at desc;
$$;
revoke execute on function prd_pack_list() from public, anon;
grant execute on function prd_pack_list() to authenticated;

-- Kontrol hattı panosu: aşama sayıları, bekleme süreleri, son 30 gün ret oranları
create or replace function prd_qc_board() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('production') or can_logistics() or prd_in_flow() then jsonb_build_object(
    'stages', (select coalesce(jsonb_object_agg(s.flow_stage, jsonb_build_object('n', s.n, 'waiting', s.w, 'oldest', s.o)), '{}'::jsonb) from (
       select flow_stage, count(*) n, count(*) filter (where holder_employee_id is null) w, min(holder_since) o
       from jobs where company_id = lab_company() and status not in ('delivered', 'cancelled') and flow_stage in ('production', 'chief', 'qc', 'dispatch') group by flow_stage) s),
    'today', jsonb_build_object(
       'chief', (select count(*) from job_qc_checks where company_id = lab_company() and stage = 'chief' and passed and at::date = current_date),
       'qc', (select count(*) from job_qc_checks where company_id = lab_company() and stage = 'qc' and passed and at::date = current_date),
       'packed', (select count(*) from jobs where company_id = lab_company() and packed_at::date = current_date),
       'rejects', (select count(*) from job_qc_checks where company_id = lab_company() and not passed and at::date = current_date)),
    'techs', (select coalesce(jsonb_agg(t order by t.rejects desc, t.name), '[]'::jsonb) from (
       select e.first_name || ' ' || e.last_name as name,
              count(*) filter (where not c.passed) as rejects,
              (select count(*) from job_handoffs h where h.employee_id = e.id and h.action = 'done' and h.at > now() - interval '30 days') as done
       from job_qc_checks c join employees e on e.id = c.target_employee_id
       where c.company_id = lab_company() and c.at > now() - interval '30 days' group by e.id, e.first_name, e.last_name limit 15) t),
    'reasons', (select coalesce(jsonb_agg(r order by r.n desc), '[]'::jsonb) from (
       select x->>'label' as label, count(*) as n from job_qc_checks c, jsonb_array_elements(c.items) x
       where c.company_id = lab_company() and c.at > now() - interval '30 days' and (x->>'ok')::boolean is false group by 1 order by 2 desc limit 8) r)
  ) end;
$$;
revoke execute on function prd_qc_board() from public, anon;
grant execute on function prd_qc_board() to authenticated;

notify pgrst, 'reload schema';
