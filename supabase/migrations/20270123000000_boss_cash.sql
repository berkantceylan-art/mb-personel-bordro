-- Patron ekranı · Nakit: seçilen tarih aralığında kasa / banka / POS hareketleri, açılış → giriş / çıkış → kalan,
-- işlem türüne göre dağılım, son 30 gün günlük akış, önümüzdeki 14 günün beklenen giriş / çıkışları (çek, kredi, kart).
-- Yalnız şirket sahibi, patron ekranı yetkilisi ya da Finans görüntüleme yetkisi olan. Tekrar çalıştırılabilir.

create or replace function boss_cash(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c uuid := lab_company();
  r jsonb;
begin
  if not (exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = c and (m.role = 'owner' or m.is_boss)) or can_module('finance', 1)) then
    raise exception 'not_allowed';
  end if;
  if p_to < p_from then p_to := p_from; end if;

  with acc as (
    select a.id, a.kind, a.name, a.currency, a.bank_name, a.sort,
           a.opening_balance
             + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.account_id = a.id and t.voided_at is null and m.move_date < p_from), 0) as opening,
           coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.account_id = a.id and t.voided_at is null and m.move_date between p_from and p_to and m.amount > 0), 0) as inflow,
           coalesce((select -sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.account_id = a.id and t.voided_at is null and m.move_date between p_from and p_to and m.amount < 0), 0) as outflow,
           coalesce((select count(*) from fin_moves m join fin_txns t on t.id = m.txn_id where m.account_id = a.id and t.voided_at is null and m.move_date between p_from and p_to), 0) as moves,
           coalesce(fx_rate(a.currency, p_to), 1) as rate
    from fin_accounts a
    where a.company_id = c and (a.is_active or exists (select 1 from fin_moves m where m.account_id = a.id and m.move_date between p_from and p_to))
  ),
  liquid as (select id from fin_accounts where company_id = c and kind in ('cash', 'bank', 'pos')),
  mv as (
    select m.move_date, m.amount, m.amount_try, m.currency, m.account_id, a.name as account, a.kind as account_kind,
           t.id as txn_id, t.no, t.kind, coalesce(nullif(m.description, ''), t.description) as description, p.name as party, cat.name as category
    from fin_moves m
    join fin_txns t on t.id = m.txn_id and t.voided_at is null
    join fin_accounts a on a.id = m.account_id
    left join fin_parties p on p.id = t.party_id
    left join fin_categories cat on cat.id = t.category_id
    where a.company_id = c and m.move_date between p_from and p_to
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object(
        'id', id, 'kind', kind, 'name', name, 'currency', currency, 'bank', bank_name,
        'opening', opening, 'in', inflow, 'out', outflow, 'closing', opening + inflow - outflow, 'moves', moves,
        'closing_try', round((opening + inflow - outflow) * rate)::bigint) order by sort, name) from acc), '[]'),
    'moves', coalesce((select jsonb_agg(jsonb_build_object(
        'date', move_date, 'amount', amount, 'amount_try', amount_try, 'currency', currency, 'account', account, 'account_kind', account_kind,
        'txn_id', txn_id, 'no', no, 'kind', kind, 'description', description, 'party', party, 'category', category)
        order by move_date desc, no desc) from (select * from mv order by move_date desc, no desc limit 500) x), '[]'),
    'moves_total', (select count(*) from mv),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'in', i, 'out', o, 'n', n) order by (i + o) desc) from (
        select kind, coalesce(sum(amount_try) filter (where amount_try > 0), 0) as i, coalesce(-sum(amount_try) filter (where amount_try < 0), 0) as o, count(*) as n
        from mv where account_id in (select id from liquid) and kind <> 'transfer' group by kind) k), '[]'),
    'by_party', coalesce((select jsonb_agg(jsonb_build_object('party', party, 'in', i, 'out', o) order by (i + o) desc) from (
        select party, coalesce(sum(amount_try) filter (where amount_try > 0), 0) as i, coalesce(-sum(amount_try) filter (where amount_try < 0), 0) as o
        from mv where account_id in (select id from liquid) and party is not null group by party order by (coalesce(sum(abs(amount_try)), 0)) desc limit 12) q), '[]'),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d::date, 'in', coalesce(x.i, 0), 'out', coalesce(x.o, 0)) order by d) from
        generate_series(p_to - 29, p_to, interval '1 day') d
        left join (select m.move_date, sum(m.amount_try) filter (where m.amount_try > 0) i, -sum(m.amount_try) filter (where m.amount_try < 0) o
                   from fin_moves m join fin_txns t on t.id = m.txn_id and t.voided_at is null
                   where m.account_id in (select id from liquid) and t.kind <> 'transfer' and m.move_date between p_to - 29 and p_to group by m.move_date) x on x.move_date = d::date), '[]'),
    'upcoming', coalesce((select jsonb_agg(u order by u->>'date') from (
        select jsonb_build_object('date', ch.due_date, 'type', 'cheque_in', 'label', 'Alınan ' || case ch.doc_type when 'note' then 'senet' else 'çek' end || coalesce(' · ' || p.name, ''), 'amount', ch.amount, 'currency', ch.currency, 'dir', 1) u
        from fin_cheques ch left join fin_parties p on p.id = ch.party_id
        where ch.company_id = c and ch.direction = 'in' and ch.status in ('portfolio', 'deposited') and ch.due_date between p_to and p_to + 14
        union all
        select jsonb_build_object('date', ch.due_date, 'type', 'cheque_out', 'label', 'Verilen ' || case ch.doc_type when 'note' then 'senet' else 'çek' end || coalesce(' · ' || p.name, ''), 'amount', ch.amount, 'currency', ch.currency, 'dir', -1)
        from fin_cheques ch left join fin_parties p on p.id = ch.party_id
        where ch.company_id = c and ch.direction = 'out' and ch.status = 'issued' and ch.due_date between p_to and p_to + 14
        union all
        select jsonb_build_object('date', li.due_date, 'type', 'loan', 'label', 'Kredi taksiti · ' || coalesce(l.bank_name, a.name) || ' #' || li.no, 'amount', li.principal + li.interest + li.tax, 'currency', l.currency, 'dir', -1)
        from fin_loan_installments li join fin_loans l on l.id = li.loan_id join fin_accounts a on a.id = l.account_id
        where l.company_id = c and l.status = 'active' and li.paid_at is null and li.due_date between p_to and p_to + 14
        union all
        select jsonb_build_object('date', ci.statement_date, 'type', 'card', 'label', 'Kart ekstresi · ' || a.name, 'amount', sum(ci.amount), 'currency', a.currency, 'dir', -1)
        from fin_card_installments ci join fin_accounts a on a.id = ci.account_id join fin_txns t on t.id = ci.txn_id and t.voided_at is null
        where a.company_id = c and ci.statement_date between p_to and p_to + 14
        group by ci.statement_date, a.name, a.currency
      ) up), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function boss_cash(date, date) from public, anon;
grant execute on function boss_cash(date, date) to authenticated;

notify pgrst, 'reload schema';
