-- =====================================================================
-- TEKNİSYEN PRİMİ
--  prd_bonus_rules  : prim kuralı (herkese ya da kişiye özel): birim başı tutar, eşik (ilk N birim primsiz),
--                     hedef primi, geri dönüş (hata) kesintisi, zamanında teslim şartı, üst sınır
--  prd_bonus_runs   : dönem hesabı (taslak → bordroya aktarıldı)
--  prd_bonus_lines  : kişi bazında birim, hata, zamanında %, tutar ve hesap ayrıntısı
--  prd_bonus_compute(dönem) : kutu okutmalarından (prd_people_stats) taslak hesap; taslak yeniden hesaplanabilir
--  prd_bonus_post(run)      : personel carisine PRİM (BONUS) hareketi olarak aktarır (bordro yetkisi)
-- Tekrar çalıştırılabilir. Önce 20261223000000_machines.sql.
-- =====================================================================

create table if not exists prd_bonus_rules (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  name text not null check (length(name) between 1 and 80),
  employee_id uuid references employees (id) on delete cascade,      -- boş: tüm teknisyenler
  unit_amount bigint not null default 0 check (unit_amount >= 0),     -- kuruş / birim
  free_units int not null default 0 check (free_units >= 0),          -- ilk N birim primsiz (maaşa dahil)
  target_units int check (target_units is null or target_units > 0),
  target_bonus bigint not null default 0 check (target_bonus >= 0),   -- hedefe ulaşınca ek tutar
  reject_penalty bigint not null default 0 check (reject_penalty >= 0), -- geri dönen iş başına kesinti
  min_on_time_pct int check (min_on_time_pct is null or min_on_time_pct between 0 and 100),
  on_time_factor numeric(4, 2) not null default 0.5 check (on_time_factor between 0 and 1), -- şart sağlanmazsa çarpan
  max_amount bigint check (max_amount is null or max_amount > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists prd_bonus_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'draft' check (status in ('draft', 'posted')),
  total bigint not null default 0,
  computed_at timestamptz not null default now(),
  computed_by uuid default auth.uid(),
  posted_at timestamptz,
  posted_by uuid,
  unique (company_id, period)
);

create table if not exists prd_bonus_lines (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references prd_bonus_runs (id) on delete cascade,
  employee_id uuid not null references employees (id) on delete cascade,
  rule_id uuid references prd_bonus_rules (id) on delete set null,
  units int not null default 0,
  jobs int not null default 0,
  rejects int not null default 0,
  on_time_pct int,
  amount bigint not null default 0,
  adjust bigint not null default 0,             -- elle düzeltme (+/-)
  detail jsonb not null default '{}'::jsonb,
  ledger_entry_id uuid references ledger_entries (id) on delete set null,
  unique (run_id, employee_id)
);

alter table prd_bonus_rules enable row level security;
alter table prd_bonus_runs enable row level security;
alter table prd_bonus_lines enable row level security;
create or replace function prd_bonus_allowed() returns boolean language sql stable security definer set search_path = public as $$
  select can_module('production', 3) or can_module('payroll', 2) or can_manage_pay(lab_company());
$$;
drop policy if exists prd_bonus_rules_read on prd_bonus_rules;
create policy prd_bonus_rules_read on prd_bonus_rules for select to authenticated using (prd_bonus_allowed());
drop policy if exists prd_bonus_runs_read on prd_bonus_runs;
create policy prd_bonus_runs_read on prd_bonus_runs for select to authenticated using (prd_bonus_allowed());
drop policy if exists prd_bonus_lines_read on prd_bonus_lines;
create policy prd_bonus_lines_read on prd_bonus_lines for select to authenticated
  using (prd_bonus_allowed() or exists (select 1 from employees e join prd_bonus_runs r on r.id = run_id where e.id = employee_id and e.user_id = auth.uid() and r.status = 'posted'));
grant select on prd_bonus_rules, prd_bonus_runs, prd_bonus_lines to authenticated;

create or replace function prd_bonus_rule_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not prd_bonus_allowed() then raise exception 'not_allowed'; end if;
  if coalesce((p->>'delete')::boolean, false) then delete from prd_bonus_rules where id = v_id; return v_id; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'name_required'; end if;
  if v_id is null then insert into prd_bonus_rules (name) values ('x') returning id into v_id; end if;
  update prd_bonus_rules set
    name = left(trim(p->>'name'), 80),
    employee_id = nullif(p->>'employee_id', '')::uuid,
    unit_amount = greatest(0, coalesce(nullif(p->>'unit_amount', '')::bigint, 0)),
    free_units = greatest(0, coalesce(nullif(p->>'free_units', '')::int, 0)),
    target_units = nullif(p->>'target_units', '')::int,
    target_bonus = greatest(0, coalesce(nullif(p->>'target_bonus', '')::bigint, 0)),
    reject_penalty = greatest(0, coalesce(nullif(p->>'reject_penalty', '')::bigint, 0)),
    min_on_time_pct = nullif(p->>'min_on_time_pct', '')::int,
    on_time_factor = coalesce(nullif(p->>'on_time_factor', '')::numeric, 0.5),
    max_amount = nullif(p->>'max_amount', '')::bigint,
    is_active = coalesce((p->>'is_active')::boolean, true)
  where id = v_id;
  return v_id;
end $$;
revoke execute on function prd_bonus_rule_save(jsonb) from public, anon;
grant execute on function prd_bonus_rule_save(jsonb) to authenticated;

-- Dönem hesabı: kişiye özel kural varsa o, yoksa genel (en son eklenen) kural
create or replace function prd_bonus_compute(p_period text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_run uuid; v_from timestamptz; v_to timestamptz; r record; k prd_bonus_rules; v_base bigint; v_amt bigint; v_ot int; v_paid int; v_factor numeric; v_hit boolean;
begin
  if not prd_bonus_allowed() then raise exception 'not_allowed'; end if;
  if p_period !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'bad_period'; end if;
  if exists (select 1 from prd_bonus_runs where company_id = lab_company() and period = p_period and status = 'posted') then raise exception 'already_posted'; end if;
  v_from := ((p_period || '-01')::date)::timestamp at time zone 'Europe/Istanbul';
  v_to := (((p_period || '-01')::date + interval '1 month')::date)::timestamp at time zone 'Europe/Istanbul';
  insert into prd_bonus_runs (company_id, period) values (lab_company(), p_period)
  on conflict (company_id, period) do update set computed_at = now(), computed_by = auth.uid()
  returning id into v_run;
  delete from prd_bonus_lines where run_id = v_run and adjust = 0;
  for r in select * from prd_people_stats(v_from, v_to) where flow_role = 'technician' and (units > 0 or rejects_received > 0) loop
    select * into k from prd_bonus_rules where is_active and (employee_id = r.employee_id or employee_id is null)
      order by (employee_id is null), created_at desc limit 1;
    if k.id is null then continue; end if;
    v_ot := case when r.finished_jobs > 0 then round(100.0 * r.on_time / r.finished_jobs)::int end;
    v_paid := greatest(0, r.units - k.free_units);
    v_base := v_paid * k.unit_amount;
    v_hit := k.target_units is not null and r.units >= k.target_units;
    v_amt := v_base + case when v_hit then k.target_bonus else 0 end;
    v_factor := case when k.min_on_time_pct is not null and coalesce(v_ot, 100) < k.min_on_time_pct then k.on_time_factor else 1 end;
    v_amt := round(v_amt * v_factor) - r.rejects_received * k.reject_penalty;
    v_amt := greatest(0, least(v_amt, coalesce(k.max_amount, v_amt)));
    insert into prd_bonus_lines (run_id, employee_id, rule_id, units, jobs, rejects, on_time_pct, amount, detail)
    values (v_run, r.employee_id, k.id, r.units, r.dones, r.rejects_received, v_ot, v_amt,
            jsonb_build_object('rule', k.name, 'paid_units', v_paid, 'unit_amount', k.unit_amount, 'base', v_base, 'target_hit', v_hit,
                               'target_bonus', case when v_hit then k.target_bonus else 0 end, 'factor', v_factor, 'penalty', r.rejects_received * k.reject_penalty,
                               'capped', k.max_amount is not null and v_amt = k.max_amount))
    on conflict (run_id, employee_id) do update set rule_id = excluded.rule_id, units = excluded.units, jobs = excluded.jobs, rejects = excluded.rejects,
      on_time_pct = excluded.on_time_pct, amount = excluded.amount, detail = excluded.detail;
  end loop;
  update prd_bonus_runs set total = (select coalesce(sum(greatest(0, amount + adjust)), 0) from prd_bonus_lines where run_id = v_run) where id = v_run;
  return v_run;
end $$;
revoke execute on function prd_bonus_compute(text) from public, anon;
grant execute on function prd_bonus_compute(text) to authenticated;

create or replace function prd_bonus_adjust(p_line uuid, p_adjust bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  if not prd_bonus_allowed() then raise exception 'not_allowed'; end if;
  update prd_bonus_lines l set adjust = coalesce(p_adjust, 0)
  from prd_bonus_runs r where l.id = p_line and r.id = l.run_id and r.status = 'draft'
  returning l.run_id into v_run;
  if v_run is null then raise exception 'already_posted'; end if;
  update prd_bonus_runs set total = (select coalesce(sum(greatest(0, amount + adjust)), 0) from prd_bonus_lines where run_id = v_run) where id = v_run;
end $$;
revoke execute on function prd_bonus_adjust(uuid, bigint) from public, anon;
grant execute on function prd_bonus_adjust(uuid, bigint) to authenticated;

-- Bordroya aktar: personel carisine PRİM hareketi (dönemin son günü)
create or replace function prd_bonus_post(p_run uuid) returns int
language plpgsql security definer set search_path = public as $$
declare r prd_bonus_runs; l record; v_le uuid; n int := 0; v_date date;
begin
  if not (can_manage_pay(lab_company()) or can_module('payroll', 2)) then raise exception 'not_allowed'; end if;
  select * into r from prd_bonus_runs where id = p_run for update;
  if r.id is null then raise exception 'not_found'; end if;
  if r.status = 'posted' then raise exception 'already_posted'; end if;
  v_date := ((r.period || '-01')::date + interval '1 month - 1 day')::date;
  for l in select bl.*, e.company_id from prd_bonus_lines bl join employees e on e.id = bl.employee_id where bl.run_id = p_run and bl.amount + bl.adjust > 0 loop
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note)
    values (l.company_id, l.employee_id, r.period, v_date, 'BONUS', 'NONE', l.amount + l.adjust,
            'Üretim primi ' || r.period || ' · ' || l.units || ' birim' || case when l.rejects > 0 then ', ' || l.rejects || ' geri dönüş' else '' end)
    returning id into v_le;
    update prd_bonus_lines set ledger_entry_id = v_le where id = l.id;
    n := n + 1;
  end loop;
  update prd_bonus_runs set status = 'posted', posted_at = now(), posted_by = auth.uid() where id = p_run;
  return n;
end $$;
revoke execute on function prd_bonus_post(uuid) from public, anon;
grant execute on function prd_bonus_post(uuid) to authenticated;

notify pgrst, 'reload schema';
