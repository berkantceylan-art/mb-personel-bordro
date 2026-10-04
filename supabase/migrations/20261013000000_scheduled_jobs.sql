-- =====================================================================
-- Denetim 5. adım: zamanlanmış işler
-- Günlük iş (Vercel Cron → /api/cron/gunluk) aynı gün iki kez çalışırsa
-- bildirimleri tekrar göndermesin diye her iş için günlük kayıt tutulur.
-- =====================================================================

create table if not exists job_runs (
  job text not null,
  run_date date not null,
  company_id uuid not null references companies(id) on delete cascade,
  result jsonb,
  created_at timestamptz not null default now(),
  primary key (job, run_date, company_id)
);

-- Yalnız service role yazar/okur; kullanıcılara kapalı
alter table job_runs enable row level security;
drop policy if exists job_runs_read on job_runs;
create policy job_runs_read on job_runs for select using (has_role(company_id, array['owner']::app_role[]));

-- Akan ekranlar: yeni bildirim sayfa yenilemeden gelsin
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
