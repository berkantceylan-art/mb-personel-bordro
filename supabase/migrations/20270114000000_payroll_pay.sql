-- =====================================================================
-- MAAŞ PLANI: ödemeler kasa / bankaya, kurum ödemeleri (BES, icra, SGK, vergi)
--  ledger_entries.account_id / fin_txn_id : maaş / avans ödemesinin hangi kasa / bankadan yapıldığı
--  payroll_pay(p)          : seçilen personele ödeme yazar (personel carisi + finans gideri, tek işlem)
--  void_ledger_entry       : cari hareket iptal edilince bağlı finans işlemi de iptal edilir
--  payroll_remittances     : dönemin kurum ödemeleri (BES şirketi, icra dairesi, SGK, muhtasar)
--  payroll_remit(p) / payroll_remit_undo(id)
-- Finans kaydı: hesap (−) / "Personel giderleri" (+). Tekrar çalıştırılabilir.
-- =====================================================================
alter table ledger_entries add column if not exists account_id uuid references fin_accounts (id) on delete set null;
alter table ledger_entries add column if not exists fin_txn_id uuid references fin_txns (id) on delete set null;

-- Personel giderleri kategorisi yoksa oluşturur (eski kurulumlarda olmayabilir)
create or replace function pay_salary_category() returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid := fin_category('exp_salary');
begin
  if v is null then
    insert into fin_categories (company_id, code, name, kind, is_system, sort)
    values (lab_company(), 'exp_salary', 'Personel giderleri', 'expense', false, 26)
    on conflict (company_id, code) do nothing;
    v := fin_category('exp_salary');
  end if;
  return v;
end $$;
revoke execute on function pay_salary_category() from public, anon, authenticated;

-- Ödeme hesabı kontrolü: şirketin, aktif, TL, kanala uygun (banka → bank, elden → cash)
create or replace function pay_check_account(p_account uuid, p_channel text) returns fin_accounts
language plpgsql stable security definer set search_path = public as $$
declare a fin_accounts;
begin
  select * into a from fin_accounts where id = p_account and company_id = lab_company();
  if a.id is null then raise exception 'account_required'; end if;
  if not a.is_active then raise exception 'account_inactive'; end if;
  if a.currency <> 'TRY' then raise exception 'account_currency'; end if;
  if p_channel = 'BANK' and a.kind <> 'bank' then raise exception 'account_kind_bank'; end if;
  if p_channel = 'CASH' and a.kind <> 'cash' then raise exception 'account_kind_cash'; end if;
  return a;
end $$;
revoke execute on function pay_check_account(uuid, text) from public, anon, authenticated;

