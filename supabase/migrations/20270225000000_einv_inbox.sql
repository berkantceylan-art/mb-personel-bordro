-- =====================================================================
-- Gelen e-belge kutusu: eLogo (ya da başka entegratör) üzerinden gelen e-fatura, e-arşiv fatura ve e-irsaliye tek listede
--  Kaynak: XML / ZIP yükleme, bağlı Gmail hesabındaki e-posta ekleri, ileride entegratör API'si
--  ETTN ile tekilleşir; alış faturasına aktarılınca (aynı ETTN) "aktarıldı" olur.
--  Ticari faturada kabul / red süresi (8 gün) izlenir. Kontrol motoruna "işlenmemiş gelen e-fatura" eklenir.
-- Tekrar çalıştırılabilir. Önce 20270223000000_gl_checks_more.sql.
-- =====================================================================

create table if not exists einv_inbox (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  ettn uuid not null,
  doc_kind text not null default 'efatura' check (doc_kind in ('efatura', 'earsiv', 'eirsaliye')),
  doc_no text check (doc_no is null or length(doc_no) <= 40),
  issue_date date,
  profile text check (profile is null or length(profile) <= 40),
  type_code text check (type_code is null or length(type_code) <= 40),
  sender_vkn text check (sender_vkn is null or length(sender_vkn) <= 20),
  sender_name text check (sender_name is null or length(sender_name) <= 250),
  currency text,
  payable bigint,
  vat_total bigint,
  line_count int,
  xml text not null,
  source text not null default 'upload' check (source in ('upload', 'email', 'api')),
  source_ref text check (source_ref is null or length(source_ref) <= 200),
  status text not null default 'new' check (status in ('new', 'ignored', 'rejected')),
  note text check (note is null or length(note) <= 300),
  received_at timestamptz not null default now(),
  processed_by uuid,
  processed_at timestamptz,
  unique (company_id, ettn)
);
alter table einv_inbox add column if not exists doc_kind text not null default 'efatura' check (doc_kind in ('efatura', 'earsiv', 'eirsaliye'));
create index if not exists einv_inbox_idx on einv_inbox (company_id, status, issue_date desc);
alter table einv_inbox enable row level security;
drop policy if exists einv_inbox_read on einv_inbox;
create policy einv_inbox_read on einv_inbox for select to authenticated using (company_id = lab_company() and (can_module('purchases') or can_module('ledger')));
revoke all on einv_inbox from anon;
grant select on einv_inbox to authenticated;

create table if not exists einv_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  mail_account_id uuid,
  mail_query text check (mail_query is null or length(mail_query) <= 300),
  last_scan_at timestamptz,
  last_scan jsonb,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table einv_settings enable row level security;
drop policy if exists einv_settings_read on einv_settings;
create policy einv_settings_read on einv_settings for select to authenticated using (company_id = lab_company() and can_module('purchases'));
revoke all on einv_settings from anon;
grant select on einv_settings to authenticated;

-- Sunucu anahtarıyla (zamanlanmış e-posta taraması) çağrılabilir mi
create or replace function einv_is_service() returns boolean language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role', current_setting('request.jwt.claim.role', true), '') = 'service_role';
$$;

-- Satırları ekle: [{ettn, doc_no, issue_date, profile, type_code, sender_vkn, sender_name, currency, payable, vat_total, line_count, xml, source_ref}]
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
    insert into einv_inbox (company_id, ettn, doc_kind, doc_no, issue_date, profile, type_code, sender_vkn, sender_name, currency, payable, vat_total, line_count, xml, source, source_ref)
    values (lab_company(), v_ettn, case when r->>'doc_kind' in ('efatura', 'earsiv', 'eirsaliye') then r->>'doc_kind' else 'efatura' end, left(r->>'doc_no', 40), nullif(r->>'issue_date', '')::date, left(r->>'profile', 40), left(r->>'type_code', 40),
            left(regexp_replace(coalesce(r->>'sender_vkn', ''), '\D', '', 'g'), 20), left(r->>'sender_name', 250), left(coalesce(r->>'currency', 'TRY'), 3),
            nullif(r->>'payable', '')::bigint, nullif(r->>'vat_total', '')::bigint, nullif(r->>'line_count', '')::int, r->>'xml', p_source, left(r->>'source_ref', 200));
    added := added + 1;
    if exists (select 1 from inv_invoices i where i.company_id = lab_company() and i.direction = 'purchase' and i.ettn = v_ettn and i.status <> 'cancelled')
       or (r->>'doc_kind' = 'eirsaliye' and exists (select 1 from stk_receipts sr where sr.company_id = lab_company() and sr.supplier_doc = r->>'doc_no' and sr.status <> 'cancelled')) then done_ := done_ + 1; end if;
  end loop;
  return jsonb_build_object('added', added, 'duplicate', dup, 'already_imported', done_, 'invalid', bad);
