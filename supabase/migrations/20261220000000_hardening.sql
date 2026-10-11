-- =====================================================================
-- SIKILAŞTIRMA (gözden geçirme bulguları)
--  - can_logistics(): rol yerine "lab" modül seviyesi (kullanıcı türüyle uyumlu)
--  - lab_payments: doğrudan yazma kapalı; ekleme / silme fonksiyonla
--  - user_type_role: bordro "düzenler" (2+) muhasebe erişimi verir; İSG öncelikli
--  - Tür / atama: web sitesi ve patron ekranı yalnız sahip; davetle kendine tür yok; var olan üyede yetki kontrolü
--  - set_module_levels: "varsayılana dön" (null) yalnız sahip
--  - İç hesap aç / kapa: resmi bakiye kesintisiz kalsın (açılış düzeltmesi)
--  - Ciro tutarları yalnız satış / finans yetkisine
--  - Satın alma: kuru olmayan dövizde onay atlanmaz; iptal edilen faturadan sonra yeniden faturalanır
-- Tekrar çalıştırılabilir. Önce 20261219000000_ai.sql.
-- =====================================================================

-- 1) Laboratuvar erişimi = lab modülü
create or replace function can_logistics() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') or module_level_for(auth.uid(), 'lab') >= 1;
$$;

-- 2) Tahsilat kayıtları: okuma lab, yazma fonksiyonla
drop policy if exists lab_payments_lab on lab_payments;
drop policy if exists lab_payments_read on lab_payments;
create policy lab_payments_read on lab_payments for select to authenticated using (can_logistics() or can_module('finance'));
revoke insert, update, delete on lab_payments from authenticated;

create or replace function lab_payment_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p lab_payments;
begin
  if not (can_module('finance', 2) or module_level('lab') >= 3) then raise exception 'not_allowed'; end if;
  select * into p from lab_payments where id = p_id;
  if p.id is null then return; end if;
  if p.fin_txn_id is not null then raise exception 'void_in_finance'; end if;
  delete from lab_payments where id = p_id;
end $$;
grant execute on function lab_payment_delete(uuid) to authenticated;

-- 3) Temel erişim
create or replace function user_type_role(p_levels jsonb, p_scoped boolean) returns app_role language sql immutable as $$
  select case
    when coalesce((p_levels->>'payroll')::int, 0) >= 2 then 'accountant'
    when coalesce((p_levels->>'hr')::int, 0) >= 2 or coalesce((p_levels->>'attendance')::int, 0) >= 2 then case when p_scoped then 'branch_manager' else 'hr' end
    when coalesce((p_levels->>'safety')::int, 0) >= 1 then 'safety'
    when coalesce((p_levels->>'hr')::int, 0) >= 1 or coalesce((p_levels->>'attendance')::int, 0) >= 1 then case when p_scoped then 'branch_manager' else 'hr' end
    else 'employee' end::app_role;
$$;

-- Atama kontrolü + bayraklar (web sitesi, patron ekranı yalnız sahip)
create or replace function user_type_flags_ok(p_actor uuid, p_type uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships where user_id = p_actor and role = 'owner')
      or not exists (select 1 from user_types where id = p_type and (site_access or boss));
$$;
revoke execute on function user_type_flags_ok(uuid, uuid) from public, anon, authenticated;

create or replace function user_type_assign(p_user uuid, p_type uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); t user_types; v_err text;
begin
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  if not exists (select 1 from memberships where user_id = p_user and company_id = v_company) then raise exception 'not_found'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(t.levels), p_user);
  if v_err is not null then raise exception '%', v_err; end if;
  if not user_type_flags_ok(auth.uid(), p_type) then raise exception 'above_own:users'; end if;
  perform user_type_apply_sys(v_company, p_user, p_type);
end $$;

