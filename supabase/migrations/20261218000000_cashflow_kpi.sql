-- =====================================================================
-- NAKİT AKIŞI TAHMİNİ ve YÖNETİM KPI
--  fin_cash_forecast(p_weeks)  : haftalık beklenen giriş / çıkış (TL karşılığı), kalem kalem
--     girişler: müşteri alacakları (vadesine göre, ilk giren ilk kapanır), portföy çekleri
--     çıkışlar: tedarikçi borçları (fatura vadesine göre), verilen çekler, kredi taksitleri,
--               tekrarlayan masraflar, satın alma siparişleri, maaş (bordro yetkisi varsa)
--  kpi_monthly(p_months)       : ay ay ciro, iş / birim, zamanında teslim, yeniden yapım, üretim süresi
--  kpi_clinic_watch()          : iş hacmi düşen / kaybolan klinikler
-- Tekrar çalıştırılabilir. Önce 20261217000000_courier.sql.
-- =====================================================================

drop function if exists fx_try(bigint, text);
create or replace function fx_try(p_amount numeric, p_cur text) returns bigint language sql stable as $$
  select case when coalesce(p_cur, 'TRY') = 'TRY' then round(p_amount)::bigint else round(p_amount * coalesce(fx_rate(p_cur, current_date), 1))::bigint end;
$$;

create or replace function fin_cash_forecast(p_weeks int default 13) returns table (week_start date, kind text, label text, amount bigint, ref text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_today date := (now() at time zone 'Europe/Istanbul')::date; v_w0 date; v_end date;
begin
  if module_level('finance') < 1 then raise exception 'not_allowed'; end if;
  v_w0 := v_today - ((extract(isodow from v_today)::int) - 1);
  v_end := v_w0 + 7 * greatest(1, least(p_weeks, 52));
  return query
  with wk as (select v_w0 as w0),
  -- müşteri alacakları: iş bazında, ödemeler en eskiden düşülür; vadesi geçen bu haftaya
  cust as (
    select c.id, c.name, c.currency, c.payment_term_days term,
      case when c.internal_book then (select coalesce(sum(amount), 0) from lab_payments where customer_id = c.id and book in ('internal', 'both'))
           else (select coalesce(sum(amount), 0) from lab_payments where customer_id = c.id) end paid
    from lab_customers c where c.is_active
  ),
  jobsr as (
    select cu.name, cu.currency, cu.term, cu.paid, j.total, lab_day(j.delivered_at) d,
      sum(j.total) over (partition by cu.id order by j.delivered_at, j.no) cum
    from cust cu join jobs j on j.customer_id = cu.id and j.status = 'delivered'
  ),
  recv as (
    select name, currency, greatest(d + term, v_today) due, least(total, cum - paid) open from jobsr where cum - paid > 0
  ),
  -- tedarikçi borçları: en yeni faturalar ödenmemiş sayılır
  sup as (
    select p.id, p.name, -b.balance owed from fin_parties p join fin_party_balances b on b.party_id = p.id where b.balance < 0 and p.lab_customer_id is null
  ),
  supinv as (
    select s.name, i.currency, coalesce(i.due_date, i.invoice_date) due, i.total, s.owed,
      sum(fx_try(i.total, i.currency)) over (partition by s.id order by i.invoice_date desc, i.created_at desc) cum
    from sup s join inv_invoices i on i.party_id = s.id and i.direction = 'purchase' and i.status = 'posted' and i.type = 'invoice'
  ),
  pay as (
    select name, greatest(due, v_today) due, least(fx_try(total, currency), owed - (cum - fx_try(total, currency))) open from supinv where owed - (cum - fx_try(total, currency)) > 0
  ),
  items as (
    select due d, 'in'::text k, 'Müşteri tahsilatı'::text l, fx_try(open, currency) a, name r from recv
    union all
    select greatest(due_date, v_today), 'in', 'Çek / senet tahsili', fx_try(amount, currency), coalesce(drawer, serial_no) from fin_cheques where direction = 'in' and status in ('portfolio', 'deposited')
    union all
    select due, 'out', 'Tedarikçi ödemesi', -open, name from pay
    union all
    select greatest(due_date, v_today), 'out', 'Verilen çek / senet', -fx_try(amount, currency), coalesce(serial_no, '') from fin_cheques where direction = 'out' and status = 'issued'
    union all
    select greatest(i.due_date, v_today), 'out', 'Kredi taksiti', -fx_try(i.principal + i.interest + i.tax, l.currency), coalesce(l.bank_name, l.loan_no, 'Kredi') from fin_loan_installments i join fin_loans l on l.id = i.loan_id where l.status = 'active' and i.paid_at is null
    union all
    select (date_trunc('month', m)::date + least(r.day_of_month, 28) - 1), 'out', 'Tekrarlayan masraf', -fx_try(r.amount, r.currency), r.name
    from exp_recurring r cross join generate_series(date_trunc('month', v_today), v_end, interval '1 month') m
    where r.is_active and (r.end_date is null or r.end_date >= m::date) and (date_trunc('month', m)::date + least(r.day_of_month, 28) - 1) >= v_today
    union all
    select greatest(coalesce(o.expected_date, o.order_date) + coalesce(p.payment_term_days, 0), v_today), 'out', 'Satın alma siparişi', -o.total_try, p.name
    from pur_orders o join fin_parties p on p.id = o.party_id where o.status in ('approved', 'sent', 'partial')
    union all
    select (date_trunc('month', m) + interval '1 month' - interval '1 day')::date, 'out', 'Maaşlar (tahmini)',
      -coalesce((select sum(accrued) from ledger_period_summary where period = to_char(v_today - interval '1 month', 'YYYY-MM')), 0)::bigint, 'bordro'
    from generate_series(date_trunc('month', v_today), v_end, interval '1 month') m
    where module_level('payroll') >= 1 and (date_trunc('month', m) + interval '1 month' - interval '1 day')::date >= v_today
  )
  select (v_w0 + 7 * floor((least(d, v_end - 1) - v_w0) / 7.0)::int)::date, k, l, sum(a)::bigint, case when count(*) = 1 then max(r) else count(*)::text || ' kalem' end
  from items where a <> 0 and d < v_end
  group by 1, 2, 3
  order by 1, 2, 3;
end $$;
revoke execute on function fin_cash_forecast(int) from public, anon;
grant execute on function fin_cash_forecast(int) to authenticated;

create or replace function kpi_monthly(p_months int default 12) returns table (
  month date, revenue_try bigint, jobs int, units numeric, on_time numeric, remakes int, remake_rate numeric, avg_days numeric, new_jobs int, clinics int
) language sql stable security definer set search_path = public as $$
  with m as (select generate_series(date_trunc('month', current_date) - ((least(greatest(p_months, 1), 36) - 1) || ' months')::interval, date_trunc('month', current_date), interval '1 month')::date m),
  d as (
    select date_trunc('month', lab_day(j.delivered_at))::date m, j.*,
      round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 1) end)::bigint rev
    from jobs j where j.status = 'delivered' and j.delivered_at >= date_trunc('month', current_date) - ((least(greatest(p_months, 1), 36)) || ' months')::interval
  )
  select m.m,
    coalesce((select sum(rev) from d where d.m = m.m), 0)::bigint,
    (select count(*) from d where d.m = m.m)::int,
    coalesce((select sum(job_units(d.id)) from d where d.m = m.m), 0),
    (select round(100.0 * count(*) filter (where d.due_date is null or lab_day(d.delivered_at) <= d.due_date) / nullif(count(*), 0), 1) from d where d.m = m.m),
    (select count(*) from prd_remakes r where date_trunc('month', r.created_at at time zone 'Europe/Istanbul')::date = m.m)::int,
    (select round(100.0 * (select count(*) from prd_remakes r where date_trunc('month', r.created_at at time zone 'Europe/Istanbul')::date = m.m) / nullif(count(*), 0), 1) from d where d.m = m.m),
    (select round(avg(lab_day(d.delivered_at) - d.in_date), 1) from d where d.m = m.m),
    (select count(*) from jobs j where date_trunc('month', j.in_date)::date = m.m and j.status <> 'cancelled')::int,
    (select count(distinct customer_id) from d where d.m = m.m)::int
  from m
  where can_module('sales') or can_module('finance') or can_module('production')
  order by m.m;
