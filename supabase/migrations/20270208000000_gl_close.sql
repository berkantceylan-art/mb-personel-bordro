-- =====================================================================
-- GENEL MUHASEBE · Paket 3: beyanname hazırlık ve dönem sonu
--  gl_vat_report(from, to)        : KDV hazırlık: oran bazında matrah / KDV, tevkifat, istisna, iadeler; 190 / 191 / 391 bakiyeleri
--  gl_vat_close(ay)               : ay sonu KDV mahsup fişi (391 / 191 / 190 / 360)
--  gl_babs(ay, eşik)              : Ba (alış) / Bs (satış): eşiği aşan cari bazında belge sayısı ve KDV hariç tutar
--  gl_payroll_report(dönem)       : muhtasar ve prim hizmet hazırlık: matrah, gelir vergisi, damga, SGK primleri
--  gl_payroll_accrual(dönem)      : bordro tahakkuk fişi (770 / 335 / 360 / 361 / 369)
--  gl_fx_revalue(tarih)           : döviz hesap ve cari kur değerlemesi (646 / 656)
--  gl_close_year(yıl) / gl_undo_close(yıl) : 7/A yansıtma, gelir tablosu kapanışı (690 → 692 → 590 / 591), bilanço kapanışı ve yeni yıl açılışı
--  gl_set_lock(tarih)             : dönem kilidi
--  gl_settings.exclude_cash_salary: elden maaş ödemelerini muhasebe dışı tut
--  Kontrol Merkezi                : eşleştirme bekleyen kayıt, fişe dönmemiş kayıt, KDV mahsubu yapılmamış ay, kilitsiz eski dönem
-- Tekrar çalıştırılabilir. Önce 20270207000000_gl_reports.sql.
-- =====================================================================

alter table gl_settings add column if not exists exclude_cash_salary boolean not null default false;
alter table gl_settings add column if not exists babs_limit bigint not null default 500000;    -- 5.000 TL (kuruş)

do $$ declare c text; begin
  select conname into c from pg_constraint where conrelid = 'gl_vouchers'::regclass and contype = 'c' and pg_get_constraintdef(oid) ilike '%source%';
  if c is not null then execute format('alter table gl_vouchers drop constraint %I', c); end if;
end $$;
alter table gl_vouchers add constraint gl_vouchers_source_check check (source in ('auto', 'manual', 'opening', 'closing', 'fx', 'payroll', 'reversal', 'vat'));
alter table gl_vouchers add column if not exists tag text check (tag is null or length(tag) <= 40);   -- dönem işlemi anahtarı (vat:2026-10, payroll:2026-10, fx:2026-12-31, close:2026 …)
create unique index if not exists gl_vouchers_tag_uidx on gl_vouchers (company_id, tag) where tag is not null and status <> 'cancelled';

-- Maaş ödemesi: kanal (banka / elden) ayrı eşleştirilebilir: ref "payroll:exp_salary:CASH"
create or replace function gl_resolve(p_company uuid, m fin_moves, t fin_txns) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid; a fin_accounts; p fin_parties; c fin_categories; k text;
begin
  if m.account_id is not null then
    select * into a from fin_accounts where id = m.account_id;
    v := gl_map_get(p_company, 'fin_account', a.id::text);
    if v is not null then return gl_link_account(p_company, v, 'fin_account', a.id, a.name || coalesce(' · ' || nullif(a.currency, 'TRY'), ''), a.currency); end if;
    v := gl_map_get(p_company, 'account_kind', a.kind);
    if v is null then return null; end if;
    return gl_link_account(p_company, v, 'fin_account', a.id, a.name || coalesce(' · ' || nullif(a.currency, 'TRY'), ''), a.currency);
  elsif m.party_id is not null then
    select * into p from fin_parties where id = m.party_id;
    v := coalesce(gl_map_get(p_company, 'party', p.id::text), gl_map_get(p_company, 'party_kind', p.kind));
    if v is null then return null; end if;
    return gl_link_account(p_company, v, 'party', p.id, p.name, p.currency);
  else
    select * into c from fin_categories where id = m.category_id;
    if t.ref_type = 'payroll_remit' then
      select r.kind into k from payroll_remittances r where r.id = t.ref_id;
      v := gl_map_get(p_company, 'ref', 'payroll_remit:' || coalesce(k, ''));
      if v is not null then return v; end if;
    elsif t.ref_type = 'payroll' then
      select e.channel::text into k from ledger_entries e where e.id = t.ref_id;
      v := coalesce(gl_map_get(p_company, 'ref', 'payroll:' || c.code || ':' || coalesce(k, '')), gl_map_get(p_company, 'ref', 'payroll:' || c.code));
      if v is not null then return v; end if;
    elsif t.ref_type is not null then
      v := gl_map_get(p_company, 'ref', t.ref_type || ':' || c.code);
      if v is not null then return v; end if;
    end if;
    v := coalesce(gl_map_get(p_company, 'category', c.id::text), gl_map_get(p_company, 'category_code', c.code));
    if v is null and c.parent_id is not null then
      v := coalesce(gl_map_get(p_company, 'category', c.parent_id::text), gl_map_get(p_company, 'category_code', (select code from fin_categories where id = c.parent_id)));
    end if;
    if v is null and c.kind not in ('equity', 'other') then v := gl_map_get(p_company, 'category_kind', c.kind); end if;
    if v is not null and (select code from gl_accounts where id = v) = '600' and t.party_id is not null
       and coalesce((select upper(country) from fin_parties where id = t.party_id), 'TR') not in ('TR', 'TÜRKİYE', 'TURKIYE', 'TURKEY', '') then
      v := coalesce(gl_map_get(p_company, 'ref', 'export_sales'), v);
    end if;
    return v;
  end if;
