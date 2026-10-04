-- =====================================================================
-- Web sitesi: vaka galerisi ve admin değişiklik geçmişi
--
-- cms_cases: öncesi/sonrası görselli vaka örnekleri (sitede /<dil>/vakalar).
-- cms_audit(): site içeriğindeki değişiklik kayıtlarını (audit_log) site
--   editörlerine okutan fonksiyon. audit_log'un kendi okuma kuralı şirket
--   sahiplerine göredir; site tablolarında şirket olmadığı için bu fonksiyon gerekir.
-- =====================================================================

create table cms_cases (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null default '{}'::jsonb check (is_i18n_text(title)),
  description jsonb not null default '{}'::jsonb check (is_i18n_text(description)),
  product_slug text check (product_slug is null or product_slug ~ '^[a-z0-9-]{1,60}$'),
  teeth text check (teeth is null or length(teeth) <= 80),
  before_path text,
  after_path text,
  gallery text[] not null default '{}',
  featured boolean not null default false,
  sort integer not null default 0,
  is_active boolean not null default true,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_cases (sort) where deleted_at is null;

create trigger cms_cases_touch before update on cms_cases for each row execute function cms_touch();
create trigger audit_cms_cases after insert or update or delete on cms_cases for each row execute function audit_trigger();

alter table cms_cases enable row level security;
create policy cms_cases_public_read on cms_cases for select to anon, authenticated using (deleted_at is null and is_active);
create policy cms_cases_editor_all on cms_cases for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select on cms_cases to anon;
grant select, insert, update, delete on cms_cases to authenticated;

-- Çöp kutusu temizliği vakaları da kapsasın
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
  return n;
end $$;
revoke execute on function cms_purge_trash() from public, anon, authenticated;

-- Ayarlar tablosundaki kaydın da geçmişi tutulsun diye id metin olarak gelir
-- (audit_trigger "id" alanını kullanır; site_settings.id = 1).

-- ---------------------------------------------------------------------
-- Değişiklik geçmişi (yalnız site tabloları, yalnız site editörleri)
-- ---------------------------------------------------------------------
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
    and a.table_name in ('cms_slides', 'cms_announcements', 'cms_products', 'cms_stories', 'cms_pages', 'cms_cases', 'site_settings')
    and (p_before is null or a.id < p_before)
    and (p_table is null or a.table_name = p_table)
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 200);
$$;
revoke execute on function cms_audit(integer, bigint, text) from public, anon;
grant execute on function cms_audit(integer, bigint, text) to authenticated;
