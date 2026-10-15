-- =====================================================================
-- Muhasebe kokpiti K2: kontrol motoru
--  gl_checks(ay): fiş, belge, KDV, bordro, kasa / banka, çek-senet, cari, dönem sonu, rapor ve beyanname kontrolleri
--  Uyarı "bilerek geçildi" ile kapatılabilir; açık kritik uyarı varken dönem kilitlenemez.
-- Tekrar çalıştırılabilir. Önce 20270217000000_gl_inbox.sql.
-- =====================================================================

create table if not exists gl_check_acks (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  check_key text not null check (length(check_key) between 1 and 40),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  note text check (note is null or length(note) <= 300),
  acked_by uuid default auth.uid(),
  acked_at timestamptz not null default now(),
  primary key (company_id, check_key, period)
);
alter table gl_check_acks enable row level security;
drop policy if exists gl_check_acks_read on gl_check_acks;
create policy gl_check_acks_read on gl_check_acks for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_check_acks from anon;
grant select on gl_check_acks to authenticated;

create or replace function gl_check_ack(p_key text, p_period text, p_note text, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if coalesce(p_on, true) then
    insert into gl_check_acks (company_id, check_key, period, note) values (lab_company(), p_key, p_period, nullif(left(trim(p_note), 300), ''))
    on conflict (company_id, check_key, period) do update set note = excluded.note, acked_by = auth.uid(), acked_at = now();
  else
    delete from gl_check_acks where company_id = lab_company() and check_key = p_key and period = p_period;
  end if;
end $$;
revoke execute on function gl_check_ack(text, text, text, boolean) from public, anon;
grant execute on function gl_check_ack(text, text, text, boolean) to authenticated;

-- Sonuç: [{key, title, area, severity, count, link, items:[{label, amount, link}], acked, note}]
create or replace function gl_checks(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  f date; t date; past boolean; co uuid := lab_company(); res jsonb := '[]'::jsonb; it jsonb; n int; ck jsonb;
begin
  if not can_module('ledger') then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date;
  past := t < current_date;
  ck := gl_period_checklist(p_month);

  -- yardımcı: res'e kontrol ekle (count > 0 olanlar ve kritik / uyarı seviyesindekiler)
  -- 1) Fiş
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(description, '—') || ' · ' || to_char(voucher_date, 'DD.MM'), 'link', '/muhasebe/fisler/' || id) order by voucher_date) filter (where rn <= 20), '[]')
  into n, it from (select *, row_number() over (order by voucher_date) rn from gl_vouchers where company_id = co and status in ('draft', 'pending') and voucher_date between f and t) q;
  res := res || jsonb_build_object('key', 'pending_vouchers', 'title', 'Onay ya da eşleştirme bekleyen fiş', 'area', 'Fiş', 'severity', 'critical', 'count', n, 'items', it, 'link', '/muhasebe/gelen-kutusu?ay=' || p_month);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(v.description, '—'), 'link', '/muhasebe/fisler/' || v.id)) filter (where true), '[]') into n, it
  from gl_vouchers v where v.company_id = co and v.status = 'posted' and v.voucher_date between f and t
    and (select coalesce(sum(debit), 0) <> coalesce(sum(credit), 0) or coalesce(sum(debit), 0) = 0 from gl_lines where voucher_id = v.id);
  res := res || jsonb_build_object('key', 'unbalanced', 'title', 'Dengesiz ya da tutarı sıfır fiş', 'area', 'Fiş', 'severity', 'critical', 'count', n, 'items', it, 'link', '/muhasebe/fisler?durum=posted');

  -- 2) Belge
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', name, 'amount', balance, 'link', '/finans/cariler/' || party_id) order by balance desc) filter (where rn <= 20), '[]') into n, it
  from (select b.*, row_number() over (order by b.balance desc) rn from fin_party_balances b join fin_parties p on p.id = b.party_id
        where p.company_id = co and p.kind = 'supplier' and p.is_active and b.balance > 100 and p.slip_of is null) q;
  res := res || jsonb_build_object('key', 'supplier_advance', 'title', 'Faturası gelmemiş tedarikçi ödemesi (tedarikçi borçlu görünüyor)', 'area', 'Belge', 'severity', 'warning', 'count', n, 'items', it, 'link', '/finans/cariler');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(i.party_name, '—') || ' · ' || to_char(i.invoice_date, 'DD.MM'), 'amount', round(i.total * i.rate), 'link', '/fatura/' || i.id)) filter (where true), '[]') into n, it
  from inv_invoices i where i.company_id = co and i.status = 'posted' and i.direction = 'purchase' and i.doc_no is null and i.invoice_date between f and t;
  res := res || jsonb_build_object('key', 'purchase_no_docno', 'title', 'Belge numarası girilmemiş alış faturası', 'area', 'Belge', 'severity', 'warning', 'count', n, 'items', it, 'link', '/alis');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', p.name || ' · ' || to_char(a.invoice_date, 'DD.MM') || ' · iki fatura', 'amount', round(a.total * a.rate), 'link', '/fatura/' || a.id)) filter (where true), '[]') into n, it
  from inv_invoices a join inv_invoices b on b.company_id = a.company_id and b.party_id = a.party_id and b.direction = a.direction and b.invoice_date = a.invoice_date and b.total = a.total and b.id > a.id and b.status = 'posted'
  join fin_parties p on p.id = a.party_id
  where a.company_id = co and a.status = 'posted' and a.direction = 'purchase' and a.invoice_date between f and t;
  res := res || jsonb_build_object('key', 'possible_duplicate', 'title', 'Olası mükerrer alış faturası (aynı gün, aynı tedarikçi, aynı tutar)', 'area', 'Belge', 'severity', 'warning', 'count', n, 'items', it, 'link', '/alis');

  -- 3) KDV
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(i.doc_no, 'taslak no') || ' · ' || coalesce(i.party_name, ''), 'amount', round(i.subtotal * i.rate), 'link', '/fatura/' || i.id)) filter (where true), '[]') into n, it
  from inv_invoices i where i.company_id = co and i.status = 'posted' and i.direction = 'sale' and i.type = 'invoice' and i.export_doc_no is null and i.invoice_date between f and t
    and (i.profile = 'IHRACAT' or exists (select 1 from inv_lines l where l.invoice_id = i.id and l.vat_exemption_code in ('301', '302')));
  res := res || jsonb_build_object('key', 'export_no_doc', 'title', 'Gümrük beyannamesi / ETGB numarası olmayan ihracat faturası', 'area', 'KDV', 'severity', 'warning', 'count', n, 'items', it, 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=iade');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(i.party_name, '') || ' · ' || coalesce(i.doc_no, ''), 'amount', round(i.subtotal * i.rate), 'link', '/fatura/' || i.id)) filter (where true), '[]') into n, it
  from inv_invoices i join fin_parties p on p.id = i.party_id
  where i.company_id = co and i.status = 'posted' and i.direction = 'purchase' and i.invoice_date between f and t and i.vat_total = 0 and i.withholding_total = 0
    and upper(coalesce(nullif(i.party_country, ''), p.country, 'TR')) not in ('TR', 'TURKIYE', 'TÜRKİYE', 'TURKEY');
  res := res || jsonb_build_object('key', 'foreign_no_kdv2', 'title', 'Yurt dışı alışta sorumlu KDV (KDV2) işaretlenmemiş olabilir', 'area', 'KDV', 'severity', 'warning', 'count', n, 'items', it, 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=kdv2');

  n := case when past and (ck->'vouchers'->('vat:' || p_month)) is null and (gl_code_balance('191', t) <> 0 or gl_code_balance('391', t) <> 0) then 1 else 0 end;
  res := res || jsonb_build_object('key', 'vat_not_closed', 'title', 'Ayın KDV mahsubu yapılmamış (191 / 391 açık)', 'area', 'KDV', 'severity', 'critical', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=kdv');

  -- 4) Bordro
  n := case when exists (select 1 from payroll_lines where company_id = co and period = p_month) and (ck->'vouchers'->('payroll:' || p_month)) is null then 1 else 0 end;
  res := res || jsonb_build_object('key', 'payroll_no_accrual', 'title', 'Bordro hesaplanmış ama tahakkuk fişi yok', 'area', 'Bordro', 'severity', 'critical', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=muhtasar');

  -- 5) Kasa / banka
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', name, 'amount', bal, 'link', '/finans/kasa')) filter (where true), '[]') into n, it
  from (select a.name, fin_account_balance_at(a.id, t) bal from fin_accounts a where a.company_id = co and a.kind = 'cash' and a.is_active) q where bal < 0;
  res := res || jsonb_build_object('key', 'negative_cash', 'title', 'Kasa bakiyesi eksi', 'area', 'Kasa / banka', 'severity', 'critical', 'count', n, 'items', it, 'link', '/finans/kasa');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', a.name, 'link', '/finans/kasa-sayim?tarih=' || t)) filter (where true), '[]') into n, it
  from fin_accounts a where a.company_id = co and a.kind = 'cash' and a.is_active and past
    and fin_account_balance_at(a.id, t) <> 0
    and not exists (select 1 from gl_cash_counts c where c.account_id = a.id and c.count_date between f and t + 5);
  res := res || jsonb_build_object('key', 'cash_count_missing', 'title', 'Ay sonu kasa sayımı yapılmamış', 'area', 'Kasa / banka', 'severity', 'warning', 'count', n, 'items', it, 'link', '/finans/kasa-sayim?tarih=' || t);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', a.name || ' · ' || to_char(l.txn_date, 'DD.MM') || ' · ' || left(coalesce(l.description, ''), 60), 'amount', l.amount, 'link', '/finans/banka-aktar')) filter (where rn <= 20), '[]') into n, it
  from (select l.*, row_number() over (order by l.txn_date) rn from fin_bank_lines l join fin_accounts a2 on a2.id = l.account_id where a2.company_id = co and l.status = 'new' and l.txn_date between f and t) l
  join fin_accounts a on a.id = l.account_id;
  res := res || jsonb_build_object('key', 'bank_unmatched', 'title', 'Banka ekstresinde işlenmemiş satır', 'area', 'Kasa / banka', 'severity', 'critical', 'count', n, 'items', it, 'link', '/finans/banka-aktar');

  n := case when past and (ck->'fx') = 'null'::jsonb and (exists (select 1 from fin_accounts where company_id = co and currency <> 'TRY' and is_active and kind in ('bank', 'cash'))
                                                          or exists (select 1 from fin_parties where company_id = co and currency <> 'TRY' and is_active)) then 1 else 0 end;
  res := res || jsonb_build_object('key', 'fx_not_done', 'title', 'Döviz hesapları için ay sonu kur değerlemesi yapılmamış', 'area', 'Kasa / banka', 'severity', 'warning', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/donem');

  -- 6) Çek / senet
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', p.name || ' · vade ' || to_char(c.due_date, 'DD.MM.YYYY'), 'amount', c.amount, 'link', '/finans/cek-senet/' || c.id)) filter (where true), '[]') into n, it
  from fin_cheques c join fin_parties p on p.id = c.party_id
  where c.company_id = co and c.due_date < least(t, current_date) and ((c.direction = 'in' and c.status = 'portfolio') or (c.direction = 'out' and c.status = 'issued'));
  res := res || jsonb_build_object('key', 'overdue_cheques', 'title', 'Vadesi geçmiş, durumu güncellenmemiş çek / senet', 'area', 'Çek-senet', 'severity', 'warning', 'count', n, 'items', it, 'link', '/finans/cek-senet');

  -- 7) Cari
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', a.code || ' ' || a.name, 'amount', gl_code_balance(a.code, t))) filter (where true), '[]') into n, it
  from gl_accounts a where a.company_id = co and (a.code = '331' or a.code like '331.%') and not exists (select 1 from gl_accounts c where c.parent_id = a.id) and gl_code_balance(a.code, t) > 0;
  res := res || jsonb_build_object('key', 'partner_debit', 'title', 'Ortak hesabı (331) borç bakiyesi veriyor — yıl sonunda 131''e aktarılmalı', 'area', 'Cari', 'severity', case when extract(month from f) = 12 and (ck->'vouchers'->('p131:' || extract(year from f))) is null then 'critical' else 'info' end, 'count', n, 'items', it, 'link', '/muhasebe/donem-sonu?ay=' || extract(year from f) || '-12');

  select jsonb_array_length(gl_doubtful_candidates(t)) into n;
  res := res || jsonb_build_object('key', 'doubtful_candidates', 'title', '6 aydır tahsilat yapılmayan borçlu müşteri (şüpheli alacak adayı)', 'area', 'Cari', 'severity', 'info', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/supheli-alacak');

  -- 8) Dönem sonu
  n := coalesce((ck->'depreciation'->>'eligible')::int, 0);
  res := res || jsonb_build_object('key', 'depreciation', 'title', 'Bu ay amortismanı ayrılmamış demirbaş', 'area', 'Dönem sonu', 'severity', 'critical', 'count', case when past then n else 0 end, 'items', '[]'::jsonb, 'link', '/muhasebe/donem-sonu?ay=' || p_month);
  n := case when past and coalesce((ck->>'deferrals')::int, 0) > 0 and (ck->'vouchers'->('pdefer:' || p_month)) is null then 1 else 0 end;
  res := res || jsonb_build_object('key', 'deferrals', 'title', 'Dönemsellik payı ayrılmamış', 'area', 'Dönem sonu', 'severity', 'warning', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/donem-sonu?ay=' || p_month);
  n := case when past and jsonb_array_length(coalesce(gl_loan_accrual_calc(p_month), '[]')) > 0 and (ck->'vouchers'->('accint:' || p_month)) is null then 1 else 0 end;
  res := res || jsonb_build_object('key', 'loan_accrual', 'title', 'Kredi faiz tahakkuku yapılmamış', 'area', 'Dönem sonu', 'severity', 'warning', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/donem-sonu?ay=' || p_month);
  n := case when past and (ck->'vouchers'->('reflect:' || p_month)) is null and exists (select 1 from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
                                                                                       where v.company_id = co and v.status = 'posted' and v.voucher_date between f and t and a.code ~ '^7[1-8]0') then 1 else 0 end;
  res := res || jsonb_build_object('key', 'reflect', 'title', 'Gider yansıtması yapılmamış (7/A)', 'area', 'Dönem sonu', 'severity', 'warning', 'count', n, 'items', '[]'::jsonb, 'link', '/muhasebe/donem-sonu?ay=' || p_month);

  -- 9) Rapor
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', code || ' ' || name, 'amount', bal)) filter (where true), '[]') into n, it from (
    select a.code, a.name, gl_code_balance(a.code, t) bal, a.code ~ '^(100|101|102|108|120|121|136|150|153|180|190|191|193|25[0-6])$' dside
    from gl_accounts a where a.company_id = co and a.code ~ '^(100|101|102|108|120|121|136|150|153|180|190|191|193|25[0-6]|320|321|335|360|361|391|370|472)$'
  ) q where (dside and bal < 0) or (not dside and bal > 0);
  res := res || jsonb_build_object('key', 'reverse_balance', 'title', 'Ters bakiye veren hesap (ör. alacaklı kasa, borçlu 360)', 'area', 'Rapor', 'severity', 'warning', 'count', n, 'items', it, 'link', '/muhasebe/mizan?bas=' || f || '&bit=' || t);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', code || ' · bu ay ' || to_char(cur / 100.0, 'FM999G999G990D00') || ' / önceki 3 ay ort. ' || to_char(avg3 / 100.0, 'FM999G999G990D00'), 'amount', cur)) filter (where true), '[]') into n, it from (
    select left(a.code, 3) code,
           sum(l.debit - l.credit) filter (where v.voucher_date between f and t) cur,
           sum(l.debit - l.credit) filter (where v.voucher_date between (f - interval '3 months')::date and f - 1) / 3.0 avg3
    from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
    where v.company_id = co and v.status = 'posted' and v.source not in ('closing', 'period') and v.voucher_date between (f - interval '3 months')::date and t and a.code ~ '^(6[2-9]|7[1-8]0)'
    group by 1
  ) q where avg3 > 0 and abs(cur - avg3) > 1000000 and abs(cur - avg3) > avg3 * 0.5;
  res := res || jsonb_build_object('key', 'expense_spike', 'title', 'Önceki 3 ayın ortalamasından %50''den fazla sapan gider kalemi', 'area', 'Rapor', 'severity', 'info', 'count', n, 'items', it, 'link', '/muhasebe/gelir-tablosu?bas=' || f || '&bit=' || t);

  -- 10) Beyanname: son güne 3 gün kalan / geçen, verilmemiş
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', (x->>'kind') || ' · ' || (x->>'period') || ' · son gün ' || to_char((x->>'due')::date, 'DD.MM.YYYY'), 'link', '/muhasebe/vergi-takvimi')) filter (where true), '[]') into n, it
  from jsonb_array_elements(coalesce(gl_tax_calendar(current_date, current_date + 3), '[]')) x
  where (x->>'status') not in ('filed', 'paid', 'none');
  res := res || jsonb_build_object('key', 'filings_due', 'title', 'Son günü 3 gün içinde olan / geçmiş, verilmemiş beyanname', 'area', 'Beyanname', 'severity', 'critical', 'count', n, 'items', it, 'link', '/muhasebe/vergi-takvimi');

  -- onaylar ("bilerek geçildi")
  return (select coalesce(jsonb_agg(e.x || jsonb_build_object('acked', a.check_key is not null, 'note', a.note, 'acked_at', a.acked_at)
            order by case e.x->>'severity' when 'critical' then 0 when 'warning' then 1 else 2 end, (e.x->>'count')::int = 0), '[]')
          from jsonb_array_elements(res) e(x)
          left join gl_check_acks a on a.company_id = co and a.check_key = e.x->>'key' and a.period = p_month);