end $$;
revoke execute on function gl_resolve(uuid, fin_moves, fin_txns) from public, anon, authenticated;

-- Elden maaş ödemesi muhasebe dışı (ayar açıksa): gl_post_txn'den önce kontrol
create or replace function gl_cash_salary_excluded(t fin_txns) returns boolean language sql stable security definer set search_path = public as $$
  select t.ref_type = 'payroll' and coalesce((select exclude_cash_salary from gl_settings where company_id = t.company_id), false)
     and exists (select 1 from ledger_entries e where e.id = t.ref_id and e.channel::text = 'CASH');
$$;
do $$
declare d text;
begin
  select pg_get_functiondef('gl_post_txn(uuid)'::regprocedure) into d;
  if position('gl_cash_salary_excluded' in d) = 0 then
    d := replace(d, $x$    when t.kind = 'purchase_slip' then 'Fişli alım'$x$, $x$    when t.kind = 'purchase_slip' then 'Fişli alım'
    when gl_cash_salary_excluded(t) then 'Elden maaş ödemesi (ayar: muhasebe dışı)'$x$);
    if position('gl_cash_salary_excluded' in d) > 0 then execute d; end if;
  end if;
end $$;

-- Ortak: bir hesap kodunun (ve alt hesaplarının) tarihe kadar bakiyesi (borç - alacak)
create or replace function gl_code_balance(p_code text, p_to date, p_from date default null) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= p_to and (p_from is null or v.voucher_date >= p_from)
    and (a.code = p_code or a.code like p_code || '.%');
$$;
revoke execute on function gl_code_balance(text, date, date) from public, anon, authenticated;

-- Yardımcı: dönem işlemi fişi (aynı anahtarla varsa ve kilitli değilse iptal edilip yenisi yazılır)
create or replace function gl_tag_voucher(p_tag text, p_date date, p_kind text, p_source text, p_desc text) returns uuid
language plpgsql security definer set search_path = public as $$
declare old gl_vouchers; v_id uuid;
begin
  select * into old from gl_vouchers where company_id = lab_company() and tag = p_tag and status <> 'cancelled';
  if old.id is not null then
    if gl_locked(lab_company(), old.voucher_date) then raise exception 'gl_locked'; end if;
    update gl_vouchers set status = 'cancelled', updated_at = now() where id = old.id;
  end if;
  insert into gl_vouchers (company_id, year, no, voucher_date, kind, source, status, description, doc_type, tag)
  values (lab_company(), extract(year from p_date)::int, gl_next_no(lab_company(), extract(year from p_date)::int), p_date, p_kind, p_source, 'pending', left(p_desc, 500), 'voucher', p_tag)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function gl_tag_voucher(text, date, text, text, text) from public, anon, authenticated;

create or replace function gl_add_line(p_v uuid, p_code text, p_amount bigint, p_desc text) returns void
language plpgsql security definer set search_path = public as $$
declare a uuid; n int;
begin
  if coalesce(p_amount, 0) = 0 then return; end if;
  select id into a from gl_accounts where company_id = lab_company() and code = p_code;
  if a is null then
    insert into gl_accounts (company_id, code, name, kind, normal_side)
    select lab_company(), t.code, t.name, gl_kind_of(t.code), gl_side_of(t.code, t.name) from gl_tdhp() t where t.code = p_code
    on conflict do nothing returning id into a;
    if a is null then select id into a from gl_accounts where company_id = lab_company() and code = p_code; end if;
    if a is null then raise exception 'gl_account_missing:%', p_code; end if;
  end if;
  select coalesce(max(sort), 0) + 1 into n from gl_lines where voucher_id = p_v;
  insert into gl_lines (voucher_id, sort, account_id, debit, credit, description) values (p_v, n, a, greatest(p_amount, 0), greatest(-p_amount, 0), left(p_desc, 300));
