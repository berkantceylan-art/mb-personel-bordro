-- =====================================================================
-- FİYAT SÖZLEŞMESİ, KREDİ LİMİTİ, KÂRLILIK
--  lab_customers   : sözleşme tarihleri / notu, kredi limiti (müşteri para biriminde), vade, limit aşımında iş engeli
--  lab_settings    : işçilik saat maliyeti, genel gider oranı (kârlılık hesabı için)
--  lab_customer_risk(id) / lab_risk_list() : bakiye (iç hesap kullananda iç cari), limit, vadesi geçen
--  lab_profitability(from, to)            : müşteri başına ciro, malzeme, işçilik, yeniden yapım, kâr
-- Tekrar çalıştırılabilir. Önce 20261215000000_mdr.sql.
-- =====================================================================

alter table lab_customers add column if not exists credit_limit bigint check (credit_limit is null or credit_limit >= 0);
alter table lab_customers add column if not exists payment_term_days int not null default 30;
alter table lab_customers add column if not exists block_over_limit boolean not null default false;
alter table lab_customers add column if not exists contract_start date;
alter table lab_customers add column if not exists contract_end date;
alter table lab_customers add column if not exists contract_note text check (contract_note is null or length(contract_note) <= 2000);

create table if not exists lab_settings (
  company_id uuid primary key references companies (id) on delete cascade default lab_company(),
  labor_cost_hour bigint not null default 0,      -- TL kuruş / saat (maaş + SGK yükü)
  overhead_pct numeric(5, 2) not null default 0,  -- ciroya oranla genel gider
  updated_at timestamptz not null default now()
);
alter table lab_settings enable row level security;
drop policy if exists lab_settings_read on lab_settings;
create policy lab_settings_read on lab_settings for select to authenticated using (can_module('sales') or can_module('finance'));
grant select on lab_settings to authenticated;

create or replace function lab_settings_save(p_labor bigint, p_overhead numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 3) or can_module('sales', 3)) then raise exception 'not_allowed'; end if;
  insert into lab_settings (company_id, labor_cost_hour, overhead_pct, updated_at) values (lab_company(), greatest(coalesce(p_labor, 0), 0), least(greatest(coalesce(p_overhead, 0), 0), 100), now())
  on conflict (company_id) do update set labor_cost_hour = excluded.labor_cost_hour, overhead_pct = excluded.overhead_pct, updated_at = now();
end $$;
grant execute on function lab_settings_save(bigint, numeric) to authenticated;

create or replace function lab_customer_contract_save(p_customer uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_logistics() and (can_module('sales', 2) or can_module('finance', 2) or can_module('lab', 3))) then raise exception 'not_allowed'; end if;
  update lab_customers set
    credit_limit = nullif(p->>'credit_limit', '')::bigint,
    payment_term_days = least(greatest(coalesce(nullif(p->>'payment_term_days', '')::int, 30), 0), 365),
    block_over_limit = coalesce((p->>'block_over_limit')::boolean, false),
    contract_start = nullif(p->>'contract_start', '')::date,
    contract_end = nullif(p->>'contract_end', '')::date,
    contract_note = nullif(left(trim(coalesce(p->>'contract_note', '')), 2000), ''),
    updated_at = now()
  where id = p_customer;
end $$;
grant execute on function lab_customer_contract_save(uuid, jsonb) to authenticated;

