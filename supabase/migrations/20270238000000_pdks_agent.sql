-- PDKS otomatik aktarım: ofis bilgisayarındaki küçük program Erom dosyasını 5 dakikada bir ERP'ye gönderir.
-- Programın anahtarının yalnız SHA-256 özeti saklanır.
create table if not exists pdks_agents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  token_hash text not null unique check (length(token_hash) = 64),
  is_active boolean not null default true,
  last_seen_at timestamptz,
  last_result jsonb,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table pdks_agents enable row level security;
drop policy if exists pdks_agents_read on pdks_agents;
create policy pdks_agents_read on pdks_agents for select to authenticated
  using (company_id = (select lab_company()) and (select can_manage_hr(company_id)));
revoke all on pdks_agents from anon;
grant select (id, company_id, name, is_active, last_seen_at, last_result, created_at) on pdks_agents to authenticated;
-- otomatik aktarımlarda içe aktarımı yapan kullanıcı yoktur
alter table attendance_imports alter column imported_by drop not null;
