-- =====================================================================
-- Web sitesi: departmanlar ve çalışanlar (sitede /<dil>/ekibimiz)
-- =====================================================================

create table cms_departments (
  id uuid primary key default gen_random_uuid(),
  name jsonb not null default '{}'::jsonb check (is_i18n_text(name)),
  description jsonb not null default '{}'::jsonb check (is_i18n_text(description)),
  image_path text,
  gallery text[] not null default '{}',
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_departments (sort) where deleted_at is null;

create table cms_team (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 120),
  role jsonb not null default '{}'::jsonb check (is_i18n_text(role)),
  bio jsonb not null default '{}'::jsonb check (is_i18n_text(bio)),
  department_id uuid references cms_departments (id) on delete set null,
  photo_path text,
  linkedin text check (linkedin is null or linkedin ~ '^https://'),
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_team (sort) where deleted_at is null;

create trigger cms_departments_touch before update on cms_departments for each row execute function cms_touch();
create trigger audit_cms_departments after insert or update or delete on cms_departments for each row execute function audit_trigger();
create trigger cms_team_touch before update on cms_team for each row execute function cms_touch();
create trigger audit_cms_team after insert or update or delete on cms_team for each row execute function audit_trigger();

alter table cms_departments enable row level security;
alter table cms_team enable row level security;
create policy cms_departments_public_read on cms_departments for select to anon, authenticated using (deleted_at is null and is_active);
create policy cms_departments_editor_all on cms_departments for all to authenticated using (can_manage_site()) with check (can_manage_site());
create policy cms_team_public_read on cms_team for select to anon, authenticated using (deleted_at is null and is_active);
create policy cms_team_editor_all on cms_team for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_departments, cms_team to anon;
grant select, insert, update, delete on cms_departments, cms_team to authenticated;

-- Örnek departmanlar (fotoğrafları admin'den eklenir; istemediğinizi silin)
insert into cms_departments (sort, name, description) values
(10, '{"tr":"Dijital tasarım (CAD)","en":"Digital design (CAD)","fr":"Conception numérique (CAO)"}',
     '{"tr":"Tarama dosyalarından restorasyonların 3D tasarımı.","en":"3D design of restorations from scan files.","fr":"Conception 3D des restaurations à partir des fichiers de scan."}'),
(20, '{"tr":"CNC ve 3D baskı (CAM)","en":"Milling and 3D printing (CAM)","fr":"Usinage et impression 3D (FAO)"}',
     '{"tr":"Zirkonyum, PMMA ve diğer malzemelerin frezelenmesi ve basılması.","en":"Milling and printing of zirconia, PMMA and other materials.","fr":"Usinage et impression de zircone, PMMA et autres matériaux."}'),
(30, '{"tr":"Porselen ve estetik","en":"Ceramics and aesthetics","fr":"Céramique et esthétique"}',
     '{"tr":"Renklendirme, porselen tabakalama ve son estetik dokunuşlar.","en":"Staining, ceramic layering and final aesthetic touches.","fr":"Maquillage, stratification céramique et finitions esthétiques."}'),
(40, '{"tr":"Kalite kontrol ve sevkiyat","en":"Quality control and shipping","fr":"Contrôle qualité et expédition"}',
     '{"tr":"Her işin son kontrolü, paketlenmesi ve teslimatı.","en":"Final check, packing and delivery of every case.","fr":"Contrôle final, emballage et livraison de chaque cas."}');

-- /<dil>/ekibimiz site sayfası: kurumsal sayfa adresi olarak kullanılamasın
alter table cms_pages drop constraint if exists cms_pages_slug_check;
alter table cms_pages add constraint cms_pages_slug_check check (
  slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60
  and slug not in ('urunler', 'iletisim', 'vaka-gonder', 'vakalar', 'sss', 'ekibimiz', 'admin', 'giris', 'auth', 'api', 'sayfa', 'portal')
);

-- Çöp temizliği ve değişiklik geçmişi yeni tabloları da kapsasın
create or replace function cms_purge_trash()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer := 0; c integer;
begin
  delete from cms_slides where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_announcements where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_products where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_stories where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_pages where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_cases where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_faqs where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_team where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_departments where deleted_at < now() - interval '30 days';
  get diagnostics c = row_count; n := n + c;
  delete from cms_chats where status = 'closed' and last_message_at < now() - interval '180 days';
  get diagnostics c = row_count; n := n + c;
  return n;
end $$;
revoke execute on function cms_purge_trash() from public, anon, authenticated;

create or replace function cms_audit(p_limit integer default 100, p_before bigint default null, p_table text default null)
returns table (
  id bigint, table_name text, row_id text, action text, at timestamptz,
  actor_email text, label text, changed text[]
)
language sql stable security definer set search_path = public as $$
  select a.id, a.table_name, a.row_id, a.action, a.at,
         u.email::text,
         coalesce(
           nullif(coalesce(a.new_data, a.old_data)->'title'->>'tr', ''),
           nullif(coalesce(a.new_data, a.old_data)->'name'->>'tr', ''),
           nullif(coalesce(a.new_data, a.old_data)->'question'->>'tr', ''),
           nullif(coalesce(a.new_data, a.old_data)->>'name', ''),
           coalesce(a.new_data, a.old_data)->>'slug',
           ''
         ),
         case when a.action = 'UPDATE' then (
           select array_agg(k order by k) from jsonb_object_keys(a.new_data) k
           where k not in ('updated_at', 'updated_by') and a.new_data->k is distinct from a.old_data->k
         ) end
  from audit_log a
  left join auth.users u on u.id = a.actor
  where can_manage_site()
    and a.table_name in ('cms_slides', 'cms_announcements', 'cms_products', 'cms_stories', 'cms_pages', 'cms_cases', 'cms_faqs', 'cms_team', 'cms_departments', 'cms_price_items', 'site_settings')
    and (p_before is null or a.id < p_before)
    and (p_table is null or a.table_name = p_table)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;
revoke execute on function cms_audit(integer, bigint, text) from public, anon;
grant execute on function cms_audit(integer, bigint, text) to authenticated;
