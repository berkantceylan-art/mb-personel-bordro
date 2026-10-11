-- =====================================================================
-- RAPOR TASARLAYICI VE GRUP KONSOLİDASYONU
--  rpt_reports        : kullanıcının kaydettiği raporlar (veri kümesi, kırılım, ölçü, süzgeç, grafik); paylaşılabilir
--  fin_parties.group_company : grup şirketi (şirketler arası) cari işareti → konsolidasyonda elenir
--  cns_entities       : ERP dışındaki grup şirketleri (ör. Fransa'daki şirket), para birimi
--  cns_entries        : bu şirketlerin aylık rakamları (gelir, gider, nakit, alacak, borç, grup içi satış / alacak / borç)
--  cns_report(ay1, ay2, para)  : bu şirket (finans kayıtlarından) + diğer grup şirketleri, raporlama para birimine
--                                çevrilmiş, grup içi işlemler elenmiş aylık özet
-- Tekrar çalıştırılabilir. Önce 20261228000000_ai_forecast.sql.
-- =====================================================================

create table if not exists rpt_reports (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 120),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table rpt_reports enable row level security;
drop policy if exists rpt_reports_read on rpt_reports;
create policy rpt_reports_read on rpt_reports for select to authenticated using (owner_id = auth.uid() or (shared and company_id = lab_company()));
drop policy if exists rpt_reports_write on rpt_reports;
create policy rpt_reports_write on rpt_reports for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
grant select, insert, update, delete on rpt_reports to authenticated;

alter table fin_parties add column if not exists group_company boolean not null default false;

create table if not exists cns_entities (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  name text not null check (length(name) between 1 and 120),
  country text check (country is null or length(country) <= 60),
  currency text not null default 'EUR' check (currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  party_id uuid references fin_parties (id) on delete set null,     -- bu şirketin bizdeki cari kartı
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists cns_entries (
  entity_id uuid not null references cns_entities (id) on delete cascade,
  period char(7) not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  revenue bigint not null default 0,
  expense bigint not null default 0,
  cash bigint not null default 0,
  receivable bigint not null default 0,
  payable bigint not null default 0,
  ic_revenue bigint not null default 0,    -- grup şirketlerine satış (gelirin içinde)
  ic_expense bigint not null default 0,    -- grup şirketlerinden alış (giderin içinde)
  ic_receivable bigint not null default 0,
  ic_payable bigint not null default 0,
  note text check (note is null or length(note) <= 500),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (entity_id, period)
);
alter table cns_entities enable row level security;
alter table cns_entries enable row level security;
drop policy if exists cns_entities_read on cns_entities;
create policy cns_entities_read on cns_entities for select to authenticated using (can_module('finance', 2));
drop policy if exists cns_entities_write on cns_entities;
create policy cns_entities_write on cns_entities for all to authenticated using (can_module('finance', 3)) with check (can_module('finance', 3));
drop policy if exists cns_entries_read on cns_entries;
create policy cns_entries_read on cns_entries for select to authenticated using (can_module('finance', 2));
drop policy if exists cns_entries_write on cns_entries;
create policy cns_entries_write on cns_entries for all to authenticated using (can_module('finance', 3)) with check (can_module('finance', 3));
grant select, insert, update, delete on cns_entities, cns_entries to authenticated;

-- Ay sonu kur (raporlama para birimine çevirmek için): TRY karşılığı / hedef para birimi
create or replace function cns_conv(p_amount numeric, p_from text, p_to text, p_date date) returns numeric
language sql stable as $$
  select case when p_from = p_to then p_amount
    else p_amount * coalesce(fx_rate(p_from, p_date), case when p_from = 'TRY' then 1 end) / nullif(coalesce(fx_rate(p_to, p_date), case when p_to = 'TRY' then 1 end), 0) end;
$$;

create or replace function cns_report(p_from text, p_to text, p_currency text default 'TRY')
returns table (period text, entity text, revenue bigint, expense bigint, profit bigint, cash bigint, receivable bigint, payable bigint, ic_revenue bigint, ic_expense bigint, ic_receivable bigint, ic_payable bigint, missing boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare m date; v_end date; v_cur text := coalesce(nullif(p_currency, ''), 'TRY'); e record; x cns_entries; v_name text;
begin
  if not can_module('finance', 2) then raise exception 'not_allowed'; end if;
  if (p_to || '-01')::date < (p_from || '-01')::date or (p_to || '-01')::date > (p_from || '-01')::date + interval '36 months' then raise exception 'range_too_long'; end if;
  select name into v_name from companies where id = lab_company();
  for m in select generate_series((p_from || '-01')::date, (p_to || '-01')::date, interval '1 month')::date loop
    v_end := (m + interval '1 month - 1 day')::date;
    -- bu şirket: finans kayıtlarından (TL karşılığı → raporlama para birimi)
    return query
    with mv as (
      select fm.amount_try, c.kind ck, fm.party_id, fm.account_id
      from fin_moves fm join fin_txns t on t.id = fm.txn_id left join fin_categories c on c.id = fm.category_id
      where t.voided_at is null and fm.move_date between m and v_end
    ),
    grp as (select id from fin_parties where group_company),
    ic as (
      -- grup şirketiyle yapılan işlemlerin gelir / gider tarafı: aynı işlemdeki kategori hareketleri
      select sum(case when c.kind = 'income' then -fm.amount_try else 0 end) ic_rev, sum(case when c.kind = 'expense' then fm.amount_try else 0 end) ic_exp
      from fin_moves fm join fin_txns t on t.id = fm.txn_id join fin_categories c on c.id = fm.category_id
      where t.voided_at is null and fm.move_date between m and v_end and t.party_id in (select id from grp)
    ),
    bal as (
      select
        (select coalesce(sum(case when a.kind in ('cash', 'bank', 'pos') then round(cns_conv(fin_account_balance_at(a.id, v_end), a.currency, 'TRY', v_end)) else 0 end), 0) from fin_accounts a) cash_try,
        (select coalesce(sum(greatest(0, round(cns_conv(fin_party_balance_at(p.id, v_end), p.currency, 'TRY', v_end)))), 0) from fin_parties p where not p.group_company) rec_try,
        (select coalesce(sum(greatest(0, -round(cns_conv(fin_party_balance_at(p.id, v_end), p.currency, 'TRY', v_end)))), 0) from fin_parties p where not p.group_company) pay_try,
        (select coalesce(sum(greatest(0, round(cns_conv(fin_party_balance_at(p.id, v_end), p.currency, 'TRY', v_end)))), 0) from fin_parties p where p.group_company) icr_try,
        (select coalesce(sum(greatest(0, -round(cns_conv(fin_party_balance_at(p.id, v_end), p.currency, 'TRY', v_end)))), 0) from fin_parties p where p.group_company) icp_try
    )
    select to_char(m, 'YYYY-MM'), coalesce(v_name, 'Bu şirket'),
      round(cns_conv(coalesce((select -sum(amount_try) from mv where ck = 'income'), 0), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv(coalesce((select sum(amount_try) from mv where ck = 'expense'), 0), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv(coalesce((select -sum(amount_try) from mv where ck = 'income'), 0) - coalesce((select sum(amount_try) from mv where ck = 'expense'), 0), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv((select cash_try from bal), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv((select rec_try + icr_try from bal), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv((select pay_try + icp_try from bal), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv(coalesce((select ic_rev from ic), 0), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv(coalesce((select ic_exp from ic), 0), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv((select icr_try from bal), 'TRY', v_cur, v_end))::bigint,
      round(cns_conv((select icp_try from bal), 'TRY', v_cur, v_end))::bigint,
      false;
    -- diğer grup şirketleri: girilen aylık rakamlar
    for e in select * from cns_entities where is_active order by name loop
      select * into x from cns_entries where entity_id = e.id and period = to_char(m, 'YYYY-MM');
      return query select to_char(m, 'YYYY-MM'), e.name,
        round(cns_conv(coalesce(x.revenue, 0), e.currency, v_cur, v_end))::bigint, round(cns_conv(coalesce(x.expense, 0), e.currency, v_cur, v_end))::bigint,
        round(cns_conv(coalesce(x.revenue, 0) - coalesce(x.expense, 0), e.currency, v_cur, v_end))::bigint,
        round(cns_conv(coalesce(x.cash, 0), e.currency, v_cur, v_end))::bigint, round(cns_conv(coalesce(x.receivable, 0), e.currency, v_cur, v_end))::bigint,
        round(cns_conv(coalesce(x.payable, 0), e.currency, v_cur, v_end))::bigint,
        round(cns_conv(coalesce(x.ic_revenue, 0), e.currency, v_cur, v_end))::bigint, round(cns_conv(coalesce(x.ic_expense, 0), e.currency, v_cur, v_end))::bigint,
        round(cns_conv(coalesce(x.ic_receivable, 0), e.currency, v_cur, v_end))::bigint, round(cns_conv(coalesce(x.ic_payable, 0), e.currency, v_cur, v_end))::bigint,
        x.entity_id is null;
    end loop;
  end loop;
end $$;
revoke execute on function cns_report(text, text, text) from public, anon;
grant execute on function cns_report(text, text, text) to authenticated;

-- Hesap bakiyesi (tarih itibarıyla, hesabın para biriminde)
create or replace function fin_account_balance_at(p_account uuid, p_date date) returns bigint
language sql stable security definer set search_path = public as $$
  select a.opening_balance + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.account_id = a.id and t.voided_at is null and m.move_date <= p_date), 0)
  from fin_accounts a where a.id = p_account;
$$;
revoke execute on function fin_account_balance_at(uuid, date) from public, anon;
grant execute on function fin_account_balance_at(uuid, date) to authenticated;

notify pgrst, 'reload schema';
