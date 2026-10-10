-- İK asistanı: şirket bazında açma/kapama, kullanım günlüğü (KVKK ve maliyet takibi)
alter table companies add column if not exists assistant_enabled boolean not null default false;
alter table companies add column if not exists assistant_daily_limit int not null default 40 check (assistant_daily_limit between 1 and 500);

create table if not exists assistant_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  question text not null,
  tools text[] not null default '{}',
  input_tokens int,
  output_tokens int,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists assistant_logs_user_idx on assistant_logs (user_id, created_at desc);
alter table assistant_logs enable row level security;
drop policy if exists al_insert on assistant_logs;
create policy al_insert on assistant_logs for insert with check (user_id = auth.uid() and is_member(company_id));
drop policy if exists al_read on assistant_logs;
create policy al_read on assistant_logs for select using (user_id = auth.uid() or has_role(company_id, array['owner']::app_role[]));