end $$;
revoke execute on function gl_add_line(uuid, text, bigint, text) from public, anon, authenticated;

create or replace function gl_finish(p_v uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d bigint; c bigint; n int;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0), count(*) into d, c, n from gl_lines where voucher_id = p_v;
  if n = 0 then update gl_vouchers set status = 'cancelled', issues = 'Tutar yok' where id = p_v; return jsonb_build_object('id', p_v, 'empty', true); end if;
  if d <> c then raise exception 'gl_unbalanced:% / %', d, c; end if;
  update gl_vouchers set status = 'posted', total = d where id = p_v;
  return jsonb_build_object('id', p_v, 'total', d, 'lines', n);
end $$;
revoke execute on function gl_finish(uuid) from public, anon, authenticated;

-- Hesabın alt hesap bazında bakiyeleri (kapanışlarda alt hesap alt hesap kapatmak için)
create or replace function gl_leaf_balances(p_prefix text, p_from date, p_to date) returns table (code text, bal bigint)
language sql stable security definer set search_path = public as $$
  select a.code, sum(l.debit - l.credit)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date between p_from and p_to and a.code like p_prefix || '%'
  group by a.code having sum(l.debit - l.credit) <> 0 order by a.code;
$$;
revoke execute on function gl_leaf_balances(text, date, date) from public, anon, authenticated;

-- Raporlar kapanış öncesi bakiyeyi gösterir: raporun yılına ait kapanış fişleri hariç (sonraki yıllarda dahil; açılış fişiyle denkleşir)
create or replace function gl_balances(p_from date, p_to date) returns table (account_id uuid, open_d bigint, open_c bigint, per_d bigint, per_c bigint)
language sql stable security definer set search_path = public as $$
  select l.account_id,
         coalesce(sum(l.debit) filter (where v.voucher_date < p_from), 0)::bigint,
         coalesce(sum(l.credit) filter (where v.voucher_date < p_from), 0)::bigint,
         coalesce(sum(l.debit) filter (where v.voucher_date >= p_from), 0)::bigint,
         coalesce(sum(l.credit) filter (where v.voucher_date >= p_from), 0)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id
  where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= p_to and can_module('ledger')
    and not (v.source = 'closing' and v.year = extract(year from p_to)::int)
  group by l.account_id;
$$;

-- ---------------------------------------------------------------------
-- KDV
-- ---------------------------------------------------------------------
create or replace function gl_vat_report(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(x order by x->>'direction', x->>'type', (x->>'vat_rate')::numeric), '[]') from (
      select jsonb_build_object('direction', i.direction, 'type', i.type, 'vat_rate', l.vat_rate, 'export', i.profile = 'IHRACAT', 'exemption', l.vat_exemption_code,
               'withholding_code', l.withholding_code, 'invoices', count(distinct i.id),
               'base', sum(round(l.net * i.rate))::bigint, 'vat', sum(round(l.vat * i.rate))::bigint, 'withholding', sum(round(l.withholding * i.rate))::bigint) x
      from inv_invoices i join inv_lines l on l.invoice_id = i.id
      where i.company_id = lab_company() and i.status = 'posted' and i.invoice_date between p_from and p_to
        and not exists (select 1 from fin_parties p where p.id = i.party_id and p.slip_of is not null)
      group by i.direction, i.type, l.vat_rate, i.profile = 'IHRACAT', l.vat_exemption_code, l.withholding_code) q),
    'gl', jsonb_build_object('v190_open', gl_code_balance('190', p_from - 1), 'v191', gl_code_balance('191', p_to, p_from), 'v391', -gl_code_balance('391', p_to, p_from),
                             'v191_bal', gl_code_balance('191', p_to), 'v391_bal', -gl_code_balance('391', p_to), 'v190_bal', gl_code_balance('190', p_to)),
    'closed', (select jsonb_build_object('id', v.id, 'no', v.no, 'year', v.year) from gl_vouchers v where v.company_id = lab_company() and v.tag = 'vat:' || to_char(p_to, 'YYYY-MM') and v.status = 'posted')
  ) end;
$$;
revoke execute on function gl_vat_report(date, date) from public, anon;
grant execute on function gl_vat_report(date, date) to authenticated;

