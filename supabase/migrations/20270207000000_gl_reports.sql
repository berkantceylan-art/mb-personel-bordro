-- =====================================================================
-- GENEL MUHASEBE · Paket 2: defterler ve raporlar
--  gl_balances(from, to)         : hesap başına devir (from öncesi) ve dönem borç / alacak (kayıtlı fişler)
--  gl_trial_balance(...)         : mizan (seviye 1 = ana hesap, 2-5 = alt kırılımlar), sıfır bakiyeleri gizle
--  gl_ledger(code, from, to)     : muavin / defter-i kebir: devir + hareketler + yürüyen bakiye (alt hesaplar dahil)
--  gl_journal(from, to)          : yevmiye defteri (madde madde)
--  gl_renumber(year)             : yevmiye madde numaralarını tarih sırasıyla verir
--  gl_balance_sheet(date)        : bilanço kalemleri (ana hesap bakiyeleri + kapatılmamış dönem kârı / zararı)
--  gl_income_statement(from, to) : gelir tablosu kalemleri; 7/A gider hesapları (yansıtılmamışsa) ilgili 6xx satırına alınır
--  gl_export(from, to)           : fiş satırları (Luca / Zirve / Excel aktarımı)
-- Tekrar çalıştırılabilir. Önce 20270206000000_gl_core.sql.
-- =====================================================================

create or replace function gl_balances(p_from date, p_to date) returns table (account_id uuid, open_d bigint, open_c bigint, per_d bigint, per_c bigint)
language sql stable security definer set search_path = public as $$
  select l.account_id,
         coalesce(sum(l.debit) filter (where v.voucher_date < p_from), 0)::bigint,
         coalesce(sum(l.credit) filter (where v.voucher_date < p_from), 0)::bigint,
         coalesce(sum(l.debit) filter (where v.voucher_date >= p_from), 0)::bigint,
         coalesce(sum(l.credit) filter (where v.voucher_date >= p_from), 0)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= p_to and can_module('ledger')
  group by l.account_id;
$$;
revoke execute on function gl_balances(date, date) from public, anon;
grant execute on function gl_balances(date, date) to authenticated;

-- Kodun ilk n kırılımı ("770.01.003", 2 → "770.01")
create or replace function gl_prefix(p_code text, p_level int) returns text language sql immutable as $$
  select array_to_string((string_to_array(p_code, '.'))[1:greatest(p_level, 1)], '.');
$$;

-- Mizan. p_from yılın başı değilse devir sütunları dolu gelir.
create or replace function gl_trial_balance(p_from date, p_to date, p_level int default 1, p_zero boolean default false)
returns table (code text, name text, lvl int, open_d bigint, open_c bigint, per_d bigint, per_c bigint, tot_d bigint, tot_c bigint, bal_d bigint, bal_c bigint)
language sql stable security definer set search_path = public as $$
  with b as (
    select gl_prefix(a.code, p_level) pc, sum(x.open_d) od, sum(x.open_c) oc, sum(x.per_d) pd, sum(x.per_c) pcr
    from gl_balances(p_from, p_to) x join gl_accounts a on a.id = x.account_id
    where array_length(string_to_array(a.code, '.'), 1) >= 1
    group by 1
  )
  select b.pc, coalesce(a.name, gl_group_name(b.pc), b.pc), array_length(string_to_array(b.pc, '.'), 1),
         b.od::bigint, b.oc::bigint, b.pd::bigint, b.pcr::bigint, (b.od + b.pd)::bigint, (b.oc + b.pcr)::bigint,
         greatest((b.od + b.pd) - (b.oc + b.pcr), 0)::bigint, greatest((b.oc + b.pcr) - (b.od + b.pd), 0)::bigint
  from b left join gl_accounts a on a.company_id = lab_company() and a.code = b.pc
  where p_zero or (b.od + b.pd) <> (b.oc + b.pcr) or b.pd <> 0 or b.pcr <> 0
  order by string_to_array(b.pc, '.');
