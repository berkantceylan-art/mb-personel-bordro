-- =====================================================================
-- Karşılıklar ve mutabakat (Paket D)
--  * Senet / vadeli çek reeskontu (122 / 657, 322 / 647) ve ertesi gün ters kaydı
--  * Şüpheli ticari alacak (128 / 129 / 654) ve tahsilatta karşılık iptali (644)
--  * Kıdem tazminatı karşılığı (gider / 472; KKEG olarak vergi hesabına eklenir)
--  * Kasa sayım tutanağı (fark: 197 / 397)
--  * Demirbaş elden çıkarmada birikmiş amortismanın kapatılması (257 / 25x)
-- Tekrar çalıştırılabilir. Önce 20270215000000_reg_center.sql.
-- =====================================================================

-- Alt hesap yardımcısı: kök hesabın altında, kaynak hesabın kırılımıyla aynı kodlu hesap (yoksa açar)
create or replace function gl_ensure_child(p_root text, p_suffix text, p_name text) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text := p_root || coalesce(p_suffix, ''); r gl_accounts; t record;
begin
  select * into r from gl_accounts where company_id = lab_company() and code = p_root;
  if r.id is null then
    select * into t from gl_tdhp() where code = p_root;
    insert into gl_accounts (company_id, code, name, kind, normal_side) values (lab_company(), p_root, coalesce(t.name, p_root), gl_kind_of(p_root), gl_side_of(p_root, coalesce(t.name, '')))
    returning * into r;
  end if;
  if v_code <> p_root and not exists (select 1 from gl_accounts where company_id = lab_company() and code = v_code) then
    insert into gl_accounts (company_id, code, name, parent_id, kind, normal_side) values (lab_company(), v_code, left(coalesce(p_name, r.name), 160), r.id, r.kind, r.normal_side);
  end if;
  return v_code;
end $$;
revoke execute on function gl_ensure_child(text, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 1) Reeskont: iç iskonto A × n × t / (36000 + n × t)
-- ---------------------------------------------------------------------
create or replace function gl_rediscount_calc(p_date date, p_rate numeric, p_cheques boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(jsonb_build_object('id', id, 'direction', direction, 'doc_type', doc_type, 'serial_no', serial_no, 'party', party,
           'due_date', due_date, 'days', n, 'currency', currency, 'amount', amount, 'amount_try', a_try,
           'discount', round(a_try * n * p_rate / (36000 + n * p_rate))::bigint) order by direction, due_date), '[]') end
  from (
    select c.id, c.direction, c.doc_type, c.serial_no, p.name party, c.due_date, (c.due_date - p_date) n, c.currency, c.amount,
           round(c.amount * coalesce(case when c.currency = 'TRY' then 1 else fin_rate(c.currency, p_date) end, 1))::bigint a_try
    from fin_cheques c join fin_parties p on p.id = c.party_id
    where c.company_id = lab_company() and c.due_date > p_date and coalesce(c.issue_date, p_date) <= p_date
      and (c.doc_type = 'note' or p_cheques)
      and ((c.direction = 'in' and c.status in ('portfolio', 'deposited')) or (c.direction = 'out' and c.status = 'issued'))
  ) q where p_rate > 0;
$$;
revoke execute on function gl_rediscount_calc(date, numeric, boolean) from public, anon;
grant execute on function gl_rediscount_calc(date, numeric, boolean) to authenticated;