-- Ay sonu KDV mahsubu: 391 borç, 191 alacak; fark 190 (devreden) ya da 360 (ödenecek)
create or replace function gl_vat_close(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; v uuid; x391 bigint; x191 bigint; x190 bigint;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('vat:' || p_month, d, 'mahsup', 'vat', 'KDV mahsubu · ' || p_month);
  x391 := -gl_code_balance('391', d); x191 := gl_code_balance('191', d); x190 := gl_code_balance('190', d);
  perform gl_add_line(v, '391', x391, 'Hesaplanan KDV kapatıldı');
  perform gl_add_line(v, '191', -x191, 'İndirilecek KDV kapatıldı');
  if x391 >= x191 + x190 then
    perform gl_add_line(v, '190', -x190, 'Devreden KDV mahsup edildi');
    perform gl_add_line(v, '360', -(x391 - x191 - x190), 'Ödenecek KDV · ' || p_month);
  else
    perform gl_add_line(v, '190', x191 - x391, 'Sonraki aya devreden KDV');
  end if;
  return gl_finish(v);
end $$;
revoke execute on function gl_vat_close(text) from public, anon;
grant execute on function gl_vat_close(text) to authenticated;

-- ---------------------------------------------------------------------
-- Ba-Bs
-- ---------------------------------------------------------------------
create or replace function gl_babs(p_month text, p_limit bigint default null) returns jsonb
language sql stable security definer set search_path = public as $$
  with s as (select coalesce(p_limit, (select babs_limit from gl_settings where company_id = lab_company()), 500000) lim),
  r as (
    select i.direction, i.party_id, coalesce(max(i.party_name), max(p.name)) party, coalesce(max(i.party_tax_no), max(p.tax_no)) tax_no, coalesce(max(i.party_country), max(p.country)) country,
           count(*) docs, sum(round(i.subtotal * i.rate))::bigint amount
    from inv_invoices i join fin_parties p on p.id = i.party_id
    where i.company_id = lab_company() and i.status = 'posted' and i.type = 'invoice' and to_char(i.invoice_date, 'YYYY-MM') = p_month and p.slip_of is null
    group by i.direction, i.party_id
  )
  select case when can_module('ledger') then jsonb_build_object('limit', (select lim from s),
    'ba', (select coalesce(jsonb_agg(to_jsonb(r) order by amount desc), '[]') from r where direction = 'purchase' and amount >= (select lim from s)),
    'bs', (select coalesce(jsonb_agg(to_jsonb(r) order by amount desc), '[]') from r where direction = 'sale' and amount >= (select lim from s))) end;
$$;
revoke execute on function gl_babs(text, bigint) from public, anon;
grant execute on function gl_babs(text, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Bordro: muhtasar hazırlık ve tahakkuk fişi
-- ---------------------------------------------------------------------
create or replace function gl_payroll_report(p_period text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') or can_module('payroll') then (
    select jsonb_build_object('period', p_period, 'people', count(*), 'days', coalesce(sum(days), 0),
      'gross', coalesce(sum(official_gross), 0), 'income_tax', coalesce(sum(income_tax), 0), 'stamp_tax', coalesce(sum(stamp_tax), 0),
      'sgk_employee', coalesce(sum(sgk_employee), 0), 'unemployment_employee', coalesce(sum(unemployment_employee), 0),
      'employer_share', coalesce(sum(employer_cost - official_gross), 0), 'employer_cost', coalesce(sum(employer_cost), 0),
      'net', coalesce(sum(official_net), 0), 'bes', coalesce(sum(bes), 0), 'garnishment', coalesce(sum(garnishment), 0), 'net_to_bank', coalesce(sum(net_to_bank), 0),
      'accrual', (select jsonb_build_object('id', v.id, 'no', v.no, 'year', v.year) from gl_vouchers v where v.company_id = lab_company() and v.tag = 'payroll:' || p_period and v.status = 'posted'))
    from payroll_lines where company_id = lab_company() and period = p_period) end;
$$;
revoke execute on function gl_payroll_report(text) from public, anon;
grant execute on function gl_payroll_report(text) to authenticated;

-- 770 brüt + işveren payı / 335 net / 360 GV + DV / 361 SGK (işçi + işveren + işsizlik) / 369 BES + icra
create or replace function gl_payroll_accrual(p_period text, p_expense text default '770') returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; v uuid; r record;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  select coalesce(sum(official_gross), 0)::bigint gross, coalesce(sum(employer_cost - official_gross), 0)::bigint er, coalesce(sum(income_tax + stamp_tax), 0)::bigint tax,
         coalesce(sum(sgk_employee + unemployment_employee), 0)::bigint ee, coalesce(sum(bes + garnishment), 0)::bigint ded, coalesce(sum(net_to_bank), 0)::bigint net, count(*) n
  into r from payroll_lines where company_id = lab_company() and period = p_period;
  if r.n = 0 then raise exception 'gl_no_payroll'; end if;
  d := (date_trunc('month', (p_period || '-01')::date) + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('payroll:' || p_period, d, 'mahsup', 'payroll', 'Bordro tahakkuku · ' || p_period || ' · ' || r.n || ' personel');
  perform gl_add_line(v, p_expense, r.gross + r.er, 'Brüt ücret ve işveren payları');
  perform gl_add_line(v, '335', -r.net, 'Ödenecek net ücret');
  perform gl_add_line(v, '360', -r.tax, 'Gelir vergisi ve damga vergisi kesintisi');
  perform gl_add_line(v, '361', -(r.ee + r.er), 'SGK primleri (işçi + işveren + işsizlik)');
  perform gl_add_line(v, '369', -r.ded, 'BES ve icra kesintileri');
  -- yuvarlama farkı (brüt - kesintiler - net) varsa 335'e
  perform gl_add_line(v, '335', -((r.gross + r.er) - r.net - r.tax - (r.ee + r.er) - r.ded), 'Yuvarlama farkı');
  return gl_finish(v);
end $$;
revoke execute on function gl_payroll_accrual(text, text) from public, anon;
grant execute on function gl_payroll_accrual(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Kur değerleme: döviz kasa / banka hesapları ve döviz carileri
-- ---------------------------------------------------------------------
create or replace function gl_fx_revalue(p_date date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; r record; target bigint; cur bigint; diff bigint; gain bigint := 0; loss bigint := 0; n int := 0;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  v := gl_tag_voucher('fx:' || p_date, p_date, 'mahsup', 'fx', 'Kur değerleme · ' || to_char(p_date, 'DD.MM.YYYY'));
  for r in
    select a.id gl_id, a.code, coalesce(fa.currency, fp.currency) cur,
           coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where t.voided_at is null and m.move_date <= p_date
                     and ((a.link_type = 'fin_account' and m.account_id = a.link_id) or (a.link_type = 'party' and m.party_id = a.link_id and m.currency = fp.currency))), 0) fx
    from gl_accounts a
    left join fin_accounts fa on a.link_type = 'fin_account' and fa.id = a.link_id
    left join fin_parties fp on a.link_type = 'party' and fp.id = a.link_id
    where a.company_id = lab_company() and a.link_id is not null and coalesce(fa.currency, fp.currency, 'TRY') <> 'TRY'
      and not (a.link_type = 'party' and exists (select 1 from fin_moves m where m.party_id = a.link_id and m.currency <> fp.currency))
  loop
    target := round(r.fx * fin_rate(r.cur, p_date));
    select coalesce(sum(l.debit - l.credit), 0) into cur from gl_lines l join gl_vouchers x on x.id = l.voucher_id
    where l.account_id = r.gl_id and x.status = 'posted' and x.voucher_date <= p_date and x.id <> v;
    diff := target - cur;
    if diff = 0 then continue; end if;
    n := n + 1;
    insert into gl_lines (voucher_id, sort, account_id, debit, credit, description, currency, rate)
    values (v, n, r.gl_id, greatest(diff, 0), greatest(-diff, 0), 'Kur farkı · ' || r.cur || ' ' || round(fin_rate(r.cur, p_date), 4), r.cur, fin_rate(r.cur, p_date));
    if diff > 0 then gain := gain + diff; else loss := loss - diff; end if;
  end loop;
  perform gl_add_line(v, '646', -gain, 'Kambiyo kârı (değerleme)');
  perform gl_add_line(v, '656', loss, 'Kambiyo zararı (değerleme)');
  return gl_finish(v) || jsonb_build_object('gain', gain, 'loss', loss);
end $$;
revoke execute on function gl_fx_revalue(date) from public, anon;
grant execute on function gl_fx_revalue(date) to authenticated;

-- ---------------------------------------------------------------------
-- Yıl sonu kapanış ve yeni yıl açılışı
-- ---------------------------------------------------------------------
create or replace function gl_close_year(p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date := make_date(p_year, 1, 1); t date := make_date(p_year, 12, 31); v uuid; r record; total bigint; res bigint; out jsonb := '{}';
  y record;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if gl_locked(lab_company(), t) then raise exception 'gl_locked'; end if;

  -- 1) 7/A yansıtma: 7xx gider → 6xx (yansıtma hesabı karşılığıyla), sonra 7xx kapanışı
  v := gl_tag_voucher('close7:' || p_year, t, 'mahsup', 'closing', 'Gider yansıtma ve 7 sınıfı kapanışı · ' || p_year);
  for y in select * from (values ('710', '711', '620'), ('720', '721', '620'), ('730', '731', '620'), ('740', '741', '622'), ('750', '751', '630'), ('760', '761', '631'), ('770', '771', '632'), ('780', '781', '660')) z(src, refl, dst) loop
    select coalesce(sum(bal), 0) into total from gl_leaf_balances(y.src, f, t);
    if total <> 0 then
      perform gl_add_line(v, y.dst, total, 'Yansıtma · ' || y.src);
      perform gl_add_line(v, y.refl, -total, 'Yansıtma · ' || y.src);
      -- yansıtma hesabı ile gider hesabının kapanışı (alt hesap alt hesap)
      perform gl_add_line(v, y.refl, total, 'Kapanış · ' || y.refl);
      for r in select * from gl_leaf_balances(y.src, f, t) loop perform gl_add_line(v, r.code, -r.bal, 'Kapanış · ' || r.code); end loop;
    end if;
  end loop;
  out := out || jsonb_build_object('reflect', gl_finish(v));

  -- 2) gelir tablosu hesapları → 690 (691, 692 hariç)
  v := gl_tag_voucher('close6:' || p_year, t, 'kapanis', 'closing', 'Gelir tablosu hesaplarının kapanışı · ' || p_year);
  res := 0;
  for r in select * from gl_leaf_balances('6', f, t) where left(code, 3) not in ('690', '691', '692') loop
    perform gl_add_line(v, r.code, -r.bal, 'Kapanış → 690'); res := res + r.bal;
  end loop;
  perform gl_add_line(v, '690', res, 'Dönem kârı veya zararı');
  out := out || jsonb_build_object('income', gl_finish(v));

  -- 3) 690 + 691 → 692 → 590 / 591
  v := gl_tag_voucher('close69:' || p_year, t, 'kapanis', 'closing', 'Dönem net kârı / zararı · ' || p_year);
  res := 0;
  for r in select * from gl_leaf_balances('69', f, t) where left(code, 3) in ('690', '691') loop
    perform gl_add_line(v, r.code, -r.bal, 'Kapanış → 692'); res := res + r.bal;
  end loop;
  if res <> 0 then
    perform gl_add_line(v, '692', res, 'Dönem net kârı veya zararı');
    perform gl_add_line(v, '692', -res, 'Kapanış');
    perform gl_add_line(v, case when res < 0 then '590' else '591' end, res, case when res < 0 then 'Dönem net kârı' else 'Dönem net zararı' end);
  end if;
  out := out || jsonb_build_object('result', gl_finish(v), 'net_profit', -res);

  -- 4) bilanço hesaplarının kapanışı (1-5 sınıfı, alt hesap bazında) ve 5) yeni yıl açılışı
  v := gl_tag_voucher('closebs:' || p_year, t, 'kapanis', 'closing', 'Bilanço hesaplarının kapanışı · ' || p_year);
  for r in select a.code, sum(l.debit - l.credit)::bigint bal from gl_lines l join gl_vouchers x on x.id = l.voucher_id join gl_accounts a on a.id = l.account_id
           where x.company_id = lab_company() and x.status = 'posted' and x.voucher_date <= t and left(a.code, 1) in ('1', '2', '3', '4', '5') and x.id <> v
           group by a.code having sum(l.debit - l.credit) <> 0 order by a.code loop
    perform gl_add_line(v, r.code, -r.bal, 'Kapanış');
  end loop;
  out := out || jsonb_build_object('balance', gl_finish(v));

  v := gl_tag_voucher('open:' || (p_year + 1), make_date(p_year + 1, 1, 1), 'acilis', 'opening', 'Açılış fişi · ' || (p_year + 1));
  insert into gl_lines (voucher_id, sort, account_id, debit, credit, description)
  select v, l.sort, l.account_id, l.credit, l.debit, 'Açılış' from gl_lines l join gl_vouchers x on x.id = l.voucher_id
  where x.company_id = lab_company() and x.tag = 'closebs:' || p_year and x.status = 'posted';
  out := out || jsonb_build_object('opening', gl_finish(v));
  return out;
