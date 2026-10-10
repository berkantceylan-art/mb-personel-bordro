-- Tek giriş: aynı kullanıcı adı / şifreyle web sitesi yönetimi + ERP modülleri.
-- Şirket sahibi, herhangi bir role (İK, muhasebe, şef...) ek olarak "Web sitesi yönetimi" yetkisi verebilir.
-- Tekrar çalıştırılabilir.

alter table memberships add column if not exists site_access boolean not null default false;

-- Site yönetimi yetkisi: sahip, site editörü ya da site_access işaretli kullanıcı
create or replace function can_manage_site()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from memberships m
    where m.user_id = auth.uid() and (m.role in ('owner', 'site_editor') or m.site_access)
  );
$$;

notify pgrst, 'reload schema';