create or replace function gl_rediscount_post(p_date date, p_rate numeric, p_cheques boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; w uuid; r jsonb; rin bigint := 0; rout bigint := 0; res jsonb;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 200 then raise exception 'bad_amount'; end if;
  if p_date <> (date_trunc('month', p_date) + interval '1 month - 1 day')::date then raise exception 'bad_period'; end if;
  for r in select * from jsonb_array_elements(gl_rediscount_calc(p_date, p_rate, p_cheques)) loop
    if r->>'direction' = 'in' then rin := rin + (r->>'discount')::bigint; else rout := rout + (r->>'discount')::bigint; end if;
  end loop;
  v := gl_tag_voucher('reesk:' || p_date, p_date, 'mahsup', 'period', 'Reeskont · %' || p_rate || ' · ' || to_char(p_date, 'DD.MM.YYYY'));
  perform gl_add_line(v, '657', rin, 'Alacak senetleri reeskont gideri');
  perform gl_add_line(v, '122', -rin, 'Alacak senetleri reeskontu');
  perform gl_add_line(v, '322', rout, 'Borç senetleri reeskontu');
  perform gl_add_line(v, '647', -rout, 'Borç senetleri reeskont geliri');
  res := gl_finish(v);
  w := gl_tag_voucher('reeskr:' || p_date, p_date + 1, 'mahsup', 'period', 'Reeskont ters kaydı · ' || to_char(p_date, 'DD.MM.YYYY'));
  perform gl_add_line(w, '122', rin, 'Reeskont iptali');
  perform gl_add_line(w, '657', -rin, 'Reeskont iptali');
  perform gl_add_line(w, '647', rout, 'Reeskont iptali');
  perform gl_add_line(w, '322', -rout, 'Reeskont iptali');
  perform gl_finish(w);
  return res || jsonb_build_object('receivable', rin, 'payable', rout);
end $$;
revoke execute on function gl_rediscount_post(date, numeric, boolean) from public, anon;
grant execute on function gl_rediscount_post(date, numeric, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Şüpheli ticari alacaklar
-- ---------------------------------------------------------------------
create table if not exists gl_doubtful (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete restrict,
  doubt_date date not null,
  amount bigint not null check (amount > 0),
  reason text not null check (reason in ('dava', 'icra', 'protesto', 'diger')),
  note text check (note is null or length(note) <= 300),
  collected bigint not null default 0 check (collected >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table gl_doubtful enable row level security;
drop policy if exists gl_doubtful_read on gl_doubtful;
create policy gl_doubtful_read on gl_doubtful for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_doubtful from anon;
grant select on gl_doubtful to authenticated;

-- carinin muhasebe hesabı (120.xxxx) ve 12 aydan eski / vadesi geçmiş bakiye adayları
create or replace function gl_party_code(p_party uuid) returns text language sql stable security definer set search_path = public as $$
  select code from gl_accounts where company_id = lab_company() and link_type = 'party' and link_id = p_party and code like '120%' order by code limit 1;
$$;
revoke execute on function gl_party_code(uuid) from public, anon, authenticated;

create or replace function gl_doubtful_candidates(p_date date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(x order by (x->>'balance')::bigint desc), '[]') end from (
    select jsonb_build_object('party_id', p.id, 'party', p.name, 'code', a.code, 'balance', b.bal,
             'last_collection', (select max(t.txn_date) from fin_txns t where t.party_id = p.id and t.kind = 'collection' and t.voided_at is null),
             'open', exists (select 1 from gl_doubtful d where d.party_id = p.id and d.status = 'open')) x
    from gl_accounts a join fin_parties p on p.id = a.link_id
    cross join lateral (select gl_code_balance(a.code, p_date) bal) b
    where a.company_id = lab_company() and a.link_type = 'party' and a.code like '120%' and b.bal > 0
      and not exists (select 1 from fin_txns t where t.party_id = p.id and t.kind = 'collection' and t.voided_at is null and t.txn_date > p_date - 180)
  ) q;
$$;
revoke execute on function gl_doubtful_candidates(date) from public, anon;
grant execute on function gl_doubtful_candidates(date) to authenticated;

-- 128 B / 120 A ve karşılık 654 B / 129 A
create or replace function gl_doubtful_add(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d gl_doubtful; c120 text; c128 text; c129 text; v uuid; nm text;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  insert into gl_doubtful (party_id, doubt_date, amount, reason, note)
  values ((p->>'party_id')::uuid, (p->>'doubt_date')::date, (p->>'amount')::bigint, coalesce(p->>'reason', 'diger'), nullif(left(trim(p->>'note'), 300), ''))
  returning * into d;
  c120 := gl_party_code(d.party_id);
  if c120 is null then raise exception 'party_no_account'; end if;
  if (p->>'amount')::bigint > gl_code_balance(c120, d.doubt_date) then raise exception 'doubtful_exceeds'; end if;
  select name into nm from fin_parties where id = d.party_id;
  c128 := gl_ensure_child('128', substr(c120, 4), nm);
  c129 := gl_ensure_child('129', substr(c120, 4), nm);
  v := gl_tag_voucher('dbt:' || d.id, d.doubt_date, 'mahsup', 'period', 'Şüpheli alacak · ' || nm);
  perform gl_add_line(v, c128, d.amount, 'Şüpheli ticari alacak (' || d.reason || ')');
  perform gl_add_line(v, c120, -d.amount, 'Şüpheli alacağa aktarıldı');
  perform gl_add_line(v, '654', d.amount, 'Şüpheli alacak karşılığı · ' || nm);
  perform gl_add_line(v, c129, -d.amount, 'Şüpheli ticari alacak karşılığı');
  perform gl_finish(v);
  return d.id;
end $$;
revoke execute on function gl_doubtful_add(jsonb) from public, anon;
grant execute on function gl_doubtful_add(jsonb) to authenticated;

-- Tahsilat: tahsil edilen kısım 120'ye geri döner (finanstaki tahsilat 120'yi kapatır), karşılığı iptal edilir (129 B / 644 A)
create or replace function gl_doubtful_collect(p_id uuid, p_amount bigint, p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d gl_doubtful; c120 text; c128 text; c129 text; v uuid; nm text; n int;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select * into d from gl_doubtful where id = p_id and company_id = lab_company() for update;
  if d.id is null then raise exception 'not_found'; end if;
  if coalesce(p_amount, 0) <= 0 or p_amount > d.amount - d.collected then raise exception 'bad_amount'; end if;
  c120 := gl_party_code(d.party_id); select name into nm from fin_parties where id = d.party_id;
  c128 := '128' || substr(c120, 4); c129 := '129' || substr(c120, 4);
  select count(*) + 1 into n from gl_vouchers where company_id = lab_company() and tag like 'dbc:' || left(d.id::text, 30) || '%';
  v := gl_tag_voucher('dbc:' || left(d.id::text, 30) || ':' || n, coalesce(p_date, current_date), 'mahsup', 'period', 'Şüpheli alacak tahsilatı · ' || nm);
  perform gl_add_line(v, c120, p_amount, 'Şüpheli alacaktan tahsil edilen');
  perform gl_add_line(v, c128, -p_amount, 'Şüpheli alacak kapandı');
  perform gl_add_line(v, c129, p_amount, 'Karşılık iptali');
  perform gl_add_line(v, '644', -p_amount, 'Konusu kalmayan karşılıklar');
  update gl_doubtful set collected = collected + p_amount, status = case when collected + p_amount >= amount then 'closed' else status end where id = d.id;
  return gl_finish(v);
end $$;
revoke execute on function gl_doubtful_collect(uuid, bigint, date) from public, anon;
grant execute on function gl_doubtful_collect(uuid, bigint, date) to authenticated;

create or replace function gl_doubtful_list() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'party_id', d.party_id, 'party', p.name, 'doubt_date', d.doubt_date, 'amount', d.amount,
           'reason', d.reason, 'note', d.note, 'collected', d.collected, 'status', d.status) order by d.status, d.doubt_date desc), '[]') end
  from gl_doubtful d join fin_parties p on p.id = d.party_id where d.company_id = lab_company();
$$;
revoke execute on function gl_doubtful_list() from public, anon;
grant execute on function gl_doubtful_list() to authenticated;

-- ---------------------------------------------------------------------
-- 3) Kıdem tazminatı karşılığı (1 yılını doldurmuş, sigortalı çalışanlar; son resmi brüt ücret, tavanla sınırlı)
-- ---------------------------------------------------------------------
alter table gl_tax_adjustments add column if not exists ref text check (ref is null or length(ref) <= 60);
create unique index if not exists gl_tax_adjustments_ref_uidx on gl_tax_adjustments (company_id, ref) where ref is not null;

create or replace function gl_severance_calc(p_date date, p_cap bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  with e as (
    select x.id, x.first_name || ' ' || x.last_name full_name, x.hire_date, ((p_date - x.hire_date) / 365.25)::numeric yrs,
           (select pl.official_gross from payroll_lines pl where pl.employee_id = x.id and pl.period <= to_char(p_date, 'YYYY-MM') and pl.official_gross > 0 order by pl.period desc limit 1) gross
    from employees x
    where x.company_id = lab_company() and x.hire_date <= p_date and (x.termination_date is null or x.termination_date > p_date)
  )
  select case when can_module('ledger') then jsonb_build_object(
    'rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', full_name, 'hire_date', hire_date, 'years', round(yrs, 2), 'gross', gross,
               'base', least(gross, coalesce(p_cap, gross)), 'amount', round(least(gross, coalesce(p_cap, gross)) * yrs)::bigint) order by full_name)
             from e where yrs >= 1 and gross is not null), '[]'),
    'total', coalesce((select sum(round(least(gross, coalesce(p_cap, gross)) * yrs))::bigint from e where yrs >= 1 and gross is not null), 0),
    'skipped', (select count(*) from e where yrs >= 1 and gross is null),
    'booked', gl_code_balance('472', p_date) * -1,
    'voucher', (select jsonb_build_object('id', id, 'no', no, 'year', year, 'total', total) from gl_vouchers where company_id = lab_company() and status = 'posted' and tag = 'kidem:' || p_date)
  ) end;