end $$;
revoke execute on function einv_inbox_add(jsonb, text) from public, anon;
grant execute on function einv_inbox_add(jsonb, text) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_inbox_add(jsonb, text) to service_role; end if; end $$;

-- Liste: aktarılan fatura ETTN ile bağlanır; ticari faturada kabul / red son günü
drop function if exists einv_inbox_list(text, int);
create or replace function einv_inbox_list(p_status text default 'new', p_kind text default null, p_limit int default 300) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('purchases') or can_module('ledger') then coalesce(jsonb_agg(x order by x->>'issue_date' desc nulls last, x->>'received_at' desc), '[]') end from (
    select jsonb_build_object('id', e.id, 'ettn', e.ettn, 'doc_no', e.doc_no, 'issue_date', e.issue_date, 'profile', e.profile, 'type_code', e.type_code,
             'sender_vkn', e.sender_vkn, 'sender_name', e.sender_name, 'currency', e.currency, 'payable', e.payable, 'vat_total', e.vat_total, 'line_count', e.line_count,
             'source', e.source, 'received_at', e.received_at, 'note', e.note,
             'doc_kind', e.doc_kind,
             'status', case when coalesce(i.id, rc.id) is not null then 'imported' else e.status end,
             'invoice_id', i.id, 'invoice_status', i.status, 'receipt_id', rc.id, 'receipt_status', rc.status,
             'party_id', (select p.id from fin_parties p where p.company_id = e.company_id and p.tax_no = e.sender_vkn order by p.created_at limit 1),
             'response_due', case when upper(coalesce(e.profile, '')) = 'TICARIFATURA' then e.issue_date + 8 end) x
    from einv_inbox e
    left join lateral (select i.id, i.status from inv_invoices i where e.doc_kind <> 'eirsaliye' and i.company_id = e.company_id and i.direction = 'purchase' and i.ettn = e.ettn and i.status <> 'cancelled' limit 1) i on true
    left join lateral (select sr.id, sr.status from stk_receipts sr where e.doc_kind = 'eirsaliye' and sr.company_id = e.company_id and sr.supplier_doc = e.doc_no and sr.status <> 'cancelled' order by sr.created_at desc limit 1) rc on true
    where e.company_id = lab_company() and (p_kind is null or e.doc_kind = p_kind)
      and case coalesce(p_status, 'new')
            when 'new' then e.status = 'new' and coalesce(i.id, rc.id) is null
            when 'imported' then coalesce(i.id, rc.id) is not null
            when 'ignored' then e.status in ('ignored', 'rejected') and coalesce(i.id, rc.id) is null
            else true end
    order by e.issue_date desc nulls last limit greatest(1, least(p_limit, 1000))
  ) q;
$$;
revoke execute on function einv_inbox_list(text, text, int) from public, anon;
grant execute on function einv_inbox_list(text, text, int) to authenticated;

create or replace function einv_inbox_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('purchases') or can_module('ledger') then jsonb_build_object(
    'new', count(*) filter (where e.status = 'new' and coalesce(i.id, rc.id) is null),
    'imported', count(*) filter (where coalesce(i.id, rc.id) is not null),
    'ignored', count(*) filter (where e.status in ('ignored', 'rejected') and coalesce(i.id, rc.id) is null),
    'due_soon', count(*) filter (where e.status = 'new' and i.id is null and e.doc_kind = 'efatura' and upper(coalesce(e.profile, '')) = 'TICARIFATURA' and e.issue_date + 8 <= current_date + 2),
    'new_efatura', count(*) filter (where e.doc_kind = 'efatura' and e.status = 'new' and i.id is null),
    'new_earsiv', count(*) filter (where e.doc_kind = 'earsiv' and e.status = 'new' and i.id is null),
    'new_eirsaliye', count(*) filter (where e.doc_kind = 'eirsaliye' and e.status = 'new' and rc.id is null)) end
  from einv_inbox e
  left join lateral (select i.id, i.status from inv_invoices i where e.doc_kind <> 'eirsaliye' and i.company_id = e.company_id and i.direction = 'purchase' and i.ettn = e.ettn and i.status <> 'cancelled' limit 1) i on true
  left join lateral (select sr.id, sr.status from stk_receipts sr where e.doc_kind = 'eirsaliye' and sr.company_id = e.company_id and sr.supplier_doc = e.doc_no and sr.status <> 'cancelled' order by sr.created_at desc limit 1) rc on true
  where e.company_id = lab_company();
