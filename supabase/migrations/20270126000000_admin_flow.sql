-- Kontrol Merkezi · İş akışı denetimi: iş kaydından teslime her aşamada takılan, sahipsiz, gecikmiş işler;
-- yönetici her aşamayı tek yerden çözer (sorumlu ata, aşamaya taşı, not yaz). Tekrar çalıştırılabilir.

create or replace function adm_flow_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select adm_allowed() or can_module('production', 3) or can_module('lab', 3);
$$;
grant execute on function adm_flow_allowed() to authenticated;

-- Aşama başına "takıldı" eşiği (saat)
create or replace function adm_stage_limit(p_stage text) returns numeric language sql immutable as $$
  select case p_stage when 'reception' then 4 when 'production' then 48 when 'chief' then 12 when 'qc' then 12 when 'dispatch' then 24 when 'tryin' then 240 else 1e9 end::numeric;
$$;

-- Açık işler ve aşamada geçen süre
create or replace function adm_open_jobs() returns table (
  id uuid, no bigint, customer text, patient text, stage text, holder uuid, holder_name text, since timestamptz, hours numeric, due_date date, in_date date, total bigint, currency text, status text
) language sql stable security definer set search_path = public as $$
  select j.id, j.no, c.name, j.patient, j.flow_stage, j.holder_employee_id,
         nullif(trim(coalesce(e.first_name, '') || ' ' || coalesce(e.last_name, '')), ''),
         s.since, round(extract(epoch from now() - s.since) / 3600.0, 1), j.due_date, j.in_date, j.total, j.currency, j.status
  from jobs j
  left join lab_customers c on c.id = j.customer_id
  left join employees e on e.id = j.holder_employee_id
  cross join lateral (select coalesce(j.holder_since, (select max(h.at) from job_handoffs h where h.job_id = j.id), j.created_at) as since) s
  where j.company_id = lab_company() and j.status not in ('delivered', 'cancelled') and j.flow_stage <> 'out';
$$;
revoke execute on function adm_open_jobs() from public, anon, authenticated;

-- Aşamasında eşikten uzun kalan işler (Kontrol Merkezi kuralı da bunu kullanır)
create or replace function adm_stuck_jobs() returns setof uuid language sql stable security definer set search_path = public as $$
  select id from adm_open_jobs() where hours > adm_stage_limit(stage);
$$;
revoke execute on function adm_stuck_jobs() from public, anon, authenticated;

