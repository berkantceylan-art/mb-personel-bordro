-- =====================================================================
-- Beyanname merkezi (Paket A)
--  * KDV2: tevkifatlı / yurt dışı hizmet alımlarında KDV'nin tamamı 191'e, tevkif edilen kısım
--    "Sorumlu sıfatıyla KDV" kategorisine (muhasebede 360). Masraf girişinde de seçilebilir.
--  * Vergi ödemeleri ve KDV iade alacağı için finans kategorileri (360 / 136).
--  * İhracat faturasına gümrük beyannamesi / ETGB numarası; KDV iade hesabı, listeler ve 136 fişi.
--  * Damga vergisi sözleşme defteri, aylık rapor ve tahakkuk fişi.
--  * Vergi takvimi ve beyanname durum takibi.
-- Tekrar çalıştırılabilir. Önce 20270211000000_stopaj.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Finans kategorileri ve muhasebe eşleştirmeleri
-- ---------------------------------------------------------------------
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, v.code, v.name, 'other', true, v.sort from companies c
cross join (values ('vat_resp', 'Sorumlu sıfatıyla KDV (KDV2)', 92),
                   ('tax_payable', 'Vergi dairesine ödeme (KDV, damga, stopaj)', 93),
                   ('vat_refund', 'KDV iade alacağı', 94)) v(code, name, sort)
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = v.code);

insert into gl_maps (company_id, source, key, account_id)
select a.company_id, 'category_code', v.code, a.id from gl_accounts a
join (values ('vat_resp', '360'), ('tax_payable', '360'), ('vat_refund', '136')) v(code, acc) on a.code = v.acc
on conflict do nothing;