$$;
revoke execute on function gl_severance_calc(date, bigint) from public, anon;
grant execute on function gl_severance_calc(date, bigint) to authenticated;

create or replace function gl_severance_post(p_date date, p_cap bigint, p_expense text default '770') returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v uuid; diff bigint; res jsonb;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_expense !~ '^[67][0-9]{2}' then raise exception 'bad_account'; end if;
  v := gl_tag_voucher('kidem:' || p_date, p_date, 'mahsup', 'period', 'Kıdem tazminatı karşılığı · ' || to_char(p_date, 'DD.MM.YYYY'));
  c := gl_severance_calc(p_date, p_cap);   -- eski fiş iptal edildikten sonra mevcut 472 bakiyesi
  diff := (c->>'total')::bigint - (c->>'booked')::bigint;
  if diff > 0 then
    perform gl_add_line(v, p_expense, diff, 'Kıdem tazminatı karşılık gideri');
    perform gl_add_line(v, '472', -diff, 'Kıdem tazminatı karşılığı');
  elsif diff < 0 then
    perform gl_add_line(v, '472', -diff, 'Kıdem tazminatı karşılığı iptali');
    perform gl_add_line(v, '644', diff, 'Konusu kalmayan karşılıklar');
  end if;
  res := gl_finish(v);
  -- vergi: karşılık gideri KKEG, iptali vergiye tabi değil (indirim)
  delete from gl_tax_adjustments where company_id = lab_company() and ref = 'kidem:' || p_date;
  if diff <> 0 then
    insert into gl_tax_adjustments (adj_date, kind, description, amount, ref)
    values (p_date, case when diff > 0 then 'kkeg' else 'deduction' end, case when diff > 0 then 'Kıdem tazminatı karşılık gideri' else 'Kıdem tazminatı karşılığı iptali (önceden KKEG)' end, abs(diff), 'kidem:' || p_date);
  end if;
  return res || jsonb_build_object('total', c->'total', 'diff', diff);
