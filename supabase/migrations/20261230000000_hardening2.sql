-- =====================================================================
-- GÜVENLİK SIKILAŞTIRMASI (1221–1229 gözden geçirme bulguları)
--  1) Masraf beyanında tutar / para birimi / tür / personel değişirse onay akışı yeniden başlar; başlatma hatası yutulmaz
--  2) Onay akışlarını yalnız şirket sahibi ya da kullanıcı yönetiminde tam yetkili düzenler; adım kişisi şirket üyesi olmalı
--  3) Onay: aynı kişi aynı talepte birden çok adımı onaylayamaz
--  4) apr_requests okuma politikası yetkili sarmalayıcıyla (izin hatası düzeltildi)
--  5) Prim kuralı ve elle düzeltme yalnız bordro yetkisiyle; kişi kendi prim satırını düzeltemez
--  6) Tarih itibarıyla cari / hesap bakiyesi yalnız finans / satış yetkisiyle
--  7) Depo: laboratuvar portal deposunda yalnız portal hesabı klasörüne yükler; html / svg / js yüklenemez
-- Tekrar çalıştırılabilir. Önce 20261229000000_reports_group.sql.
-- =====================================================================

-- 1) Masraf
create or replace function exp_claims_apr_start() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and new.recurring_id is null then
    perform apr_start('expense_claim', new.id, fx_try(new.amount, new.currency), new.category_id, new.employee_id,
                      'Masraf #' || new.no || coalesce(' · ' || nullif(new.vendor, ''), '') || ' · ' || to_char(new.amount / 100.0, 'FM999G999G990D00') || ' ' || new.currency, '/masraf');
  end if;
  return new;
end $$;

create or replace function exp_claims_apr_restart() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'submitted' and new.recurring_id is null
     and (new.amount, new.currency, new.category_id, new.employee_id) is distinct from (old.amount, old.currency, old.category_id, old.employee_id) then
    -- önceki onay geçersiz: uygun akış varsa yeniden başlar (yoksa eski talepler iptal edilir)
    update apr_requests set status = 'cancelled', decided_at = now() where entity = 'expense_claim' and entity_id = new.id and status in ('pending', 'approved');
    perform apr_start('expense_claim', new.id, fx_try(new.amount, new.currency), new.category_id, new.employee_id,
                      'Masraf #' || new.no || coalesce(' · ' || nullif(new.vendor, ''), '') || ' · ' || to_char(new.amount / 100.0, 'FM999G999G990D00') || ' ' || new.currency, '/masraf');
  end if;
  return new;
end $$;
drop trigger if exists exp_claims_apr_restart on exp_claims;
create trigger exp_claims_apr_restart after update of amount, currency, category_id, employee_id on exp_claims for each row execute function exp_claims_apr_restart();

-- apr_cleared: iptal edilmiş talepler sayılmaz (yeniden başlatılan akışın son durumu esas)
create or replace function apr_cleared(p_entity text, p_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select status = 'approved' from apr_requests
                   where entity = p_entity and entity_id = p_id and status <> 'cancelled'
                   order by created_at desc limit 1), true);
$$;

-- 2) Akış yönetimi
create or replace function apr_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') or can_module('users', 3);
$$;

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
    if s->>'approver_kind' = 'user' and not exists (select 1 from memberships m where m.user_id = nullif(s->>'user_id', '')::uuid and m.company_id = lab_company()) then continue; end if;
    if s->>'approver_kind' = 'module' and not (s->>'module' = any (all_modules())) then continue; end if;
    i := i + 1;
    insert into apr_flow_steps (flow_id, sort, approver_kind, user_id, module, level, label)
    values (v_id, i, s->>'approver_kind', nullif(s->>'user_id', '')::uuid, nullif(s->>'module', ''), coalesce(nullif(s->>'level', '')::int, 2), nullif(left(trim(coalesce(s->>'label', '')), 80), ''));
  end loop;
  if i = 0 then raise exception 'steps_required'; end if;
  return v_id;
end $$;

-- 3) Onay kararı: aynı kişi aynı talepte ikinci kez karar veremez
create or replace function apr_decide(p_request uuid, p_decision text, p_note text default null) returns text
language plpgsql security definer set search_path = public as $$
declare r apr_requests;
begin
  if p_decision not in ('approve', 'reject') then raise exception 'bad_decision'; end if;
  select * into r from apr_requests where id = p_request for update;
  if r.id is null or r.status <> 'pending' then raise exception 'not_pending'; end if;
  if not (auth.uid() = any (apr_step_users(r.id))) then raise exception 'not_allowed'; end if;
  if r.requested_by = auth.uid() and not exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') then raise exception 'own_request'; end if;
  if p_decision = 'approve' and exists (select 1 from apr_actions a where a.request_id = r.id and a.user_id = auth.uid() and a.decision = 'approve') then raise exception 'already_approved_step'; end if;
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

