-- =====================================================================
-- Genel fiyat listesi: yalnız laboratuvarın onay verdiği portal hesapları görür
--
-- cms_price_items: fiyat satırları (bölüm, ürün, birim, TL / EUR fiyat, not).
-- portal_accounts.price_access: laboratuvar onayı; price_requested_at: hekimin talebi.
-- Görme kuralı: site editörü YA DA aktif + fiyat erişimi onaylı portal hesabının üyesi.
-- =====================================================================

alter table portal_accounts add column if not exists price_access boolean not null default false;
alter table portal_accounts add column if not exists price_requested_at timestamptz;
alter table portal_accounts add column if not exists price_granted_at timestamptz;

create table cms_price_items (
  id uuid primary key default gen_random_uuid(),
  section jsonb not null default '{}'::jsonb check (is_i18n_text(section)),
  name jsonb not null default '{}'::jsonb check (is_i18n_text(name)),
  unit jsonb not null default '{}'::jsonb check (is_i18n_text(unit)),
  note jsonb not null default '{}'::jsonb check (is_i18n_text(note)),
  price_try numeric(12, 2) check (price_try is null or price_try >= 0),
  price_eur numeric(12, 2) check (price_eur is null or price_eur >= 0),
  sort integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on cms_price_items (sort);

create trigger cms_price_items_touch before update on cms_price_items for each row execute function cms_touch();
create trigger audit_cms_price_items after insert or update or delete on cms_price_items for each row execute function audit_trigger();

-- Fiyatları görebilir mi?
create or replace function can_see_prices() returns boolean
language sql stable security definer set search_path = public as $$
  select can_manage_site() or exists (
    select 1 from portal_members m join portal_accounts a on a.id = m.account_id
    where m.user_id = auth.uid() and a.status = 'active' and a.price_access
  );
$$;
revoke execute on function can_see_prices() from public, anon;
grant execute on function can_see_prices() to authenticated;

alter table cms_price_items enable row level security;
create policy cms_price_items_read on cms_price_items for select to authenticated using (can_manage_site() or (is_active and can_see_prices()));
create policy cms_price_items_editor_all on cms_price_items for all to authenticated using (can_manage_site()) with check (can_manage_site());
grant select, insert, update, delete on cms_price_items to authenticated;

-- Hekim / klinik / aracı: fiyat listesi talebi (yalnız kendi hesabı için)
create or replace function portal_request_prices() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare v_account uuid; v_at timestamptz := now();
begin
  select m.account_id into v_account from portal_members m where m.user_id = auth.uid() limit 1;
  if v_account is null then raise exception 'no_account' using errcode = 'P0001'; end if;
  update portal_accounts set price_requested_at = coalesce(price_requested_at, v_at) where id = v_account and not price_access;
  return v_at;
end $$;
revoke execute on function portal_request_prices() from public, anon;
grant execute on function portal_request_prices() to authenticated;

-- Bekleyen fiyat listesi talepleri (admin menüsü için)
create or replace function portal_price_requests_count() returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::int from portal_accounts where price_requested_at is not null and not price_access;
$$;
grant execute on function portal_price_requests_count() to authenticated;