end $$;
revoke execute on function gl_close_year(int) from public, anon;
grant execute on function gl_close_year(int) to authenticated;

create or replace function gl_undo_close(p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if gl_locked(lab_company(), make_date(p_year, 12, 31)) then raise exception 'gl_locked'; end if;
  update gl_vouchers set status = 'cancelled', updated_at = now()
  where company_id = lab_company() and status <> 'cancelled' and tag in ('close7:' || p_year, 'close6:' || p_year, 'close69:' || p_year, 'closebs:' || p_year, 'open:' || (p_year + 1));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function gl_undo_close(int) from public, anon;
grant execute on function gl_undo_close(int) to authenticated;

-- Dönem kilidi (boş = kilidi kaldır)
create or replace function gl_set_lock(p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if p_date is not null and exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'pending' and voucher_date <= p_date) then
    raise exception 'gl_pending_before_lock';
  end if;
  update gl_settings set lock_date = p_date, updated_by = auth.uid(), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function gl_set_lock(date) from public, anon;
grant execute on function gl_set_lock(date) to authenticated;

create or replace function gl_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  perform gl_seed(lab_company());
  update gl_settings set
    enabled = coalesce((p->>'enabled')::boolean, enabled),
    start_date = coalesce(nullif(p->>'start_date', '')::date, start_date),
    export_format = coalesce(nullif(p->>'export_format', ''), export_format),
    exclude_codes = case when p ? 'exclude_codes' then array(select jsonb_array_elements_text(p->'exclude_codes')) else exclude_codes end,
    exclude_cash_salary = coalesce((p->>'exclude_cash_salary')::boolean, exclude_cash_salary),
    babs_limit = coalesce(nullif(p->>'babs_limit', '')::bigint, babs_limit),
    updated_by = auth.uid(), updated_at = now()
  where company_id = lab_company();
end $$;

-- Dönem durumu (ekran): ay ay KDV mahsubu, bordro tahakkuku, kur değerleme
create or replace function gl_period_status(p_year int) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'months', (select jsonb_agg(jsonb_build_object('month', m,
        'vouchers', (select count(*) from gl_vouchers v where v.company_id = lab_company() and v.status = 'posted' and to_char(v.voucher_date, 'YYYY-MM') = m),
        'pending', (select count(*) from gl_vouchers v where v.company_id = lab_company() and v.status = 'pending' and to_char(v.voucher_date, 'YYYY-MM') = m),
        'vat', exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.tag = 'vat:' || m and v.status = 'posted'),
        'payroll', exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.tag = 'payroll:' || m and v.status = 'posted'),
        'payroll_lines', exists (select 1 from payroll_lines pl where pl.company_id = lab_company() and pl.period = m)) order by m)
      from (select to_char(make_date(p_year, g, 1), 'YYYY-MM') m from generate_series(1, 12) g) x),
    'closed', exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.tag = 'closebs:' || p_year and v.status = 'posted'),
    'fx', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'date', v.voucher_date, 'total', v.total) order by v.voucher_date), '[]') from gl_vouchers v
           where v.company_id = lab_company() and v.source = 'fx' and v.status = 'posted' and extract(year from v.voucher_date)::int = p_year)
  ) end;
