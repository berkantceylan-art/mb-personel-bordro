-- Gelen e-Arşiv (PDF): e-postadaki ya da yüklenen PDF faturalar yapay zekâyla okunup gelen kutusuna düşer
-- Önce: 20270225000000_einv_inbox.sql, 20270226000000_elogo_sync.sql. Tekrar çalıştırılabilir.

alter table einv_inbox alter column xml drop not null;
alter table einv_inbox add column if not exists pdf_path text check (pdf_path is null or length(pdf_path) <= 300);
alter table einv_inbox add column if not exists ai_data jsonb;

-- Okunan e-posta ekleri (aynı PDF her taramada yeniden okunmasın)
create table if not exists einv_mail_seen (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  ref text not null check (length(ref) <= 300),
  result text check (result is null or length(result) <= 200),
  seen_at timestamptz not null default now(),
  primary key (company_id, ref)
);
alter table einv_mail_seen enable row level security;
revoke all on einv_mail_seen from anon, authenticated;

create or replace function einv_mail_seen_check(p_refs text[]) returns text[]
language sql stable security definer set search_path = public as $$
  select case when can_module('purchases', 2) or einv_is_service() then coalesce(array_agg(ref), '{}') end
  from einv_mail_seen where company_id = lab_company() and ref = any (p_refs)
$$;
create or replace function einv_mail_seen_mark(p_rows jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if not (can_module('purchases', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    insert into einv_mail_seen (company_id, ref, result) values (lab_company(), left(r->>'ref', 300), left(r->>'result', 200))
    on conflict (company_id, ref) do update set result = excluded.result, seen_at = now();
  end loop;
end $$;
revoke execute on function einv_mail_seen_check(text[]) from public, anon;
revoke execute on function einv_mail_seen_mark(jsonb) from public, anon;
grant execute on function einv_mail_seen_check(text[]) to authenticated;
grant execute on function einv_mail_seen_mark(jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then
  grant execute on function einv_mail_seen_check(text[]) to service_role;
  grant execute on function einv_mail_seen_mark(jsonb) to service_role;
end if; end $$;

-- einv_inbox_add: XML yoksa PDF (okunan veriyle) kabul edilir
do $$
declare src text; o text; n text;
begin
  select pg_get_functiondef('einv_inbox_add(jsonb, text)'::regprocedure) into src;
  if position('pdf_path' in src) > 0 then return; end if;
  o := 'if v_ettn is null or coalesce(r->>''xml'', '''') = '''' then';
  n := 'if v_ettn is null or (coalesce(r->>''xml'', '''') = '''' and coalesce(r->>''pdf_path'', '''') = '''') then';
  if position(o in src) = 0 then raise exception 'einv_pdf_patch_failed:1'; end if;
  src := replace(src, o, n);
  o := 'line_count, xml, source, source_ref)';
  n := 'line_count, xml, source, source_ref, pdf_path, ai_data)';
  if position(o in src) = 0 then raise exception 'einv_pdf_patch_failed:2'; end if;
  src := replace(src, o, n);
  o := 'r->>''xml'', p_source, left(r->>''source_ref'', 200));';
  n := 'nullif(r->>''xml'', ''''), p_source, left(r->>''source_ref'', 200), nullif(left(r->>''pdf_path'', 300), ''''), case when jsonb_typeof(r->''ai_data'') = ''object'' then r->''ai_data'' end);';
  if position(o in src) = 0 then raise exception 'einv_pdf_patch_failed:3'; end if;
  src := replace(src, o, n);
  execute src;
end $$;

-- Liste: PDF'ten okunduğu ve dosya bilgisi
do $$
declare src text; o text;
begin
  select pg_get_functiondef('einv_inbox_list(text, text, int, text)'::regprocedure) into src;
  if position('''ai''' in src) > 0 then return; end if;
  o := '''doc_kind'', e.doc_kind, ''direction'', e.direction,';
  if position(o in src) = 0 then raise exception 'einv_pdf_patch_failed:4'; end if;
  execute replace(src, o, o || ' ''ai'', e.ai_data is not null, ''has_pdf'', e.pdf_path is not null, ''has_xml'', e.xml is not null,');
end $$;

notify pgrst, 'reload schema';