-- Ödeme: { period, date, items: [{ employee_id, channel: BANK|CASH, amount (kuruş), account_id, type?: SALARY|ADVANCE, note? }] }
create or replace function payroll_pay(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := lab_company();
  v_period text := p ->> 'period';
  v_date date := nullif(p ->> 'date', '')::date;
  it jsonb; v_emp employees; v_amount bigint; v_channel text; v_type text; a fin_accounts;
  v_entry uuid; v_txn uuid; v_cat uuid; v_n int := 0; v_label text;
begin
  if v_company is null or not can_manage_pay(v_company) then raise exception 'not_allowed'; end if;
  if v_period !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  if v_date is null then raise exception 'date_required'; end if;
  if period_is_closed(v_company, v_period) then raise exception 'period_closed'; end if;
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then raise exception 'items_required'; end if;
  v_cat := pay_salary_category();
  for it in select * from jsonb_array_elements(p -> 'items') loop
    v_amount := nullif(it ->> 'amount', '')::bigint;
    if coalesce(v_amount, 0) <= 0 then continue; end if;
    v_channel := it ->> 'channel';
    if v_channel not in ('BANK', 'CASH') then raise exception 'bad_channel'; end if;
    v_type := coalesce(nullif(it ->> 'type', ''), 'SALARY');
    if v_type not in ('SALARY', 'ADVANCE') then raise exception 'bad_type'; end if;
    select * into v_emp from employees where id = (it ->> 'employee_id')::uuid and company_id = v_company;
    if v_emp.id is null then raise exception 'employee_not_found'; end if;
    a := pay_check_account(nullif(it ->> 'account_id', '')::uuid, v_channel);
    v_label := (case v_type when 'ADVANCE' then 'Avans' else 'Maaş' end) || ' · ' || v_emp.first_name || ' ' || v_emp.last_name || ' · ' || v_period
               || case v_channel when 'BANK' then ' (banka)' else ' (elden)' end;
    insert into ledger_entries (company_id, employee_id, period, entry_date, type, channel, amount, note, account_id, signature_path)
    values (v_company, v_emp.id, v_period, v_date, v_type::ledger_type, v_channel::ledger_channel, v_amount,
            coalesce(nullif(left(it ->> 'note', 300), ''), case v_type when 'ADVANCE' then 'Avans' else 'Maaş ödemesi' end || ' · ' || a.name),
            a.id, nullif(it ->> 'signature_path', ''))
    returning id into v_entry;
    v_txn := fin_post_sys(
      jsonb_build_object('kind', 'expense', 'txn_date', v_date, 'description', v_label, 'amount', v_amount, 'currency', 'TRY',
                         'account_id', a.id, 'category_id', v_cat, 'ref_type', 'payroll', 'ref_id', v_entry),
      jsonb_build_array(
        jsonb_build_object('account_id', a.id, 'amount', -v_amount, 'description', v_label),
        jsonb_build_object('category_id', v_cat, 'amount', v_amount, 'description', v_label)));
    update ledger_entries set fin_txn_id = v_txn where id = v_entry;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function payroll_pay(jsonb) from public, anon;
grant execute on function payroll_pay(jsonb) to authenticated;

-- Cari hareket iptali (tek yol): bağlı finans işlemi de iptal edilir
create or replace function void_ledger_entry(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_txn uuid;
begin
  select company_id, fin_txn_id into v_company, v_txn from ledger_entries where id = p_id;
  if v_company is null or not can_manage_pay(v_company) then
    raise exception 'Yetki yok';
  end if;
  if coalesce(length(p_reason), 0) = 0 then
    raise exception 'İptal gerekçesi zorunlu';
  end if;
  update ledger_entries set voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = p_id and voided_at is null;
  if v_txn is not null then perform fin_void_sys(v_txn, 'Personel ödemesi iptal: ' || p_reason); end if;
end $$;

-- ---------------------------------------------------------------------
-- Kurum ödemeleri
-- ---------------------------------------------------------------------
create table if not exists payroll_remittances (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  period char(7) not null,
  kind text not null check (kind in ('bes', 'icra', 'sgk', 'vergi')),
  ref_id uuid,                                        -- icra: dosya
  label text check (label is null or length(label) <= 200),
  amount bigint not null check (amount > 0),
  paid_on date not null,
  account_id uuid references fin_accounts (id) on delete set null,
  fin_txn_id uuid references fin_txns (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  voided_at timestamptz,
  voided_by uuid
);
create unique index if not exists payroll_remittances_once on payroll_remittances
  (company_id, period, kind, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid)) where voided_at is null;
alter table payroll_remittances enable row level security;
drop policy if exists payroll_remittances_read on payroll_remittances;
create policy payroll_remittances_read on payroll_remittances for select to authenticated using (can_manage_pay(company_id));
grant select on payroll_remittances to authenticated;

-- { period, kind, ref_id?, label, amount, date, account_id, note? }
create or replace function payroll_remit(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := lab_company();
  v_period text := p ->> 'period';
  v_kind text := p ->> 'kind';
  v_amount bigint := nullif(p ->> 'amount', '')::bigint;
  v_date date := nullif(p ->> 'date', '')::date;
  v_ref uuid := nullif(p ->> 'ref_id', '')::uuid;
  a fin_accounts; v_id uuid; v_txn uuid; v_label text; v_cat uuid;
begin
  if v_company is null or not can_manage_pay(v_company) then raise exception 'not_allowed'; end if;
  if v_period !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  if v_kind not in ('bes', 'icra', 'sgk', 'vergi') then raise exception 'bad_kind'; end if;
  if coalesce(v_amount, 0) <= 0 then raise exception 'amount_required'; end if;
  if v_date is null then raise exception 'date_required'; end if;
  if v_ref is not null and not exists (select 1 from garnishment_files where id = v_ref and company_id = v_company) then raise exception 'not_found'; end if;
  select * into a from fin_accounts where id = nullif(p ->> 'account_id', '')::uuid and company_id = v_company and is_active and kind in ('bank', 'cash') and currency = 'TRY';
  if a.id is null then raise exception 'account_required'; end if;
  if exists (select 1 from payroll_remittances where company_id = v_company and period = v_period and kind = v_kind
             and coalesce(ref_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_ref, '00000000-0000-0000-0000-000000000000'::uuid) and voided_at is null) then
    raise exception 'already_paid';
  end if;
  v_label := coalesce(nullif(left(p ->> 'label', 200), ''),
    case v_kind when 'bes' then 'BES katkı payları' when 'icra' then 'İcra / nafaka' when 'sgk' then 'SGK primleri' else 'Muhtasar (gelir + damga vergisi)' end) || ' · ' || v_period;
  v_cat := pay_salary_category();
  insert into payroll_remittances (company_id, period, kind, ref_id, label, amount, paid_on, account_id, note)
  values (v_company, v_period, v_kind, v_ref, v_label, v_amount, v_date, a.id, nullif(left(p ->> 'note', 300), ''))
  returning id into v_id;
  v_txn := fin_post_sys(
    jsonb_build_object('kind', 'expense', 'txn_date', v_date, 'description', v_label, 'amount', v_amount, 'currency', 'TRY',
                       'account_id', a.id, 'category_id', v_cat, 'ref_type', 'payroll_remit', 'ref_id', v_id),
    jsonb_build_array(
      jsonb_build_object('account_id', a.id, 'amount', -v_amount, 'description', v_label),
      jsonb_build_object('category_id', v_cat, 'amount', v_amount, 'description', v_label)));
  update payroll_remittances set fin_txn_id = v_txn where id = v_id;
  return v_id;
end $$;
revoke execute on function payroll_remit(jsonb) from public, anon;
grant execute on function payroll_remit(jsonb) to authenticated;

create or replace function payroll_remit_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r payroll_remittances;
begin
  select * into r from payroll_remittances where id = p_id and company_id = lab_company() for update;
  if r.id is null then raise exception 'not_found'; end if;
  if not can_manage_pay(r.company_id) then raise exception 'not_allowed'; end if;
  if r.voided_at is not null then return; end if;
  update payroll_remittances set voided_at = now(), voided_by = auth.uid() where id = p_id;
  perform fin_void_sys(r.fin_txn_id, 'Kurum ödemesi geri alındı');
end $$;
revoke execute on function payroll_remit_undo(uuid) from public, anon;
grant execute on function payroll_remit_undo(uuid) to authenticated;

notify pgrst, 'reload schema';
