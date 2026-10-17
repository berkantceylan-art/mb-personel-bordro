-- =====================================================================
-- PARÇA BAŞI ÜCRET
--  pc_workers  : parça başı çalışanlar — kendi personelimiz (internal) ya da dışarıdan usta (external, finans carisi açılır)
--  pc_rates    : fiyat listesi — ürün / iş adı başına birim fiyat; ustaya özel fiyat önceliklidir
--  pc_entries  : yapılan iş (kim, ne zaman, hangi ürün / iş kaydı, kaç birim, birim fiyat) → onay → aktarım
--  Aktarım:
--    internal → personel carisine BONUS (elden / resmi brüt; uygulama yazar) → maaşa yansır
--    external → finans: "Parça başı işçilik" gideri / usta carisi alacak (+ stopaj varsa) ve ödeme planı → ödeme merkezi
--  Ürün maliyeti: son 90 günün parça başı tutarı / aynı dönemde üretilen birim → prd_cost_core'a "Parça başı işçilik payı"
-- Tekrar çalıştırılabilir.
-- =====================================================================

-- Gider kategorisi
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, 'exp_piece', 'Parça başı işçilik', 'expense', true, 25 from companies c
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = 'exp_piece');
do $$ begin
  if to_regclass('public.gl_maps') is not null and to_regclass('public.gl_accounts') is not null then
    insert into gl_maps (company_id, source, key, account_id)
    select a.company_id, 'category_code', 'exp_piece', a.id from gl_accounts a where a.code = '720' on conflict do nothing;
  end if;
end $$;

create table if not exists pc_workers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  kind text not null check (kind in ('internal', 'external')),
  employee_id uuid references employees (id) on delete cascade,
  party_id uuid references fin_parties (id) on delete set null,
  name text not null check (length(name) between 1 and 160),
  phone text check (phone is null or length(phone) <= 40),
  doc_type text not null default 'none' check (doc_type in ('none', 'gider_pusulasi', 'serbest_meslek', 'fatura')),
  stopaj_pct numeric(5, 2) not null default 0 check (stopaj_pct between 0 and 40),
  pay_side text not null default 'CASH' check (pay_side in ('OFFICIAL', 'CASH')),
  pay_days int not null default 7 check (pay_days between 0 and 120),
  is_active boolean not null default true,
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now(),
  check (kind = 'external' or employee_id is not null)
);
create unique index if not exists pc_workers_emp_uq on pc_workers (employee_id) where employee_id is not null;

create table if not exists pc_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  lab_product_id uuid references lab_products (id) on delete cascade,
  work_name text not null check (length(work_name) between 1 and 160),
  unit text not null default 'üye' check (length(unit) <= 20),
  price bigint not null check (price >= 0),                       -- kuruş / birim
  worker_id uuid references pc_workers (id) on delete cascade,     -- boş = herkese
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists pc_rates_product_idx on pc_rates (lab_product_id);

create table if not exists pc_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  worker_id uuid not null references pc_workers (id) on delete restrict,
  work_date date not null,
  period char(7) not null,
  job_id uuid references jobs (id) on delete set null,
  lab_product_id uuid references lab_products (id) on delete set null,
  rate_id uuid references pc_rates (id) on delete set null,
  work_name text not null check (length(work_name) between 1 and 200),
  unit text not null default 'üye',
  qty numeric(10, 2) not null check (qty > 0),
  unit_price bigint not null check (unit_price >= 0),
  amount bigint generated always as (round(qty * unit_price)::bigint) stored,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'posted')),
  note text check (note is null or length(note) <= 500),
  reject_reason text,
  stopaj_amount bigint,
  net_amount bigint,
  gross_amount bigint,                                            -- resmi bordroya giren brüt (internal OFFICIAL)
  ledger_entry_id uuid references ledger_entries (id) on delete set null,
  fin_txn_id uuid,
  payment_plan_id uuid,
  created_by uuid references auth.users (id) default auth.uid(),
  created_at timestamptz not null default now(),
  approved_by uuid references auth.users (id),
  approved_at timestamptz,
  posted_by uuid references auth.users (id),
  posted_at timestamptz
);
create index if not exists pc_entries_period_idx on pc_entries (company_id, period);
create index if not exists pc_entries_worker_idx on pc_entries (worker_id, work_date desc);
create index if not exists pc_entries_product_idx on pc_entries (lab_product_id, work_date);
create index if not exists pc_entries_job_idx on pc_entries (job_id) where job_id is not null;