$$;
revoke execute on function gl_period_status(int) from public, anon;
grant execute on function gl_period_status(int) to authenticated;

-- ---------------------------------------------------------------------
-- Kontrol Merkezi: ÜTS + genel muhasebe kuralları
-- ---------------------------------------------------------------------
create or replace function adm_extra_rules() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_array(
    jsonb_build_object('key', 'uts_error', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''ye iletilemeyen bildirim', 'hint', 'Hata mesajını okuyun: lot / kurum no düzeltip tekrar deneyin ya da ÜTS''de elle yapıp işaretleyin.', 'fix', '/stok/uts?durum=error',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || coalesce('' · lot '' || n.lot_no, '''') || coalesce('' · seri '' || n.serial_no, '''') label, ''/stok/uts?durum=error'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''error'''),
    jsonb_build_object('key', 'uts_cancel', 'area', 'stok', 'sev', 'high', 'title', 'ÜTS''de iptal edilmesi gereken bildirim', 'hint', 'Malzeme işten kaldırıldı ama bildirim ÜTS''ye gitmişti.', 'fix', '/stok/uts?durum=cancel_needed',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, '''') || coalesce('' · lot '' || coalesce(n.lot_no, n.serial_no), '''') label, ''/stok/uts?durum=cancel_needed'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''cancel_needed'''),
    jsonb_build_object('key', 'uts_stale', 'area', 'stok', 'sev', 'medium', 'title', '24 saattir bekleyen ÜTS bildirimi', 'hint', 'Ismarlama bildirimleri ÜTS ekranından elle yapılır; diğerleri için ÜTS bağlantısını kontrol edin.', 'fix', '/stok/uts',
      'sql', 'select n.id::text id, n.kind || '' · '' || coalesce(n.item_name, ''iş #'' || (n.payload->>''job_no''), '''') || '' · '' || to_char(n.created_at, ''DD.MM'') label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status = ''pending'' and n.created_at < now() - interval ''24 hours'''),
    jsonb_build_object('key', 'uts_no_number', 'area', 'stok', 'sev', 'medium', 'title', 'ÜTS takibinde ama ürün numarası (UNO) girilmemiş stok kartı', 'hint', 'Ürünün karekodundaki (01) numarasını karta girin.', 'fix', '/stok/urunler',
      'sql', 'select i.id::text id, i.name label, ''/stok/urunler/'' || i.id link from stk_items i where i.company_id = lab_company() and i.is_active and i.uts_tracked and coalesce(i.uts_product_no, '''') = '''''),
    jsonb_build_object('key', 'uts_no_kurum', 'area', 'stok', 'sev', 'low', 'title', 'ÜTS kurum no eksik: bildirimi bekleyen tedarikçi / klinik', 'hint', 'Cari ya da hekim kartına ÜTS kurum numarasını girin.', 'fix', '/stok/uts',
      'sql', 'select coalesce(n.counterparty_name, ''?'') id, coalesce(n.counterparty_name, ''Karşı kurum'') || '' · '' || count(*) || '' bildirim'' label, ''/stok/uts'' link from uts_notifications n where n.company_id = lab_company() and n.status in (''pending'', ''error'') and n.kind in (''alma'', ''verme'') and coalesce(n.counterparty_no, '''') = '''' group by n.counterparty_name')
  ) where exists (select 1 from uts_settings s where s.company_id = lab_company() and s.enabled)), '[]'::jsonb)
  || coalesce((select jsonb_build_array(
    jsonb_build_object('key', 'gl_pending', 'area', 'finans', 'sev', 'high', 'title', 'Muhasebe fişine dönemeyen kayıt (eşleştirme yok)', 'hint', 'Eşleştirme ekranından hesap kodunu girin, sonra yeniden deneyin.', 'fix', '/muhasebe/fisler?durum=pending',
      'sql', 'select v.id::text id, to_char(v.voucher_date, ''DD.MM.YYYY'') || '' · '' || coalesce(v.description, '''') || '' · '' || coalesce(v.issues, '''') label, ''/muhasebe/fisler/'' || v.id link from gl_vouchers v where v.company_id = lab_company() and v.status = ''pending'''),
    jsonb_build_object('key', 'gl_unposted', 'area', 'finans', 'sev', 'medium', 'title', 'Muhasebeye hiç aktarılmamış ERP kaydı', 'hint', 'Genel muhasebe › Geçmişi fişe çevir.', 'fix', '/muhasebe',
      'sql', 'select x.id::text id, to_char(x.txn_date, ''DD.MM.YYYY'') || '' · '' || x.kind || coalesce('' · '' || x.description, '''') label, ''/muhasebe'' link from fin_txns x join gl_settings s on s.company_id = x.company_id where x.company_id = lab_company() and s.enabled and x.voided_at is null and x.txn_date >= s.start_date and x.created_at < now() - interval ''1 hour'' and not exists (select 1 from gl_vouchers v where v.fin_txn_id = x.id)'),
    jsonb_build_object('key', 'gl_vat_open', 'area', 'finans', 'sev', 'medium', 'title', 'KDV mahsubu yapılmamış geçmiş ay', 'hint', 'Beyanname hazırlık › KDV ekranında ayı kapatın.', 'fix', '/muhasebe/beyanname',
      'sql', 'select m id, m || '' KDV mahsubu yok'' label, ''/muhasebe/beyanname?ay='' || m link from (select to_char(d, ''YYYY-MM'') m from generate_series(date_trunc(''month'', (select start_date from gl_settings where company_id = lab_company())), date_trunc(''month'', current_date) - interval ''1 month'', interval ''1 month'') d) q where exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.status = ''posted'' and to_char(v.voucher_date, ''YYYY-MM'') = q.m) and not exists (select 1 from gl_vouchers v where v.company_id = lab_company() and v.tag = ''vat:'' || q.m and v.status = ''posted'')'),
    jsonb_build_object('key', 'gl_unbalanced', 'area', 'finans', 'sev', 'high', 'title', 'Borç ve alacağı tutmayan muhasebe fişi', 'hint', 'Fişi açıp düzeltin.', 'fix', '/muhasebe/fisler',
      'sql', 'select v.id::text id, v.year || ''/'' || v.no label, ''/muhasebe/fisler/'' || v.id link from gl_vouchers v join gl_lines l on l.voucher_id = v.id where v.company_id = lab_company() and v.status = ''posted'' group by v.id having sum(l.debit) <> sum(l.credit)')
  ) where exists (select 1 from gl_settings s where s.company_id = lab_company() and s.enabled)), '[]'::jsonb);
$$;
revoke execute on function adm_extra_rules() from public, anon, authenticated;

notify pgrst, 'reload schema';