$$;
revoke execute on function kpi_monthly(int) from public, anon;
grant execute on function kpi_monthly(int) to authenticated;

-- Hacmi düşen / kaybolan klinikler: son 60 gün, önceki 60 güne göre
create or replace function kpi_clinic_watch() returns table (customer_id uuid, name text, last_job date, prev60 int, last60 int, change_pct numeric)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, max(j.in_date),
    count(*) filter (where j.in_date >= current_date - 120 and j.in_date < current_date - 60)::int,
    count(*) filter (where j.in_date >= current_date - 60)::int,
    round(100.0 * (count(*) filter (where j.in_date >= current_date - 60) - count(*) filter (where j.in_date >= current_date - 120 and j.in_date < current_date - 60))
          / nullif(count(*) filter (where j.in_date >= current_date - 120 and j.in_date < current_date - 60), 0), 0)
  from lab_customers c join jobs j on j.customer_id = c.id and j.status <> 'cancelled'
  where c.is_active and (can_module('sales') or can_module('finance') or can_logistics())
  group by c.id, c.name
  having count(*) filter (where j.in_date >= current_date - 120 and j.in_date < current_date - 60) >= 3
     and count(*) filter (where j.in_date >= current_date - 60) < 0.7 * count(*) filter (where j.in_date >= current_date - 120 and j.in_date < current_date - 60)
  order by 6 nulls first;
$$;
revoke execute on function kpi_clinic_watch() from public, anon;
grant execute on function kpi_clinic_watch() to authenticated;

notify pgrst, 'reload schema';