-- ---------------------------------------------------------------------
-- Yetki
-- ---------------------------------------------------------------------
create or replace function pc_can_view() returns boolean language sql stable security definer set search_path = public as $$
  select can_module('production') or can_module('payroll') or can_module('finance') or has_role(lab_company(), array['owner', 'hr', 'accountant']::app_role[]);
$$;
create or replace function pc_can_enter() returns boolean language sql stable security definer set search_path = public as $$
  select can_module('production', 2) or has_role(lab_company(), array['owner', 'hr', 'accountant', 'branch_manager']::app_role[]);
$$;
create or replace function pc_can_approve() returns boolean language sql stable security definer set search_path = public as $$
  select can_module('production', 3) or can_module('payroll', 2) or has_role(lab_company(), array['owner', 'hr', 'accountant']::app_role[]);
$$;
create or replace function pc_can_post() returns boolean language sql stable security definer set search_path = public as $$
  select can_manage_pay(lab_company()) or can_module('finance', 2);
$$;

alter table pc_workers enable row level security;
alter table pc_rates enable row level security;
alter table pc_entries enable row level security;
drop policy if exists pc_workers_read on pc_workers;
drop policy if exists pc_rates_read on pc_rates;
drop policy if exists pc_entries_read on pc_entries;
create policy pc_workers_read on pc_workers for select to authenticated using (company_id = (select lab_company()) and ((select pc_can_view()) or (employee_id is not null and (select is_self_employee(employee_id)))));
create policy pc_rates_read on pc_rates for select to authenticated using (company_id = (select lab_company()) and (select pc_can_view()));
create policy pc_entries_read on pc_entries for select to authenticated using (company_id = (select lab_company()) and ((select pc_can_view())
  or exists (select 1 from pc_workers w where w.id = worker_id and w.employee_id is not null and is_self_employee(w.employee_id))));
revoke all on pc_workers, pc_rates, pc_entries from anon;
grant select on pc_workers, pc_rates, pc_entries to authenticated;

-- ---------------------------------------------------------------------
-- Tanımlar
-- ---------------------------------------------------------------------
create or replace function pc_worker_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_id uuid := nullif(p->>'id', '')::uuid; v_kind text := coalesce(p->>'kind', 'external'); v_emp uuid := nullif(p->>'employee_id', '')::uuid;
  v_name text := nullif(trim(coalesce(p->>'name', '')), ''); v_party uuid; v_tax text := nullif(regexp_replace(coalesce(p->>'tax_no', ''), '\D', '', 'g'), '');