$$;
revoke execute on function gl_trial_balance(date, date, int, boolean) from public, anon;
grant execute on function gl_trial_balance(date, date, int, boolean) to authenticated;

-- Muavin: seçilen hesap ve alt hesapları
create or replace function gl_ledger(p_code text, p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_open bigint; v_rows jsonb; a gl_accounts;
begin
  if not can_module('ledger') then raise exception 'not_allowed'; end if;
  select * into a from gl_accounts where company_id = lab_company() and code = p_code;
  if a.id is null then raise exception 'gl_account_missing:%', p_code; end if;
  select coalesce(sum(l.debit - l.credit), 0) into v_open
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts x on x.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date < p_from and (x.code = p_code or x.code like p_code || '.%');
  select coalesce(jsonb_agg(r order by r->>'date', (r->>'no')::int, (r->>'sort')::int), '[]') into v_rows from (
    select jsonb_build_object('voucher_id', v.id, 'year', v.year, 'no', v.no, 'journal_no', v.journal_no, 'date', v.voucher_date, 'kind', v.kind, 'doc_no', v.doc_no,
             'description', coalesce(l.description, v.description), 'code', x.code, 'account', x.name, 'debit', l.debit, 'credit', l.credit, 'sort', l.sort,
             'currency', l.currency, 'fx_amount', l.fx_amount) r
    from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts x on x.id = l.account_id
    where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date between p_from and p_to and (x.code = p_code or x.code like p_code || '.%')
    limit 20000) q;
  return jsonb_build_object('code', a.code, 'name', a.name, 'normal_side', a.normal_side, 'opening', v_open, 'rows', v_rows);
end $$;
revoke execute on function gl_ledger(text, date, date) from public, anon;
grant execute on function gl_ledger(text, date, date) to authenticated;

create or replace function gl_journal(p_from date, p_to date, p_limit int default 3000) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(j order by (j->>'date'), (j->>'jn')::int nulls last, (j->>'no')::int), '[]') end from (
    select jsonb_build_object('id', v.id, 'year', v.year, 'no', v.no, 'jn', v.journal_no, 'date', v.voucher_date, 'kind', v.kind, 'description', v.description,
      'doc_type', v.doc_type, 'doc_no', v.doc_no, 'doc_date', v.doc_date,
      'lines', (select jsonb_agg(jsonb_build_object('code', a.code, 'name', a.name, 'debit', l.debit, 'credit', l.credit, 'description', l.description) order by l.debit = 0, l.sort)
                from gl_lines l join gl_accounts a on a.id = l.account_id where l.voucher_id = v.id)) j
    from gl_vouchers v where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date between p_from and p_to
    order by v.voucher_date, v.journal_no nulls last, v.no limit p_limit) q;
$$;
revoke execute on function gl_journal(date, date, int) from public, anon;
grant execute on function gl_journal(date, date, int) to authenticated;

