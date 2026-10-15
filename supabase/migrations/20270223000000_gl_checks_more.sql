-- =====================================================================
-- Kontrol motoru ek kontroller (planlanan 32 kontrolün kalanları)
--  duplicate_docno      : aynı tedarikçiden aynı numaralı fatura (kritik)
--  vat_rate_unusual     : faturadaki KDV oranı stok kartındaki orandan farklı
--  vat_gl_diff          : faturalardaki KDV ile 191 / 391 hareketleri farklı (mahsuptan önce)
--  sgk_tax_left         : önceki aylardan ödenmemiş 360 / 361 bakiyesi
--  payroll_missing_staff: bordrosu hesaplanmış ayda bordrosu olmayan çalışan
--  bank_balance_diff    : ekstre bakiyesi ile ERP banka bakiyesi farklı (kritik)
--  customer_credit      : alacak bakiyeli (fazla ödeme yapmış) müşteri
--  no_reconciliation    : yıl içinde mutabakat yapılmamış büyük cariler (bilgi)
-- Ayrıca kokpit aşama onayı (kim, ne zaman): gl_stage_signoffs, gl_stage_sign, gl_stage_signoffs_list.
-- gl_checks'e eklenir; kokpitte "Kontroller" aşamasında görünür. Tekrar çalıştırılabilir. Önce 20270222000000_gl_package.sql.
-- =====================================================================