begin
  if not pc_can_approve() then raise exception 'not_allowed'; end if;
  if v_kind = 'internal' then
    if v_emp is null then raise exception 'employee_required'; end if;
    select first_name || ' ' || last_name into v_name from employees where id = v_emp and company_id = c;
    if v_name is null then raise exception 'employee_required'; end if;
  elsif v_name is null then raise exception 'name_required';
  end if;
  if v_tax is not null and v_tax !~ '^[0-9]{10,11}$' then raise exception 'bad_tax_no'; end if;
  if v_id is null then
    if v_kind = 'internal' and exists (select 1 from pc_workers where employee_id = v_emp) then
      select id into v_id from pc_workers where employee_id = v_emp;
      update pc_workers set is_active = true where id = v_id;
    else
      insert into pc_workers (company_id, kind, employee_id, name) values (c, v_kind, case when v_kind = 'internal' then v_emp end, v_name) returning id into v_id;
    end if;
  end if;
  update pc_workers set
    name = v_name, phone = nullif(left(trim(coalesce(p->>'phone', '')), 40), ''),
    doc_type = case when p->>'doc_type' in ('none', 'gider_pusulasi', 'serbest_meslek', 'fatura') then p->>'doc_type' else doc_type end,
    stopaj_pct = least(greatest(coalesce(nullif(p->>'stopaj_pct', '')::numeric, stopaj_pct), 0), 40),
    pay_side = case when p->>'pay_side' in ('OFFICIAL', 'CASH') then p->>'pay_side' else pay_side end,
    pay_days = least(greatest(coalesce(nullif(p->>'pay_days', '')::int, pay_days), 0), 120),
    is_active = coalesce((p->>'is_active')::boolean, is_active),
    note = nullif(left(trim(coalesce(p->>'note', '')), 500), '')
  where id = v_id and company_id = c;
  -- Dış usta: finans carisi (yoksa açılır, varsa güncellenir)
  if v_kind = 'external' then
    select party_id into v_party from pc_workers where id = v_id;
    if v_party is null and v_tax is not null then
      select id into v_party from fin_parties where company_id = c and tax_no = v_tax limit 1;   -- aynı VKN/TCKN'li cari varsa o kullanılır
      if v_party is not null then update pc_workers set party_id = v_party where id = v_id; end if;
    end if;
    if v_party is null then
      insert into fin_parties (company_id, name, kind, person_type, phone, iban, tax_no, note)
      values (c, v_name, 'supplier', 'person', nullif(left(trim(coalesce(p->>'phone', '')), 40), ''), nullif(left(replace(coalesce(p->>'iban', ''), ' ', ''), 40), ''), v_tax, 'Parça başı usta')
      returning id into v_party;
      update pc_workers set party_id = v_party where id = v_id;
    else
      update fin_parties set name = v_name, phone = coalesce(nullif(left(trim(coalesce(p->>'phone', '')), 40), ''), phone),
             iban = coalesce(nullif(left(replace(coalesce(p->>'iban', ''), ' ', ''), 40), ''), iban), tax_no = coalesce(v_tax, tax_no)
       where id = v_party;
    end if;
  end if;
  return v_id;
end $$;

create or replace function pc_rate_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not pc_can_approve() then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p->>'work_name', '')), '') is null then raise exception 'name_required'; end if;
  if v_id is null then
    insert into pc_rates (company_id, lab_product_id, work_name, unit, price, worker_id)
    values (lab_company(), nullif(p->>'lab_product_id', '')::uuid, left(trim(p->>'work_name'), 160), coalesce(nullif(trim(p->>'unit'), ''), 'üye'),
            greatest(coalesce((p->>'price')::bigint, 0), 0), nullif(p->>'worker_id', '')::uuid)
    returning id into v_id;
  else
    update pc_rates set lab_product_id = nullif(p->>'lab_product_id', '')::uuid, work_name = left(trim(p->>'work_name'), 160), unit = coalesce(nullif(trim(p->>'unit'), ''), 'üye'),
           price = greatest(coalesce((p->>'price')::bigint, 0), 0), worker_id = nullif(p->>'worker_id', '')::uuid, is_active = coalesce((p->>'is_active')::boolean, is_active)
     where id = v_id and company_id = lab_company();
  end if;
  return v_id;
end $$;

create or replace function pc_rate_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pc_can_approve() then raise exception 'not_allowed'; end if;
  update pc_rates set is_active = false where id = p_id and company_id = lab_company();
end $$;

-- Ustanın bu ürün / iş için geçerli fiyatı (ustaya özel önce)
create or replace function pc_price_for(p_worker uuid, p_product uuid, p_work text) returns table (rate_id uuid, price bigint, work_name text, unit text)
language sql stable security definer set search_path = public as $$
  select r.id, r.price, r.work_name, r.unit from pc_rates r
   where r.company_id = lab_company() and r.is_active
     and (r.worker_id = p_worker or r.worker_id is null)
     and ((p_product is not null and r.lab_product_id = p_product) or (p_product is null and p_work is not null and lower(r.work_name) = lower(p_work)))
   order by (r.worker_id is not null) desc, r.created_at desc limit 1;