end $$;
revoke execute on function gl_severance_post(date, bigint, text) from public, anon;
grant execute on function gl_severance_post(date, bigint, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Kasa sayım tutanağı
-- ---------------------------------------------------------------------
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, v.code, v.name, 'other', true, v.sort from companies c
cross join (values ('cash_short', 'Kasa sayım noksanı', 95), ('cash_over', 'Kasa sayım fazlası', 96)) v(code, name, sort)
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = v.code);
insert into gl_maps (company_id, source, key, account_id)
select a.company_id, 'category_code', v.code, a.id from gl_accounts a join (values ('cash_short', '197'), ('cash_over', '397')) v(code, acc) on a.code = v.acc
on conflict do nothing;

create table if not exists gl_cash_counts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  account_id uuid not null references fin_accounts (id) on delete cascade,
  count_date date not null,
  counted bigint not null check (counted >= 0),
  book bigint not null,
  diff bigint not null,
  denominations jsonb,
  counted_by text check (counted_by is null or length(counted_by) <= 120),
  note text check (note is null or length(note) <= 300),
  txn_id uuid references fin_txns (id) on delete set null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table gl_cash_counts enable row level security;
drop policy if exists gl_cash_counts_read on gl_cash_counts;
create policy gl_cash_counts_read on gl_cash_counts for select to authenticated using (company_id = lab_company() and (can_module('finance') or can_module('ledger')));
revoke all on gl_cash_counts from anon;
grant select on gl_cash_counts to authenticated;

create or replace function fin_account_balance_at(p_account uuid, p_date date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(m.amount), 0)::bigint from fin_moves m join fin_txns t on t.id = m.txn_id
  where m.account_id = p_account and t.voided_at is null and m.move_date <= p_date and t.company_id = lab_company();