do $$
declare src text; anchor text := '  -- onaylar ("bilerek geçildi")'; add text;
begin
  select pg_get_functiondef('gl_checks(text)'::regprocedure) into src;
  if position('''key'', ''duplicate_docno''' in src) > 0 then return; end if;
  if position(anchor in src) = 0 then raise exception 'gl_checks_more: bağlantı satırı bulunamadı'; end if;
  add := $add$
  -- 11) Ek kontroller
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', p.name || ' · ' || d.dn || ' · ' || d.c || ' fatura', 'link', '/fatura/' || d.last_id)) filter (where d.rn <= 20), '[]') into n, it
  from (select party_id, upper(regexp_replace(doc_no, '\s', '', 'g')) dn, count(*) c, (array_agg(id order by invoice_date desc))[1] last_id, row_number() over (order by max(invoice_date) desc) rn
        from inv_invoices where company_id = co and direction = 'purchase' and status = 'posted' and doc_no is not null
        group by 1, 2 having count(*) > 1 and max(invoice_date) between f and t) d
  join fin_parties p on p.id = d.party_id;
  res := res || jsonb_build_object('key', 'duplicate_docno', 'title', 'Aynı tedarikçiden aynı numaralı alış faturası (mükerrer kayıt)', 'area', 'Belge', 'severity', 'critical', 'count', n, 'items', it, 'link', '/alis');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', q.lbl, 'link', '/fatura/' || q.iid)) filter (where q.rn <= 20), '[]') into n, it
  from (select coalesce(i.doc_no, 'taslak') || ' · ' || left(l.name, 50) || ' · %' || l.vat_rate::int || ' (kartta %' || s.vat_rate || ')' lbl, i.id iid,
               row_number() over (order by i.invoice_date, i.id) rn
        from inv_lines l join inv_invoices i on i.id = l.invoice_id join stk_items s on s.id = l.item_id
        where i.company_id = co and i.status = 'posted' and i.invoice_date between f and t and l.vat_rate::int <> s.vat_rate and coalesce(l.vat_exemption_code, '') = '') q;
  res := res || jsonb_build_object('key', 'vat_rate_unusual', 'title', 'Faturadaki KDV oranı stok kartındaki orandan farklı', 'area', 'KDV', 'severity', 'warning', 'count', n, 'items', it, 'link', '/alis');

  if (ck->'vouchers'->('vat:' || p_month)) is null then
    declare vr jsonb; s391 bigint; s191 bigint; g391 bigint; g191 bigint;
    begin
      vr := gl_vat_report(f, t);
      select coalesce(sum(case when l->>'type' = 'return' then -1 else 1 end * ((l->>'vat')::bigint - (l->>'withholding')::bigint)) filter (where l->>'direction' = 'sale'), 0),
             coalesce(sum(case when l->>'type' = 'return' then -1 else 1 end * (l->>'vat')::bigint) filter (where l->>'direction' = 'purchase'), 0)
        into s391, s191 from jsonb_array_elements(coalesce(vr->'lines', '[]')) l;
      g391 := coalesce((vr->'gl'->>'v391')::bigint, 0); g191 := coalesce((vr->'gl'->>'v191')::bigint, 0);
      it := '[]'::jsonb;
      if abs(g391 - s391) > 100 then it := it || jsonb_build_object('label', '391 muhasebede ' || translate(to_char(g391 / 100.0, 'FM999,999,999,990.00'), ',.', '.,') || ', faturalarda ' || translate(to_char(s391 / 100.0, 'FM999,999,999,990.00'), ',.', '.,'), 'amount', g391 - s391); end if;
      if abs(g191 - s191) > 100 then it := it || jsonb_build_object('label', '191 muhasebede ' || translate(to_char(g191 / 100.0, 'FM999,999,999,990.00'), ',.', '.,') || ', faturalarda ' || translate(to_char(s191 / 100.0, 'FM999,999,999,990.00'), ',.', '.,') || ' (masraf KDV''si olabilir)', 'amount', g191 - s191); end if;
      n := jsonb_array_length(it);
    end;
  else n := 0; it := '[]'::jsonb; end if;
  res := res || jsonb_build_object('key', 'vat_gl_diff', 'title', 'Faturalardaki KDV ile 191 / 391 hesapları farklı', 'area', 'KDV', 'severity', 'warning', 'count', n, 'items', it, 'link', '/muhasebe/beyanname?ay=' || p_month || '&sekme=kdv');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', q.code || ' önceki aylardan ödenmemiş', 'amount', q.left_amt, 'link', '/muhasebe/kebir?hesap=' || q.code || '&bit=' || t)) filter (where true), '[]') into n, it
  from (select c.code, -gl_code_balance(c.code, t) - coalesce((select sum(l.credit) from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
                                                               where v.company_id = co and v.status = 'posted' and v.voucher_date between f and t and (a.code = c.code or a.code like c.code || '.%')), 0) left_amt
        from (values ('360'), ('361')) c(code)) q
  where past and q.left_amt > 10000;
  res := res || jsonb_build_object('key', 'sgk_tax_left', 'title', 'Önceki aylardan ödenmemiş vergi / SGK (360 / 361 bakiyesi)', 'area', 'Bordro', 'severity', 'warning', 'count', n, 'items', it, 'link', '/muhasebe/mizan?bit=' || t);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', e.first_name || ' ' || e.last_name || case when e.hire_date between f and t then ' · bu ay girdi' when e.termination_date between f and t then ' · bu ay çıktı' else '' end, 'link', '/personel/' || e.id)) filter (where true), '[]') into n, it
  from employees e
  where e.company_id = co and e.hire_date <= t and (e.termination_date is null or e.termination_date >= f)
    and exists (select 1 from payroll_lines pl where pl.company_id = co and pl.period = p_month)
    and not exists (select 1 from payroll_lines pl where pl.employee_id = e.id and pl.period = p_month);
  res := res || jsonb_build_object('key', 'payroll_missing_staff', 'title', 'Bu ay çalışıp bordrosu olmayan personel', 'area', 'Bordro', 'severity', 'warning', 'count', n, 'items', it, 'link', '/donemler/' || p_month);

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', q.name || ' · ekstre ' || to_char(q.d, 'DD.MM') || ': ' || translate(to_char(q.stmt / 100.0, 'FM999,999,999,990.00'), ',.', '.,') || ', ERP: ' || translate(to_char(q.erp / 100.0, 'FM999,999,999,990.00'), ',.', '.,'), 'amount', q.erp - q.stmt, 'link', '/finans/banka-aktar')) filter (where true), '[]') into n, it
  from (select a.id, a.name, ld.d, fin_account_balance_at(a.id, ld.d) erp,
               (select l.balance from fin_bank_lines l where l.account_id = a.id and l.txn_date = ld.d and l.balance is not null
                order by abs(l.balance - fin_account_balance_at(a.id, ld.d)) limit 1) stmt
        from fin_accounts a
        cross join lateral (select max(l.txn_date) d from fin_bank_lines l where l.account_id = a.id and l.balance is not null and l.txn_date <= t) ld
        where a.company_id = co and a.kind = 'bank' and a.is_active and ld.d is not null
          and not exists (select 1 from fin_bank_lines l2 where l2.account_id = a.id and l2.status = 'new' and l2.txn_date <= ld.d)) q
  where abs(q.erp - q.stmt) > 100;
  res := res || jsonb_build_object('key', 'bank_balance_diff', 'title', 'Banka ekstresi bakiyesi ile ERP banka bakiyesi farklı', 'area', 'Kasa / banka', 'severity', 'critical', 'count', n, 'items', it, 'link', '/finans/banka-aktar');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', pname, 'amount', balance, 'link', '/finans/cariler/' || party_id) order by balance) filter (where rn <= 20), '[]') into n, it
  from (select b.party_id, b.balance, p.name pname, row_number() over (order by b.balance) rn from fin_party_balances b join fin_parties p on p.id = b.party_id
        where p.company_id = co and p.kind = 'customer' and p.is_active and b.balance < -100 and p.slip_of is null) q;
  res := res || jsonb_build_object('key', 'customer_credit', 'title', 'Alacak bakiyeli müşteri (fazla ödeme ya da faturası kesilmemiş tahsilat)', 'area', 'Cari', 'severity', 'warning', 'count', n, 'items', it, 'link', '/finans/cariler');

  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', pname, 'amount', balance, 'link', '/finans/cariler/' || party_id) order by abs(balance) desc) filter (where rn <= 20), '[]') into n, it
  from (select b.party_id, b.balance, p.name pname, row_number() over (order by abs(b.balance) desc) rn from fin_party_balances b join fin_parties p on p.id = b.party_id
        where p.company_id = co and p.is_active and abs(b.balance) >= 5000000 and p.slip_of is null
          and not exists (select 1 from fin_reconciliations r where r.party_id = p.id and r.as_of >= make_date(extract(year from t)::int, 1, 1))) q;
  res := res || jsonb_build_object('key', 'no_reconciliation', 'title', 'Bu yıl mutabakat yapılmamış büyük cari (50.000 TL üstü bakiye)', 'area', 'Cari', 'severity', 'info', 'count', n, 'items', it, 'link', '/finans/mutabakat');

