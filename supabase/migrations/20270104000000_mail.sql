-- =====================================================================
-- POSTA (Gmail / Google Workspace) MODÜLÜ
--  mail_accounts : kullanıcının bağladığı Gmail hesapları. Google yenileme anahtarı sunucuda AES-256-GCM ile
--                  şifrelenmiş saklanır; uygulama kullanıcıları şifreli sütunları da okuyamaz (sütun yetkisi).
--  mail_links    : e-postanın ERP kaydına bağlantısı (hekim / cari, CRM adayı, sipariş, hatırlatma)
--  mail_ai       : yapay zekâ özeti ve yapılacaklar (konuşma başına önbellek)
-- Herkes yalnız kendi bağladığı hesapları görür. Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists mail_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text not null check (length(email) between 3 and 200),
  display_name text check (display_name is null or length(display_name) <= 120),
  color text not null default '#2563EB' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  refresh_token_enc text,
  access_token_enc text,
  access_expires_at timestamptz,
  scopes text,
  status text not null default 'active' check (status in ('active', 'revoked', 'error')),
  last_error text,
  signature text check (signature is null or length(signature) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, email)
);
alter table mail_accounts enable row level security;
drop policy if exists mail_accounts_self on mail_accounts;
create policy mail_accounts_self on mail_accounts for select to authenticated using (user_id = auth.uid());
drop policy if exists mail_accounts_self_upd on mail_accounts;
create policy mail_accounts_self_upd on mail_accounts for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists mail_accounts_self_del on mail_accounts;
create policy mail_accounts_self_del on mail_accounts for delete to authenticated using (user_id = auth.uid());
-- Şifreli anahtar sütunları uygulama kullanıcılarına kapalı (yalnız sunucu / service role)
revoke all on mail_accounts from authenticated, anon;
grant select (id, company_id, user_id, email, display_name, color, status, last_error, signature, created_at, updated_at) on mail_accounts to authenticated;
grant update (display_name, color, signature, updated_at) on mail_accounts to authenticated;
grant delete on mail_accounts to authenticated;

create table if not exists mail_links (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  account_id uuid not null references mail_accounts (id) on delete cascade,
  thread_id text not null check (length(thread_id) <= 64),
  subject text check (subject is null or length(subject) <= 300),
  sender text check (sender is null or length(sender) <= 300),
  entity text not null check (entity in ('customer', 'lead', 'order', 'reminder', 'job')),
  entity_id uuid,
  note text check (note is null or length(note) <= 300),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists mail_links_thread_idx on mail_links (account_id, thread_id);
create index if not exists mail_links_entity_idx on mail_links (entity, entity_id);
alter table mail_links enable row level security;
drop policy if exists mail_links_rw on mail_links;
create policy mail_links_rw on mail_links for all to authenticated
  using (exists (select 1 from mail_accounts a where a.id = account_id and a.user_id = auth.uid()) or (company_id = lab_company() and entity = 'customer' and can_module('sales')))
  with check (exists (select 1 from mail_accounts a where a.id = account_id and a.user_id = auth.uid()));
grant select, insert, delete on mail_links to authenticated;

create table if not exists mail_ai (
  account_id uuid not null references mail_accounts (id) on delete cascade,
  thread_id text not null check (length(thread_id) <= 64),
  history text,                       -- son mesaj kimliği; değişince yeniden özetlenir
  category text check (category in ('case', 'question', 'complaint', 'price', 'invoice', 'order', 'info', 'spam', 'other')),
  urgency smallint check (urgency between 0 and 3),
  summary text check (summary is null or length(summary) <= 1200),
  actions jsonb not null default '[]'::jsonb,
  reply text check (reply is null or length(reply) <= 4000),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (account_id, thread_id)
);
alter table mail_ai enable row level security;
drop policy if exists mail_ai_self on mail_ai;
create policy mail_ai_self on mail_ai for all to authenticated
  using (exists (select 1 from mail_accounts a where a.id = account_id and a.user_id = auth.uid()))
  with check (exists (select 1 from mail_accounts a where a.id = account_id and a.user_id = auth.uid()));
grant select, insert, update, delete on mail_ai to authenticated;

notify pgrst, 'reload schema';
