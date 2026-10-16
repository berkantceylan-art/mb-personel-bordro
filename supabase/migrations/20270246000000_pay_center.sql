-- =====================================================================
-- ÖDEME MERKEZİ: şirketten çıkacak tüm paralar tek listede
--  Tedarikçi (fatura vadesi, verilen çek / senet, planlı ödeme) · Personel (maaş, onay bekleyen avans talepleri)
--  Vergi / SGK (bordrodan) · Kredi taksiti · Kredi kartı ekstresi · Tekrarlayan masraf · Elle eklenen ödeme
--  pay_center(bas, bit)     : kalemler (gecikmişler de gelir), TL karşılığıyla, acil işaretiyle
--  pay_center_plan_save(p)  : elle ödeme (kira, vergi, tedarikçisiz ödemeler; acil işaretlenebilir)
--  pay_center_digest(gün)   : her sabah patron / muhasebeye özet bildirim (zamanlanmış görev)
-- Tekrar çalıştırılabilir. Önce 20270244000000_supplier_portal.sql.
-- =====================================================================

alter table fin_payment_plans alter column party_id drop not null;
alter table fin_payment_plans add column if not exists title text check (title is null or length(title) <= 160);
alter table fin_payment_plans add column if not exists category text not null default 'supplier';
alter table fin_payment_plans add column if not exists urgent boolean not null default false;
alter table fin_payment_plans add column if not exists employee_id uuid references employees (id) on delete set null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fin_payment_plans_cat_chk') then
    alter table fin_payment_plans add constraint fin_payment_plans_cat_chk check (category in ('supplier', 'personnel', 'tax', 'rent', 'loan', 'utility', 'other'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fin_payment_plans_target_chk') then
    alter table fin_payment_plans add constraint fin_payment_plans_target_chk check (party_id is not null or title is not null);
  end if;
end $$;

-- Elle ödeme kalemi: {id?, title, category, party_id?, employee_id?, due_date, amount, currency, method, note, urgent, remind_days}
create or replace function pay_center_plan_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_party uuid := nullif(p->>'party_id', '')::uuid; v_cat text := coalesce(nullif(p->>'category', ''), 'other');
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_manage_pay(lab_company())) then raise exception 'not_allowed'; end if;
  if v_cat not in ('supplier', 'personnel', 'tax', 'rent', 'loan', 'utility', 'other') then v_cat := 'other'; end if;
  if v_party is not null then v_party := coalesce((select slip_of from fin_parties where id = v_party and company_id = lab_company()), (select id from fin_parties where id = v_party and company_id = lab_company())); end if;
  if v_party is null and coalesce(trim(p->>'title'), '') = '' then raise exception 'title_required'; end if;
  if coalesce(nullif(p->>'amount', '')::bigint, 0) <= 0 then raise exception 'amount_required'; end if;
  if nullif(p->>'due_date', '') is null then raise exception 'date_required'; end if;
  if v_id is null then
    insert into fin_payment_plans (party_id, employee_id, title, category, due_date, amount, currency, method, note, remind_days, urgent, notify_supplier, show_supplier)
    values (v_party, (select id from employees where id = nullif(p->>'employee_id', '')::uuid), nullif(left(trim(coalesce(p->>'title', '')), 160), ''), case when v_party is not null and v_cat = 'other' then 'supplier' else v_cat end,
            (p->>'due_date')::date, (p->>'amount')::bigint, coalesce(nullif(p->>'currency', ''), 'TRY'), coalesce(nullif(p->>'method', ''), 'transfer'),
            nullif(left(trim(coalesce(p->>'note', '')), 300), ''), coalesce(nullif(p->>'remind_days', '')::int, 2), coalesce((p->>'urgent')::boolean, false), false, v_party is not null)
    returning id into v_id;
  else
    update fin_payment_plans set title = nullif(left(trim(coalesce(p->>'title', '')), 160), ''), category = v_cat, due_date = (p->>'due_date')::date, amount = (p->>'amount')::bigint,
           currency = coalesce(nullif(p->>'currency', ''), 'TRY'), note = nullif(left(trim(coalesce(p->>'note', '')), 300), ''), urgent = coalesce((p->>'urgent')::boolean, false)
     where id = v_id and company_id = lab_company() and status = 'planned';
  end if;
  return v_id;
end $$;
revoke execute on function pay_center_plan_save(jsonb) from public, anon;
grant execute on function pay_center_plan_save(jsonb) to authenticated;

-- Plan durumu: personel / maaş planlarını maaş yetkilisi de kapatabilsin
create or replace function pay_plan_status(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_manage_pay(lab_company())) then raise exception 'not_allowed'; end if;
  if p_status not in ('planned', 'paid', 'cancelled') then raise exception 'bad_status'; end if;
  update fin_payment_plans set status = p_status, paid_at = case when p_status = 'paid' then now() end where id = p_id and company_id = lab_company();
end $$;
revoke execute on function pay_plan_status(uuid, text) from public, anon;
grant execute on function pay_plan_status(uuid, text) to authenticated;

-- Acil işareti aç / kapat (yalnız elle / planlı kalemler)
create or replace function pay_plan_urgent(p_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_manage_pay(lab_company())) then raise exception 'not_allowed'; end if;
  update fin_payment_plans set urgent = coalesce(p_on, false) where id = p_id and company_id = lab_company();
end $$;
revoke execute on function pay_plan_urgent(uuid, boolean) from public, anon;
grant execute on function pay_plan_urgent(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Kalemler (izin denetimi yok; p_pay: maaş / avans / vergi, p_fin: tedarikçi / kredi / kart / masraf)
-- ---------------------------------------------------------------------
create or replace function pay_center_raw(p_from date, p_to date, p_pay boolean, p_fin boolean) returns table (
  src text, kind text, ref uuid, who_id uuid, title text, sub text, due_date date, amount_try bigint, amount bigint, currency text, overdue boolean, urgent boolean, link text, estimate boolean)
language sql stable security definer set search_path = public as $$
  with c as (select lab_company() id, (now() at time zone 'Europe/Istanbul')::date d, coalesce((select salary_pay_day from companies where id = lab_company()), 5) payday),
  items as (
    -- 1) Tedarikçi
    select 'supplier'::text src, r.kind, r.ref, r.party_id who_id, r.party title,
           case r.kind when 'invoice' then 'Fatura vadesi' when 'cheque' then 'Verilen çek' when 'note' then 'Verilen senet' else 'Planlı ödeme' end || coalesce(' · ' || r.doc, '') || coalesce(' · ' || r.note, '') sub,
           r.due_date, fx_try(r.amount, r.currency) amount_try, r.amount, r.currency,
           (r.kind in ('cheque', 'note') and r.due_date <= (select d from c) + 3) or coalesce((select pl.urgent from fin_payment_plans pl where pl.id = r.ref and r.kind = 'plan'), false) urgent,
           '/satinalma/tedarikci/' || r.party_id || '?t=odeme' link, false estimate
      from pay_items_raw(null) r where p_fin and r.amount > 0
    union all
    -- 2) Elle eklenen (tedarikçisiz) ödemeler
    select coalesce(nullif(pl.category, 'supplier'), 'other'), 'plan', pl.id, coalesce(pl.employee_id, null), pl.title,
           coalesce(pl.note, '') || case when pl.employee_id is not null then coalesce(' · ' || (select first_name || ' ' || last_name from employees where id = pl.employee_id), '') else '' end,
           pl.due_date, fx_try(pl.amount, pl.currency), pl.amount, pl.currency, pl.urgent, '/odeme-merkezi', false
      from fin_payment_plans pl
     where pl.company_id = (select id from c) and pl.status = 'planned' and pl.party_id is null
       and ((pl.category in ('personnel', 'tax') and p_pay) or (pl.category not in ('personnel', 'tax') and (p_fin or p_pay)))
    union all
    -- 3) Maaşlar: dönem başına kalan bakiye, sonraki ayın maaş gününde
    select 'personnel', 'salary', null::uuid, null::uuid, 'Maaşlar · ' || s.period,
           s.n || ' personel · kalan net (banka + elden)', (to_date(s.period || '-01', 'YYYY-MM-DD') + interval '1 month')::date + (select payday from c) - 1,
           s.owed, s.owed, 'TRY', false, '/maas-plani?donem=' || s.period, false
      from (select l.period, sum(greatest(l.balance, 0))::bigint owed, count(*) filter (where l.balance > 100)::int n
              from ledger_period_summary l
             where p_pay and l.company_id = (select id from c) and l.period >= to_char((select d from c) - interval '6 months', 'YYYY-MM')
             group by l.period) s
     where s.owed > 100
    union all
    -- 3b) Bu ayın maaşı henüz tahakkuk etmediyse tahmin (geçen ayın tahakkuku)
    select 'personnel', 'salary', null, null, 'Maaşlar · ' || to_char((select d from c), 'YYYY-MM'), 'tahmini: geçen ayın tahakkuku kadar',
           (date_trunc('month', (select d from c)) + interval '1 month')::date + (select payday from c) - 1,
           x.acc, x.acc, 'TRY', false, '/maas-plani', true
      from (select coalesce(sum(l.accrued), 0)::bigint acc from ledger_period_summary l where l.company_id = (select id from c) and l.period = to_char((select d from c) - interval '1 month', 'YYYY-MM')) x
     where p_pay and x.acc > 0
       and not exists (select 1 from ledger_entries e where e.company_id = (select id from c) and e.period = to_char((select d from c), 'YYYY-MM') and e.type = 'ACCRUAL' and e.voided_at is null)
    union all
    -- 4) Onay bekleyen avans talepleri
    select 'advance', 'advance_request', a.id, a.employee_id, coalesce(e.first_name || ' ' || e.last_name, 'Personel'),
           'Avans talebi' || coalesce(' · ' || nullif(trim(a.reason), ''), ''), greatest((a.created_at at time zone 'Europe/Istanbul')::date, (select d from c)),
           a.amount, a.amount, 'TRY', true, '/patron', false
      from advance_requests a left join employees e on e.id = a.employee_id
     where p_pay and a.company_id = (select id from c) and a.status = 'pending'
    union all
    -- 5) SGK ve muhtasar (kaydedilmiş bordrodan; ödendi kaydı yoksa)
    select 'tax', t.k, null, null, case t.k when 'sgk' then 'SGK primleri · ' else 'Muhtasar (gelir + damga vergisi) · ' end || t.period, 'Bordrodan · ' || t.n || ' personel',
           case t.k when 'sgk' then ((to_date(t.period || '-01', 'YYYY-MM-DD') + interval '2 months')::date - 1) else (to_date(t.period || '-01', 'YYYY-MM-DD') + interval '1 month')::date + 25 end,
           t.v, t.v, 'TRY', false, '/maas-plani?donem=' || t.period, false
      from (select pl.period, 'sgk' k, sum(pl.sgk_employee + pl.unemployment_employee + greatest(pl.employer_cost - pl.official_gross, 0))::bigint v, count(*)::int n
              from payroll_lines pl where p_pay and pl.company_id = (select id from c) and pl.period >= to_char((select d from c) - interval '3 months', 'YYYY-MM') group by pl.period
            union all
            select pl.period, 'vergi', sum(pl.income_tax + pl.stamp_tax)::bigint, count(*)::int
              from payroll_lines pl where p_pay and pl.company_id = (select id from c) and pl.period >= to_char((select d from c) - interval '3 months', 'YYYY-MM') group by pl.period) t
     where t.v > 0 and not exists (select 1 from payroll_remittances r where r.company_id = (select id from c) and r.period = t.period and r.kind = t.k and r.voided_at is null)
    union all
    -- 6) Kredi taksitleri
    select 'loan', 'loan', i.id, l.id, coalesce(l.bank_name, 'Kredi') || coalesce(' · ' || l.loan_no, ''), i.no || '. taksit',
           i.due_date, fx_try(i.principal + i.interest + i.tax, l.currency), i.principal + i.interest + i.tax, l.currency, i.due_date <= (select d from c) + 2, '/finans/krediler', false
      from fin_loan_installments i join fin_loans l on l.id = i.loan_id
     where p_fin and l.company_id = (select id from c) and l.status = 'active' and i.paid_at is null
    union all
    -- 7) Kredi kartı borcu (son ödeme günü)
    select 'card', 'card', a.id, a.id, a.name, 'Kredi kartı borcu' || coalesce(' · ' || a.bank_name, ''),
           case when extract(day from (select d from c)) <= a.due_day then date_trunc('month', (select d from c))::date + a.due_day - 1
                else (date_trunc('month', (select d from c)) + interval '1 month')::date + a.due_day - 1 end,
           greatest(-b.balance_try, 0), greatest(-b.balance, 0), a.currency, false, '/finans/kredi-karti', false
      from fin_accounts a join fin_account_balances b on b.account_id = a.id
     where p_fin and a.company_id = (select id from c) and a.kind = 'credit_card' and a.is_active and a.due_day is not null and b.balance < 0
    union all
    -- 8) Tekrarlayan masraflar (kira, abonelik …)
    select 'expense', 'recurring', r.id, r.party_id, r.name, 'Tekrarlayan masraf',
           (date_trunc('month', m)::date + least(r.day_of_month, 28) - 1), fx_try(r.amount, r.currency), r.amount, r.currency, false, '/masraf', false
      from exp_recurring r cross join generate_series(date_trunc('month', greatest(p_from, (select d from c))), date_trunc('month', p_to), interval '1 month') m
     where p_fin and r.company_id = (select id from c) and r.is_active and (r.end_date is null or r.end_date >= m::date) and r.start_date <= (date_trunc('month', m) + interval '1 month')::date
       and (r.last_period is null or r.last_period < date_trunc('month', m)::date)
  )
  select i.src, i.kind, i.ref, i.who_id, i.title, nullif(btrim(i.sub, ' ·'), ''), i.due_date, coalesce(i.amount_try, 0), coalesce(i.amount, 0), i.currency,
         i.due_date < (select d from c) and i.kind <> 'advance_request',
         i.urgent or (i.due_date < (select d from c) and i.kind <> 'advance_request'),
         i.link, i.estimate
    from items i
   where coalesce(i.amount, 0) > 0
     and (i.due_date between p_from and p_to or (i.due_date < p_from and p_from <= (select d from c) and i.kind not in ('recurring')) or i.kind = 'advance_request')
   order by i.due_date, i.amount_try desc;
