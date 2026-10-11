-- =====================================================================
-- KAMERALAR (ara cihaz / go2rtc gibi bir ağ geçidinin WebRTC / HLS izleme sayfası gömülür)
--  cam_cameras : kamera adı, grubu (atölye, depo, giriş…), izleme adresi (https), sıra
--  cam_access  : kim hangi grubu izleyebilir (sahip hepsini görür)
--  cam_views   : kim ne zaman izledi (KVKK kaydı)
-- Tekrar çalıştırılabilir.
-- =====================================================================
create table if not exists cam_cameras (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  name text not null check (length(name) between 1 and 80),
  group_name text not null default 'Genel' check (length(group_name) between 1 and 60),
  embed_url text not null check (embed_url ~ '^https://' and length(embed_url) <= 500),
  sort int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists cam_access (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  user_id uuid not null references auth.users (id) on delete cascade,
  group_name text not null,
  primary key (company_id, user_id, group_name)
);
create table if not exists cam_views (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  user_id uuid not null default auth.uid(),
  camera_ids uuid[] not null default '{}',
  at timestamptz not null default now()
);
create or replace function cam_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and m.role = 'owner');
$$;
revoke execute on function cam_admin() from public, anon;
grant execute on function cam_admin() to authenticated;
alter table cam_cameras enable row level security;
alter table cam_access enable row level security;
alter table cam_views enable row level security;
drop policy if exists cam_cameras_read on cam_cameras;
create policy cam_cameras_read on cam_cameras for select to authenticated using (company_id = lab_company() and (cam_admin() or exists (select 1 from cam_access a where a.user_id = auth.uid() and a.company_id = cam_cameras.company_id and a.group_name = cam_cameras.group_name)));
drop policy if exists cam_cameras_write on cam_cameras;
create policy cam_cameras_write on cam_cameras for all to authenticated using (company_id = lab_company() and cam_admin()) with check (company_id = lab_company() and cam_admin());
drop policy if exists cam_access_read on cam_access;
create policy cam_access_read on cam_access for select to authenticated using (company_id = lab_company() and (cam_admin() or user_id = auth.uid()));
drop policy if exists cam_access_write on cam_access;
create policy cam_access_write on cam_access for all to authenticated using (company_id = lab_company() and cam_admin()) with check (company_id = lab_company() and cam_admin());
drop policy if exists cam_views_ins on cam_views;
create policy cam_views_ins on cam_views for insert to authenticated with check (company_id = lab_company() and user_id = auth.uid());
drop policy if exists cam_views_read on cam_views;
create policy cam_views_read on cam_views for select to authenticated using (company_id = lab_company() and cam_admin());
grant select, insert, update, delete on cam_cameras, cam_access to authenticated;
grant select, insert on cam_views to authenticated;
notify pgrst, 'reload schema';
