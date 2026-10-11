-- =====================================================================
-- GÜNLÜK İRSALİYE, AYLIK FATURA (İÇ HESAP) VE İKİ CARİ
--  lab_customers.internal_book : "iç hesap kullanır" — kutu çıkışında iş günlük irsaliyeye eklenir,
--                                tutarı iç cariye işlenir; resmi cariye yalnız resmi fatura (e-fatura /
--                                e-ihracat) ve resmi tahsilat işlenir
--  lab_waybills                : günlük irsaliye (müşteri + gün); çıkışta otomatik
--  lab_statements              : ay sonu fatura (iç): dönemin irsaliyelerini tek belgede toplar
--  lab_payments.book           : tahsilat hangi hesaba: official (resmi) / internal (iç) / both (ikisi)
-- Tekrar çalıştırılabilir. Önce 20261210000000_user_types.sql.
-- =====================================================================

-- 1) Müşteri kartı
alter table lab_customers add column if not exists internal_book boolean not null default false;
alter table lab_customers add column if not exists pay_book text not null default 'both';
alter table lab_customers add column if not exists doc_lang text not null default 'tr';
alter table lab_customers add column if not exists internal_opening bigint not null default 0;
alter table lab_customers add column if not exists internal_opening_date date;
do $$ begin
  alter table lab_customers add constraint lab_customers_pay_book_check check (pay_book in ('official', 'internal', 'both'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table lab_customers add constraint lab_customers_doc_lang_check check (doc_lang in ('tr', 'en', 'fr'));
exception when duplicate_object then null; end $$;

alter table lab_payments add column if not exists book text not null default 'official';
do $$ begin
  alter table lab_payments add constraint lab_payments_book_check check (book in ('official', 'internal', 'both'));
exception when duplicate_object then null; end $$;

-- 2) Belge numaraları (yıl başına)
create table if not exists lab_doc_seq (
  company_id uuid not null references companies (id) on delete cascade,
  kind text not null,
  year int not null,
  last int not null default 0,
  primary key (company_id, kind, year)
);
alter table lab_doc_seq enable row level security;
revoke all on lab_doc_seq from authenticated;

create or replace function lab_next_no(p_kind text, p_year int) returns int
language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into lab_doc_seq (company_id, kind, year, last) values (lab_company(), p_kind, p_year, 1)
  on conflict (company_id, kind, year) do update set last = lab_doc_seq.last + 1
  returning last into v;
  return v;
end $$;
revoke execute on function lab_next_no(text, int) from public, anon, authenticated;

-- 3) Ay sonu fatura (iç)
create table if not exists lab_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null,
  no int not null,
  customer_id uuid not null references lab_customers (id) on delete restrict,
  period_from date not null,
  period_to date not null,
  issue_date date not null default current_date,
  due_date date,
  currency text not null default 'TRY',
  job_count int not null default 0,
  unit_count numeric not null default 0,
  total bigint not null default 0,
  lang text not null default 'tr' check (lang in ('tr', 'en', 'fr')),
  note text check (note is null or length(note) <= 1000),
  status text not null default 'issued' check (status in ('issued', 'cancelled')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (company_id, year, no)
);
create index if not exists lab_statements_cust_idx on lab_statements (customer_id, period_to desc);

-- 4) Günlük irsaliye
create table if not exists lab_waybills (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  year int not null,
  no int not null,
  customer_id uuid not null references lab_customers (id) on delete restrict,
  ship_date date not null,
  status text not null default 'open' check (status in ('open', 'issued', 'cancelled')),
  currency text not null default 'TRY',
  job_count int not null default 0,
  unit_count numeric not null default 0,
  total bigint not null default 0,
  statement_id uuid references lab_statements (id) on delete set null,
  auto boolean not null default true,
  note text check (note is null or length(note) <= 500),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  unique (company_id, year, no)
);
create index if not exists lab_waybills_day_idx on lab_waybills (ship_date desc, customer_id);
create index if not exists lab_waybills_stmt_idx on lab_waybills (statement_id);
alter table jobs add column if not exists waybill_id uuid references lab_waybills (id) on delete set null;
create index if not exists jobs_waybill_idx on jobs (waybill_id);