-- 136 hesap planında yoksa ekle (eşleştirme için)
insert into gl_accounts (company_id, code, name, kind, normal_side)
select s.company_id, t.code, t.name, gl_kind_of(t.code), gl_side_of(t.code, t.name)
from gl_settings s cross join gl_tdhp() t
where t.code = '136' and not exists (select 1 from gl_accounts a where a.company_id = s.company_id and a.code = '136')
on conflict do nothing;
insert into gl_maps (company_id, source, key, account_id)
select a.company_id, 'category_code', 'vat_refund', a.id from gl_accounts a where a.code = '136'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- inv_post: alış faturasında tevkifat varsa KDV'nin tamamı indirilecek KDV'ye,
-- tevkif edilen kısım sorumlu sıfatıyla KDV'ye (satıcıya ödenmez, KDV2 ile vergi dairesine ödenir)
-- ---------------------------------------------------------------------
do $$
declare src text; old_txt text; new_txt text;
begin
  select pg_get_functiondef('inv_post(uuid)'::regprocedure) into src;
  if position('vat_resp' in src) > 0 then return; end if;
  old_txt := $q$  if v.vat_total - v.withholding_total <> 0 then
    v_lines := v_lines || jsonb_build_object('category_id', fin_category(case when v.direction = 'sale' then 'vat_out' else 'vat_in' end),$q$;
  new_txt := $q$  if v.direction = 'purchase' and v.withholding_total <> 0 then
    if fin_category('vat_resp') is null then raise exception 'category_missing'; end if;
    v_lines := v_lines || jsonb_build_object('category_id', fin_category('vat_in'), 'amount', -s * v.vat_total, 'currency', v.currency, 'rate', v.rate)
                       || jsonb_build_object('category_id', fin_category('vat_resp'), 'amount', s * v.withholding_total, 'currency', v.currency, 'rate', v.rate, 'description', 'Sorumlu sıfatıyla KDV (KDV2)');
  elsif v.vat_total - v.withholding_total <> 0 then
    v_lines := v_lines || jsonb_build_object('category_id', fin_category(case when v.direction = 'sale' then 'vat_out' else 'vat_in' end),$q$;
  if position(old_txt in src) = 0 then raise exception 'inv_post_patch_failed'; end if;
  execute replace(src, old_txt, new_txt);
end $$;

-- ---------------------------------------------------------------------
-- İhracat belgesi (gümrük beyannamesi / ETGB)
-- ---------------------------------------------------------------------
alter table inv_invoices add column if not exists export_doc_kind text check (export_doc_kind is null or export_doc_kind in ('gb', 'etgb'));
alter table inv_invoices add column if not exists export_doc_no text check (export_doc_no is null or length(export_doc_no) <= 40);
alter table inv_invoices add column if not exists export_doc_date date;

create or replace function inv_set_export_doc(p_id uuid, p_kind text, p_no text, p_date date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('ledger', 2)) then raise exception 'not_allowed'; end if;
  if p_kind is not null and p_kind not in ('gb', 'etgb') then raise exception 'bad_kind'; end if;
  update inv_invoices set export_doc_kind = case when nullif(trim(p_no), '') is null then null else p_kind end,
         export_doc_no = nullif(left(trim(p_no), 40), ''), export_doc_date = case when nullif(trim(p_no), '') is null then null else p_date end
  where id = p_id and company_id = lab_company() and direction = 'sale';
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function inv_set_export_doc(uuid, text, text, date) from public, anon;
grant execute on function inv_set_export_doc(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------
-- KDV2 raporu: faturalardaki tevkifat + masraf girişlerinden sorumlu KDV
-- ---------------------------------------------------------------------
create or replace function gl_vat2_report(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'lines', (select coalesce(jsonb_agg(x order by x->>'code' nulls last), '[]') from (
      select jsonb_build_object('code', l.withholding_code, 'rate', l.withholding_rate, 'vat_rate', l.vat_rate, 'foreign', f.foreign_party,
               'invoices', count(distinct i.id),
               'base', sum(case when i.type = 'return' then -1 else 1 end * round(l.net * i.rate))::bigint,
               'vat', sum(case when i.type = 'return' then -1 else 1 end * round(l.vat * i.rate))::bigint,
               'withholding', sum(case when i.type = 'return' then -1 else 1 end * round(l.withholding * i.rate))::bigint) x
      from inv_invoices i join inv_lines l on l.invoice_id = i.id join fin_parties p on p.id = i.party_id
      cross join lateral (select coalesce(nullif(upper(coalesce(i.party_country, p.country)), ''), 'TR') not in ('TR', 'TURKIYE', 'TÜRKİYE', 'TURKEY') foreign_party) f
      where i.company_id = lab_company() and i.status = 'posted' and i.direction = 'purchase' and l.withholding <> 0
        and i.invoice_date between p_from and p_to
      group by l.withholding_code, l.withholding_rate, l.vat_rate, f.foreign_party) q),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('txn_id', t.id, 'date', m.move_date, 'description', t.description, 'doc_no', t.doc_no,
                 'party', (select name from fin_parties where id = t.party_id), 'amount', -m.amount_try) order by m.move_date), '[]')
               from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
               where t.company_id = lab_company() and t.voided_at is null and c.code = 'vat_resp' and m.move_date between p_from and p_to
                 and t.ref_type is distinct from 'invoice'),
    'total', coalesce((select -sum(m.amount_try) from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
               where t.company_id = lab_company() and t.voided_at is null and c.code = 'vat_resp' and m.move_date between p_from and p_to), 0)::bigint
  ) end;