$$;

-- ---------------------------------------------------------------------
-- Kayıt: ekle / düzelt (yalnız bekleyen) / sil
--  p: {id?, worker_id, work_date, job_no?|job_id?, lab_product_id?, rate_id?, work_name?, qty, unit_price?, note?}
-- ---------------------------------------------------------------------
create or replace function pc_entry_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_id uuid := nullif(p->>'id', '')::uuid; w pc_workers; v_prod uuid := nullif(p->>'lab_product_id', '')::uuid;
  v_job uuid := nullif(p->>'job_id', '')::uuid; v_rate record; v_price bigint := nullif(p->>'unit_price', '')::bigint; v_work text := nullif(trim(coalesce(p->>'work_name', '')), '');
  v_unit text := 'üye'; v_date date := coalesce(nullif(p->>'work_date', '')::date, current_date); v_qty numeric := nullif(p->>'qty', '')::numeric; v_pname text;
begin
  if not pc_can_enter() then raise exception 'not_allowed'; end if;
  select * into w from pc_workers where id = nullif(p->>'worker_id', '')::uuid and company_id = c;
  if w.id is null or not w.is_active then raise exception 'worker_required'; end if;
  if v_qty is null or v_qty <= 0 then raise exception 'qty_required'; end if;
  if v_date > current_date then raise exception 'future_date'; end if;
  if v_job is null and nullif(p->>'job_no', '') is not null then
    select id into v_job from jobs where company_id = c and no = (regexp_replace(p->>'job_no', '\D', '', 'g'))::bigint;
    if v_job is null then raise exception 'job_not_found'; end if;
  end if;
  -- iş kaydı seçildi, ürün seçilmediyse işteki ilk ürün
  if v_prod is null and v_job is not null then
    select product_id into v_prod from job_items where job_id = v_job and product_id is not null order by qty desc limit 1;
  end if;
  select * into v_rate from pc_price_for(w.id, v_prod, v_work);
  if v_price is null then v_price := v_rate.price; end if;
  if v_price is null then raise exception 'price_required'; end if;
  if v_work is null then
    select coalesce(nullif(trim(name_tr), ''), name) into v_pname from lab_products where id = v_prod;
    v_work := coalesce(v_rate.work_name, v_pname);
  end if;
  if v_work is null then raise exception 'work_required'; end if;
  v_unit := coalesce(v_rate.unit, nullif(trim(p->>'unit'), ''), 'üye');
  if v_id is null then
    insert into pc_entries (company_id, worker_id, work_date, period, job_id, lab_product_id, rate_id, work_name, unit, qty, unit_price, note)
    values (c, w.id, v_date, to_char(v_date, 'YYYY-MM'), v_job, v_prod, v_rate.rate_id, left(v_work, 200), v_unit, v_qty, v_price, nullif(left(trim(coalesce(p->>'note', '')), 500), ''))
    returning id into v_id;
  else
    update pc_entries set worker_id = w.id, work_date = v_date, period = to_char(v_date, 'YYYY-MM'), job_id = v_job, lab_product_id = v_prod, rate_id = v_rate.rate_id,
           work_name = left(v_work, 200), unit = v_unit, qty = v_qty, unit_price = v_price, note = nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
           status = 'pending', reject_reason = null, approved_by = null, approved_at = null
     where id = v_id and company_id = c and status in ('pending', 'rejected');
    if not found then raise exception 'locked'; end if;
  end if;
  return v_id;
end $$;

create or replace function pc_entry_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not pc_can_enter() then raise exception 'not_allowed'; end if;
  delete from pc_entries where id = p_id and company_id = lab_company() and status in ('pending', 'rejected');
  if not found then raise exception 'locked'; end if;
end $$;

