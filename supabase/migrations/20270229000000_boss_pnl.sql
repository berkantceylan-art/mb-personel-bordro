-- Patron ekranı: Gelir – Gider – Kâr/Zarar (günlük / aylık)
--  Gelir: laboratuvar iş cirosu (iş girişi ya da teslim esası) + muhasebeleşen diğer gelirler (fatura, diğer gelir)
--  Gider: masraf ve alış faturalarının gider kalemleri, satılan malın maliyeti, stoktan malzeme tüketimi
--  Personel maliyeti bordrodan (uygulama tarafında) eklenir; maaş ödemesi kaydı (exp_salary) çift sayılmasın diye burada yok.
-- Tekrar çalıştırılabilir. Önce 20270124000000_revenue.sql.

create or replace function boss_pnl(p_from date, p_to date, p_bucket text default 'day', p_basis text default 'delivered') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c uuid := lab_company();
  v_len int;
  v_bucket text := case when p_bucket = 'month' then 'month' else 'day' end;
  p_from0 date; p_to0 date;
  r jsonb;
begin
  if not (rev_can() or can_module('finance')) then raise exception 'not_allowed'; end if;
  if p_to < p_from then p_to := p_from; end if;
  if p_to - p_from > 1500 then p_from := p_to - 1500; end if;
  v_len := p_to - p_from + 1;
  p_to0 := p_from - 1;
  p_from0 := p_from - v_len;

  with
  jobs_ as (
    select case when p_basis = 'in' then jb.in_date else (jb.delivered_at at time zone 'Europe/Istanbul')::date end as d,
           round(jb.total * case when jb.currency = 'TRY' then 1 else coalesce(fx_rate(jb.currency, coalesce(jb.in_date, current_date)), 1) end)::bigint as try
    from jobs jb
    where jb.company_id = c and jb.status <> 'cancelled' and (p_basis = 'in' or jb.delivered_at is not null)
  ),
  lab as (select d, try from jobs_ where d between p_from0 and p_to),
  fin as (
    select m.move_date as d, fc.code, fc.name, fc.kind, m.amount_try as amt, t.party_id
    from fin_moves m
    join fin_txns t on t.id = m.txn_id and t.voided_at is null
    join fin_categories fc on fc.id = m.category_id
    where t.company_id = c and m.move_date between p_from0 and p_to
      and fc.kind in ('income', 'expense') and fc.code not in ('internal_collection', 'exp_salary')
  ),
  mat as (
    select sm.move_date as d, round(-sm.qty * sm.unit_cost)::bigint as try
    from stk_moves sm join stk_items si on si.id = sm.item_id
    where si.company_id = c and sm.kind in ('consume', 'waste') and sm.qty < 0 and sm.move_date between p_from0 and p_to
  ),
  buckets as (select date_trunc(v_bucket, g)::date as b from generate_series(p_from, p_to, ('1 ' || v_bucket)::interval) g group by 1),
  agg as (
    select date_trunc(v_bucket, d)::date as b, sum(lab_) lab, sum(inc_) inc, sum(exp_) exp, sum(mat_) mat from (
      select d, try lab_, 0 inc_, 0 exp_, 0 mat_ from lab where d >= p_from
      union all select d, 0, case when kind = 'income' then -amt else 0 end, case when kind = 'expense' then amt else 0 end, 0 from fin where d >= p_from
      union all select d, 0, 0, 0, try from mat where d >= p_from
    ) u group by 1
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', p_from0, 'prev_to', p_to0, 'bucket', v_bucket, 'basis', p_basis,
    'series', coalesce((select jsonb_agg(jsonb_build_object('b', b.b, 'lab', coalesce(a.lab, 0), 'inc', coalesce(a.inc, 0), 'exp', coalesce(a.exp, 0), 'mat', coalesce(a.mat, 0)) order by b.b)
                        from buckets b left join agg a on a.b = b.b), '[]'),
    'totals', jsonb_build_object(
      'lab', (select coalesce(sum(try), 0) from lab where d >= p_from),
      'inc', (select coalesce(sum(-amt), 0) from fin where d >= p_from and kind = 'income'),
      'exp', (select coalesce(sum(amt), 0) from fin where d >= p_from and kind = 'expense'),
      'mat', (select coalesce(sum(try), 0) from mat where d >= p_from)),
    'prev', jsonb_build_object(
      'lab', (select coalesce(sum(try), 0) from lab where d < p_from),
      'inc', (select coalesce(sum(-amt), 0) from fin where d < p_from and kind = 'income'),
      'exp', (select coalesce(sum(amt), 0) from fin where d < p_from and kind = 'expense'),
      'mat', (select coalesce(sum(try), 0) from mat where d < p_from)),
    'income_by', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'try', t) order by t desc) from (
                   select code, name, sum(-amt) t from fin where d >= p_from and kind = 'income' group by 1, 2 having sum(-amt) <> 0) x), '[]'),
    'expense_by', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'try', t, 'prev', pv) order by t desc) from (
                   select code, max(name) name, sum(case when d >= p_from then amt else 0 end) t, sum(case when d < p_from then amt else 0 end) pv
                   from fin where kind = 'expense' group by 1 having sum(case when d >= p_from then amt else 0 end) <> 0 or sum(case when d < p_from then amt else 0 end) <> 0) y), '[]'),
    'suppliers', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'try', t) order by t desc) from (
                   select coalesce(p.name, 'Carisiz') n, sum(f.amt) t from fin f left join fin_parties p on p.id = f.party_id
                   where f.d >= p_from and f.kind = 'expense' group by 1 order by 2 desc limit 8) z), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function boss_pnl(date, date, text, text) from public, anon;
grant execute on function boss_pnl(date, date, text, text) to authenticated;

notify pgrst, 'reload schema';