$$;
revoke execute on function gl_vat2_report(date, date) from public, anon;
grant execute on function gl_vat2_report(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- KDV iadesi (ihracat istisnası): tahmini hesap, listeler, 136 fişi
-- Yüklenilen KDV oranlama yöntemiyle: dönem indirilecek KDV × ihracat matrahı / toplam teslim matrahı.
-- Üst sınır: ihracat matrahı × %20. İade edilebilir = indirimle giderilemeyen (devreden) ile sınırlı.
-- ---------------------------------------------------------------------
create or replace function gl_vat_refund_calc(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_exp bigint; v_sale bigint; v_out bigint; v_in bigint; v_open bigint; v_loaded bigint; v_cap bigint; v_ref bigint; v_carry bigint; v_missing int; v_inv int;
begin
  if not can_module('ledger') then return null; end if;
  select coalesce(sum(sg * round(l.net * i.rate)) filter (where i.profile = 'IHRACAT' or l.vat_exemption_code in ('301', '302')), 0)::bigint,
         coalesce(sum(sg * round(l.net * i.rate)), 0)::bigint,
         coalesce(sum(sg * round((l.vat - l.withholding) * i.rate)), 0)::bigint
  into v_exp, v_sale, v_out
  from inv_invoices i join inv_lines l on l.invoice_id = i.id
  cross join lateral (select case when i.type = 'return' then -1 else 1 end sg) z
  where i.company_id = lab_company() and i.status = 'posted' and i.direction = 'sale' and i.invoice_date between p_from and p_to
    and not exists (select 1 from fin_parties p where p.id = i.party_id and p.slip_of is not null);
  select count(*) filter (where i.export_doc_no is null), count(*) into v_missing, v_inv
  from inv_invoices i where i.company_id = lab_company() and i.status = 'posted' and i.direction = 'sale' and i.type = 'invoice'
    and i.invoice_date between p_from and p_to
    and (i.profile = 'IHRACAT' or exists (select 1 from inv_lines l where l.invoice_id = i.id and l.vat_exemption_code in ('301', '302')));
  select coalesce(sum(m.amount_try), 0)::bigint into v_in
  from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
  where t.company_id = lab_company() and t.voided_at is null and c.code = 'vat_in' and m.move_date between p_from and p_to;
  v_open := gl_code_balance('190', p_from - 1);
  v_loaded := case when v_sale > 0 then least(v_in, round(v_in::numeric * v_exp / v_sale)::bigint) else 0 end;
  v_cap := round(v_exp * 0.20)::bigint;
  v_ref := greatest(0, least(v_loaded, v_cap));
  v_carry := greatest(0, v_in + v_open - v_out);
  return jsonb_build_object('export_base', v_exp, 'sale_base', v_sale, 'vat_out', v_out, 'vat_in', v_in, 'open', v_open,
    'loaded', v_loaded, 'cap', v_cap, 'refundable', v_ref, 'carry', v_carry, 'refund_now', least(v_ref, v_carry),
    'export_invoices', v_inv, 'missing_docs', v_missing,
    'posted', (select jsonb_build_object('id', v.id, 'no', v.no, 'year', v.year, 'total', v.total) from gl_vouchers v
               where v.company_id = lab_company() and v.tag = 'vatrefund:' || to_char(p_to, 'YYYY-MM') and v.status = 'posted'));
end $$;
revoke execute on function gl_vat_refund_calc(date, date) from public, anon;
grant execute on function gl_vat_refund_calc(date, date) to authenticated;

create or replace function gl_vat_refund_list(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'exports', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'date', i.invoice_date, 'doc_no', i.doc_no, 'party', coalesce(i.party_name, p.name),
                  'country', coalesce(i.party_country, p.country), 'currency', i.currency, 'rate', i.rate, 'total_fx', i.subtotal,
                  'base', round(i.subtotal * i.rate)::bigint, 'doc_kind', i.export_doc_kind, 'doc_no2', i.export_doc_no, 'doc_date', i.export_doc_date)
                  order by i.invoice_date, i.doc_no), '[]')
                from inv_invoices i join fin_parties p on p.id = i.party_id
                where i.company_id = lab_company() and i.status = 'posted' and i.direction = 'sale' and i.type = 'invoice'
                  and i.invoice_date between p_from and p_to
                  and (i.profile = 'IHRACAT' or exists (select 1 from inv_lines l where l.invoice_id = i.id and l.vat_exemption_code in ('301', '302')))),
    'purchases', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'date', i.invoice_date, 'doc_no', i.doc_no, 'party', coalesce(i.party_name, p.name),
                  'tax_no', coalesce(i.party_tax_no, p.tax_no), 'type', i.type,
                  'items', (select string_agg(distinct l.name, ', ') from inv_lines l where l.invoice_id = i.id),
                  'base', (case when i.type = 'return' then -1 else 1 end * round(i.subtotal * i.rate))::bigint,
                  'vat', (case when i.type = 'return' then -1 else 1 end * round(i.vat_total * i.rate))::bigint) order by i.invoice_date, i.doc_no), '[]')
                from inv_invoices i join fin_parties p on p.id = i.party_id
                where i.company_id = lab_company() and i.status = 'posted' and i.direction = 'purchase' and i.vat_total <> 0
                  and i.invoice_date between p_from and p_to and p.slip_of is null),
    'others', (select coalesce(jsonb_agg(jsonb_build_object('txn_id', t.id, 'date', m.move_date, 'doc_no', t.doc_no, 'description', t.description,
                  'party', (select name from fin_parties where id = t.party_id), 'vat', m.amount_try) order by m.move_date), '[]')
               from fin_moves m join fin_txns t on t.id = m.txn_id join fin_categories c on c.id = m.category_id
               where t.company_id = lab_company() and t.voided_at is null and c.code = 'vat_in' and m.move_date between p_from and p_to
                 and t.ref_type is distinct from 'invoice')
  ) end;