$$;
revoke execute on function fin_account_balance_at(uuid, date) from public, anon;
grant execute on function fin_account_balance_at(uuid, date) to authenticated;

create or replace function gl_cash_count(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a fin_accounts; v_date date := coalesce(nullif(p->>'count_date', '')::date, current_date); v_cnt bigint := (p->>'counted')::bigint; v_book bigint; v_diff bigint; v_txn uuid; v_id uuid;
begin
  if not (can_module('finance', 2) or can_module('ledger', 2)) then raise exception 'not_allowed'; end if;
  select * into a from fin_accounts where id = (p->>'account_id')::uuid and company_id = lab_company() and kind = 'cash';
  if a.id is null then raise exception 'account_required'; end if;
  if v_cnt is null or v_cnt < 0 then raise exception 'bad_amount'; end if;
  v_book := fin_account_balance_at(a.id, v_date);
  v_diff := v_cnt - v_book;
  if v_diff <> 0 and coalesce((p->>'post')::boolean, true) then
    v_txn := fin_post_sys(jsonb_build_object('kind', 'adjust', 'txn_date', v_date, 'description', 'Kasa sayımı ' || case when v_diff < 0 then 'noksanı · ' else 'fazlası · ' end || a.name,
                                             'amount', abs(v_diff), 'currency', a.currency, 'account_id', a.id, 'ref_type', 'cash_count'),
      jsonb_build_array(jsonb_build_object('account_id', a.id, 'amount', v_diff, 'currency', a.currency, 'rate', fin_rate(a.currency, v_date)),
                        jsonb_build_object('category_id', fin_category(case when v_diff < 0 then 'cash_short' else 'cash_over' end), 'amount', -v_diff, 'currency', a.currency, 'rate', fin_rate(a.currency, v_date))));
  end if;
  insert into gl_cash_counts (account_id, count_date, counted, book, diff, denominations, counted_by, note, txn_id)
  values (a.id, v_date, v_cnt, v_book, v_diff, p->'denominations', nullif(left(trim(p->>'counted_by'), 120), ''), nullif(left(trim(p->>'note'), 300), ''), v_txn)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'book', v_book, 'diff', v_diff, 'txn', v_txn);
end $$;
revoke execute on function gl_cash_count(jsonb) from public, anon;
grant execute on function gl_cash_count(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- 5) Demirbaş elden çıkarma: birikmiş amortisman (257) maliyet hesabına karşı kapatılır
-- ---------------------------------------------------------------------
create or replace function gl_asset_dispose_fix(p_asset uuid, p_date date, p_accum bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v uuid; acc text; nm text;
begin
  if coalesce(p_accum, 0) <= 0 then return; end if;
  if not exists (select 1 from gl_settings where company_id = lab_company() and enabled) then return; end if;
  select coalesce((select a.code from gl_maps m join gl_accounts a on a.id = m.account_id where m.company_id = lab_company() and m.source = 'category_code' and m.key = 'fixed_assets'), '255') into acc;
  select name into nm from assets where id = p_asset;
  v := gl_tag_voucher('dp:' || p_asset, p_date, 'mahsup', 'period', 'Demirbaş çıkışı · birikmiş amortisman · ' || coalesce(nm, ''));
  perform gl_add_line(v, '257', p_accum, 'Birikmiş amortisman kapatıldı');
  perform gl_add_line(v, acc, -p_accum, 'Maliyet bedelinden düşüldü');
  perform gl_finish(v);
end $$;
revoke execute on function gl_asset_dispose_fix(uuid, date, bigint) from public, anon, authenticated;

do $$
declare src text; old_txt text := $q$  update assets set status = 'RETIRED',$q$;
begin
  select pg_get_functiondef('asset_dispose(uuid, date, bigint, uuid, text)'::regprocedure) into src;
  if position('gl_asset_dispose_fix' in src) > 0 then return; end if;
  if position(old_txt in src) = 0 then raise exception 'asset_dispose_patch_failed'; end if;
  execute replace(src, old_txt, $q$  if a.opening_txn_id is not null or a.invoice_id is not null then perform gl_asset_dispose_fix(a.id, v_date, v_accum); end if;
$q$ || old_txt);
end $$;

notify pgrst, 'reload schema';
