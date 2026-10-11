-- =====================================================================
-- DİJİTAL DOSYA AKIŞI VE İŞ MESAJLAŞMA
--  job-files deposu: tarama dosyaları (STL, PLY, OBJ, 3MF, ZIP, DCM) için tür sınırı kalkar, 100 MB
--  job_files.kind / size : dosya türü (foto, tarama, tasarım, belge)
--  Laboratuvar (lab modülü) bağlı portal vakasının dosyalarını ve geçmişini ERP iş ekranından görür,
--    hekime mesaj ve dosya gönderir
--  job_notes            : iş üzerindeki iç ekip notları (hekim görmez)
--  Hekim mesajı bildirimi bağlı iş kaydına gider
-- Tekrar çalıştırılabilir. Önce 20261220000000_hardening.sql.
-- =====================================================================

update storage.buckets set allowed_mime_types = null, file_size_limit = 104857600 where id = 'job-files';

alter table job_files add column if not exists kind text not null default 'photo';
alter table job_files add column if not exists size bigint;
do $$ begin
  alter table job_files add constraint job_files_kind_chk check (kind in ('photo', 'scan', 'design', 'doc', 'other'));
exception when duplicate_object then null; end $$;
update job_files set kind = case
  when path ~* '\.(stl|ply|obj|3mf|dcm|zip)$' then 'scan'
  when path ~* '\.pdf$' then 'doc'
  else 'photo' end
where kind = 'photo' and path !~* '\.(jpe?g|png|webp|heic)$';

-- Laboratuvar ekibi portal vakalarını okur, hekime mesaj / dosya gönderir
drop policy if exists portal_cases_lab_read on portal_cases;
create policy portal_cases_lab_read on portal_cases for select to authenticated using (can_logistics());
drop policy if exists portal_files_lab_read on portal_case_files;
create policy portal_files_lab_read on portal_case_files for select to authenticated using (can_logistics());
drop policy if exists portal_files_lab_insert on portal_case_files;
create policy portal_files_lab_insert on portal_case_files for insert to authenticated with check (from_lab and can_logistics());
drop policy if exists portal_events_lab_read on portal_case_events;
create policy portal_events_lab_read on portal_case_events for select to authenticated using (can_logistics());
drop policy if exists portal_events_lab_insert on portal_case_events;
create policy portal_events_lab_insert on portal_case_events for insert to authenticated
  with check (from_lab and kind in ('message', 'file') and author = auth.uid() and can_logistics());

drop policy if exists "portal_files_lab_obj_read" on storage.objects;
create policy "portal_files_lab_obj_read" on storage.objects for select to authenticated using (bucket_id = 'portal-files' and can_logistics());
drop policy if exists "portal_files_lab_obj_write" on storage.objects;
create policy "portal_files_lab_obj_write" on storage.objects for insert to authenticated with check (bucket_id = 'portal-files' and can_logistics());

-- İç notlar
create table if not exists job_notes (
  id bigint generated always as identity primary key,
  job_id uuid not null references jobs (id) on delete cascade,
  body text not null check (length(body) between 1 and 4000),
  author uuid not null default auth.uid(),
  author_name text,
  created_at timestamptz not null default now()
);
create index if not exists job_notes_idx on job_notes (job_id, id);
alter table job_notes enable row level security;
drop policy if exists job_notes_read on job_notes;
create policy job_notes_read on job_notes for select to authenticated using (can_logistics() or can_module('production'));
drop policy if exists job_notes_insert on job_notes;
create policy job_notes_insert on job_notes for insert to authenticated with check (author = auth.uid() and (can_logistics() or can_module('production')));
drop policy if exists job_notes_delete on job_notes;
create policy job_notes_delete on job_notes for delete to authenticated using (author = auth.uid());
grant select, insert, delete on job_notes to authenticated;

create or replace function job_notes_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.author := auth.uid();
  new.author_name := coalesce(
    (select e.first_name || ' ' || e.last_name from employees e where e.user_id = auth.uid() limit 1),
    (select u.email from auth.users u where u.id = auth.uid()));
  return new;
end $$;
drop trigger if exists job_notes_fill on job_notes;
create trigger job_notes_fill before insert on job_notes for each row execute function job_notes_fill();

-- Hekim mesajı → bildirim (bağlı iş varsa iş ekranına gider)
create or replace function notify_portal_message() returns trigger
language plpgsql security definer set search_path = public as $$
declare c portal_cases; who text; jid uuid;
begin
  if new.kind <> 'message' or new.from_lab then return new; end if;
  select * into c from portal_cases where id = new.case_id;
  select coalesce(company, name) into who from portal_accounts where id = c.account_id;
  select id into jid from jobs where portal_case_id = c.id order by created_at desc limit 1;
  perform deliver(lab_company(), lab_recipients(), 'Hekim mesajı · vaka #' || c.no,
                  coalesce(who, '') || ': ' || left(coalesce(new.body, ''), 140),
                  case when jid is not null then '/isler/' || jid || '#mesajlar' else '/isler?q=' || c.patient_ref end);
  return new;
exception when others then return new;
end $$;

notify pgrst, 'reload schema';