create or replace function gl_renumber(p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  perform set_config('gl.unlock', 'on', true);
  with o as (
    select id, row_number() over (order by voucher_date, case kind when 'acilis' then 0 when 'kapanis' then 2 else 1 end, no) rn
    from gl_vouchers where company_id = lab_company() and status = 'posted' and extract(year from voucher_date)::int = p_year)
  update gl_vouchers v set journal_no = o.rn from o where v.id = o.id and v.journal_no is distinct from o.rn;
  update gl_vouchers set journal_no = null where company_id = lab_company() and status <> 'posted' and journal_no is not null and extract(year from voucher_date)::int = p_year;
  perform set_config('gl.unlock', 'off', true);
  select count(*) into n from gl_vouchers where company_id = lab_company() and status = 'posted' and extract(year from voucher_date)::int = p_year;
  return n;
end $$;
revoke execute on function gl_renumber(int) from public, anon;
grant execute on function gl_renumber(int) to authenticated;

-- Bilanço: 1-5 sınıfı ana hesap bakiyeleri (borç - alacak); kapatılmamış 6-7 sınıfı net sonuç 590 / 591'e eklenir
create or replace function gl_balance_sheet(p_date date) returns table (code text, name text, side text, amount bigint)
language sql stable security definer set search_path = public as $$
  with b as (
    select left(a.code, 3) c, sum(x.open_d + x.per_d - x.open_c - x.per_c) bal
    from gl_balances(p_date, p_date) x join gl_accounts a on a.id = x.account_id group by 1
  ), res as (
    select coalesce(sum(bal), 0) r from b where left(c, 1) in ('6', '7')
  ), rows as (
    select c, bal from b where left(c, 1) in ('1', '2', '3', '4', '5') and bal <> 0
    union all select case when (select r from res) > 0 then '591' else '590' end, (select r from res) where (select r from res) <> 0
  )
  select r.c, coalesce(a.name, r.c), case when left(r.c, 1) in ('1', '2') then 'aktif' else 'pasif' end,
         (case when left(r.c, 1) in ('1', '2') then sum(r.bal) else -sum(r.bal) end)::bigint
  from rows r left join gl_accounts a on a.company_id = lab_company() and a.code = r.c
  group by r.c, a.name order by r.c;
$$;
revoke execute on function gl_balance_sheet(date) from public, anon;
grant execute on function gl_balance_sheet(date) to authenticated;

-- Gelir tablosu: 6xx (alacak - borç); 7xx net (yansıtılmamış) gider: 710-740 → 620/622, 750 → 630, 760 → 631, 770 → 632, 780 → 660
create or replace function gl_income_statement(p_from date, p_to date) returns table (code text, name text, amount bigint, from_cost boolean)
language sql stable security definer set search_path = public as $$
  with b as (
    select left(a.code, 3) c, sum(x.per_c - x.per_d) net
    from gl_balances(p_from, p_to) x join gl_accounts a on a.id = x.account_id
    where left(a.code, 1) in ('6', '7') group by 1
  ), seven as (
    select case when c in ('710', '711', '720', '721', '730', '731') then '620' when c in ('740', '741') then '622' when c in ('750', '751') then '630'
                when c in ('760', '761') then '631' when c in ('770', '771') then '632' when c in ('780', '781') then '660' end tgt, sum(net) net
    from b where left(c, 1) = '7' group by 1
  )
  select x.c, coalesce(a.name, x.c), x.net::bigint, x.fc from (
    select c, net, false fc from b where left(c, 1) = '6' and c not in ('690', '692') and net <> 0
    union all select tgt, net, true from seven where tgt is not null and net <> 0
  ) x left join gl_accounts a on a.company_id = lab_company() and a.code = x.c
  order by x.c, x.fc;
$$;
revoke execute on function gl_income_statement(date, date) from public, anon;
grant execute on function gl_income_statement(date, date) to authenticated;

create or replace function gl_export(p_from date, p_to date) returns table (
  year int, no int, journal_no int, voucher_date date, kind text, description text, doc_type text, doc_no text, doc_date date,
  sort int, code text, account text, line_description text, debit bigint, credit bigint, currency text, fx_amount bigint, rate numeric, party_tax_no text)
language sql stable security definer set search_path = public as $$
  select v.year, v.no, v.journal_no, v.voucher_date, v.kind, v.description, v.doc_type, v.doc_no, v.doc_date, l.sort, a.code, a.name,
         coalesce(l.description, v.description), l.debit, l.credit, l.currency, l.fx_amount, l.rate, p.tax_no
  from gl_vouchers v join gl_lines l on l.voucher_id = v.id join gl_accounts a on a.id = l.account_id left join fin_parties p on p.id = l.party_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date between p_from and p_to and can_module('ledger')
  order by v.voucher_date, v.journal_no nulls last, v.no, l.sort;
$$;
revoke execute on function gl_export(date, date) from public, anon;
grant execute on function gl_export(date, date) to authenticated;

notify pgrst, 'reload schema';