alter table lab_waybills enable row level security;
alter table lab_statements enable row level security;
drop policy if exists lab_waybills_read on lab_waybills;
create policy lab_waybills_read on lab_waybills for select to authenticated using (can_logistics() or can_module('sales') or can_module('finance'));
drop policy if exists lab_statements_read on lab_statements;
create policy lab_statements_read on lab_statements for select to authenticated using (can_logistics() or can_module('sales') or can_module('finance'));
-- Portal: kendi irsaliye ve faturaları
drop policy if exists lab_waybills_portal on lab_waybills;
create policy lab_waybills_portal on lab_waybills for select to authenticated
  using (status <> 'cancelled' and exists (select 1 from lab_customers c where c.id = customer_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id)));
drop policy if exists lab_statements_portal on lab_statements;
create policy lab_statements_portal on lab_statements for select to authenticated
  using (status <> 'cancelled' and exists (select 1 from lab_customers c where c.id = customer_id and c.portal_account_id is not null and is_portal_member(c.portal_account_id)));
grant select on lab_waybills, lab_statements to authenticated;
revoke insert, update, delete on lab_waybills, lab_statements from authenticated;

-- İstanbul günü
create or replace function lab_day(p timestamptz) returns date language sql immutable as $$ select (p at time zone 'Europe/Istanbul')::date $$;

-- Toplamları yeniden hesapla
create or replace function lab_waybill_recalc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update lab_waybills w set
    job_count = coalesce(s.n, 0), total = coalesce(s.total, 0), unit_count = coalesce(s.units, 0)
  from (select count(*) n, sum(j.total) total,
               sum((select coalesce(sum(i.qty), 0) from job_items i where i.job_id = j.id and i.amount > 0)) units
        from jobs j where j.waybill_id = p_id) s
  where w.id = p_id;
end $$;
revoke execute on function lab_waybill_recalc(uuid) from public, anon, authenticated;

-- Bir işi gününün açık irsaliyesine ekle (yoksa açar)
create or replace function lab_waybill_put(p_job uuid, p_day date, p_auto boolean default true) returns uuid
language plpgsql security definer set search_path = public as $$
declare j jobs; v_id uuid; v_cur text;
begin
  select * into j from jobs where id = p_job;
  if j.id is null or j.customer_id is null then return null; end if;
  select coalesce(j.currency, c.currency) into v_cur from lab_customers c where c.id = j.customer_id;
  select id into v_id from lab_waybills
  where customer_id = j.customer_id and ship_date = p_day and status = 'open' and statement_id is null and currency = v_cur
  order by created_at limit 1;
  if v_id is null then
    insert into lab_waybills (company_id, year, no, customer_id, ship_date, currency, auto)
    values (coalesce(j.company_id, lab_company()), extract(year from p_day)::int, lab_next_no('waybill', extract(year from p_day)::int), j.customer_id, p_day, v_cur, p_auto)
    returning id into v_id;
  end if;
  update jobs set waybill_id = v_id where id = p_job;
  perform lab_waybill_recalc(v_id);
  return v_id;
end $$;
revoke execute on function lab_waybill_put(uuid, date, boolean) from public, anon, authenticated;

-- Çıkışta otomatik irsaliye; çıkış geri alınırsa irsaliyeden düşer (faturalanmadıysa)
create or replace function jobs_waybill_sync() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_flag boolean; v_old uuid := old.waybill_id;
begin
  if new.status = 'delivered' and old.status is distinct from 'delivered' and new.waybill_id is null then
    select internal_book into v_flag from lab_customers where id = new.customer_id;
    if coalesce(v_flag, false) then
      perform lab_waybill_put(new.id, lab_day(coalesce(new.delivered_at, now())));
    end if;
  elsif old.status = 'delivered' and new.status is distinct from 'delivered' and v_old is not null then
    if exists (select 1 from lab_waybills where id = v_old and statement_id is null) then
      update jobs set waybill_id = null where id = new.id;
      perform lab_waybill_recalc(v_old);
    end if;
  elsif new.waybill_id is not null and new.total is distinct from old.total then
    perform lab_waybill_recalc(new.waybill_id);
  end if;
  return null;
end $$;
drop trigger if exists jobs_waybill_sync on jobs;
create trigger jobs_waybill_sync after update of status, total on jobs for each row execute function jobs_waybill_sync();

-- 5) Resmi cari: iç hesap kullanan müşteride işler ve iç tahsilatlar resmi bakiyeye girmez
create or replace view fin_party_balances with (security_invoker = true) as
select p.id as party_id, p.name, p.kind, p.currency, p.lab_customer_id,
       p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null), 0)
       + case when coalesce(c.internal_book, false) then 0 else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered'), 0)
         - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null), 0) end
       as balance