-- Risk: iç hesap kullananda iç cari, diğerlerinde tek cari (işler + tahsilat + resmi hareketler)
create or replace function lab_customer_risk(p_customer uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c lab_customers; v_bal bigint; v_old bigint; v_paid bigint; v_open bigint := 0;
begin
  if not (can_logistics() or can_module('sales') or can_module('finance')) then return null; end if;
  select * into c from lab_customers where id = p_customer;
  if c.id is null then return null; end if;
  if c.internal_book then
    select balance into v_bal from lab_internal_balances where customer_id = p_customer;
    v_open := c.internal_opening;
    select coalesce(sum(amount), 0) into v_paid from lab_payments where customer_id = p_customer and book in ('internal', 'both');
  else
    select balance into v_bal from fin_party_balances where lab_customer_id = p_customer limit 1;
    select coalesce(sum(amount), 0) into v_paid from lab_payments where customer_id = p_customer;
    v_open := coalesce((select opening_balance from fin_parties where lab_customer_id = p_customer limit 1), 0);
  end if;
  -- vadesi geçen: vadeden eski işler + açılış − tüm tahsilatlar (ilk giren ilk kapanır)
  select coalesce(sum(total), 0) into v_old from jobs where customer_id = p_customer and status = 'delivered'
    and (delivered_at at time zone 'Europe/Istanbul')::date < (now() at time zone 'Europe/Istanbul')::date - c.payment_term_days;
  return jsonb_build_object('currency', c.currency, 'balance', coalesce(v_bal, 0), 'limit', c.credit_limit, 'term', c.payment_term_days, 'block', c.block_over_limit,
    'over', c.credit_limit is not null and coalesce(v_bal, 0) > c.credit_limit,
    'overdue', greatest(0, v_old + greatest(v_open, 0) - v_paid),
    'contract_end', c.contract_end, 'contract_expired', c.contract_end is not null and c.contract_end < current_date);
end $$;
grant execute on function lab_customer_risk(uuid) to authenticated;

create or replace function lab_risk_list() returns table (customer_id uuid, name text, risk jsonb)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, lab_customer_risk(c.id) from lab_customers c
  where c.is_active and (can_logistics() or can_module('sales') or can_module('finance'))
    and exists (select 1 from jobs j where j.customer_id = c.id and j.status = 'delivered');
$$;
grant execute on function lab_risk_list() to authenticated;

-- Kârlılık: dönemde teslim edilen işler (TL karşılığı, teslim günü kuruyla)
create or replace function lab_profitability(p_from date, p_to date) returns table (
  customer_id uuid, name text, currency text, jobs int, units numeric, revenue_try bigint, material_try bigint, minutes int, labor_try bigint, overhead_try bigint,
  remakes int, profit_try bigint, margin numeric
) language sql stable security definer set search_path = public as $$
  with st as (select coalesce((select labor_cost_hour from lab_settings where company_id = lab_company()), 0) labor, coalesce((select overhead_pct from lab_settings where company_id = lab_company()), 0) oh),
  j as (
    select j.id, j.customer_id, j.total, j.currency, lab_day(j.delivered_at) d,
      round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 1) end)::bigint rev,
      coalesce((select sum(round(m.qty * stk_avg_cost(m.item_id))) from prd_job_materials m where m.job_id = j.id), 0)::bigint mat,
      greatest(coalesce((select sum(o.work_minutes) from prd_job_ops o where o.job_id = j.id), 0), coalesce((select sum(h.minutes) from job_handoffs h where h.job_id = j.id and h.action in ('done', 'approve', 'exit', 'reject')), 0))::int mins,
      job_units(j.id) u,
      (select count(*) from prd_remakes r where r.job_id = j.id and not coalesce(r.chargeable, false))::int rm
    from jobs j
    where j.status = 'delivered' and lab_day(j.delivered_at) between p_from and p_to
  )
  select c.id, c.name, c.currency, count(j.id)::int, coalesce(sum(j.u), 0), coalesce(sum(j.rev), 0)::bigint, coalesce(sum(j.mat), 0)::bigint, coalesce(sum(j.mins), 0)::int,
    round(coalesce(sum(j.mins), 0) / 60.0 * (select labor from st))::bigint,
    round(coalesce(sum(j.rev), 0) * (select oh from st) / 100)::bigint,
    coalesce(sum(j.rm), 0)::int,
    (coalesce(sum(j.rev), 0) - coalesce(sum(j.mat), 0) - round(coalesce(sum(j.mins), 0) / 60.0 * (select labor from st)) - round(coalesce(sum(j.rev), 0) * (select oh from st) / 100))::bigint,
    case when coalesce(sum(j.rev), 0) > 0 then round((coalesce(sum(j.rev), 0) - coalesce(sum(j.mat), 0) - coalesce(sum(j.mins), 0) / 60.0 * (select labor from st) - coalesce(sum(j.rev), 0) * (select oh from st) / 100) * 100.0 / sum(j.rev), 1) end
  from j join lab_customers c on c.id = j.customer_id
  where can_module('sales') or can_module('finance')
  group by c.id, c.name, c.currency
  order by 6 desc;
$$;
grant execute on function lab_profitability(date, date) to authenticated;

notify pgrst, 'reload schema';