-- Onay / ret / onayı geri al
create or replace function pc_decide(p_ids uuid[], p_decision text, p_reason text default null) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not pc_can_approve() then raise exception 'not_allowed'; end if;
  if p_decision = 'approve' then
    update pc_entries set status = 'approved', approved_by = auth.uid(), approved_at = now(), reject_reason = null
     where id = any (p_ids) and company_id = lab_company() and status in ('pending', 'rejected');
  elsif p_decision = 'reject' then
    update pc_entries set status = 'rejected', reject_reason = nullif(left(trim(coalesce(p_reason, '')), 300), ''), approved_by = auth.uid(), approved_at = now()
     where id = any (p_ids) and company_id = lab_company() and status in ('pending', 'approved');
  elsif p_decision = 'reopen' then
    update pc_entries set status = 'pending', approved_by = null, approved_at = null
     where id = any (p_ids) and company_id = lab_company() and status in ('approved', 'rejected');
  else raise exception 'bad_decision';
  end if;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Aktarım
-- ---------------------------------------------------------------------
-- Dış usta: usta başına tek finans kaydı (gider brüt; stopaj; usta carisine net borç) + ödeme planı
create or replace function pc_post_external(p_ids uuid[], p_txn_date date default current_date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); w record; v_gross bigint; v_stop bigint; v_net bigint; v_txn uuid; v_plan uuid; n_w int := 0; n_e int := 0; v_ids uuid[];
begin
  if not pc_can_post() then raise exception 'not_allowed'; end if;
  for w in
    select k.id, k.name, k.party_id, k.stopaj_pct, k.doc_type, k.pay_days from pc_workers k
     where k.kind = 'external' and k.company_id = c
       and exists (select 1 from pc_entries e where e.worker_id = k.id and e.id = any (p_ids) and e.status = 'approved')
  loop
    if w.party_id is null then raise exception 'party_missing:%', w.name; end if;
    select array_agg(id), sum(amount) into v_ids, v_gross from pc_entries where worker_id = w.id and id = any (p_ids) and status = 'approved';
    if coalesce(v_gross, 0) <= 0 then continue; end if;
    v_stop := round(v_gross * w.stopaj_pct / 100);
    v_net := v_gross - v_stop;
    v_txn := fin_post_sys(
      jsonb_build_object('kind', 'expense', 'txn_date', p_txn_date, 'description', 'Parça başı işçilik · ' || w.name || ' · ' || cardinality(v_ids) || ' kayıt',
                         'amount', v_gross, 'currency', 'TRY', 'party_id', w.party_id, 'category_id', fin_category('exp_piece'), 'ref_type', 'piecework'),
      jsonb_build_array(
        jsonb_build_object('category_id', fin_category('exp_piece'), 'amount', v_gross, 'currency', 'TRY'),
        jsonb_build_object('party_id', w.party_id, 'amount', -v_net, 'currency', 'TRY'),
        jsonb_build_object('category_id', fin_category('stopaj_smm'), 'amount', -v_stop, 'currency', 'TRY')));
    insert into fin_payment_plans (company_id, party_id, due_date, amount, currency, method, note, title, category)
    values (c, w.party_id, p_txn_date + w.pay_days, v_net, 'TRY', 'transfer', 'Parça başı işçilik ödemesi', 'Parça başı · ' || w.name, 'personnel')
    returning id into v_plan;
    update pc_entries e set status = 'posted', posted_by = auth.uid(), posted_at = now(), fin_txn_id = v_txn, payment_plan_id = v_plan,
           stopaj_amount = round(e.amount * w.stopaj_pct / 100), net_amount = e.amount - round(e.amount * w.stopaj_pct / 100)
     where e.id = any (v_ids);
    n_w := n_w + 1; n_e := n_e + cardinality(v_ids);
  end loop;
  return jsonb_build_object('workers', n_w, 'entries', n_e);
end $$;

-- Personel: uygulama cari kaydını (BONUS) yazdıktan sonra kayıtları bağlar
create or replace function pc_mark_internal_posted(p_ids uuid[], p_ledger uuid, p_gross bigint) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_total bigint;
begin
  if not pc_can_post() then raise exception 'not_allowed'; end if;
  select sum(amount) into v_total from pc_entries where id = any (p_ids) and status = 'approved';
  update pc_entries e set status = 'posted', posted_by = auth.uid(), posted_at = now(), ledger_entry_id = p_ledger, net_amount = e.amount,
         gross_amount = case when p_gross is null or coalesce(v_total, 0) = 0 then null else round(p_gross::numeric * e.amount / v_total) end
   where e.id = any (p_ids) and e.company_id = lab_company() and e.status = 'approved'
     and exists (select 1 from pc_workers w where w.id = e.worker_id and w.kind = 'internal');
  get diagnostics n = row_count;
  return n;