create or replace function user_invite_create(p_type uuid, p_employee uuid, p_name text, p_login text, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); t user_types; v_err text;
begin
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(t.levels), null);
  if v_err is not null then raise exception '%', v_err; end if;
  if not user_type_flags_ok(auth.uid(), p_type) then raise exception 'above_own:users'; end if;
  if p_employee is not null and not exists (select 1 from employees where id = p_employee and company_id = v_company) then raise exception 'not_found'; end if;
  insert into invites (company_id, code, role, employee_id, display_name, login_email, all_branches, user_type_id)
  values (v_company, p_code, user_type_role(t.levels, t.scoped), p_employee, p_name, lower(p_login), not t.scoped, t.id);
end $$;

create or replace function admin_attach_account(p_actor uuid, p_user uuid, p_employee uuid, p_type uuid, p_name text) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid; t user_types; v_err text; v_role app_role; v_exists boolean;
begin
  select company_id into v_company from memberships where user_id = p_actor order by created_at limit 1;
  if v_company is null then raise exception 'not_allowed'; end if;
  select * into t from user_types where id = p_type and company_id = v_company;
  if t.id is null then raise exception 'type_not_found'; end if;
  v_exists := exists (select 1 from memberships where user_id = p_user and company_id = v_company);
  v_err := user_type_can_assign(p_actor, user_type_clean(t.levels), case when v_exists then p_user end);
  if v_err is not null then raise exception '%', v_err; end if;
  if not user_type_flags_ok(p_actor, p_type) then raise exception 'above_own:users'; end if;
  if exists (select 1 from memberships where user_id = p_user and company_id <> v_company) then raise exception 'other_company'; end if;
  if p_employee is not null then
    if not exists (select 1 from employees where id = p_employee and company_id = v_company) then raise exception 'not_found'; end if;
    if exists (select 1 from employees where id = p_employee and user_id is not null and user_id <> p_user) then raise exception 'employee_linked'; end if;
  end if;
  v_role := user_type_role(t.levels, t.scoped);
  if not v_exists then
    insert into memberships (user_id, company_id, role, all_branches, display_name) values (p_user, v_company, v_role, not t.scoped, p_name);
  end if;
  if p_employee is not null then
    perform set_config('mb.allow_user_link', 'on', true);
    update employees set user_id = p_user where id = p_employee;
    perform set_config('mb.allow_user_link', 'off', true);
  end if;
  perform user_type_apply_sys(v_company, p_user, t.id);