from fin_parties p left join lab_customers c on c.id = p.lab_customer_id;
grant select on fin_party_balances to authenticated;

-- İç cari bakiyeleri
create or replace view lab_internal_balances with (security_invoker = true) as
select c.id as customer_id, c.name, c.currency, c.internal_opening as opening,
       coalesce((select sum(j.total) from jobs j where j.customer_id = c.id and j.status = 'delivered'), 0) as delivered,
       coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = c.id and lp.book in ('internal', 'both')), 0) as paid,
       c.internal_opening
       + coalesce((select sum(j.total) from jobs j where j.customer_id = c.id and j.status = 'delivered'), 0)
       - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = c.id and lp.book in ('internal', 'both')), 0) as balance
from lab_customers c where c.internal_book;
grant select on lab_internal_balances to authenticated;

-- 6) Kart ayarı
create or replace function lab_customer_set_book(p_customer uuid, p_on boolean, p_pay_book text, p_lang text, p_opening bigint, p_opening_date date) returns void
language plpgsql security definer set search_path = public as $$
declare c lab_customers;
begin
  if not (can_logistics() and (can_module('sales', 2) or can_module('finance', 2) or can_module('lab', 3))) then raise exception 'not_allowed'; end if;
  select * into c from lab_customers where id = p_customer for update;
  if c.id is null then raise exception 'not_found'; end if;
  -- açılınca: o güne kadarki tüm tahsilatlar iki hesapta da sayılır (eski tek cari = iç cari)
  if coalesce(p_on, false) and not c.internal_book then
    update lab_payments set book = 'both' where customer_id = p_customer and book = 'official';
  end if;
  update lab_customers set internal_book = coalesce(p_on, false),
    pay_book = case when p_pay_book in ('official', 'internal', 'both') then p_pay_book else pay_book end,
    doc_lang = case when p_lang in ('tr', 'en', 'fr') then p_lang else doc_lang end,
    internal_opening = coalesce(p_opening, internal_opening), internal_opening_date = coalesce(p_opening_date, internal_opening_date),
    updated_at = now()
  where id = p_customer;
end $$;
grant execute on function lab_customer_set_book(uuid, boolean, text, text, bigint, date) to authenticated;

-- 7) İrsaliye işlemleri
create or replace function lab_waybill_guard() returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_logistics() or can_module('sales', 2)) then raise exception 'not_allowed'; end if;
end $$;
grant execute on function lab_waybill_guard() to authenticated;

-- Elle irsaliye: teslim edilmiş, irsaliyesiz işlerden (her müşteri için)
create or replace function lab_waybill_create(p_customer uuid, p_date date, p_jobs uuid[]) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; j uuid; v_cur text;
begin
  perform lab_waybill_guard();
  if p_jobs is null or array_length(p_jobs, 1) is null then raise exception 'jobs_required'; end if;
  if exists (select 1 from jobs where id = any (p_jobs) and (customer_id is distinct from p_customer or waybill_id is not null or status <> 'delivered')) then raise exception 'jobs_invalid'; end if;
  select currency into v_cur from lab_customers where id = p_customer;
  insert into lab_waybills (year, no, customer_id, ship_date, currency, auto)
  values (extract(year from p_date)::int, lab_next_no('waybill', extract(year from p_date)::int), p_customer, p_date, v_cur, false)
  returning id into v_id;
  update jobs set waybill_id = v_id where id = any (p_jobs);
  perform lab_waybill_recalc(v_id);
  return v_id;
end $$;
grant execute on function lab_waybill_create(uuid, date, uuid[]) to authenticated;

