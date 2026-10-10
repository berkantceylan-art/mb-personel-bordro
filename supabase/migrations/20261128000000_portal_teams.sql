-- =====================================================================
-- Portal: klinik ekibi (çok kullanıcı), aracı kuruluş müşterileri, logo; hekime özel fiyat
--  portal_invites   : hesap yöneticisinin ürettiği katılma kodları (klinik → hekim / asistan)
--  portal_clients   : aracı kuruluşun (ya da kliniğin) kendi müşterileri / hekimleri
--  portal_cases.client_id : vakanın hangi alt müşteri için gönderildiği
--  portal_accounts.logo_path : belgelerde kullanılacak logo (portal-files deposu)
--  lab_customer_prices : hekim / kurum bazında ürün özel fiyatı (ERP iş kayıtta önceliklidir)
-- Tekrar çalıştırılabilir.
-- =====================================================================

alter table portal_members add column if not exists display_name text check (display_name is null or length(display_name) <= 120);
alter table portal_members add column if not exists email text check (email is null or length(email) <= 200);
alter table portal_accounts add column if not exists logo_path text check (logo_path is null or length(logo_path) <= 300);

create or replace function is_portal_admin(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_members where account_id = p_account and user_id = auth.uid() and role = 'admin');
$$;

-- Aynı hesabın üyeleri birbirini görebilsin (ekip sayfası)
drop policy if exists portal_members_read on portal_members;
create policy portal_members_read on portal_members for select to authenticated
  using (user_id = auth.uid() or is_portal_member(account_id) or can_manage_site());

-- Hesap yöneticisi logo ve iletişim bilgisini güncelleyebilsin (durum / tür değil)
create or replace function portal_update_profile(p_account uuid, p_logo text, p_phone text, p_city text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_portal_admin(p_account) then raise exception 'not_allowed'; end if;
  if p_logo is not null and p_logo <> '' and p_logo not like p_account::text || '/%' then raise exception 'bad_path'; end if;
  update portal_accounts set
    logo_path = case when p_logo is null then logo_path when p_logo = '' then null else left(p_logo, 300) end,
    phone = coalesce(nullif(left(trim(coalesce(p_phone, '')), 40), ''), phone),
    city = coalesce(nullif(left(trim(coalesce(p_city, '')), 80), ''), city)
  where id = p_account;
end $$;
revoke execute on function portal_update_profile(uuid, text, text, text) from public, anon;
grant execute on function portal_update_profile(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Katılma kodları
-- ---------------------------------------------------------------------
create table if not exists portal_invites (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references portal_accounts (id) on delete cascade,
  code text not null unique,
  display_name text check (display_name is null or length(display_name) <= 120),
  role text not null default 'member' check (role in ('admin', 'member')),
  created_by uuid default auth.uid(),
  expires_at timestamptz not null default now() + interval '14 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table portal_invites enable row level security;
drop policy if exists portal_invites_admin on portal_invites;
create policy portal_invites_admin on portal_invites for select to authenticated using (is_portal_admin(account_id) or can_manage_site());
drop policy if exists portal_invites_delete on portal_invites;
create policy portal_invites_delete on portal_invites for delete to authenticated using (is_portal_admin(account_id));

create or replace function portal_create_invite(p_account uuid, p_name text, p_role text default 'member')
returns text language plpgsql security definer set search_path = public as $$
declare c text; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if not is_portal_admin(p_account) or not is_portal_active(p_account) then raise exception 'not_allowed'; end if;
  if (select count(*) from portal_invites where account_id = p_account and created_at > now() - interval '1 day') >= 20 then raise exception 'rate_limited'; end if;
  loop
    c := '';
    for i in 1..10 loop c := c || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
    exit when not exists (select 1 from portal_invites where code = c);
  end loop;
  insert into portal_invites (account_id, code, display_name, role)
  values (p_account, c, nullif(left(trim(coalesce(p_name, '')), 120), ''), case when p_role = 'admin' then 'admin' else 'member' end);
  return c;
end $$;
revoke execute on function portal_create_invite(uuid, text, text) from public, anon;
grant execute on function portal_create_invite(uuid, text, text) to authenticated;

-- Kodla hesaba katıl (giriş yapmış, henüz hiçbir portal hesabına bağlı olmayan kullanıcı)
create or replace function portal_join(p_code text, p_name text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare inv portal_invites; v_uid uuid := auth.uid(); v_email text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from portal_members where user_id = v_uid) then raise exception 'already_member'; end if;
  select * into inv from portal_invites where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) for update;
  if inv.id is null or inv.used_at is not null or inv.expires_at < now() then raise exception 'invalid_code'; end if;
  select email into v_email from auth.users where id = v_uid;
  insert into portal_members (account_id, user_id, role, display_name, email)
  values (inv.account_id, v_uid, inv.role, coalesce(nullif(left(trim(coalesce(p_name, '')), 120), ''), inv.display_name), v_email);
  update portal_invites set used_by = v_uid, used_at = now() where id = inv.id;
  return inv.account_id;
end $$;
revoke execute on function portal_join(text, text) from public, anon;
grant execute on function portal_join(text, text) to authenticated;

create or replace function portal_remove_member(p_account uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_portal_admin(p_account) then raise exception 'not_allowed'; end if;
  if p_user = auth.uid() then raise exception 'self'; end if;
  delete from portal_members where account_id = p_account and user_id = p_user;
end $$;
revoke execute on function portal_remove_member(uuid, uuid) from public, anon;
grant execute on function portal_remove_member(uuid, uuid) to authenticated;

-- Kayıtlı üyelerin adını / e-postasını doldur (ekip listesi)
update portal_members m set email = u.email from auth.users u where u.id = m.user_id and m.email is null;
update portal_members m set display_name = a.name from portal_accounts a where a.id = m.account_id and m.display_name is null and m.role = 'admin';

-- ---------------------------------------------------------------------
-- Aracı kuruluş / klinik müşterileri
-- ---------------------------------------------------------------------
create table if not exists portal_clients (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references portal_accounts (id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  country text check (country is null or length(country) <= 60),
  city text check (city is null or length(city) <= 80),
  phone text check (phone is null or length(phone) <= 40),
  note text check (note is null or length(note) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists portal_clients_idx on portal_clients (account_id, name);
alter table portal_clients enable row level security;
drop policy if exists portal_clients_read on portal_clients;
create policy portal_clients_read on portal_clients for select to authenticated using (is_portal_member(account_id) or can_manage_site() or can_logistics());
drop policy if exists portal_clients_write on portal_clients;
create policy portal_clients_write on portal_clients for all to authenticated using (is_portal_active(account_id)) with check (is_portal_active(account_id));

alter table portal_cases add column if not exists client_id uuid references portal_clients (id) on delete set null;

-- ---------------------------------------------------------------------
-- Hekime / kuruma özel fiyat (ERP)
-- ---------------------------------------------------------------------
create table if not exists lab_customer_prices (
  customer_id uuid not null references lab_customers (id) on delete cascade,
  product_id uuid not null references lab_products (id) on delete cascade,
  price_try bigint check (price_try is null or price_try >= 0),
  price_eur bigint check (price_eur is null or price_eur >= 0),
  primary key (customer_id, product_id)
);
alter table lab_customer_prices enable row level security;
drop policy if exists lab_customer_prices_lab on lab_customer_prices;
create policy lab_customer_prices_lab on lab_customer_prices for all to authenticated using (can_logistics()) with check (can_logistics());

notify pgrst, 'reload schema';