end $$;
revoke execute on function gl_checks(text) from public, anon;
grant execute on function gl_checks(text) to authenticated;

-- Dönem kilidi: kilitlenecek aylarda açık (onaylanmamış) kritik kontrol olmamalı
create or replace function gl_set_lock(p_date date) returns void
language plpgsql security definer set search_path = public as $$
declare m date; bad text;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if p_date is not null and exists (select 1 from gl_vouchers where company_id = lab_company() and status in ('pending', 'draft') and voucher_date <= p_date) then
    raise exception 'gl_pending_before_lock';
  end if;
  if p_date is not null then
    for m in select generate_series(greatest(date_trunc('month', coalesce((select lock_date from gl_settings where company_id = lab_company()) + 1, p_date)), date_trunc('month', p_date) - interval '11 months'), date_trunc('month', p_date), interval '1 month')::date loop
      select string_agg(x->>'title', '; ') into bad from jsonb_array_elements(gl_checks(to_char(m, 'YYYY-MM'))) x
      where x->>'severity' = 'critical' and (x->>'count')::int > 0 and not (x->>'acked')::boolean and x->>'key' not in ('filings_due');
      if bad is not null then raise exception 'gl_checks_open:%', to_char(m, 'YYYY-MM') || ' · ' || bad; end if;
    end loop;
  end if;
  update gl_settings set lock_date = p_date, updated_by = auth.uid(), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function gl_set_lock(date) from public, anon;
grant execute on function gl_set_lock(date) to authenticated;

notify pgrst, 'reload schema';