-- Kesildi (yazdırıldı / gönderildi): o gün sonraki çıkışlar yeni irsaliyeye gider
create or replace function lab_waybill_issue(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform lab_waybill_guard();
  update lab_waybills set status = 'issued', issued_at = coalesce(issued_at, now()) where id = p_id and status = 'open';
end $$;
grant execute on function lab_waybill_issue(uuid) to authenticated;

create or replace function lab_waybill_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform lab_waybill_guard();
  if exists (select 1 from lab_waybills where id = p_id and statement_id is not null) then raise exception 'waybill_invoiced'; end if;
  update jobs set waybill_id = null where waybill_id = p_id;
  update lab_waybills set status = 'cancelled', job_count = 0, total = 0, unit_count = 0 where id = p_id;
end $$;
grant execute on function lab_waybill_cancel(uuid) to authenticated;

create or replace function lab_waybill_remove_job(p_job uuid) returns void language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  perform lab_waybill_guard();
  select waybill_id into v from jobs where id = p_job;
  if v is null then return; end if;
  if exists (select 1 from lab_waybills where id = v and statement_id is not null) then raise exception 'waybill_invoiced'; end if;
  update jobs set waybill_id = null where id = p_job;
  perform lab_waybill_recalc(v);
end $$;
grant execute on function lab_waybill_remove_job(uuid) to authenticated;

-- Dönemin irsaliyesiz teslim edilmiş işlerini günlük irsaliyelere yerleştir
create or replace function lab_waybills_backfill(p_customer uuid, p_from date, p_to date) returns int
language plpgsql security definer set search_path = public as $$
declare j record; n int := 0;
begin
  perform lab_waybill_guard();
  for j in select id, lab_day(coalesce(delivered_at, in_date::timestamptz)) d from jobs
           where customer_id = p_customer and status = 'delivered' and waybill_id is null
             and lab_day(coalesce(delivered_at, in_date::timestamptz)) between p_from and p_to
           order by delivered_at nulls first, no loop
    perform lab_waybill_put(j.id, j.d);
    n := n + 1;
  end loop;
  return n;
end $$;
grant execute on function lab_waybills_backfill(uuid, date, date) to authenticated;

-- 8) Ay sonu fatura (iç)
create or replace function lab_statement_create(p_customer uuid, p_from date, p_to date, p_issue date default null, p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare c lab_customers; v_id uuid; v_issue date := coalesce(p_issue, p_to); v_cur text;
begin
  perform lab_waybill_guard();
  select * into c from lab_customers where id = p_customer;
  if c.id is null then raise exception 'not_found'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'bad_period'; end if;
  perform lab_waybills_backfill(p_customer, p_from, p_to);
  if not exists (select 1 from lab_waybills where customer_id = p_customer and status <> 'cancelled' and statement_id is null and job_count > 0 and ship_date between p_from and p_to) then
    raise exception 'nothing_to_invoice';
  end if;
  select currency into v_cur from lab_waybills where customer_id = p_customer and status <> 'cancelled' and statement_id is null and job_count > 0 and ship_date between p_from and p_to
  group by currency order by count(*) desc limit 1;
  insert into lab_statements (year, no, customer_id, period_from, period_to, issue_date, due_date, currency, lang, note)
  values (extract(year from v_issue)::int, lab_next_no('statement', extract(year from v_issue)::int), p_customer, p_from, p_to, v_issue, v_issue + 30, v_cur, c.doc_lang, nullif(trim(p_note), ''))
  returning id into v_id;
  update lab_waybills set statement_id = v_id, status = 'issued', issued_at = coalesce(issued_at, now())
  where customer_id = p_customer and status <> 'cancelled' and statement_id is null and job_count > 0 and ship_date between p_from and p_to and currency = v_cur;
  update lab_statements s set job_count = x.n, total = x.t, unit_count = x.u
  from (select sum(job_count) n, sum(total) t, sum(unit_count) u from lab_waybills where statement_id = v_id) x where s.id = v_id;
  return v_id;
end $$;
grant execute on function lab_statement_create(uuid, date, date, date, text) to authenticated;

create or replace function lab_statement_cancel(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform lab_waybill_guard();
  update lab_waybills set statement_id = null where statement_id = p_id;
  update lab_statements set status = 'cancelled', cancelled_at = now() where id = p_id and status = 'issued';
end $$;
grant execute on function lab_statement_cancel(uuid) to authenticated;

-- Aylık faturalama ekranı: dönemde irsaliyesi / teslimi olan müşteriler
create or replace function lab_billing_overview(p_from date, p_to date) returns table (
  customer_id uuid, name text, currency text, internal_book boolean, doc_lang text,
  waybills int, open_jobs int, open_total bigint, loose_jobs int, loose_total bigint, statements int, statement_total bigint, last_statement uuid
) language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.currency, c.internal_book, c.doc_lang,
    (select count(*)::int from lab_waybills w where w.customer_id = c.id and w.status <> 'cancelled' and w.ship_date between p_from and p_to),
    coalesce((select sum(w.job_count)::int from lab_waybills w where w.customer_id = c.id and w.status <> 'cancelled' and w.statement_id is null and w.ship_date between p_from and p_to), 0),
    coalesce((select sum(w.total)::bigint from lab_waybills w where w.customer_id = c.id and w.status <> 'cancelled' and w.statement_id is null and w.ship_date between p_from and p_to), 0),
    (select count(*)::int from jobs j where j.customer_id = c.id and j.status = 'delivered' and j.waybill_id is null and lab_day(coalesce(j.delivered_at, j.in_date::timestamptz)) between p_from and p_to),
    coalesce((select sum(j.total)::bigint from jobs j where j.customer_id = c.id and j.status = 'delivered' and j.waybill_id is null and lab_day(coalesce(j.delivered_at, j.in_date::timestamptz)) between p_from and p_to), 0),
    (select count(*)::int from lab_statements s where s.customer_id = c.id and s.status = 'issued' and s.period_to >= p_from and s.period_from <= p_to),
    coalesce((select sum(s.total)::bigint from lab_statements s where s.customer_id = c.id and s.status = 'issued' and s.period_to >= p_from and s.period_from <= p_to), 0),
    (select s.id from lab_statements s where s.customer_id = c.id and s.status = 'issued' and s.period_to >= p_from and s.period_from <= p_to order by s.created_at desc limit 1)
  from lab_customers c
  where (can_logistics() or can_module('sales') or can_module('finance'))
    and (c.internal_book
      or exists (select 1 from lab_waybills w where w.customer_id = c.id and w.status <> 'cancelled' and w.ship_date between p_from and p_to))
  order by c.name;
$$;
grant execute on function lab_billing_overview(date, date) to authenticated;

-- 9) Tahsilat: resmi / iç / ikisi
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select lab_company(), 'internal_collection', 'İç hesap tahsilatı', 'income', true, 12
where lab_company() is not null and not exists (select 1 from fin_categories where code = 'internal_collection' and company_id = lab_company());

-- Finans tahsilatı: kayıt hangi hesaba (iç hesap kullanan müşteride)
drop function if exists fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text);
create or replace function fin_collect_or_pay(
  p_kind text, p_party uuid, p_account uuid, p_date date, p_amount bigint, p_party_amount bigint,
  p_rate numeric, p_description text, p_doc_no text, p_method text default null, p_book text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a fin_accounts; pt fin_parties; v_txn uuid; v_lp uuid; s int; v_book text;
begin
  if p_kind not in ('collection', 'payment') then raise exception 'bad_kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount'; end if;
  select * into a from fin_accounts where id = p_account;
  select * into pt from fin_parties where id = p_party;
  if a.id is null or pt.id is null then raise exception 'not_found'; end if;
  s := case when p_kind = 'collection' then 1 else -1 end;
  v_book := case when p_book in ('official', 'both') then p_book else 'official' end;
  v_txn := fin_post(
    jsonb_build_object('kind', p_kind, 'txn_date', p_date, 'description', p_description, 'doc_no', p_doc_no,
                       'amount', p_amount, 'currency', a.currency, 'party_id', p_party, 'account_id', p_account),
    jsonb_build_array(
      jsonb_build_object('account_id', p_account, 'amount', s * p_amount, 'currency', a.currency, 'rate', case when a.currency = 'TRY' then 1 else coalesce(p_rate, fx_rate(a.currency, p_date)) end),
      jsonb_build_object('party_id', p_party, 'amount', -s * coalesce(p_party_amount, p_amount), 'currency', pt.currency,
                         'rate', case when pt.currency = 'TRY' then 1
                                      when pt.currency = a.currency then coalesce(p_rate, fx_rate(pt.currency, p_date))
                                      when p_party_amount is not null and p_party_amount > 0 then
                                        round(p_amount * (case when a.currency = 'TRY' then 1 else coalesce(p_rate, fx_rate(a.currency, p_date)) end) / p_party_amount, 6)
                                      else fx_rate(pt.currency, p_date) end)
    ));
  if p_kind = 'collection' and pt.lab_customer_id is not null and pt.currency in ('TRY', 'EUR', 'USD') then
    insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, fin_txn_id, account_id, book)
    values (pt.lab_customer_id, coalesce(p_date, current_date), coalesce(p_party_amount, p_amount), pt.currency,
            coalesce(p_method, case a.kind when 'cash' then 'cash' when 'credit_card' then 'card' when 'pos' then 'card' else 'bank' end),
            nullif(left(coalesce(p_doc_no, ''), 80), ''), nullif(left(coalesce(p_description, ''), 500), ''), v_txn, p_account, v_book)
    returning id into v_lp;
    update fin_txns set lab_payment_id = v_lp where id = v_txn;
  end if;
  return v_txn;
