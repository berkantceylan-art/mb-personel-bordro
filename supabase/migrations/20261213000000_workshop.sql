-- =====================================================================
-- ATÖLYE EKRANI: şirketteki bilgisayar / TV için tek sorguda canlı üretim özeti
--  prd_workshop_board() -> jsonb
--    today      : giren, çıkan, kalan, geciken, bugün / yarın teslim (iş ve birim)
--    month      : bu ay çıkan iş, birim, tutar (para birimine göre)
--    stages     : aşama başına iş ve birim (kimde / sırada)
--    people     : kişi başına elindeki iş ve birim, bugün biten
--    clinics    : klinik / hekim başına açık iş, birim, geciken, en yakın teslim
--    trend      : son 14 gün giren / çıkan birim
--    feed       : son 25 okutma
--    forecast   : kalan birim / son 14 gün günlük çıkış ortalaması
-- Tekrar çalıştırılabilir. Önce 20261212000000_orders.sql.
-- =====================================================================

create or replace function job_units(p_job uuid) returns numeric language sql stable as $$
  select coalesce(sum(qty), 0) from job_items where job_id = p_job and amount >= 0;
$$;

create or replace function prd_workshop_board() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_from timestamptz := (v_today::timestamp at time zone 'Europe/Istanbul');
  r jsonb;
begin
  if not (can_module('production') or can_logistics()) then raise exception 'not_allowed'; end if;
  with open as (
    select j.*, job_units(j.id) u from jobs j where j.status not in ('delivered', 'cancelled')
  ), outd as (
    select j.*, job_units(j.id) u from jobs j where j.status = 'delivered' and j.delivered_at >= v_from
  ), ind as (
    select j.*, job_units(j.id) u from jobs j where j.in_date = v_today and j.status <> 'cancelled'
  ), days as (
    select d::date d from generate_series(v_today - 13, v_today, interval '1 day') d
  ), exits14 as (
    select coalesce(sum(job_units(j.id)), 0) u from jobs j where j.status = 'delivered' and j.delivered_at >= v_from - interval '13 days'
  )
  select jsonb_build_object(
    'now', now(),
    'today', jsonb_build_object(
      'in_jobs', (select count(*) from ind), 'in_units', (select coalesce(sum(u), 0) from ind),
      'out_jobs', (select count(*) from outd), 'out_units', (select coalesce(sum(u), 0) from outd),
      'open_jobs', (select count(*) from open), 'open_units', (select coalesce(sum(u), 0) from open),
      'late_jobs', (select count(*) from open where due_date < v_today), 'late_units', (select coalesce(sum(u), 0) from open where due_date < v_today),
      'due_today', (select count(*) from open where due_date = v_today), 'due_today_units', (select coalesce(sum(u), 0) from open where due_date = v_today),
      'due_tomorrow', (select count(*) from open where due_date = v_today + 1),
      'tryin', (select count(*) from open where status = 'tryin' or flow_stage = 'tryin'),
      'unassigned', (select count(*) from open where holder_employee_id is null and flow_stage in ('reception', 'production'))
    ),
    'month', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'jobs', n, 'units', u, 'total', case when can_module('sales') or can_module('finance') then t end)), '[]'::jsonb) from (
      select j.currency, count(*) n, sum(job_units(j.id)) u, sum(j.total) t from jobs j
      where j.status = 'delivered' and j.delivered_at >= date_trunc('month', v_today)::timestamp at time zone 'Europe/Istanbul' group by j.currency) x),
    'stages', (select coalesce(jsonb_agg(jsonb_build_object('stage', s, 'jobs', n, 'units', u, 'held', h, 'late', l) order by o), '[]'::jsonb) from (
      select v.s, v.o, count(op.id) n, coalesce(sum(op.u), 0) u, count(op.holder_employee_id) h, count(*) filter (where op.due_date < v_today) l
      from (values ('reception', 1), ('production', 2), ('chief', 3), ('qc', 4), ('dispatch', 5), ('tryin', 6)) v(s, o)
      left join open op on op.flow_stage = v.s group by v.s, v.o) x),
    'people', (select coalesce(jsonb_agg(x order by x.holding desc, x.done_today desc), '[]'::jsonb) from (
      select e.id, e.first_name || ' ' || e.last_name as name, coalesce(p.flow_role, 'technician') as role,
        (select count(*) from open where holder_employee_id = e.id) as holding,
        (select coalesce(sum(u), 0) from open where holder_employee_id = e.id) as holding_units,
        (select count(*) from job_handoffs h where h.employee_id = e.id and h.at >= v_from and h.action in ('done', 'approve', 'exit')) as done_today,
        (select coalesce(sum(h.qty), 0) from job_handoffs h where h.employee_id = e.id and h.at >= v_from and h.action in ('done', 'approve', 'exit')) as units_today,
        (select min(holder_since) from open where holder_employee_id = e.id) as oldest
      from employees e left join prd_people p on p.employee_id = e.id and p.is_active
      where e.company_id = lab_company() and e.status = 'active'
        and (p.employee_id is not null or exists (select 1 from open where holder_employee_id = e.id) or exists (select 1 from job_handoffs h where h.employee_id = e.id and h.at >= v_from))) x),
    'clinics', (select coalesce(jsonb_agg(x order by x.jobs desc), '[]'::jsonb) from (
      select c.id, c.name, count(op.id) jobs, coalesce(sum(op.u), 0) units, count(*) filter (where op.due_date < v_today) late,
             min(op.due_date) next_due, (select count(*) from outd where outd.customer_id = c.id) out_today
      from open op join lab_customers c on c.id = op.customer_id group by c.id, c.name limit 40) x),
    'trend', (select jsonb_agg(jsonb_build_object('d', d,
        'in', (select coalesce(sum(job_units(j.id)), 0) from jobs j where j.in_date = days.d and j.status <> 'cancelled'),
        'out', (select coalesce(sum(job_units(j.id)), 0) from jobs j where j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date = days.d)) order by d) from days),
    'feed', (select coalesce(jsonb_agg(x order by x.at desc), '[]'::jsonb) from (
      select h.at, h.action, h.stage, j.no, e.first_name || ' ' || e.last_name who, c.name customer
      from job_handoffs h join jobs j on j.id = h.job_id left join employees e on e.id = h.employee_id left join lab_customers c on c.id = j.customer_id
      order by h.at desc limit 25) x),
    'forecast', jsonb_build_object('avg_out_units', round((select u from exits14) / 14.0, 1),
      'days_left', case when (select u from exits14) > 0 then round((select coalesce(sum(u), 0) from open) / ((select u from exits14) / 14.0), 1) end)
  ) into r;
  return r;
end $$;
revoke execute on function prd_workshop_board() from public, anon;
grant execute on function prd_workshop_board() to authenticated;

notify pgrst, 'reload schema';
