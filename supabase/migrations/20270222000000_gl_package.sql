-- =====================================================================
-- Muhasebe K4: mali müşavir paketi, nakit akış tablosu, karşılaştırmalı raporlar
--  gl_package_settings / gl_package_sends : paket alıcıları, gönderen e-posta hesabı, gönderim / indirme kaydı
--  gl_cash_flow(bas, bit)                 : hazır değerler (10x) hareketlerinden doğrudan yöntemle nakit akışı
--  Kokpit 6. aşamaya "mali müşavir paketi" maddesi eklenir.
-- Tekrar çalıştırılabilir. Önce 20270221000000_gl_cockpit.sql.
-- =====================================================================

create table if not exists gl_package_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  to_emails text check (to_emails is null or length(to_emails) <= 500),
  cc_emails text check (cc_emails is null or length(cc_emails) <= 500),
  mail_account_id uuid,
  message text check (message is null or length(message) <= 1000),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table gl_package_settings enable row level security;
drop policy if exists gl_package_settings_read on gl_package_settings;
create policy gl_package_settings_read on gl_package_settings for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_package_settings from anon;
grant select on gl_package_settings to authenticated;

create table if not exists gl_package_sends (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  kind text not null check (kind in ('email', 'download')),
  to_emails text,
  files jsonb not null default '[]'::jsonb,
  size bigint,
  error text check (error is null or length(error) <= 500),
  sent_by uuid default auth.uid(),
  sent_at timestamptz not null default now()
);
create index if not exists gl_package_sends_idx on gl_package_sends (company_id, period, sent_at desc);
alter table gl_package_sends enable row level security;
drop policy if exists gl_package_sends_read on gl_package_sends;
create policy gl_package_sends_read on gl_package_sends for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_package_sends from anon;
grant select on gl_package_sends to authenticated;

create or replace function gl_package_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  insert into gl_package_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update gl_package_settings set
    to_emails = nullif(left(trim(p->>'to_emails'), 500), ''),
    cc_emails = nullif(left(trim(p->>'cc_emails'), 500), ''),
    mail_account_id = nullif(p->>'mail_account_id', '')::uuid,
    message = nullif(left(trim(p->>'message'), 1000), ''),
    updated_by = auth.uid(), updated_at = now()
  where company_id = lab_company();
end $$;
revoke execute on function gl_package_settings_save(jsonb) from public, anon;
grant execute on function gl_package_settings_save(jsonb) to authenticated;

create or replace function gl_package_log(p_period text, p_kind text, p_to text, p_files jsonb, p_size bigint, p_error text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', case when p_kind = 'email' then 3 else 1 end) then raise exception 'not_allowed'; end if;
  insert into gl_package_sends (company_id, period, kind, to_emails, files, size, error)
  values (lab_company(), p_period, p_kind, left(p_to, 500), coalesce(p_files, '[]'), p_size, left(p_error, 500));
end $$;
revoke execute on function gl_package_log(text, text, text, jsonb, bigint, text) from public, anon;
grant execute on function gl_package_log(text, text, text, jsonb, bigint, text) to authenticated;

-- Nakit akış tablosu (doğrudan yöntem): kasa / banka / çek (10x) satırı olan fişlerde karşı hesaplar nakit giriş / çıkışıdır.
-- Dengeli fişte karşı satırların (alacak - borç) toplamı nakit değişimine eşittir; hazır değerler arası virman tabloya girmez.
create or replace function gl_cash_flow(p_from date, p_to date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare co uuid := lab_company(); rows_ jsonb; opening bigint; closing bigint;
begin
  if not gl_can() then return null; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_period'; end if;
  select coalesce(sum(l.debit - l.credit), 0) into opening from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
   where v.company_id = co and v.status = 'posted' and a.code like '10%' and (v.voucher_date < p_from or (v.voucher_date = p_from and v.source = 'opening'))
     and v.source <> 'closing';
  select coalesce(sum(l.debit - l.credit), 0) into closing from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
   where v.company_id = co and v.status = 'posted' and a.code like '10%' and v.voucher_date <= p_to and v.source <> 'closing';
  with cv as (
    select distinct v.id from gl_vouchers v join gl_lines l on l.voucher_id = v.id join gl_accounts a on a.id = l.account_id
    where v.company_id = co and v.status = 'posted' and v.voucher_date between p_from and p_to and v.source not in ('opening', 'closing') and a.code like '10%'
  ), cp as (
    select left(a.code, 3) c3, sum(l.credit - l.debit) amt
    from cv join gl_lines l on l.voucher_id = cv.id join gl_accounts a on a.id = l.account_id
    where a.code not like '10%'
    group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object('code', c3, 'name', coalesce((select name from gl_accounts where company_id = co and code = c3), c3), 'amount', amt,
           'section', case
             when c3 ~ '^(2[0-9][0-9]|11[0-9])$' then 'investing'
             when c3 ~ '^(30[0-9]|40[0-9]|5[0-9][0-9]|131|231|331|431|780|781|642)$' then case when c3 in ('780', '781', '642') then 'operating' else 'financing' end
             else 'operating' end) order by c3) filter (where amt <> 0), '[]') into rows_
  from cp;
  return jsonb_build_object('from', p_from, 'to', p_to, 'opening', opening, 'closing', closing, 'rows', rows_,
    'operating', (select coalesce(sum((r->>'amount')::bigint), 0) from jsonb_array_elements(rows_) r where r->>'section' = 'operating'),
    'investing', (select coalesce(sum((r->>'amount')::bigint), 0) from jsonb_array_elements(rows_) r where r->>'section' = 'investing'),
    'financing', (select coalesce(sum((r->>'amount')::bigint), 0) from jsonb_array_elements(rows_) r where r->>'section' = 'financing'));
end $$;
revoke execute on function gl_cash_flow(date, date) from public, anon;
grant execute on function gl_cash_flow(date, date) to authenticated;

-- Kokpit: 6. aşamaya mali müşavir paketi maddesi
do $$
declare src text; anchor text := 'jsonb_build_object(''key'', ''lock'', ''label''';
begin
  select pg_get_functiondef('gl_cockpit(text)'::regprocedure) into src;
  if position('''key'', ''package''' in src) > 0 then return; end if;
  if position(anchor in src) = 0 then raise exception 'gl_package: kokpit maddesi bulunamadı'; end if;
  src := replace(src, anchor,
    'jsonb_build_object(''key'', ''package'', ''label'', ''Mali müşavir paketi (mizan, yevmiye, bilanço, gelir tablosu, nakit akış, KDV, Luca dosyaları)'', ''count'', case when exists (select 1 from gl_package_sends ps where ps.company_id = co and ps.period = p_month and ps.error is null) then 0 else 1 end, ''ok'', exists (select 1 from gl_package_sends ps where ps.company_id = co and ps.period = p_month and ps.error is null), ''severity'', ''warning'', ''link'', ''/muhasebe/paket?ay='' || p_month),
      ' || anchor);
  execute src;
end $$;

notify pgrst, 'reload schema';
