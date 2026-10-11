-- =====================================================================
-- ONAY AKIŞI TASARIMCISI (masraf beyanı ve satın alma siparişi)
--  apr_flows       : kural (tür, tutar aralığı TL, masraf kategorisi, öncelik)
--  apr_flow_steps  : sıralı adımlar: belirli kullanıcı / modül yetkilisi / personelin yöneticisi / şirket sahibi
--  apr_requests    : belge için başlatılan onay (şu anki adım, durum)
--  apr_actions     : onay / ret geçmişi
--  apr_start / apr_decide / apr_cleared / apr_inbox
--  Masraf: beyan girilince uygun akış başlar; akış bitmeden finans kaydı yapılamaz, retle beyan reddedilir
--  Satın alma: sipariş onaya gönderilince uygun akış varsa o işler (yoksa eski tutar sınırı)
-- Tekrar çalıştırılabilir. Önce 20261225000000_bank_recon.sql.
-- =====================================================================

create table if not exists apr_flows (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  entity text not null check (entity in ('expense_claim', 'purchase_order')),
  name text not null check (length(name) between 1 and 80),
  min_amount bigint not null default 0 check (min_amount >= 0),   -- TL kuruş
  max_amount bigint check (max_amount is null or max_amount > 0),
  category_id uuid references fin_categories (id) on delete set null,
  priority int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists apr_flow_steps (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references apr_flows (id) on delete cascade,
  sort int not null default 1,
  approver_kind text not null check (approver_kind in ('user', 'module', 'manager', 'owner')),
  user_id uuid references auth.users (id) on delete cascade,
  module text,
  level int check (level is null or level between 1 and 3),
  label text check (label is null or length(label) <= 80)
);
create index if not exists apr_flow_steps_idx on apr_flow_steps (flow_id, sort);

create table if not exists apr_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies (id) on delete cascade default lab_company(),
  entity text not null,
  entity_id uuid not null,
  flow_id uuid references apr_flows (id) on delete set null,
  employee_id uuid,
  step int not null default 1,
  steps int not null default 1,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  amount bigint not null default 0,
  title text,
  link text,
  requested_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index if not exists apr_requests_open_uidx on apr_requests (entity, entity_id) where status = 'pending';
create index if not exists apr_requests_entity_idx on apr_requests (entity, entity_id, created_at desc);

create table if not exists apr_actions (
  id bigint generated always as identity primary key,
  request_id uuid not null references apr_requests (id) on delete cascade,
  step int not null,
  decision text not null check (decision in ('approve', 'reject')),
  note text check (note is null or length(note) <= 500),
  user_id uuid default auth.uid(),
  at timestamptz not null default now()
);

alter table apr_flows enable row level security;
alter table apr_flow_steps enable row level security;
alter table apr_requests enable row level security;
alter table apr_actions enable row level security;
create or replace function apr_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') or can_module('users', 2);
$$;
drop policy if exists apr_flows_read on apr_flows;
create policy apr_flows_read on apr_flows for select to authenticated using (apr_admin() or can_module('expenses', 2) or can_module('purchases', 2));
drop policy if exists apr_flow_steps_read on apr_flow_steps;
create policy apr_flow_steps_read on apr_flow_steps for select to authenticated using (apr_admin() or can_module('expenses', 2) or can_module('purchases', 2));
grant select on apr_flows, apr_flow_steps to authenticated;

-- Adımın onaylayıcıları
create or replace function apr_step_users(p_request uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select case st.approver_kind when 'user' then st.user_id end u
    from apr_requests r join apr_flow_steps st on st.flow_id = r.flow_id
    where r.id = p_request and st.sort = (select sort from apr_flow_steps x where x.flow_id = r.flow_id order by sort offset r.step - 1 limit 1)
      and st.approver_kind = 'user'
    union all
    select m.user_id from apr_requests r join apr_flow_steps st on st.flow_id = r.flow_id join memberships m on m.company_id = r.company_id
    where r.id = p_request and st.sort = (select sort from apr_flow_steps x where x.flow_id = r.flow_id order by sort offset r.step - 1 limit 1)
      and ((st.approver_kind = 'owner' and m.role = 'owner')
        or (st.approver_kind = 'module' and module_level_for(m.user_id, st.module) >= coalesce(st.level, 2)))
    union all
    select unnest(managers_for_employee(r.employee_id, array['owner']::app_role[]))
    from apr_requests r join apr_flow_steps st on st.flow_id = r.flow_id
    where r.id = p_request and r.employee_id is not null and st.approver_kind = 'manager'
      and st.sort = (select sort from apr_flow_steps x where x.flow_id = r.flow_id order by sort offset r.step - 1 limit 1)
  ) z where u is not null;
$$;
revoke execute on function apr_step_users(uuid) from public, anon, authenticated;

-- Talep okuma: talep eden, adımdaki onaylayıcı, geçmişte işlem yapan, yönetici, ilgili modül yetkilisi
drop policy if exists apr_requests_read on apr_requests;
create policy apr_requests_read on apr_requests for select to authenticated using (
  requested_by = auth.uid() or apr_admin()
  or (entity = 'expense_claim' and can_module('expenses', 1)) or (entity = 'purchase_order' and can_module('purchases', 1))
  or (status = 'pending' and auth.uid() = any (apr_step_users(apr_requests.id)))
  or exists (select 1 from apr_actions a where a.request_id = apr_requests.id and a.user_id = auth.uid()));
drop policy if exists apr_actions_read on apr_actions;
create policy apr_actions_read on apr_actions for select to authenticated using (exists (select 1 from apr_requests r where r.id = request_id));
grant select on apr_requests, apr_actions to authenticated;

create or replace function apr_notify(p_request uuid) returns void
language plpgsql security definer set search_path = public as $$
declare r apr_requests; v_label text;
begin
  select * into r from apr_requests where id = p_request;
  select coalesce(label, '') into v_label from apr_flow_steps where flow_id = r.flow_id order by sort offset r.step - 1 limit 1;
  perform deliver(r.company_id, apr_step_users(p_request), 'Onayınız bekleniyor', coalesce(r.title, '') || ' · adım ' || r.step || '/' || r.steps || case when v_label <> '' then ' (' || v_label || ')' else '' end, '/onaylar');
exception when others then null;
end $$;
revoke execute on function apr_notify(uuid) from public, anon, authenticated;

-- Başlat: uygun akış yoksa null
create or replace function apr_start(p_entity text, p_id uuid, p_amount bigint, p_category uuid, p_employee uuid, p_title text, p_link text) returns uuid
language plpgsql security definer set search_path = public as $$
declare f apr_flows; v_id uuid; v_steps int;
begin
  select * into f from apr_flows
  where company_id = lab_company() and entity = p_entity and is_active
    and coalesce(p_amount, 0) >= min_amount and (max_amount is null or coalesce(p_amount, 0) <= max_amount)
    and (category_id is null or category_id = p_category)
    and exists (select 1 from apr_flow_steps s where s.flow_id = apr_flows.id)
  order by priority desc, (category_id is not null) desc, min_amount desc limit 1;
  if f.id is null then return null; end if;
  select count(*) into v_steps from apr_flow_steps where flow_id = f.id;
  update apr_requests set status = 'cancelled', decided_at = now() where entity = p_entity and entity_id = p_id and status = 'pending';
  insert into apr_requests (company_id, entity, entity_id, flow_id, employee_id, step, steps, amount, title, link)
  values (f.company_id, p_entity, p_id, f.id, p_employee, 1, v_steps, coalesce(p_amount, 0), left(p_title, 200), left(p_link, 200))
  returning id into v_id;
  perform apr_notify(v_id);
  return v_id;
end $$;
revoke execute on function apr_start(text, uuid, bigint, uuid, uuid, text, text) from public, anon, authenticated;

create or replace function apr_cleared(p_entity text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from apr_requests where entity = p_entity and entity_id = p_id and status in ('pending', 'rejected')
                     and created_at = (select max(created_at) from apr_requests x where x.entity = p_entity and x.entity_id = p_id));
$$;
grant execute on function apr_cleared(text, uuid) to authenticated;

create or replace function apr_decide(p_request uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r apr_requests;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'bad_decision'; end if;
  select * into r from apr_requests where id = p_request for update;
  if r.id is null or r.status <> 'pending' then raise exception 'not_pending'; end if;
  if not (auth.uid() = any (apr_step_users(r.id))) then raise exception 'not_allowed'; end if;
  if r.requested_by = auth.uid() and not exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') then raise exception 'own_request'; end if;
  if p_decision = 'reject' and nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'note_required'; end if;
  insert into apr_actions (request_id, step, decision, note) values (r.id, r.step, p_decision, nullif(left(trim(coalesce(p_note, '')), 500), ''));
  if p_decision = 'reject' then
    update apr_requests set status = 'rejected', decided_at = now() where id = r.id;
    if r.entity = 'expense_claim' then
      update exp_claims set status = 'rejected', decided_by = auth.uid(), decided_at = now(), reject_reason = left('Onay akışında reddedildi: ' || coalesce(p_note, ''), 300) where id = r.entity_id and status = 'submitted';
    elsif r.entity = 'purchase_order' then
      update pur_orders set status = 'draft', reject_reason = left(coalesce(p_note, ''), 300) where id = r.entity_id and status = 'pending';
    end if;
    perform deliver(r.company_id, array[r.requested_by], 'Onay reddedildi', coalesce(r.title, '') || ' · ' || left(coalesce(p_note, ''), 140), coalesce(r.link, '/onaylar'));
    return 'rejected';
  end if;
  if r.step < r.steps then
    update apr_requests set step = step + 1 where id = r.id;
    perform apr_notify(r.id);
    return 'next';
  end if;
  update apr_requests set status = 'approved', decided_at = now() where id = r.id;
  if r.entity = 'purchase_order' then
    update pur_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = r.entity_id and status = 'pending';
  elsif r.entity = 'expense_claim' then
    perform deliver(r.company_id, module_recipients('expenses', 2), 'Masraf onaylandı, kayıt bekliyor', coalesce(r.title, ''), '/masraf');
  end if;
  perform deliver(r.company_id, array[r.requested_by], 'Onaylandı', coalesce(r.title, ''), coalesce(r.link, '/onaylar'));
  return 'approved';
end $$;
revoke execute on function apr_decide(uuid, text, text) from public, anon;
grant execute on function apr_decide(uuid, text, text) to authenticated;

-- Onay kutusu: bana düşenler
create or replace function apr_inbox() returns table (id uuid, entity text, entity_id uuid, title text, link text, amount bigint, step int, steps int, step_label text, requested_by_name text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.entity, r.entity_id, r.title, r.link, r.amount, r.step, r.steps,
    (select coalesce(s.label, case s.approver_kind when 'manager' then 'Yönetici' when 'owner' then 'Şirket sahibi' when 'module' then s.module else 'Kullanıcı' end) from apr_flow_steps s where s.flow_id = r.flow_id order by s.sort offset r.step - 1 limit 1),
    coalesce((select e.first_name || ' ' || e.last_name from employees e where e.user_id = r.requested_by limit 1), (select u.email from auth.users u where u.id = r.requested_by)),
    r.created_at
  from apr_requests r
  where r.status = 'pending' and auth.uid() = any (apr_step_users(r.id))
  order by r.created_at;
$$;
revoke execute on function apr_inbox() from public, anon;
grant execute on function apr_inbox() to authenticated;

-- Akış kaydet: p = {id, entity, name, min_amount, max_amount, category_id, priority, is_active, steps:[{approver_kind,user_id,module,level,label}]}
create or replace function apr_flow_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; s jsonb; i int := 0;
begin
  if not apr_admin() then raise exception 'not_allowed'; end if;
  if coalesce((p->>'delete')::boolean, false) then delete from apr_flows where id = v_id; return v_id; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'name_required'; end if;
  if p->>'entity' not in ('expense_claim', 'purchase_order') then raise exception 'bad_entity'; end if;
  if v_id is null then insert into apr_flows (entity, name) values (p->>'entity', 'x') returning id into v_id; end if;
  update apr_flows set entity = p->>'entity', name = left(trim(p->>'name'), 80),
    min_amount = greatest(0, coalesce(nullif(p->>'min_amount', '')::bigint, 0)), max_amount = nullif(p->>'max_amount', '')::bigint,
    category_id = nullif(p->>'category_id', '')::uuid, priority = coalesce(nullif(p->>'priority', '')::int, 0), is_active = coalesce((p->>'is_active')::boolean, true)
  where id = v_id;
  delete from apr_flow_steps where flow_id = v_id;
  for s in select * from jsonb_array_elements(coalesce(p->'steps', '[]'::jsonb)) loop
    if s->>'approver_kind' not in ('user', 'module', 'manager', 'owner') then continue; end if;
    if s->>'approver_kind' = 'user' and nullif(s->>'user_id', '') is null then continue; end if;
    if s->>'approver_kind' = 'module' and not (s->>'module' = any (all_modules())) then continue; end if;
    i := i + 1;
    insert into apr_flow_steps (flow_id, sort, approver_kind, user_id, module, level, label)
    values (v_id, i, s->>'approver_kind', nullif(s->>'user_id', '')::uuid, nullif(s->>'module', ''), coalesce(nullif(s->>'level', '')::int, 2), nullif(left(trim(coalesce(s->>'label', '')), 80), ''));
  end loop;
  if i = 0 then raise exception 'steps_required'; end if;
  return v_id;
end $$;
revoke execute on function apr_flow_save(jsonb) from public, anon;
grant execute on function apr_flow_save(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Bağlantılar
-- ---------------------------------------------------------------------
create or replace function exp_claims_apr_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and new.recurring_id is null then
    perform apr_start('expense_claim', new.id, fx_try(new.amount, new.currency), new.category_id, new.employee_id,
                      'Masraf #' || new.no || coalesce(' · ' || nullif(new.vendor, ''), '') || ' · ' || to_char(new.amount / 100.0, 'FM999G999G990D00') || ' ' || new.currency, '/masraf');
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists exp_claims_apr_start on exp_claims;
create trigger exp_claims_apr_start after insert on exp_claims for each row execute function exp_claims_apr_start();

-- Akış bitmeden kayıt yok
create or replace function exp_claims_apr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'submitted' and new.status = 'posted' and not apr_cleared('expense_claim', new.id) then raise exception 'approval_pending'; end if;
  if old.status = 'submitted' and new.status = 'rejected' then
    update apr_requests set status = 'cancelled', decided_at = now() where entity = 'expense_claim' and entity_id = new.id and status = 'pending';
  end if;
  if old.status = 'rejected' and new.status = 'submitted' then
    perform apr_start('expense_claim', new.id, fx_try(new.amount, new.currency), new.category_id, new.employee_id, 'Masraf #' || new.no || coalesce(' · ' || nullif(new.vendor, ''), ''), '/masraf');
  end if;
  return new;
end $$;
drop trigger if exists exp_claims_apr_guard on exp_claims;
create trigger exp_claims_apr_guard before update of status on exp_claims for each row execute function exp_claims_apr_guard();

create or replace function pur_orders_apr_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status = 'pending' and new.status = 'approved' and not apr_cleared('purchase_order', new.id) then raise exception 'approval_pending'; end if;
  if old.status = 'pending' and new.status in ('draft', 'cancelled') then
    update apr_requests set status = 'cancelled', decided_at = now() where entity = 'purchase_order' and entity_id = new.id and status = 'pending';
  end if;
  return new;
end $$;
drop trigger if exists pur_orders_apr_guard on pur_orders;
create trigger pur_orders_apr_guard before update of status on pur_orders for each row execute function pur_orders_apr_guard();

-- Satın alma: akış varsa ona göre
create or replace function pur_order_submit(p_id uuid) returns text language plpgsql security definer set search_path = public as $$
declare o pur_orders; v_limit bigint; v_norate boolean; v_req uuid;
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  select * into o from pur_orders where id = p_id for update;
  if o.id is null or o.status <> 'draft' then raise exception 'po_locked'; end if;
  update pur_orders set status = 'pending', submitted_at = now() where id = p_id;
  v_req := apr_start('purchase_order', o.id, o.total_try, null, null,
                     'Satın alma SA-' || o.year || '-' || lpad(o.no::text, 4, '0') || ' · ' || coalesce((select name from fin_parties where id = o.party_id), '') || ' · ' || to_char(o.total / 100.0, 'FM999G999G990D00') || ' ' || o.currency,
                     '/alis/siparisler/' || o.id);
  if v_req is not null then return 'pending'; end if;
  select approval_limit into v_limit from pur_settings where company_id = o.company_id;
  v_norate := o.currency <> 'TRY' and fx_rate(o.currency, o.order_date) is null;
  if can_module('purchases', 3) or (coalesce(v_limit, 0) = 0) or (not v_norate and o.total_try <= v_limit) then
    update pur_orders set status = 'approved', approved_by = auth.uid(), approved_at = now() where id = p_id;
    return 'approved';
  end if;
  return 'pending';
end $$;
grant execute on function pur_order_submit(uuid) to authenticated;

-- Aynı fiş iki kez beyan edilmiş olabilir mi (VKN + belge no, ya da tutar + tarih + satıcı)
create or replace function exp_claim_dups(p_ids uuid[]) returns table (id uuid, dup_no bigint)
language sql stable security definer set search_path = public as $$
  select c.id, min(d.no)
  from exp_claims c join exp_claims d on d.id <> c.id and d.status <> 'rejected'
   and ((nullif(c.doc_no, '') is not null and d.doc_no = c.doc_no and coalesce(d.vendor_tax_no, '') = coalesce(c.vendor_tax_no, ''))
     or (d.amount = c.amount and d.expense_date = c.expense_date and lower(coalesce(d.vendor, '')) = lower(coalesce(c.vendor, '')) and coalesce(c.vendor, '') <> ''))
  where c.id = any (p_ids) and can_module('expenses', 1)
  group by c.id;
$$;
revoke execute on function exp_claim_dups(uuid[]) from public, anon;
grant execute on function exp_claim_dups(uuid[]) to authenticated;

notify pgrst, 'reload schema';
