-- =====================================================================
-- eLogo otomatik eşitleme: gelen ve giden e-fatura, e-arşiv, e-irsaliye
--  einv_inbox.direction: in (gelen) / out (giden, kendi kestiğimiz)
--  Giden fatura ETTN ile satış faturasına bağlanır; giden irsaliye arşivde tutulur.
--  einv_settings: eLogo eşitleme açık mı, başlangıç tarihi, son eşitleme kaydı
-- Tekrar çalıştırılabilir. Önce 20270225000000_einv_inbox.sql.
-- =====================================================================

alter table einv_inbox add column if not exists direction text not null default 'in' check (direction in ('in', 'out'));
create index if not exists einv_inbox_dir_idx on einv_inbox (company_id, direction, issue_date desc);
alter table einv_settings add column if not exists elogo_enabled boolean not null default false;
alter table einv_settings add column if not exists elogo_from date;
alter table einv_settings add column if not exists elogo_last_sync timestamptz;
alter table einv_settings add column if not exists elogo_log jsonb;

create or replace function einv_inbox_add(p_rows jsonb, p_source text default 'upload') returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb; added int := 0; dup int := 0; done_ int := 0; bad int := 0; v_ettn uuid;
begin
  if not (can_module('purchases', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  if p_source not in ('upload', 'email', 'api') then raise exception 'bad_source'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    begin v_ettn := (r->>'ettn')::uuid; exception when others then v_ettn := null; end;
    if v_ettn is null or coalesce(r->>'xml', '') = '' then bad := bad + 1; continue; end if;
    if exists (select 1 from einv_inbox where company_id = lab_company() and ettn = v_ettn) then dup := dup + 1; continue; end if;
    insert into einv_inbox (company_id, ettn, direction, doc_kind, doc_no, issue_date, profile, type_code, sender_vkn, sender_name, currency, payable, vat_total, line_count, xml, source, source_ref)
    values (lab_company(), v_ettn, case when r->>'direction' = 'out' then 'out' else 'in' end, case when r->>'doc_kind' in ('efatura', 'earsiv', 'eirsaliye') then r->>'doc_kind' else 'efatura' end, left(r->>'doc_no', 40), nullif(r->>'issue_date', '')::date, left(r->>'profile', 40), left(r->>'type_code', 40),
            left(regexp_replace(coalesce(r->>'sender_vkn', ''), '\D', '', 'g'), 20), left(r->>'sender_name', 250), left(coalesce(r->>'currency', 'TRY'), 3),
            nullif(r->>'payable', '')::bigint, nullif(r->>'vat_total', '')::bigint, nullif(r->>'line_count', '')::int, r->>'xml', p_source, left(r->>'source_ref', 200));
    added := added + 1;
    if exists (select 1 from inv_invoices i where i.company_id = lab_company() and i.direction = case when r->>'direction' = 'out' then 'sale' else 'purchase' end and i.ettn = v_ettn and i.status <> 'cancelled')
       or (r->>'doc_kind' = 'eirsaliye' and coalesce(r->>'direction', 'in') = 'in' and exists (select 1 from stk_receipts sr where sr.company_id = lab_company() and sr.supplier_doc = r->>'doc_no' and sr.status <> 'cancelled')) then done_ := done_ + 1; end if;
  end loop;
  return jsonb_build_object('added', added, 'duplicate', dup, 'already_imported', done_, 'invalid', bad);
end $$;
revoke execute on function einv_inbox_add(jsonb, text) from public, anon;
grant execute on function einv_inbox_add(jsonb, text) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_inbox_add(jsonb, text) to service_role; end if; end $$;

-- Liste: aktarılan fatura ETTN ile bağlanır; ticari faturada kabul / red son günü
drop function if exists einv_inbox_list(text, int);
drop function if exists einv_inbox_list(text, text, int);
create or replace function einv_inbox_list(p_status text default 'new', p_kind text default null, p_limit int default 300, p_dir text default 'in') returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('purchases') or can_module('ledger') then coalesce(jsonb_agg(x order by x->>'issue_date' desc nulls last, x->>'received_at' desc), '[]') end from (
    select jsonb_build_object('id', e.id, 'ettn', e.ettn, 'doc_no', e.doc_no, 'issue_date', e.issue_date, 'profile', e.profile, 'type_code', e.type_code,
             'sender_vkn', e.sender_vkn, 'sender_name', e.sender_name, 'currency', e.currency, 'payable', e.payable, 'vat_total', e.vat_total, 'line_count', e.line_count,
             'source', e.source, 'received_at', e.received_at, 'note', e.note,
             'doc_kind', e.doc_kind, 'direction', e.direction,
             'status', case when coalesce(i.id, rc.id) is not null then 'imported' else e.status end,
             'invoice_id', i.id, 'invoice_status', i.status, 'receipt_id', rc.id, 'receipt_status', rc.status,
             'party_id', (select p.id from fin_parties p where p.company_id = e.company_id and p.tax_no = e.sender_vkn order by p.created_at limit 1),
             'response_due', case when e.direction = 'in' and upper(coalesce(e.profile, '')) = 'TICARIFATURA' then e.issue_date + 8 end) x
    from einv_inbox e
    left join lateral (select i.id, i.status from inv_invoices i where e.doc_kind <> 'eirsaliye' and i.company_id = e.company_id and i.direction = case when e.direction = 'out' then 'sale' else 'purchase' end and i.ettn = e.ettn and i.status <> 'cancelled' limit 1) i on true
    left join lateral (select sr.id, sr.status from stk_receipts sr where e.doc_kind = 'eirsaliye' and e.direction = 'in' and sr.company_id = e.company_id and sr.supplier_doc = e.doc_no and sr.status <> 'cancelled' order by sr.created_at desc limit 1) rc on true
    where e.company_id = lab_company() and (p_kind is null or e.doc_kind = p_kind) and e.direction = coalesce(p_dir, 'in')
      and case coalesce(p_status, 'new')
            when 'new' then e.status = 'new' and coalesce(i.id, rc.id) is null
            when 'imported' then coalesce(i.id, rc.id) is not null
            when 'ignored' then e.status in ('ignored', 'rejected') and coalesce(i.id, rc.id) is null
            else true end
    order by e.issue_date desc nulls last limit greatest(1, least(p_limit, 1000))
  ) q;
$$;
revoke execute on function einv_inbox_list(text, text, int, text) from public, anon;
grant execute on function einv_inbox_list(text, text, int, text) to authenticated;

create or replace function einv_inbox_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('purchases') or can_module('ledger') then jsonb_build_object(
    'new', count(*) filter (where e.direction = 'in' and e.status = 'new' and coalesce(i.id, rc.id) is null),
    'imported', count(*) filter (where e.direction = 'in' and coalesce(i.id, rc.id) is not null),
    'ignored', count(*) filter (where e.direction = 'in' and e.status in ('ignored', 'rejected') and coalesce(i.id, rc.id) is null),
    'out_total', count(*) filter (where e.direction = 'out'),
    'out_new', count(*) filter (where e.direction = 'out' and e.doc_kind <> 'eirsaliye' and e.status = 'new' and i.id is null),
    'due_soon', count(*) filter (where e.direction = 'in' and e.status = 'new' and i.id is null and e.doc_kind = 'efatura' and upper(coalesce(e.profile, '')) = 'TICARIFATURA' and e.issue_date + 8 <= current_date + 2),
    'new_efatura', count(*) filter (where e.direction = 'in' and e.doc_kind = 'efatura' and e.status = 'new' and i.id is null),
    'new_earsiv', count(*) filter (where e.direction = 'in' and e.doc_kind = 'earsiv' and e.status = 'new' and i.id is null),
    'new_eirsaliye', count(*) filter (where e.direction = 'in' and e.doc_kind = 'eirsaliye' and e.status = 'new' and rc.id is null)) end
  from einv_inbox e
  left join lateral (select i.id, i.status from inv_invoices i where e.doc_kind <> 'eirsaliye' and i.company_id = e.company_id and i.direction = case when e.direction = 'out' then 'sale' else 'purchase' end and i.ettn = e.ettn and i.status <> 'cancelled' limit 1) i on true
  left join lateral (select sr.id, sr.status from stk_receipts sr where e.doc_kind = 'eirsaliye' and e.direction = 'in' and sr.company_id = e.company_id and sr.supplier_doc = e.doc_no and sr.status <> 'cancelled' order by sr.created_at desc limit 1) rc on true
  where e.company_id = lab_company();
$$;
revoke execute on function einv_inbox_counts() from public, anon;
grant execute on function einv_inbox_counts() to authenticated;

create or replace function einv_elogo_settings(p_enabled boolean, p_from date) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  insert into einv_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update einv_settings set elogo_enabled = coalesce(p_enabled, false), elogo_from = p_from, updated_by = auth.uid(), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function einv_elogo_settings(boolean, date) from public, anon;
grant execute on function einv_elogo_settings(boolean, date) to authenticated;

create or replace function einv_elogo_log(p_log jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('purchases', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  insert into einv_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update einv_settings set elogo_last_sync = now(), elogo_log = p_log where company_id = lab_company();
end $$;
revoke execute on function einv_elogo_log(jsonb) from public, anon;
grant execute on function einv_elogo_log(jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_elogo_log(jsonb) to service_role; end if; end $$;

-- Kontrol: yalnız gelen belgeler
do $$
declare src text;
begin
  select pg_get_functiondef('gl_checks(text)'::regprocedure) into src;
  if position('e.doc_kind <> ''eirsaliye'' and e.direction = ''in''' in src) > 0 then return; end if;
  if position('e.doc_kind <> ''eirsaliye''' in src) = 0 then raise exception 'elogo_sync: kontrol satırı bulunamadı'; end if;
  execute replace(src, 'e.doc_kind <> ''eirsaliye''', 'e.doc_kind <> ''eirsaliye'' and e.direction = ''in''');
end $$;

notify pgrst, 'reload schema';
