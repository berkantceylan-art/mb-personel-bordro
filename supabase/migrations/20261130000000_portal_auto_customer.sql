-- =====================================================================
-- Portal hesabı onaylanınca ERP'de otomatik cari / hekim kartı
--  - Hesap "aktif" olduğunda (onay) lab_customers kaydı açılır ya da var olan karta bağlanır:
--      1) zaten bağlı kart varsa → eksik iletişim bilgileri tamamlanır
--      2) bağlı olmayan, aynı e-posta ya da aynı telefonlu kart varsa → o karta bağlanır (çift kart olmaz)
--      3) yoksa → yeni kart (yurtdışı hesaplar € cari)
--  - Hekim adı kartın "hekimler" listesine eklenir; klinik / aracı kuruluşa katılan her kişi de eklenir
--  - Laboratuvar ekibine bildirim: "Yeni hekim cari kartı"
-- Tekrar çalıştırılabilir. Önce 20261125 (iş kayıt) ve 20261126 (portal-lab) çalıştırılmış olmalı.
-- =====================================================================

-- Düzeltme: zaman damgası tetikleyicisi "status" alanı olmayan tablolarda (hekim / ürün kartı) güncellemeyi bozuyordu
create or replace function lab_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  if tg_table_name = 'jobs' then
    if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function portal_digits(p text) returns text
language sql immutable as $$
  select right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10);
$$;

create or replace function portal_to_lab_customer(p_account uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare a portal_accounts; v_id uuid; v_new boolean := false; v_kind text;
begin
  select * into a from portal_accounts where id = p_account;
  if a.id is null then return null; end if;
  v_kind := case a.type::text when 'doctor_tr' then 'doctor_tr' when 'doctor_foreign' then 'doctor_foreign' when 'clinic' then 'clinic' else 'agency' end;

  select id into v_id from lab_customers where portal_account_id = a.id;
  if v_id is null then
    -- Aynı e-posta / telefonla ERP'de önceden açılmış kart: ona bağla
    select id into v_id from lab_customers
    where portal_account_id is null
      and ((a.email is not null and lower(email) = lower(a.email))
        or (length(portal_digits(a.phone)) = 10 and portal_digits(phone) = portal_digits(a.phone)))
    order by created_at limit 1;
    if v_id is not null then
      update lab_customers set portal_account_id = a.id where id = v_id;
    end if;
  end if;

  if v_id is null then
    insert into lab_customers (company_id, name, kind, portal_account_id, currency, phone, email, country, city)
    values (lab_company(), left(coalesce(nullif(a.company, ''), a.name), 160), v_kind, a.id,
            case when coalesce(a.country, 'TR') in ('TR', 'Türkiye', 'Turkey') then 'TRY' else 'EUR' end,
            a.phone, a.email, coalesce(nullif(a.country, ''), 'TR'), a.city)
    returning id into v_id;
    v_new := true;
  else
    update lab_customers set
      phone = coalesce(phone, a.phone), email = coalesce(email, a.email), city = coalesce(city, a.city), updated_at = now()
    where id = v_id;
  end if;

  -- Hesap sahibinin adı hekim listesine (klinik / kuruluş adı ile aynı değilse)
  if a.name is not null and length(trim(a.name)) > 0 and not exists (
    select 1 from lab_customer_doctors where customer_id = v_id and lower(name) = lower(trim(a.name))
  ) then
    insert into lab_customer_doctors (customer_id, name, phone) values (v_id, left(trim(a.name), 120), a.phone);
  end if;

  if v_new then
    begin
      perform deliver(lab_company(), lab_recipients(), 'Yeni hekim cari kartı',
                      left(coalesce(nullif(a.company, ''), a.name), 120) || ' portalda onaylandı; cari kartı açıldı.',
                      '/isler/hekimler/' || v_id);
    exception when others then null;   -- bildirim hatası kartı engellemesin
    end;
  end if;
  return v_id;
end $$;
revoke execute on function portal_to_lab_customer(uuid) from public, anon, authenticated;

-- Onay (status → active) ya da doğrudan aktif açılan hesap
create or replace function portal_account_activated() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'active' and (tg_op = 'INSERT' or old.status is distinct from 'active') then
    perform portal_to_lab_customer(new.id);
  end if;
  return new;
exception when others then
  raise warning 'portal_to_lab_customer: %', sqlerrm;
  return new;   -- cari kartı açılamasa da onay kaydedilsin
end $$;
drop trigger if exists portal_account_activated on portal_accounts;
create trigger portal_account_activated after insert or update of status on portal_accounts
  for each row execute function portal_account_activated();

-- Klinik / kuruluşa katılan kişi → hekim listesine
create or replace function portal_member_to_doctor() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_cust uuid; v_name text;
begin
  v_name := trim(coalesce(new.display_name, ''));
  if length(v_name) = 0 then return new; end if;
  select id into v_cust from lab_customers where portal_account_id = new.account_id;
  if v_cust is not null and not exists (select 1 from lab_customer_doctors where customer_id = v_cust and lower(name) = lower(v_name)) then
    insert into lab_customer_doctors (customer_id, name) values (v_cust, left(v_name, 120));
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists portal_member_to_doctor on portal_members;
create trigger portal_member_to_doctor after insert or update of display_name on portal_members
  for each row execute function portal_member_to_doctor();

-- Şu an aktif olup kartı olmayan hesaplar için bir kez çalıştır
do $$
declare r record;
begin
  for r in select a.id from portal_accounts a where a.status = 'active'
           and not exists (select 1 from lab_customers c where c.portal_account_id = a.id) loop
    perform portal_to_lab_customer(r.id);
  end loop;
end $$;

notify pgrst, 'reload schema';
