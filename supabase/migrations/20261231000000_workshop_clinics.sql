-- =====================================================================
-- ATÖLYE EKRANI: FİRMA BAZINDA İLERLEME
--  prd_workshop_clinics() : her klinik / firma için "gelen parti" ilerlemesi
--    since    : firmanın en eski açık işinin giriş günü (en fazla 30 gün geriye); açık işi yoksa bugün çıkanların giriş günü
--    total    : since'ten beri gelen (iptal olmayan) işler
--    out_n    : bunlardan teslim edilenler
--    open_n   : hâlâ içeride olanlar (30 günden eski açık işler dahil)
--    pending  : kalan işler (no, aşama, teslim tarihi), en yakın teslimden başlayarak en çok 4
--  Ör. Odonto: 10 iş gelmiş, 9 çıkmış, 1 kalmış (#1234 · Kalite kontrol).
-- Tekrar çalıştırılabilir. Önce 20261213000000_workshop.sql.
-- =====================================================================

create or replace function prd_workshop_clinics()
returns table (id uuid, name text, since date, total int, out_n int, open_n int, out_today int, late int, open_units numeric, next_due date, pending jsonb)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_from timestamptz := (v_today::timestamp at time zone 'Europe/Istanbul');
begin
  if not (can_module('production') or can_logistics()) then raise exception 'not_allowed'; end if;
  return query
  with op as (
    select j.id, j.no, j.customer_id, j.in_date, j.due_date, j.flow_stage, job_units(j.id) u
    from jobs j where j.status not in ('delivered', 'cancelled') and j.customer_id is not null
  ), outt as (
    select j.customer_id, min(j.in_date) d, count(*) n from jobs j
    where j.status = 'delivered' and j.delivered_at >= v_from and j.customer_id is not null group by j.customer_id
  ), cust as (
    select c.id, c.name,
      coalesce((select greatest(min(o.in_date), v_today - 30) from op o where o.customer_id = c.id having count(*) > 0), (select t.d from outt t where t.customer_id = c.id), v_today) s
    from lab_customers c
    where exists (select 1 from op o where o.customer_id = c.id) or exists (select 1 from outt t where t.customer_id = c.id)
  )
  select cu.id, cu.name, cu.s,
    ((select count(*) from jobs j where j.customer_id = cu.id and j.status = 'delivered' and j.in_date >= cu.s)
      + (select count(*) from op o where o.customer_id = cu.id))::int,
    (select count(*) from jobs j where j.customer_id = cu.id and j.status = 'delivered' and j.in_date >= cu.s)::int,
    (select count(*) from op o where o.customer_id = cu.id)::int,
    coalesce((select t.n from outt t where t.customer_id = cu.id), 0)::int,
    (select count(*) from op o where o.customer_id = cu.id and o.due_date < v_today)::int,
    coalesce((select sum(o.u) from op o where o.customer_id = cu.id), 0),
    (select min(o.due_date) from op o where o.customer_id = cu.id),
    coalesce((select jsonb_agg(jsonb_build_object('no', x.no, 'stage', x.flow_stage, 'due', x.due_date) order by x.due_date nulls last, x.no)
      from (select o.no, o.flow_stage, o.due_date from op o where o.customer_id = cu.id order by o.due_date nulls last, o.no limit 4) x), '[]'::jsonb)
  from cust cu;
end $$;
revoke execute on function prd_workshop_clinics() from public, anon;
grant execute on function prd_workshop_clinics() to authenticated;

notify pgrst, 'reload schema';