end $$;
revoke execute on function admin_attach_account(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function admin_attach_account(uuid, uuid, uuid, uuid, text) to service_role; end if; end $$;

-- Tür kaydet: web sitesi / patron ekranı bayrağı yalnız sahip
create or replace function user_type_save(p_id uuid, p_name text, p_description text, p_color text, p_levels jsonb, p_scoped boolean, p_site boolean, p_boss boolean, p_flow_role text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); v_id uuid; v_levels jsonb := user_type_clean(p_levels); v_err text; u uuid; v_old jsonb; v_owner boolean;
begin
  if module_level('users') < 3 then raise exception 'not_allowed'; end if;
  v_owner := exists (select 1 from memberships where user_id = auth.uid() and role = 'owner');
  if not v_owner and (coalesce(p_site, false) or coalesce(p_boss, false)) then raise exception 'above_own:users'; end if;
  v_err := user_type_can_assign(auth.uid(), v_levels, null);
  if v_err is not null then raise exception '%', v_err; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'name_required'; end if;
  if p_flow_role is not null and p_flow_role not in ('technician', 'chief', 'qc', 'dispatch') then p_flow_role := null; end if;
  if p_id is null then
    insert into user_types (company_id, name, description, color, levels, scoped, site_access, boss, flow_role, sort)
    values (v_company, trim(p_name), nullif(trim(p_description), ''), coalesce(nullif(p_color, ''), '#0A3D73'), v_levels, coalesce(p_scoped, false), coalesce(p_site, false), coalesce(p_boss, false), p_flow_role,
            coalesce((select max(sort) + 10 from user_types where company_id = v_company), 10))
    returning id into v_id;
  else
    if not v_owner and exists (select 1 from user_types where id = p_id and (site_access or boss)) then raise exception 'above_own:users'; end if;
    select user_type_clean(levels) into v_old from user_types where id = p_id and company_id = v_company;
    update user_types set name = trim(p_name), description = nullif(trim(p_description), ''), color = coalesce(nullif(p_color, ''), color), levels = v_levels,
      scoped = coalesce(p_scoped, false), site_access = coalesce(p_site, false), boss = coalesce(p_boss, false), flow_role = p_flow_role, updated_at = now()
    where id = p_id and company_id = v_company returning id into v_id;
    if v_id is null then raise exception 'type_not_found'; end if;
    for u in select user_id from memberships where user_type_id = v_id and company_id = v_company and role <> 'owner' and user_id <> auth.uid() loop
      perform user_type_apply_sys(v_company, u, v_id, v_old);
    end loop;
  end if;
  return v_id;
exception when unique_violation then raise exception 'name_taken';
end $$;

-- "Varsayılana dön" (null) yalnız sahip
create or replace function set_module_levels(p_user uuid, p_levels jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_role text; k text; v jsonb; v_err text; v_owner boolean;
begin
  select m.company_id, m.role::text into v_company, v_role from memberships m where m.user_id = p_user and m.company_id = my_company() limit 1;
  if v_company is null then raise exception 'not_found'; end if;
  if v_role = 'owner' then raise exception 'owner_full'; end if;
  v_owner := exists (select 1 from memberships where user_id = auth.uid() and role = 'owner');
  if not v_owner and exists (select 1 from jsonb_each(p_levels) e where jsonb_typeof(e.value) = 'null') then raise exception 'not_allowed'; end if;
  v_err := user_type_can_assign(auth.uid(), user_type_clean(coalesce((select jsonb_object_agg(key, value) from jsonb_each(p_levels) where jsonb_typeof(value) = 'number'), '{}'::jsonb)), case when p_user = auth.uid() then null else p_user end);
  if v_err is not null then raise exception '%', v_err; end if;
  if module_level('users') < 2 then raise exception 'not_allowed'; end if;
  if p_user = auth.uid() and p_levels ? 'users' and (jsonb_typeof(p_levels->'users') = 'null' or (p_levels->>'users')::int < 3) then raise exception 'self_lockout'; end if;
  for k, v in select * from jsonb_each(p_levels) loop
    if not (k = any (all_modules())) then continue; end if;
    if v is null or jsonb_typeof(v) = 'null' then
      delete from module_permissions where company_id = v_company and user_id = p_user and module = k;
    else
      insert into module_permissions (company_id, user_id, module, level, updated_at, updated_by)
      values (v_company, p_user, k, least(greatest((v #>> '{}')::int, 0), 3), now(), auth.uid())
      on conflict (company_id, user_id, module) do update set level = excluded.level, updated_at = now(), updated_by = auth.uid();
    end if;
  end loop;
end $$;

-- Kapsam: sahip olmayan, kendinde olmayan "tüm şubeler" yetkisini veremez
create or replace function user_set_scope(p_user uuid, p_name text, p_all boolean, p_branches uuid[], p_departments uuid[]) returns void
language plpgsql security definer set search_path = public as $$
declare v_company uuid := my_company(); v_err text; v_owner boolean;
begin
  v_owner := exists (select 1 from memberships where user_id = auth.uid() and company_id = v_company and role = 'owner');
  if not v_owner then
    v_err := user_type_can_assign(auth.uid(), '{}'::jsonb, p_user);
    if v_err is not null then raise exception '%', v_err; end if;
    if coalesce(p_all, false) and not exists (select 1 from memberships where user_id = auth.uid() and company_id = v_company and all_branches) then raise exception 'above_own:users'; end if;
  end if;
  if not coalesce(p_all, false) and coalesce(array_length(p_branches, 1), 0) = 0 then raise exception 'branch_required'; end if;
  update memberships set display_name = nullif(trim(p_name), ''), all_branches = coalesce(p_all, false) where user_id = p_user and company_id = v_company;
  delete from membership_branches where user_id = p_user and company_id = v_company;
  if not coalesce(p_all, false) then
    insert into membership_branches (user_id, company_id, branch_id) select p_user, v_company, b from unnest(p_branches) b where b in (select id from branches where company_id = v_company);
  end if;
  if to_regclass('public.membership_departments') is not null then
    delete from membership_departments where user_id = p_user and company_id = v_company;
    insert into membership_departments (user_id, company_id, department_id) select p_user, v_company, d from unnest(coalesce(p_departments, '{}')) d where d in (select id from departments where company_id = v_company);
  end if;
end $$;

-- Davet: kendi oluşturduğu türlü daveti kendisi kullanamaz
create or replace function claim_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare inv invites; name text; emp employees; cur memberships;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapın'; end if;
  if not invite_rate_ok('claim:' || auth.uid()) then
    return json_build_object('error', 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
  end if;
  select * into inv from invites where code = invite_norm(p_code) for update;
  if inv.id is null or (inv.used_at is not null and inv.used_by is distinct from auth.uid()) or inv.expires_at < now() then
    return json_build_object('error', 'Davet kodu geçersiz, kullanılmış ya da süresi dolmuş.');
  end if;
  if inv.user_type_id is not null and inv.created_by = auth.uid() then
    return json_build_object('error', 'Kendi oluşturduğunuz davet kodunu kullanamazsınız.');
  end if;
  if inv.employee_id is not null then
    select * into emp from employees where id = inv.employee_id;
    if emp.id is null or emp.company_id <> inv.company_id then raise exception 'Davet geçersiz'; end if;
    if emp.user_id is not null and emp.user_id <> auth.uid() then
      raise exception 'Bu personel kaydı başka bir hesaba bağlı. Yöneticinizle görüşün.';
    end if;
  end if;
  select * into cur from memberships where user_id = auth.uid() and company_id = inv.company_id;
  if cur.user_id is not null and cur.role <> inv.role and inv.user_type_id is null then
    raise exception 'Bu hesap şirkete zaten farklı bir rolle bağlı.';
  end if;
  name := coalesce(inv.display_name, emp.first_name || ' ' || emp.last_name);
  if cur.user_id is null then
    insert into memberships (user_id, company_id, role, all_branches, display_name)
    values (auth.uid(), inv.company_id, inv.role, inv.all_branches or inv.role in ('owner', 'accountant', 'hr', 'safety'), name);
  end if;
  if inv.employee_id is not null then
    perform set_config('mb.allow_user_link', 'on', true);
    update employees set user_id = auth.uid() where id = inv.employee_id;
    perform set_config('mb.allow_user_link', 'off', true);
  end if;
  if inv.user_type_id is not null and coalesce(cur.role::text, '') <> 'owner' then
    perform user_type_apply_sys(inv.company_id, auth.uid(), inv.user_type_id);
  end if;
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return json_build_object('company_id', inv.company_id, 'role', inv.role);
end $$;

-- Mevcut türlü kullanıcılara yeni temel erişim kuralını uygula (kişiye özel istisnalar korunur)
do $$ declare r record; begin
  for r in select m.company_id, m.user_id, m.user_type_id from memberships m where m.user_type_id is not null and m.role <> 'owner' loop
    perform user_type_apply_sys(r.company_id, r.user_id, r.user_type_id, (select user_type_clean(levels) from user_types where id = r.user_type_id));
  end loop;
end $$;

-- 4) İç hesap aç / kapa: resmi bakiye o an değişmesin (açılış düzeltmesi)
create or replace function lab_customer_set_book(p_customer uuid, p_on boolean, p_pay_book text, p_lang text, p_opening bigint, p_opening_date date) returns void
language plpgsql security definer set search_path = public as $$
declare c lab_customers; v_before bigint; v_after bigint;
begin
  if not (can_logistics() and (can_module('sales', 2) or can_module('finance', 2) or can_module('lab', 3))) then raise exception 'not_allowed'; end if;
  select * into c from lab_customers where id = p_customer for update;
  if c.id is null then raise exception 'not_found'; end if;
  select balance into v_before from fin_party_balances where lab_customer_id = p_customer limit 1;
  if coalesce(p_on, false) and not c.internal_book then
    update lab_payments set book = 'both' where customer_id = p_customer and book = 'official';
  end if;
  update lab_customers set internal_book = coalesce(p_on, false),
    pay_book = case when p_pay_book in ('official', 'internal', 'both') then p_pay_book else pay_book end,
    doc_lang = case when p_lang in ('tr', 'en', 'fr') then p_lang else doc_lang end,
    internal_opening = coalesce(p_opening, internal_opening), internal_opening_date = coalesce(p_opening_date, internal_opening_date),
    updated_at = now()
  where id = p_customer;
  if coalesce(p_on, false) is distinct from c.internal_book then
    select balance into v_after from fin_party_balances where lab_customer_id = p_customer limit 1;
    if v_before is not null and v_after is not null and v_before <> v_after then
      update fin_parties set opening_balance = opening_balance + (v_before - v_after) where lab_customer_id = p_customer;
    end if;
  end if;
end $$;

-- Finans tahsilatı: hesap belirtilmezse iç hesap kullanan müşteride kartın varsayılanı
create or replace function fin_collect_or_pay(
  p_kind text, p_party uuid, p_account uuid, p_date date, p_amount bigint, p_party_amount bigint,
  p_rate numeric, p_description text, p_doc_no text, p_method text default null, p_book text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare a fin_accounts; pt fin_parties; v_txn uuid; v_lp uuid; s int; v_book text; v_pb text;
begin
  if p_kind not in ('collection', 'payment') then raise exception 'bad_kind'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'amount'; end if;
  select * into a from fin_accounts where id = p_account;
  select * into pt from fin_parties where id = p_party;
  if a.id is null or pt.id is null then raise exception 'not_found'; end if;
  s := case when p_kind = 'collection' then 1 else -1 end;
  select case when internal_book then pay_book end into v_pb from lab_customers where id = pt.lab_customer_id;
  v_book := case when p_book in ('official', 'both') then p_book when v_pb in ('both', 'internal') then 'both' else 'official' end;
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

-- Faturalanmış irsaliyede iş tutarı değişirse fatura toplamı da güncellensin
create or replace function lab_waybill_recalc(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_st uuid;
begin
  update lab_waybills w set
    job_count = coalesce(s.n, 0), total = coalesce(s.total, 0), unit_count = coalesce(s.units, 0)
  from (select count(*) n, sum(j.total) total,
               sum((select coalesce(sum(i.qty), 0) from job_items i where i.job_id = j.id and i.amount > 0)) units
        from jobs j where j.waybill_id = p_id) s
  where w.id = p_id
  returning w.statement_id into v_st;
  if v_st is not null then
    update lab_statements s set job_count = x.n, total = x.t, unit_count = x.u
    from (select coalesce(sum(job_count), 0) n, coalesce(sum(total), 0) t, coalesce(sum(unit_count), 0) u from lab_waybills where statement_id = v_st) x where s.id = v_st;
  end if;
end $$;

-- 5) Satın alma: kuru olmayan döviz onaya düşer; iptal edilen faturadan sonra yeniden faturalanır
create or replace function pur_order_submit(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_limit bigint; v_norate boolean;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status <> 'draft' then raise exception 'po_locked'; end if;
  select approval_limit into v_limit from pur_settings where company_id = o.company_id;
  v_norate := o.currency <> 'TRY' and fx_rate(o.currency, o.order_date) is null;
  if can_module('purchases', 3) or (coalesce(v_limit, 0) = 0) or (not v_norate and o.total_try <= v_limit) then
    update pur_orders set status = 'approved', submitted_at = now(), approved_by = auth.uid(), approved_at = now() where id = p_id;
    return 'approved';
  end if;
  update pur_orders set status = 'pending', submitted_at = now() where id = p_id;
  return 'pending';
end $$;

create or replace function pur_order_to_invoice(p_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_inv uuid; v_lines jsonb;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null then raise exception 'po_not_open'; end if;
  if o.invoice_id is not null and exists (select 1 from inv_invoices where id = o.invoice_id and status <> 'cancelled') then return o.invoice_id; end if;
  if o.status not in ('approved', 'sent', 'partial', 'received', 'invoiced') then raise exception 'po_not_open'; end if;
  select jsonb_agg(jsonb_build_object('item_id', item_id, 'name', name, 'qty', case when received_qty > 0 then received_qty else qty end, 'unit', unit,
                                      'unit_price', round(unit_price / 100.0, 4), 'vat_rate', vat_rate) order by sort)
  into v_lines from pur_order_lines where order_id = p_id;
  v_inv := inv_save(jsonb_build_object('direction', 'purchase', 'party_id', o.party_id, 'invoice_date', current_date, 'currency', o.currency,
                                      'warehouse_id', o.warehouse_id, 'note', 'Satın alma siparişi SA-' || o.year || '-' || lpad(o.no::text, 4, '0'), 'lines', v_lines));
  update pur_orders set invoice_id = v_inv, status = 'invoiced' where id = p_id;
  return v_inv;
end $$;

-- 6) Ciro tutarları yalnız satış / finans yetkisine (akıştaki teknisyen görmesin)
create or replace function kpi_monthly(p_months int default 12) returns table (
  month date, revenue_try bigint, jobs int, units numeric, on_time numeric, remakes int, remake_rate numeric, avg_days numeric, new_jobs int, clinics int
) language sql stable security definer set search_path = public as $$
  with m as (select generate_series(date_trunc('month', current_date) - ((least(greatest(p_months, 1), 36) - 1) || ' months')::interval, date_trunc('month', current_date), interval '1 month')::date m),
  d as (
    select date_trunc('month', lab_day(j.delivered_at))::date m, j.*,
      round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, lab_day(j.delivered_at)), 1) end)::bigint rev
    from jobs j where j.status = 'delivered' and j.delivered_at >= date_trunc('month', current_date) - ((least(greatest(p_months, 1), 36)) || ' months')::interval
  )
  select m.m,
    case when can_module('sales') or can_module('finance') then coalesce((select sum(rev) from d where d.m = m.m), 0) else 0 end::bigint,
    (select count(*) from d where d.m = m.m)::int,
    coalesce((select sum(job_units(d.id)) from d where d.m = m.m), 0),
    (select round(100.0 * count(*) filter (where d.due_date is null or lab_day(d.delivered_at) <= d.due_date) / nullif(count(*), 0), 1) from d where d.m = m.m),
    (select count(*) from prd_remakes r where date_trunc('month', r.created_at at time zone 'Europe/Istanbul')::date = m.m)::int,
    (select round(100.0 * (select count(*) from prd_remakes r where date_trunc('month', r.created_at at time zone 'Europe/Istanbul')::date = m.m) / nullif(count(*), 0), 1) from d where d.m = m.m),
    (select round(avg(lab_day(d.delivered_at) - d.in_date), 1) from d where d.m = m.m),
    (select count(*) from jobs j where date_trunc('month', j.in_date)::date = m.m and j.status <> 'cancelled')::int,
    (select count(distinct customer_id) from d where d.m = m.m)::int
  from m
  where can_module('sales') or can_module('finance') or can_module('production', 3)
  order by m.m;
$$;

notify pgrst, 'reload schema';
