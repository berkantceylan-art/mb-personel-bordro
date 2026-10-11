-- =====================================================================
-- AKILLI ÖZELLİKLER
--  prd_stage_hours()   : son 120 günde teslim edilen işlerde her aşamadan çıkışa kadar geçen ortalama saat
--  prd_delay_risk()    : açık işler için tahmini hazır olma zamanı ve gecikme riski (geçmiş akış hızına göre)
-- Tekrar çalıştırılabilir. Önce 20261218000000_cashflow_kpi.sql.
-- =====================================================================

create or replace function prd_stage_hours() returns table (stage text, hours numeric, samples int)
language sql stable security definer set search_path = public as $$
  with ex as (
    select h.job_id, min(h.at) filter (where h.action in ('exit')) exit_at from job_handoffs h group by h.job_id having min(h.at) filter (where h.action = 'exit') > now() - interval '120 days'
  ),
  firsts as (
    select h.job_id, h.stage, min(h.at) first_at from job_handoffs h join ex on ex.job_id = h.job_id where h.action = 'take' group by h.job_id, h.stage
  )
  select f.stage, round(avg(extract(epoch from (ex.exit_at - f.first_at)) / 3600.0)::numeric, 1), count(*)::int
  from firsts f join ex on ex.job_id = f.job_id
  where can_module('production') or can_logistics()
  group by f.stage;
$$;
revoke execute on function prd_stage_hours() from public, anon;
grant execute on function prd_stage_hours() to authenticated;

-- Varsayılan (geçmiş veri azsa): aşama başına kalan saat
create or replace function prd_delay_risk() returns table (job_id uuid, no bigint, customer text, patient text, due_date date, flow_stage text, eta timestamptz, slack_hours numeric, risk text)
language sql stable security definer set search_path = public as $$
  with sh as (select stage, hours, samples from prd_stage_hours()),
  def(stage, hours) as (values ('reception', 72.0), ('production', 48.0), ('chief', 12.0), ('qc', 8.0), ('dispatch', 4.0), ('tryin', 96.0)),
  rate as (select stage, coalesce((select case when sh.samples >= 5 then sh.hours end from sh where sh.stage = def.stage), def.hours) h from def),
  j as (
    select j.id, j.no, c.name customer, j.patient, j.due_date, j.flow_stage,
      now() + make_interval(secs => (coalesce((select h from rate where rate.stage = j.flow_stage), 48)
        * case when j.holder_employee_id is null and j.flow_stage in ('reception', 'production') then 1.25 else 1 end) * 3600) eta
    from jobs j left join lab_customers c on c.id = j.customer_id
    where j.status not in ('delivered', 'cancelled') and j.flow_stage <> 'tryin' and j.due_date is not null
      and (can_module('production') or can_logistics())
  )
  select id, no, customer, patient, due_date, flow_stage, eta,
    round((extract(epoch from (((due_date + 1)::timestamp at time zone 'Europe/Istanbul') - eta)) / 3600.0)::numeric, 1),
    case when due_date < (now() at time zone 'Europe/Istanbul')::date then 'late'
         when eta > ((due_date + 1)::timestamp at time zone 'Europe/Istanbul') then 'high'
         when eta > ((due_date + 1)::timestamp at time zone 'Europe/Istanbul') - interval '12 hours' then 'medium'
         else 'low' end
  from j
  order by 8;
$$;
revoke execute on function prd_delay_risk() from public, anon;
grant execute on function prd_delay_risk() to authenticated;

notify pgrst, 'reload schema';