$$;
revoke execute on function einv_inbox_counts() from public, anon;
grant execute on function einv_inbox_counts() to authenticated;

create or replace function einv_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  if p_status not in ('new', 'ignored', 'rejected') then raise exception 'bad_status'; end if;
  update einv_inbox set status = p_status, note = coalesce(nullif(left(trim(p_note), 300), ''), note), processed_by = auth.uid(), processed_at = now()
  where id = p_id and company_id = lab_company();
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function einv_set_status(uuid, text, text) from public, anon;
grant execute on function einv_set_status(uuid, text, text) to authenticated;

create or replace function einv_settings_save(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('purchases', 2) then raise exception 'not_allowed'; end if;
  insert into einv_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update einv_settings set mail_account_id = nullif(p->>'mail_account_id', '')::uuid, mail_query = nullif(left(trim(p->>'mail_query'), 300), ''),
    updated_by = auth.uid(), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function einv_settings_save(jsonb) from public, anon;
grant execute on function einv_settings_save(jsonb) to authenticated;

create or replace function einv_scan_log(p_result jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('purchases', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  insert into einv_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update einv_settings set last_scan_at = now(), last_scan = p_result where company_id = lab_company();
end $$;
revoke execute on function einv_scan_log(jsonb) from public, anon;
grant execute on function einv_scan_log(jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_scan_log(jsonb) to service_role; end if; end $$;

-- Kontrol motoru: işlenmemiş gelen e-fatura (ticari faturada kabul / red süresi dolmak üzereyse kritik)
do $$
declare src text; anchor text := '  -- onaylar ("bilerek geçildi")'; add text;
begin
  select pg_get_functiondef('gl_checks(text)'::regprocedure) into src;
  if position('''key'', ''einv_unprocessed''' in src) > 0 then return; end if;
  if position(anchor in src) = 0 then raise exception 'einv_inbox: kontrol bağlantı satırı bulunamadı'; end if;
  add := $add$
  -- 12) Gelen e-fatura
  select count(*), coalesce(jsonb_agg(jsonb_build_object('label', coalesce(q.sender_name, '—') || ' · ' || coalesce(q.doc_no, '') || ' · ' || to_char(q.issue_date, 'DD.MM')
             || case when q.due is not null then ' · kabul/red son gün ' || to_char(q.due, 'DD.MM') else '' end, 'amount', q.payable, 'link', '/alis/gelen-efatura')) filter (where q.rn <= 20), '[]'),
         count(*) filter (where q.due is not null and q.due <= current_date + 1)
    into n, it, ck_due
  from (select e.*, case when upper(coalesce(e.profile, '')) = 'TICARIFATURA' then e.issue_date + 8 end due, row_number() over (order by e.issue_date) rn
        from einv_inbox e
        where e.company_id = co and e.status = 'new' and e.issue_date <= t and e.doc_kind <> 'eirsaliye'
          and not exists (select 1 from inv_invoices i where i.company_id = co and i.direction = 'purchase' and i.ettn = e.ettn and i.status <> 'cancelled')) q;
  res := res || jsonb_build_object('key', 'einv_unprocessed', 'title', 'Alış faturasına aktarılmamış gelen e-fatura / e-arşiv fatura', 'area', 'Belge', 'severity', case when ck_due > 0 then 'critical' else 'warning' end, 'count', n, 'items', it, 'link', '/alis/gelen-efatura');

$add$;
  src := replace(src, anchor, add || anchor);
  -- yeni değişken
  src := regexp_replace(src, '(\ndeclare\n)', E'\\1  ck_due int := 0;\n');
  if position('ck_due int := 0;' in src) = 0 then
    src := regexp_replace(src, 'declare', E'declare\n  ck_due int := 0;', '');
  end if;
  execute src;
end $$;

notify pgrst, 'reload schema';