$$;
revoke execute on function gl_vat_refund_list(date, date) from public, anon;
grant execute on function gl_vat_refund_list(date, date) to authenticated;

-- İade talebi: indirimle giderilemeyen KDV devreden KDV'den iade alacağına (136 B / 190 A)
create or replace function gl_vat_refund_post(p_month text, p_amount bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; v uuid;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'bad_amount'; end if;
  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
  -- aynı ayın eski iade fişi varsa önce onun etkisini geri al (gl_tag_voucher iptal eder)
  if p_amount > gl_code_balance('190', d) + coalesce((select total from gl_vouchers where company_id = lab_company() and tag = 'vatrefund:' || p_month and status = 'posted'), 0) then
    raise exception 'refund_exceeds';
  end if;
  v := gl_tag_voucher('vatrefund:' || p_month, d, 'mahsup', 'vat', 'KDV iade alacağı · ' || p_month);
  perform gl_add_line(v, '136', p_amount, 'İhracat KDV iade alacağı · ' || p_month);
  perform gl_add_line(v, '190', -p_amount, 'İadeye konu devreden KDV');
  return gl_finish(v);
end $$;
revoke execute on function gl_vat_refund_post(text, bigint) from public, anon;
grant execute on function gl_vat_refund_post(text, bigint) to authenticated;

-- ---------------------------------------------------------------------
-- Damga vergisi sözleşme defteri
-- ---------------------------------------------------------------------
create table if not exists gl_stamp_docs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  doc_date date not null,
  doc_type text not null check (doc_type in ('rent', 'contract', 'commitment', 'guarantee', 'other', 'fixed')),
  title text not null check (length(title) between 1 and 200),
  party_id uuid references fin_parties (id) on delete set null,
  base bigint not null default 0 check (base >= 0),                       -- kuruş
  rate_pm numeric(8, 4) not null default 0 check (rate_pm between 0 and 100),  -- binde
  fixed_amount bigint check (fixed_amount is null or fixed_amount >= 0),  -- maktu vergi
  share_pct numeric(5, 2) not null default 100 check (share_pct > 0 and share_pct <= 100),
  tax bigint not null default 0,
  our_tax bigint not null default 0,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gl_stamp_docs_date_idx on gl_stamp_docs (company_id, doc_date);
alter table gl_stamp_docs enable row level security;
drop policy if exists gl_stamp_docs_read on gl_stamp_docs;
create policy gl_stamp_docs_read on gl_stamp_docs for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_stamp_docs from anon;
grant select on gl_stamp_docs to authenticated;

-- bir kağıt için azami damga vergisi (2026: 29.115.961,10 TL); sonraki yıllar ilan edilince güncellenir
create or replace function gl_stamp_cap(p_date date) returns bigint language sql immutable as $$
  select 2911596110::bigint;
$$;

create or replace function gl_stamp_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_date date := (p->>'doc_date')::date; v_base bigint := greatest(coalesce((p->>'base')::bigint, 0), 0);
        v_rate numeric := coalesce(nullif(p->>'rate_pm', '')::numeric, 0); v_fixed bigint := nullif(p->>'fixed_amount', '')::bigint;
        v_share numeric := coalesce(nullif(p->>'share_pct', '')::numeric, 100); v_tax bigint; old_date date;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if v_date is null then raise exception 'bad_date'; end if;
  if gl_locked(lab_company(), v_date) then raise exception 'gl_locked'; end if;
  if v_id is not null then
    select doc_date into old_date from gl_stamp_docs where id = v_id and company_id = lab_company();
    if old_date is null then raise exception 'not_found'; end if;
    if gl_locked(lab_company(), old_date) then raise exception 'gl_locked'; end if;
  end if;
  v_tax := case when v_fixed is not null then v_fixed else least(round(v_base * v_rate / 1000)::bigint, gl_stamp_cap(v_date)) end;
  if v_id is null then
    insert into gl_stamp_docs (doc_date, doc_type, title, party_id, base, rate_pm, fixed_amount, share_pct, tax, our_tax, note)
    values (v_date, coalesce(p->>'doc_type', 'contract'), left(trim(p->>'title'), 200), nullif(p->>'party_id', '')::uuid, v_base, v_rate, v_fixed, v_share,
            v_tax, round(v_tax * v_share / 100)::bigint, nullif(left(trim(p->>'note'), 500), ''))
    returning id into v_id;
  else
    update gl_stamp_docs set doc_date = v_date, doc_type = coalesce(p->>'doc_type', doc_type), title = left(trim(p->>'title'), 200),
      party_id = nullif(p->>'party_id', '')::uuid, base = v_base, rate_pm = v_rate, fixed_amount = v_fixed, share_pct = v_share,
      tax = v_tax, our_tax = round(v_tax * v_share / 100)::bigint, note = nullif(left(trim(p->>'note'), 500), ''), updated_at = now()
    where id = v_id;
  end if;
  return v_id;
end $$;
revoke execute on function gl_stamp_save(jsonb) from public, anon;
grant execute on function gl_stamp_save(jsonb) to authenticated;

create or replace function gl_stamp_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select doc_date into d from gl_stamp_docs where id = p_id and company_id = lab_company();
  if d is null then raise exception 'not_found'; end if;
  if gl_locked(lab_company(), d) then raise exception 'gl_locked'; end if;
  delete from gl_stamp_docs where id = p_id;
end $$;
revoke execute on function gl_stamp_delete(uuid) from public, anon;
grant execute on function gl_stamp_delete(uuid) to authenticated;

create or replace function gl_stamp_report(p_month text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then jsonb_build_object(
    'docs', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'doc_date', d.doc_date, 'doc_type', d.doc_type, 'title', d.title, 'party_id', d.party_id,
               'party', p.name, 'base', d.base, 'rate_pm', d.rate_pm, 'fixed_amount', d.fixed_amount, 'share_pct', d.share_pct, 'tax', d.tax, 'our_tax', d.our_tax, 'note', d.note)
               order by d.doc_date, d.created_at), '[]')
             from gl_stamp_docs d left join fin_parties p on p.id = d.party_id
             where d.company_id = lab_company() and to_char(d.doc_date, 'YYYY-MM') = p_month),
    'total', (select coalesce(sum(our_tax), 0) from gl_stamp_docs where company_id = lab_company() and to_char(doc_date, 'YYYY-MM') = p_month),
    'payroll', (select coalesce(sum(stamp_tax), 0) from payroll_lines where company_id = lab_company() and period = p_month),
    'voucher', (select jsonb_build_object('id', v.id, 'no', v.no, 'year', v.year, 'total', v.total) from gl_vouchers v
                where v.company_id = lab_company() and v.tag = 'stamp:' || p_month and v.status = 'posted')
  ) end;
