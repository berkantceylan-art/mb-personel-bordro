-- =====================================================================
-- YENİ GÖSTERGE PANELİ: tüm modüllerden tek sorguda özet (kişinin yetkisine göre)
--  dash_summary()     -> jsonb (yetkisi olmayan bölüm null döner)
--  user_dashboard     : kişinin kart sırası ve gizledikleri
-- Tekrar çalıştırılabilir. Önce 20261213000000_workshop.sql.
-- =====================================================================

create table if not exists user_dashboard (
  user_id uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  hidden text[] not null default '{}',
  card_order text[] not null default '{}',
  updated_at timestamptz not null default now()
);
alter table user_dashboard enable row level security;
drop policy if exists user_dashboard_self on user_dashboard;
create policy user_dashboard_self on user_dashboard for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select, insert, update, delete on user_dashboard to authenticated;

create or replace function dash_summary() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Europe/Istanbul')::date;
  v_from timestamptz := (v_today::timestamp at time zone 'Europe/Istanbul');
  v_month date := date_trunc('month', v_today)::date;
  v_company uuid := lab_company();
  v_role text := (select role::text from memberships where user_id = auth.uid() order by created_at limit 1);
  r jsonb := jsonb_build_object('today', v_today);
begin
  if v_role is null then raise exception 'not_allowed'; end if;

  -- Laboratuvar ve üretim
  if module_level('lab') >= 1 or module_level('production') >= 1 then
    r := r || jsonb_build_object('lab', jsonb_build_object(
      'open', (select count(*) from jobs where status not in ('delivered', 'cancelled')),
      'open_units', (select coalesce(sum(job_units(id)), 0) from jobs where status not in ('delivered', 'cancelled')),
      'late', (select count(*) from jobs where status not in ('delivered', 'cancelled') and due_date < v_today),
      'due_today', (select count(*) from jobs where status not in ('delivered', 'cancelled') and due_date = v_today),
      'in_today', (select count(*) from jobs where in_date = v_today and status <> 'cancelled'),
      'out_today', (select count(*) from jobs where status = 'delivered' and delivered_at >= v_from),
      'tryin', (select count(*) from jobs where status = 'tryin'),
      'orders', (select count(*) from lab_orders where status in ('new', 'confirmed')) + (select count(*) from portal_cases pc where pc.status in ('received', 'design') and not exists (select 1 from jobs j where j.portal_case_id = pc.id)),
      'stages', (select coalesce(jsonb_object_agg(flow_stage, n), '{}'::jsonb) from (select flow_stage, count(*) n from jobs where status not in ('delivered', 'cancelled') group by flow_stage) x),
      'unbilled', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, sum(total) t from lab_waybills where status <> 'cancelled' and statement_id is null and ship_date >= v_month group by currency) x),
      'trend', (select jsonb_agg(jsonb_build_object('d', d::date, 'n', (select count(*) from jobs j where j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date = d::date)) order by d)
                from generate_series(v_today - 13, v_today, interval '1 day') d)
    ));
  end if;

  -- Finans
  if module_level('finance') >= 1 then
    r := r || jsonb_build_object('finance', jsonb_build_object(
      'cash', (select coalesce(jsonb_agg(jsonb_build_object('currency', currency, 'kind', kind, 'total', t)), '[]'::jsonb) from (
                 select currency, case when kind = 'cash' then 'cash' else 'bank' end kind, sum(balance) t from fin_account_balances where kind in ('cash', 'bank', 'pos') group by 1, 2) x),
      'receivable', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, sum(balance) t from fin_party_balances where balance > 0 group by currency) x),
      'payable', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, -sum(balance) t from fin_party_balances where balance < 0 group by currency) x),
      'cheques_in_7', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(amount), 0)) from fin_cheques where direction = 'in' and status in ('portfolio', 'deposited') and due_date <= v_today + 7),
      'cheques_out_7', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(amount), 0)) from fin_cheques where direction = 'out' and status = 'issued' and due_date <= v_today + 7),
      'loans_7', (select jsonb_build_object('n', count(*), 'total', coalesce(sum(i.principal + i.interest + i.tax), 0)) from fin_loan_installments i join fin_loans l on l.id = i.loan_id where l.status = 'active' and i.paid_at is null and i.due_date <= v_today + 7)
    ));
  end if;

  -- Satış ve alış
  if module_level('sales') >= 1 then
    r := r || jsonb_build_object('sales', jsonb_build_object(
      'month', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, sum(total) t from inv_invoices where direction = 'sale' and status = 'posted' and type = 'invoice' and invoice_date >= v_month group by currency) x),
      'prev', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, sum(total) t from inv_invoices where direction = 'sale' and status = 'posted' and type = 'invoice' and invoice_date >= (v_month - interval '1 month')::date and invoice_date < v_month group by currency) x),
      'drafts', (select count(*) from inv_invoices where direction = 'sale' and status = 'draft'),
      'statements', (select count(*) from lab_statements where status = 'issued' and issue_date >= v_month)
    ));
  end if;
  if module_level('purchases') >= 1 then
    r := r || jsonb_build_object('purchases', jsonb_build_object(
      'pending', (select count(*) from pur_orders where status = 'pending'),
      'open', (select count(*) from pur_orders where status in ('approved', 'sent', 'partial')),
      'late', (select count(*) from pur_orders where status in ('approved', 'sent', 'partial') and expected_date < v_today),
      'month', (select coalesce(jsonb_object_agg(currency, t), '{}'::jsonb) from (select currency, sum(total) t from inv_invoices where direction = 'purchase' and status = 'posted' and invoice_date >= v_month group by currency) x)
    ));
  end if;

  -- Stok
  if module_level('stock') >= 1 then
    r := r || jsonb_build_object('stock', jsonb_build_object(
      'critical', (select count(*) from stk_items i join stk_item_totals t on t.item_id = i.id where i.is_active and i.min_qty is not null and t.qty < i.min_qty),
      'expiring', (select count(*) from stk_stock where qty > 0 and expiry_date is not null and expiry_date <= v_today + 30),
      'value', (select coalesce(sum(value), 0) from stk_item_totals where qty > 0)
    ));
  end if;

  -- Masraf
  if module_level('expenses') >= 2 then
    r := r || jsonb_build_object('expenses', jsonb_build_object(
      'pending', (select count(*) from exp_claims where status = 'submitted'),
      'pending_total', (select coalesce(sum(amount), 0) from exp_claims where status = 'submitted' and currency = 'TRY'),
      'month', (select coalesce(sum(amount), 0) from exp_claims where status = 'posted' and expense_date >= v_month and currency = 'TRY')
    ));
  end if;

  -- İnsan kaynakları (yalnız İK verisine erişen roller)
  if module_level('hr') >= 1 and v_role in ('owner', 'hr', 'accountant', 'branch_manager', 'safety') then
    r := r || jsonb_build_object('hr', jsonb_build_object(
      'active', (select count(*) from employees where company_id = v_company and status = 'active'),
      'present', (select count(distinct employee_id) from attendance_punches where punched_at >= v_today::timestamp and direction::text = 'IN'),
      'on_leave', (select count(distinct employee_id) from leave_requests where status::text = 'approved' and v_today between start_date and end_date),
      'leave_pending', (select count(*) from leave_requests where status::text = 'pending'),
      'ot_pending', (select count(*) from overtime_records where status::text = 'pending'),
      'advance_pending', (select count(*) from advance_requests where status = 'pending'),
      'birthdays', (select count(*) from employees e join employee_private p on p.employee_id = e.id where e.status = 'active' and to_char(p.birth_date, 'MM-DD') = to_char(v_today, 'MM-DD'))
    ));
  end if;

  -- Bordro
  if module_level('payroll') >= 1 and v_role in ('owner', 'accountant') then
    r := r || jsonb_build_object('payroll', (select jsonb_build_object('period', to_char(v_today, 'YYYY-MM'), 'accrued', coalesce(sum(accrued), 0), 'paid', coalesce(sum(paid_bank + paid_cash), 0), 'balance', coalesce(sum(balance), 0))
                                             from ledger_period_summary where period = to_char(v_today, 'YYYY-MM')));
  end if;

  -- Kullanıcılar
  if module_level('users') >= 2 then
    r := r || jsonb_build_object('users', jsonb_build_object(
      'total', (select count(*) from memberships where company_id = v_company),
      'no_account', (select count(*) from employees where company_id = v_company and status = 'active' and user_id is null),
      'untyped', (select count(*) from memberships where company_id = v_company and user_type_id is null and role <> 'owner')
    ));
  end if;
  return r;
end $$;
revoke execute on function dash_summary() from public, anon;
grant execute on function dash_summary() to authenticated;

notify pgrst, 'reload schema';