end $$;

-- Aktarımı geri al: finans kaydı / cari kaydı iptal, ödeme planı iptal, kayıtlar onaylıya döner
create or replace function pc_unpost(p_ids uuid[], p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  if not pc_can_post() then raise exception 'not_allowed'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  for r in select distinct fin_txn_id, payment_plan_id, ledger_entry_id from pc_entries where id = any (p_ids) and status = 'posted' and company_id = lab_company() loop
    if r.fin_txn_id is not null then perform fin_void_sys(r.fin_txn_id, 'Parça başı aktarımı geri alındı: ' || p_reason); end if;
    if r.payment_plan_id is not null then update fin_payment_plans set status = 'cancelled' where id = r.payment_plan_id and status = 'planned'; end if;
    if r.ledger_entry_id is not null then perform void_ledger_entry(r.ledger_entry_id, 'Parça başı aktarımı geri alındı: ' || p_reason); end if;
  end loop;
  -- aynı finans / cari kaydını paylaşan tüm kayıtlar birlikte geri alınır
  update pc_entries set status = 'approved', posted_by = null, posted_at = null, fin_txn_id = null, payment_plan_id = null, ledger_entry_id = null,
         stopaj_amount = null, net_amount = null, gross_amount = null
   where company_id = lab_company() and status = 'posted'
     and (id = any (p_ids) or fin_txn_id in (select fin_txn_id from pc_entries where id = any (p_ids)) or ledger_entry_id in (select ledger_entry_id from pc_entries where id = any (p_ids)));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function pc_worker_save(jsonb), pc_rate_save(jsonb), pc_rate_delete(uuid), pc_price_for(uuid, uuid, text), pc_entry_save(jsonb), pc_entry_delete(uuid),
  pc_decide(uuid[], text, text), pc_post_external(uuid[], date), pc_mark_internal_posted(uuid[], uuid, bigint), pc_unpost(uuid[], text) from public, anon;
grant execute on function pc_worker_save(jsonb), pc_rate_save(jsonb), pc_rate_delete(uuid), pc_price_for(uuid, uuid, text), pc_entry_save(jsonb), pc_entry_delete(uuid),
  pc_decide(uuid[], text, text), pc_post_external(uuid[], date), pc_mark_internal_posted(uuid[], uuid, bigint), pc_unpost(uuid[], text) to authenticated;

-- ---------------------------------------------------------------------
-- Ürün maliyeti: birim başına parça başı işçilik payı (son 90 gün)
-- ---------------------------------------------------------------------
create or replace function pc_unit_cost(p_product uuid) returns bigint
language sql stable security definer set search_path = public as $$
  with pc as (
    select coalesce(sum(amount), 0) amt, coalesce(sum(qty), 0) q from pc_entries
     where lab_product_id = p_product and status in ('approved', 'posted') and work_date >= current_date - 90
  ), made as (
    select coalesce(sum(i.qty), 0) u from job_items i join jobs j on j.id = i.job_id
     where i.product_id = p_product and j.status <> 'cancelled' and j.in_date >= current_date - 90
  )
  select case when pc.amt = 0 then 0 else round(pc.amt::numeric / greatest(made.u, pc.q, 1))::bigint end from pc, made;
$$;

create or replace function prd_cost_core(p_product uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s prd_cost_settings; p lab_products; v_mat bigint; v_lab bigint; v_min int; v_prod bigint; v_rem bigint; v_mkt bigint; v_adm bigint; v_fin bigint; v_total bigint; v_price bigint; v_price_eur_try bigint;
  v_mlines jsonb; v_llines jsonb; v_piece bigint := 0;
begin
  select * into s from prd_cost_settings where company_id = lab_company();
  if s.company_id is null then s.labor_rate_min := 600; s.overhead_per_unit := 20000; s.remake_pct := 4; s.marketing_pct := 7; s.admin_pct := 10; s.finance_pct := 2; end if;
  select * into p from lab_products where id = p_product;
  if p.id is null then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bom_id', b.id, 'item_id', i.id, 'code', i.code, 'name', i.name, 'unit', i.unit, 'qty', b.qty, 'waste_pct', b.waste_pct,
           'unit_cost', stk_avg_cost(i.id), 'purchase_price', i.purchase_price, 'currency', i.purchase_currency,
           'cost', round(b.qty * (1 + b.waste_pct / 100) * stk_avg_cost(i.id))::bigint, 'note', b.note) order by i.code), '[]'),
         coalesce(sum(round(b.qty * (1 + b.waste_pct / 100) * stk_avg_cost(i.id))), 0)::bigint
    into v_mlines, v_mat
    from stk_boms b join stk_items i on i.id = b.item_id where b.lab_product_id = p_product;
  select coalesce(jsonb_agg(jsonb_build_object('step_id', r.id, 'station_id', st.id, 'station', st.name, 'minutes', coalesce(r.std_minutes, 0),
           'rate', coalesce(st.labor_rate_min, s.labor_rate_min), 'own_rate', st.labor_rate_min is not null,
           'cost', coalesce(r.std_minutes, 0) * coalesce(st.labor_rate_min, s.labor_rate_min)) order by r.sort, st.sort), '[]'),
         coalesce(sum(coalesce(r.std_minutes, 0) * coalesce(st.labor_rate_min, s.labor_rate_min)), 0)::bigint, coalesce(sum(r.std_minutes), 0)::int
    into v_llines, v_lab, v_min
    from prd_route_steps r join prd_stations st on st.id = r.station_id where r.lab_product_id = p_product;
  begin v_piece := coalesce(pc_unit_cost(p_product), 0); exception when others then v_piece := 0; end;
  v_prod := v_mat + v_lab + v_piece + s.overhead_per_unit;
  v_rem := round((v_mat + v_lab + v_piece) * s.remake_pct / 100);
  v_prod := v_prod + v_rem;
  v_mkt := round(v_prod * s.marketing_pct / 100);
  v_adm := round(v_prod * s.admin_pct / 100);
  v_fin := round(v_prod * s.finance_pct / 100);
  v_total := v_prod + v_mkt + v_adm + v_fin;
  v_price := p.price_try;
  v_price_eur_try := case when p.price_eur is not null then round(p.price_eur * fx_rate('EUR', current_date)) end;
  return jsonb_build_object(
    'product', jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'material', p.material, 'price_try', p.price_try, 'price_eur', p.price_eur, 'per_unit', p.per_unit),
    'settings', to_jsonb(s) - 'company_id' - 'updated_by',
    'materials', v_mlines, 'labor', v_llines, 'minutes', v_min,
    'material', v_mat, 'labor_total', v_lab, 'piece', v_piece, 'overhead', s.overhead_per_unit, 'remake', v_rem, 'production', v_prod,
    'marketing', v_mkt, 'admin', v_adm, 'finance', v_fin, 'total', v_total,
    'price_try', v_price, 'price_eur_try', v_price_eur_try, 'eur_rate', fx_rate('EUR', current_date),
    'margin_try', case when v_price > 0 then round(100.0 * (v_price - v_total) / v_price, 1) end,
    'margin_eur', case when v_price_eur_try > 0 then round(100.0 * (v_price_eur_try - v_total) / v_price_eur_try, 1) end,
    'missing_prices', (select count(*) from stk_boms b where b.lab_product_id = p_product and stk_avg_cost(b.item_id) = 0));
end $$;
revoke execute on function prd_cost_core(uuid) from public, anon, authenticated;

drop trigger if exists audit_pc_entries on pc_entries;
create trigger audit_pc_entries after insert or update or delete on pc_entries for each row execute function audit_trigger();

notify pgrst, 'reload schema';