-- 4) Okuma politikası
create or replace function apr_is_step_user(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() = any (apr_step_users(p_request));
$$;
revoke execute on function apr_is_step_user(uuid) from public, anon;
grant execute on function apr_is_step_user(uuid) to authenticated;
create or replace function apr_acted(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from apr_actions a where a.request_id = p_request and a.user_id = auth.uid());
$$;
revoke execute on function apr_acted(uuid) from public, anon;
grant execute on function apr_acted(uuid) to authenticated;
create or replace function apr_request_visible(p_request uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from apr_requests r where r.id = p_request and (
    r.requested_by = auth.uid() or apr_admin()
    or (r.entity = 'expense_claim' and can_module('expenses', 1)) or (r.entity = 'purchase_order' and can_module('purchases', 1))
    or (r.status = 'pending' and auth.uid() = any (apr_step_users(r.id)))
    or exists (select 1 from apr_actions a where a.request_id = r.id and a.user_id = auth.uid())));
$$;
revoke execute on function apr_request_visible(uuid) from public, anon;
grant execute on function apr_request_visible(uuid) to authenticated;
drop policy if exists apr_requests_read on apr_requests;
create policy apr_requests_read on apr_requests for select to authenticated using (
  requested_by = auth.uid() or apr_admin()
  or (entity = 'expense_claim' and can_module('expenses', 1)) or (entity = 'purchase_order' and can_module('purchases', 1))
  or (status = 'pending' and apr_is_step_user(apr_requests.id))
  or apr_acted(apr_requests.id));
drop policy if exists apr_actions_read on apr_actions;
create policy apr_actions_read on apr_actions for select to authenticated using (apr_request_visible(request_id));

-- 5) Prim
create or replace function prd_bonus_rule_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid;
begin
  if not (can_module('payroll', 2) or can_manage_pay(lab_company())) then raise exception 'not_allowed'; end if;
  if coalesce((p->>'delete')::boolean, false) then delete from prd_bonus_rules where id = v_id; return v_id; end if;
  if nullif(trim(coalesce(p->>'name', '')), '') is null then raise exception 'name_required'; end if;
  if v_id is null then insert into prd_bonus_rules (name) values ('x') returning id into v_id; end if;
  update prd_bonus_rules set
    name = left(trim(p->>'name'), 80),
    employee_id = nullif(p->>'employee_id', '')::uuid,
    unit_amount = greatest(0, coalesce(nullif(p->>'unit_amount', '')::bigint, 0)),
    free_units = greatest(0, coalesce(nullif(p->>'free_units', '')::int, 0)),
    target_units = nullif(p->>'target_units', '')::int,
    target_bonus = greatest(0, coalesce(nullif(p->>'target_bonus', '')::bigint, 0)),
    reject_penalty = greatest(0, coalesce(nullif(p->>'reject_penalty', '')::bigint, 0)),
    min_on_time_pct = nullif(p->>'min_on_time_pct', '')::int,
    on_time_factor = coalesce(nullif(p->>'on_time_factor', '')::numeric, 0.5),
    max_amount = nullif(p->>'max_amount', '')::bigint,
    is_active = coalesce((p->>'is_active')::boolean, true)
  where id = v_id;
  return v_id;
end $$;

create or replace function prd_bonus_adjust(p_line uuid, p_adjust bigint) returns void
language plpgsql security definer set search_path = public as $$
declare v_run uuid;
begin
  if not (can_module('payroll', 2) or can_manage_pay(lab_company())) then raise exception 'not_allowed'; end if;
  if exists (select 1 from prd_bonus_lines l join employees e on e.id = l.employee_id where l.id = p_line and e.user_id = auth.uid())
     and not exists (select 1 from memberships m where m.user_id = auth.uid() and m.role = 'owner') then raise exception 'own_line'; end if;
  update prd_bonus_lines l set adjust = coalesce(p_adjust, 0)
  from prd_bonus_runs r where l.id = p_line and r.id = l.run_id and r.status = 'draft'
  returning l.run_id into v_run;
  if v_run is null then raise exception 'already_posted'; end if;
  update prd_bonus_runs set total = (select coalesce(sum(greatest(0, amount + adjust)), 0) from prd_bonus_lines where run_id = v_run) where id = v_run;
end $$;

-- 6) Bakiyeler
create or replace function fin_party_balance_at(p_party uuid, p_date date, p_book text default 'official') returns bigint
language plpgsql stable security definer set search_path = public as $$
begin
  if not (can_module('finance') or can_module('sales')) then return null; end if;
  if p_book = 'internal' then
    return (select c.internal_opening
       + coalesce((select sum(j.total) from jobs j where j.customer_id = c.id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
       - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = c.id and lp.book in ('internal', 'both') and lp.paid_on <= p_date), 0)
     from fin_parties p join lab_customers c on c.id = p.lab_customer_id where p.id = p_party and c.internal_book);
  end if;
  return (select p.opening_balance
       + coalesce((select sum(m.amount) from fin_moves m join fin_txns t on t.id = m.txn_id where m.party_id = p.id and t.voided_at is null and m.move_date <= p_date), 0)
       + case when coalesce(c.internal_book, false) then 0 else
           coalesce((select sum(j.total) from jobs j where j.customer_id = p.lab_customer_id and j.status = 'delivered' and (j.delivered_at at time zone 'Europe/Istanbul')::date <= p_date), 0)
         - coalesce((select sum(lp.amount) from lab_payments lp where lp.customer_id = p.lab_customer_id and lp.fin_txn_id is null and lp.paid_on <= p_date), 0) end
     from fin_parties p left join lab_customers c on c.id = p.lab_customer_id where p.id = p_party);
end $$;
revoke execute on function fin_party_balance_at(uuid, date, text) from public, anon;
grant execute on function fin_party_balance_at(uuid, date, text) to authenticated;

revoke execute on function fin_account_balance_at(uuid, date) from public, anon, authenticated;

-- 7) Depo
drop policy if exists "portal_files_lab_obj_write" on storage.objects;
create policy "portal_files_lab_obj_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'portal-files' and can_logistics()
              and exists (select 1 from portal_accounts a where a.id::text = (storage.foldername(name))[1])
              and name !~* '\.(html?|xhtml|svg|js|mjs)$');
drop policy if exists "job_files_obj_write" on storage.objects;
create policy "job_files_obj_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'job-files' and can_logistics() and name !~* '\.(html?|xhtml|svg|js|mjs)$');

notify pgrst, 'reload schema';