end $$;
revoke execute on function fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text, text) from public, anon;
grant execute on function fin_collect_or_pay(text, uuid, uuid, date, bigint, bigint, numeric, text, text, text, text) to authenticated;

-- Laboratuvar ekranından tahsilat
--  official / both : kasaya / bankaya işlenir, resmi cariden düşer (both: iç cariden de)
--  internal        : yalnız iç cariden düşer; hesap seçilirse kasaya / bankaya "İç hesap tahsilatı" olarak girer
create or replace function lab_payment_add(p_customer uuid, p_date date, p_amount bigint, p_method text, p_ref text, p_note text, p_book text, p_account uuid default null, p_account_amount bigint default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c lab_customers; pt fin_parties; a fin_accounts; v_txn uuid; v_lp uuid; v_book text := coalesce(p_book, 'official'); v_rate numeric;
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount'; end if;
  select * into c from lab_customers where id = p_customer;
  if c.id is null then raise exception 'not_found'; end if;
  if not c.internal_book then v_book := 'official'; end if;
  if v_book not in ('official', 'internal', 'both') then raise exception 'bad_book'; end if;

  if p_account is null then
    -- hesapsız: eski usul tahsilat kaydı (iç hesapta iç / ikisi; iç hesap kullanmayan müşteride tek cari)
    if c.internal_book and v_book <> 'internal' then raise exception 'account_required'; end if;
    insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, book)
    values (p_customer, coalesce(p_date, current_date), p_amount, c.currency, coalesce(p_method, 'bank'), nullif(left(p_ref, 80), ''), nullif(left(p_note, 500), ''), v_book)
    returning id into v_lp;
    return v_lp;
  end if;

  select * into a from fin_accounts where id = p_account;
  if a.id is null then raise exception 'not_found'; end if;
  if v_book in ('official', 'both') then
    select * into pt from fin_parties where lab_customer_id = p_customer limit 1;
    if pt.id is null then raise exception 'party_missing'; end if;
    v_txn := fin_collect_or_pay('collection', pt.id, p_account, p_date,
      case when a.currency = c.currency then p_amount else coalesce(p_account_amount, p_amount) end,
      case when a.currency = c.currency then null else p_amount end,
      null, p_note, p_ref, p_method, v_book);
    return (select lab_payment_id from fin_txns where id = v_txn);
  end if;
  -- internal + hesap: kasa / banka girişi, karşılığı "İç hesap tahsilatı"
  v_rate := case when a.currency = 'TRY' then 1 else fx_rate(a.currency, p_date) end;
  v_txn := fin_post(
    jsonb_build_object('kind', 'income', 'txn_date', p_date, 'description', coalesce(nullif(p_note, ''), c.name || ' — iç hesap tahsilatı'), 'doc_no', p_ref,
                       'amount', coalesce(p_account_amount, p_amount), 'currency', a.currency, 'account_id', p_account, 'category_id', fin_category('internal_collection')),
    jsonb_build_array(
      jsonb_build_object('account_id', p_account, 'amount', coalesce(p_account_amount, p_amount), 'currency', a.currency, 'rate', v_rate),
      jsonb_build_object('category_id', fin_category('internal_collection'), 'amount', -coalesce(p_account_amount, p_amount), 'currency', a.currency, 'rate', v_rate)));
  insert into lab_payments (customer_id, paid_on, amount, currency, method, ref, note, fin_txn_id, account_id, book)
  values (p_customer, coalesce(p_date, current_date), p_amount, c.currency, coalesce(p_method, case a.kind when 'cash' then 'cash' else 'bank' end), nullif(left(p_ref, 80), ''), nullif(left(p_note, 500), ''), v_txn, p_account, 'internal')
  returning id into v_lp;
  update fin_txns set lab_payment_id = v_lp where id = v_txn;
  return v_lp;
end $$;
grant execute on function lab_payment_add(uuid, date, bigint, text, text, text, text, uuid, bigint) to authenticated;

-- İşten resmi fatura (e-fatura / e-ihracat): iç hesap kullanan müşteride fatura resmi cariye işlenir
create or replace function inv_internal_book_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source = 'jobs' and new.direction = 'sale' and exists (
       select 1 from fin_parties p join lab_customers c on c.id = p.lab_customer_id where p.id = new.party_id and c.internal_book) then
    new.affects_balance := true;
  end if;
  return new;
end $$;
drop trigger if exists inv_internal_book_sync on inv_invoices;
create trigger inv_internal_book_sync before insert or update on inv_invoices for each row execute function inv_internal_book_sync();

notify pgrst, 'reload schema';