create or replace function adm_flow_board() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not adm_flow_allowed() then raise exception 'not_allowed'; end if;
  with o as (select * from adm_open_jobs())
  select jsonb_build_object(
    'stages', coalesce((select jsonb_agg(jsonb_build_object('stage', st, 'count', n, 'avg_hours', a, 'stuck', k, 'limit', adm_stage_limit(st)) order by ord) from (
        select s.st, s.ord, count(o.id) n, round(avg(o.hours), 1) a, count(o.id) filter (where o.hours > adm_stage_limit(s.st)) k
        from (values ('reception', 1), ('production', 2), ('chief', 3), ('qc', 4), ('dispatch', 5), ('tryin', 6)) s(st, ord)
        left join o on o.stage = s.st group by s.st, s.ord) x), '[]'),
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'no', no, 'customer', customer, 'patient', patient, 'stage', stage, 'holder', holder, 'holder_name', holder_name,
        'hours', hours, 'limit', adm_stage_limit(stage), 'due', due_date, 'in', in_date, 'total', total, 'currency', currency,
        'flags', array_remove(array[
          case when hours > adm_stage_limit(stage) then 'stuck' end,
          case when due_date < current_date then 'overdue' end,
          case when due_date <= current_date + 1 and stage in ('reception', 'production') then 'due_soon' end,
          case when holder is null and stage in ('production', 'chief', 'qc') then 'no_holder' end
        ], null)) order by (due_date is null), due_date, hours desc) from o
        where hours > adm_stage_limit(stage) or due_date < current_date or (due_date <= current_date + 1 and stage in ('reception', 'production')) or (holder is null and stage in ('production', 'chief', 'qc'))), '[]'),
    'open_total', (select count(*) from o),
    'workload', coalesce((select jsonb_agg(jsonb_build_object('employee', holder, 'name', holder_name, 'count', n, 'stuck', k) order by n desc) from (
        select holder, holder_name, count(*) n, count(*) filter (where hours > adm_stage_limit(stage)) k from o where holder is not null group by holder, holder_name) w), '[]'),
    'people', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name, 'role', p.flow_role) order by p.flow_role, e.first_name)
        from prd_people p join employees e on e.id = p.employee_id where p.is_active and e.status::text <> 'terminated' and e.company_id = lab_company()), '[]'),
    'remakes', coalesce((select jsonb_agg(jsonb_build_object('job', j.id, 'no', j.no, 'customer', c.name, 'reason', r2.reason, 'at', r2.created_at) order by r2.created_at desc)
        from prd_remakes r2 join jobs j on j.id = r2.job_id left join lab_customers c on c.id = j.customer_id where j.company_id = lab_company() and r2.created_at > now() - interval '7 days'), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function adm_flow_board() from public, anon;
grant execute on function adm_flow_board() to authenticated;

-- Yönetici müdahalesi: sorumlu ata / aşamaya taşı / not
create or replace function adm_job_fix(p_job uuid, p_action text, p_stage text default null, p_employee uuid default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare j jobs; who text;
begin
  if not adm_flow_allowed() then raise exception 'not_allowed'; end if;
  select * into j from jobs where id = p_job and company_id = lab_company() for update;
  if j.id is null then raise exception 'job_not_found'; end if;
  select coalesce(nullif(display_name, ''), 'Yönetici') into who from memberships where user_id = auth.uid() and company_id = lab_company();
  if p_action = 'assign' then
    if not exists (select 1 from employees where id = p_employee and company_id = lab_company()) then raise exception 'bad_employee'; end if;
    update jobs set holder_employee_id = p_employee, holder_since = now() where id = p_job;
    insert into job_handoffs (job_id, employee_id, user_id, action, stage, target_employee_id, reason)
    values (p_job, p_employee, auth.uid(), 'note', j.flow_stage, p_employee, left('Yönetici atadı' || coalesce(': ' || nullif(trim(p_note), ''), ''), 300));
  elsif p_action = 'stage' then
    if p_stage not in ('reception', 'production', 'chief', 'qc', 'dispatch', 'tryin') then raise exception 'bad_stage'; end if;
    update jobs set flow_stage = p_stage, holder_employee_id = p_employee, holder_since = now() where id = p_job;
    insert into job_handoffs (job_id, employee_id, user_id, action, stage, target_employee_id, reason)
    values (p_job, p_employee, auth.uid(), 'note', p_stage, p_employee, left('Yönetici aşamayı değiştirdi: ' || j.flow_stage || ' → ' || p_stage || coalesce(' · ' || nullif(trim(p_note), ''), ''), 300));
  elsif p_action = 'note' then
    if length(trim(coalesce(p_note, ''))) < 1 then raise exception 'note_required'; end if;
  else raise exception 'bad_action';
  end if;
  if length(trim(coalesce(p_note, ''))) > 0 or p_action <> 'note' then
    insert into job_notes (job_id, body, author, author_name)
    values (p_job, left(case p_action when 'assign' then '🛠 Sorumlu atandı. ' when 'stage' then '🛠 Aşama değişti (' || j.flow_stage || ' → ' || p_stage || '). ' else '' end || coalesce(trim(p_note), ''), 4000), auth.uid(), who);
  end if;
  if p_employee is not null and p_action in ('assign', 'stage') then
    perform deliver(lab_company(), array(select user_id from employees where id = p_employee and user_id is not null), '🛠 Size iş atandı', '#' || j.no || coalesce(' · ' || nullif(trim(p_note), ''), ''), '/isler/' || p_job);
  end if;
end $$;
revoke execute on function adm_job_fix(uuid, text, text, uuid, text) from public, anon;
grant execute on function adm_job_fix(uuid, text, text, uuid, text) to authenticated;

notify pgrst, 'reload schema';