$add$;
  execute replace(src, anchor, add || anchor);
end $$;

-- Kokpit aşama onayı: aşama tamamlanınca yönetici / müşavir "kontrol ettim" der (kim, ne zaman, not)
create table if not exists gl_stage_signoffs (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  stage text not null check (stage in ('kayit', 'onay', 'donem', 'kontrol', 'beyan', 'kapanis')),
  note text check (note is null or length(note) <= 300),
  signed_by uuid default auth.uid(),
  signed_at timestamptz not null default now(),
  primary key (company_id, period, stage)
);
alter table gl_stage_signoffs enable row level security;
drop policy if exists gl_stage_signoffs_read on gl_stage_signoffs;
create policy gl_stage_signoffs_read on gl_stage_signoffs for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_stage_signoffs from anon;
grant select on gl_stage_signoffs to authenticated;

create or replace function gl_stage_sign(p_period text, p_stage text, p_note text default null, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare st text;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if not coalesce(p_on, true) then
    delete from gl_stage_signoffs where company_id = lab_company() and period = p_period and stage = p_stage;
    return;
  end if;
  select e->>'status' into st from jsonb_array_elements(gl_cockpit(p_period)->'stages') e where e->>'key' = p_stage;
  if st is distinct from 'done' then raise exception 'gl_stage_not_done'; end if;
  insert into gl_stage_signoffs (company_id, period, stage, note) values (lab_company(), p_period, p_stage, nullif(left(trim(p_note), 300), ''))
  on conflict (company_id, period, stage) do update set note = excluded.note, signed_by = auth.uid(), signed_at = now();
end $$;
revoke execute on function gl_stage_sign(text, text, text, boolean) from public, anon;
grant execute on function gl_stage_sign(text, text, text, boolean) to authenticated;

create or replace function gl_stage_signoffs_list(p_period text) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_object_agg(s.stage, jsonb_build_object('at', s.signed_at, 'note', s.note,
           'name', coalesce(m.display_name, (select email from auth.users u where u.id = s.signed_by), '—'))), '{}') end
  from gl_stage_signoffs s left join memberships m on m.user_id = s.signed_by and m.company_id = s.company_id
  where s.company_id = lab_company() and s.period = p_period;
$$;
revoke execute on function gl_stage_signoffs_list(text) from public, anon;
grant execute on function gl_stage_signoffs_list(text) to authenticated;

notify pgrst, 'reload schema';
