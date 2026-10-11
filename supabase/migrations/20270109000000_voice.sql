-- =====================================================================
-- SESLİ KARŞILAMA VE SESLİ DUYURU
--  company_voice      : şirket geneli sesli karşılama (açık / kapalı, metin şablonu: {ad} {isim} {selam} {sirket})
--  announcements.speak: duyuru herkesin ekranında bir kez sesli okunur
-- Tekrar çalıştırılabilir.
-- =====================================================================
create table if not exists company_voice (
  company_id uuid primary key references companies (id) on delete cascade default lab_company(),
  enabled boolean not null default true,
  template text not null default '{selam} {ad}, hoş geldin. Günün iyi geçmesini dilerim.' check (length(template) between 1 and 400),
  announce boolean not null default true,
  rate numeric(3, 2) not null default 1 check (rate between 0.5 and 1.6),
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table company_voice enable row level security;
drop policy if exists company_voice_read on company_voice;
create policy company_voice_read on company_voice for select to authenticated using (company_id = lab_company());
drop policy if exists company_voice_write on company_voice;
create policy company_voice_write on company_voice for all to authenticated
  using (company_id = lab_company() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = company_voice.company_id and m.role in ('owner', 'hr')))
  with check (company_id = lab_company() and exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = company_voice.company_id and m.role in ('owner', 'hr')));
grant select, insert, update on company_voice to authenticated;

alter table announcements add column if not exists speak boolean not null default false;

notify pgrst, 'reload schema';