$$;
revoke execute on function pay_center_raw(date, date, boolean, boolean) from public, anon, authenticated;

create or replace function pay_center(p_from date, p_to date) returns table (
  src text, kind text, ref uuid, who_id uuid, title text, sub text, due_date date, amount_try bigint, amount bigint, currency text, overdue boolean, urgent boolean, link text, estimate boolean)
language plpgsql stable security definer set search_path = public as $$
declare v_pay boolean := can_manage_pay(lab_company()) or exists (select 1 from memberships where user_id = auth.uid() and company_id = lab_company() and is_boss);
        v_fin boolean := can_module('finance') or can_module('purchases') or v_pay;
begin
  if not (v_pay or v_fin) then raise exception 'not_allowed'; end if;
  if p_to < p_from or p_to - p_from > 400 then raise exception 'bad_range'; end if;
  return query select * from pay_center_raw(p_from, p_to, v_pay, v_fin);
end $$;
revoke execute on function pay_center(date, date) from public, anon;
grant execute on function pay_center(date, date) to authenticated;

-- Sabah özeti: patron, sahip ve muhasebeye (zamanlanmış görev)
create or replace function pay_center_digest(p_today date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date := coalesce(p_today, (now() at time zone 'Europe/Istanbul')::date); c uuid := lab_company();
  v_today bigint; n_today int; v_over bigint; n_over int; n_adv int; v_week bigint; n_week int; v_body text; v_users uuid[];
begin
  if exists (select 1 from fin_pay_reminders where key = 'digest:' || d) then return jsonb_build_object('skipped', true); end if;
  select coalesce(sum(amount_try) filter (where due_date = d and not overdue and kind <> 'advance_request'), 0), count(*) filter (where due_date = d and not overdue and kind <> 'advance_request'),
         coalesce(sum(amount_try) filter (where overdue), 0), count(*) filter (where overdue),
         count(*) filter (where kind = 'advance_request'),
         coalesce(sum(amount_try) filter (where kind <> 'advance_request' and not estimate), 0), count(*) filter (where kind <> 'advance_request')
    into v_today, n_today, v_over, n_over, n_adv, v_week, n_week
    from pay_center_raw(d, d + 6, true, true);
  if n_today + n_over + n_adv = 0 and n_week = 0 then return jsonb_build_object('empty', true); end if;
  insert into fin_pay_reminders (key) values ('digest:' || d);
  v_body := case when n_today > 0 then 'Bugün ' || n_today || ' ödeme · ' || tl_text(v_today) else 'Bugün ödeme yok' end
         || case when n_over > 0 then ' · ⚠ ' || n_over || ' gecikmiş · ' || tl_text(v_over) else '' end
         || case when n_adv > 0 then ' · ' || n_adv || ' avans talebi onay bekliyor' else '' end
         || ' · 7 gün: ' || n_week || ' kalem · ' || tl_text(v_week);
  select coalesce(array_agg(distinct m.user_id), '{}') into v_users from memberships m
   where m.company_id = c and (m.role in ('owner', 'accountant') or m.is_boss);
  perform deliver(c, v_users, case when n_over > 0 then '⚠ Ödeme özeti: gecikmiş ödeme var' else '💳 Günün ödeme özeti' end, v_body, '/odeme-merkezi?g=acil');
  return jsonb_build_object('today', n_today, 'overdue', n_over, 'advances', n_adv, 'week', n_week);
end $$;
revoke execute on function pay_center_digest(date) from public, anon, authenticated;
grant execute on function pay_center_digest(date) to service_role;

notify pgrst, 'reload schema';