$$;
revoke execute on function gl_stamp_report(text) from public, anon;
grant execute on function gl_stamp_report(text) to authenticated;

-- Tahakkuk: gider (varsayılan 770) B / 360 A — şirket payı
create or replace function gl_stamp_close(p_month text, p_expense text default '770') returns jsonb
language plpgsql security definer set search_path = public as $$
declare d date; v uuid; r record;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  if p_expense !~ '^[67][0-9]{2}' then raise exception 'bad_account'; end if;
  d := (date_trunc('month', (p_month || '-01')::date) + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('stamp:' || p_month, d, 'mahsup', 'vat', 'Damga vergisi tahakkuku · ' || p_month);
  for r in select title, our_tax from gl_stamp_docs where company_id = lab_company() and to_char(doc_date, 'YYYY-MM') = p_month and our_tax > 0 order by doc_date, created_at loop
    perform gl_add_line(v, p_expense, r.our_tax, 'Damga vergisi · ' || r.title);
  end loop;
  perform gl_add_line(v, '360', -(select coalesce(sum(our_tax), 0) from gl_stamp_docs where company_id = lab_company() and to_char(doc_date, 'YYYY-MM') = p_month)::bigint, 'Ödenecek damga vergisi · ' || p_month);
  return gl_finish(v);
end $$;
revoke execute on function gl_stamp_close(text, text) from public, anon;
grant execute on function gl_stamp_close(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Vergi takvimi ve beyanname durumu
-- ---------------------------------------------------------------------
create table if not exists gl_tax_filings (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  kind text not null check (kind in ('kdv1', 'kdv2', 'muhsgk', 'damga', 'gecici', 'kurumlar', 'edefter')),
  period text not null check (period ~ '^\d{4}(-\d{2}|-Q[1-4])?$'),
  status text not null default 'todo' check (status in ('todo', 'prepared', 'filed', 'paid', 'none')),
  amount bigint,
  note text check (note is null or length(note) <= 300),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (company_id, kind, period)
);
alter table gl_tax_filings enable row level security;
drop policy if exists gl_tax_filings_read on gl_tax_filings;
create policy gl_tax_filings_read on gl_tax_filings for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_tax_filings from anon;
grant select on gl_tax_filings to authenticated;

create or replace function gl_filing_set(p_kind text, p_period text, p_status text, p_amount bigint default null, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  insert into gl_tax_filings (company_id, kind, period, status, amount, note)
  values (lab_company(), p_kind, p_period, p_status, p_amount, nullif(left(trim(p_note), 300), ''))
  on conflict (company_id, kind, period) do update set status = excluded.status, amount = coalesce(excluded.amount, gl_tax_filings.amount),
    note = coalesce(excluded.note, gl_tax_filings.note), updated_by = auth.uid(), updated_at = now();
end $$;
revoke execute on function gl_filing_set(text, text, text, bigint, text) from public, anon;
grant execute on function gl_filing_set(text, text, text, bigint, text) to authenticated;

-- hafta sonuna denk gelen son gün ilk iş gününe kayar (resmi tatiller dahil değil)
create or replace function gl_bizday(d date) returns date language sql immutable as $$
  select case extract(isodow from d)::int when 6 then d + 2 when 7 then d + 1 else d end;
$$;

-- Dönemlere göre son günler; p_from–p_to arasındakiler ve son 31 günde verilmemiş olanlar
create or replace function gl_tax_calendar(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare m date; r jsonb := '[]'::jsonb; per text; y int; mo int;
begin
  if not can_module('ledger') then return null; end if;
  for m in select generate_series(date_trunc('month', p_from - 150), date_trunc('month', p_to), interval '1 month')::date loop
    per := to_char(m, 'YYYY-MM'); y := extract(year from m)::int; mo := extract(month from m)::int;
    r := r || jsonb_build_array(
      jsonb_build_object('kind', 'kdv2', 'period', per, 'due', gl_bizday((m + interval '1 month')::date + 24)),
      jsonb_build_object('kind', 'muhsgk', 'period', per, 'due', gl_bizday((m + interval '1 month')::date + 25)),
      jsonb_build_object('kind', 'damga', 'period', per, 'due', gl_bizday((m + interval '1 month')::date + 25)),
      jsonb_build_object('kind', 'kdv1', 'period', per, 'due', gl_bizday((m + interval '1 month')::date + 27)),
      jsonb_build_object('kind', 'edefter', 'period', per, 'due', gl_bizday((m + case when mo = 12 then interval '5 months' else interval '4 months' end)::date + 13)));
    if mo in (3, 6, 9) then
      r := r || jsonb_build_object('kind', 'gecici', 'period', y || '-Q' || (mo / 3), 'due', gl_bizday((m + interval '2 months')::date + 16));
    end if;
    if mo = 12 then
      r := r || jsonb_build_object('kind', 'kurumlar', 'period', y::text, 'due', gl_bizday(make_date(y + 1, 4, 30)));
    end if;
  end loop;
  return (select coalesce(jsonb_agg(e.x || jsonb_build_object('status', coalesce(f.status, 'todo'), 'amount', f.amount, 'note', f.note) order by (e.x->>'due')::date, e.x->>'kind'), '[]')
          from jsonb_array_elements(r) e(x)
          left join gl_tax_filings f on f.company_id = lab_company() and f.kind = e.x->>'kind' and f.period = e.x->>'period'
          where (e.x->>'due')::date between p_from and p_to
             or ((e.x->>'due')::date between p_from - 31 and p_from - 1 and coalesce(f.status, 'todo') not in ('filed', 'paid', 'none')));
end $$;
revoke execute on function gl_tax_calendar(date, date) from public, anon;
grant execute on function gl_tax_calendar(date, date) to authenticated;

notify pgrst, 'reload schema';
