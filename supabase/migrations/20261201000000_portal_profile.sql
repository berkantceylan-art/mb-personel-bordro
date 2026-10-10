-- =====================================================================
-- Hekim portalı: profil sayfası
--  portal_accounts : kurum / muayenehane bilgileri (adres, teslimat, fatura, web, sosyal, tercihler)
--  portal_members  : kişinin kendi bilgileri (unvan, uzmanlık, cep, oda sicil no)
--  portal_update_account()    : yalnız hesap yöneticisi; izinli alanlar
--  portal_update_my_profile() : herkes kendi satırını
--  Değişen iletişim / fatura bilgisi ERP cari kartına (lab_customers) otomatik yansır
-- Tekrar çalıştırılabilir. Önce 20261128 (ekip) ve 20261125 (iş kayıt) çalıştırılmış olmalı.
-- =====================================================================

alter table portal_accounts add column if not exists website text check (website is null or length(website) <= 200);
alter table portal_accounts add column if not exists instagram text check (instagram is null or length(instagram) <= 100);
alter table portal_accounts add column if not exists whatsapp text check (whatsapp is null or length(whatsapp) <= 40);
alter table portal_accounts add column if not exists contact_email text check (contact_email is null or length(contact_email) <= 200);
alter table portal_accounts add column if not exists address text check (address is null or length(address) <= 300);
alter table portal_accounts add column if not exists district text check (district is null or length(district) <= 80);
alter table portal_accounts add column if not exists postal_code text check (postal_code is null or length(postal_code) <= 20);
alter table portal_accounts add column if not exists delivery_address text check (delivery_address is null or length(delivery_address) <= 300);
alter table portal_accounts add column if not exists delivery_note text check (delivery_note is null or length(delivery_note) <= 300);
alter table portal_accounts add column if not exists working_hours text check (working_hours is null or length(working_hours) <= 200);
alter table portal_accounts add column if not exists invoice_title text check (invoice_title is null or length(invoice_title) <= 200);
alter table portal_accounts add column if not exists tax_office text check (tax_office is null or length(tax_office) <= 80);
alter table portal_accounts add column if not exists tax_no text check (tax_no is null or length(tax_no) <= 20);
alter table portal_accounts add column if not exists invoice_address text check (invoice_address is null or length(invoice_address) <= 300);
alter table portal_accounts add column if not exists e_invoice boolean not null default false;
alter table portal_accounts add column if not exists shade_system text check (shade_system is null or length(shade_system) <= 40);
alter table portal_accounts add column if not exists preferred_carrier text check (preferred_carrier is null or length(preferred_carrier) <= 40);
alter table portal_accounts add column if not exists about text check (about is null or length(about) <= 1000);

alter table portal_members add column if not exists title text check (title is null or length(title) <= 40);
alter table portal_members add column if not exists specialty text check (specialty is null or length(specialty) <= 80);
alter table portal_members add column if not exists phone text check (phone is null or length(phone) <= 40);
alter table portal_members add column if not exists chamber_no text check (chamber_no is null or length(chamber_no) <= 40);

-- Hesap (kurum) bilgileri: yalnız hesap yöneticisi; yalnız listelenen alanlar değişir
create or replace function portal_update_account(p_account uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  f text;
  lim int;
  v text;
  allowed constant jsonb := '{"name":160,"company":160,"country":60,"city":80,"phone":40,"website":200,"instagram":100,"whatsapp":40,
    "contact_email":200,"address":300,"district":80,"postal_code":20,"delivery_address":300,"delivery_note":300,"working_hours":200,
    "invoice_title":200,"tax_office":80,"tax_no":20,"invoice_address":300,"shade_system":40,"preferred_carrier":40,"about":1000}';
begin
  if not is_portal_admin(p_account) then raise exception 'not_allowed'; end if;
  for f, lim in select key, value::int from jsonb_each_text(allowed) loop
    if p ? f then
      v := nullif(left(trim(coalesce(p->>f, '')), lim), '');
      if f = 'name' and (v is null or length(v) < 2) then raise exception 'name_required'; end if;
      if f = 'country' and v is null then v := 'TR'; end if;
      if f = 'website' and v is not null and v !~* '^https?://' then v := 'https://' || v; end if;
      execute format('update portal_accounts set %I = $1 where id = $2', f) using v, p_account;
    end if;
  end loop;
  if p ? 'e_invoice' then
    update portal_accounts set e_invoice = coalesce((p->>'e_invoice')::boolean, false) where id = p_account;
  end if;
end $$;
revoke execute on function portal_update_account(uuid, jsonb) from public, anon;
grant execute on function portal_update_account(uuid, jsonb) to authenticated;

-- Kişinin kendi bilgileri (her üye)
create or replace function portal_update_my_profile(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  update portal_members set
    display_name = case when p ? 'display_name' then nullif(left(trim(coalesce(p->>'display_name', '')), 120), '') else display_name end,
    title        = case when p ? 'title' then nullif(left(trim(coalesce(p->>'title', '')), 40), '') else title end,
    specialty    = case when p ? 'specialty' then nullif(left(trim(coalesce(p->>'specialty', '')), 80), '') else specialty end,
    phone        = case when p ? 'phone' then nullif(left(trim(coalesce(p->>'phone', '')), 40), '') else phone end,
    chamber_no   = case when p ? 'chamber_no' then nullif(left(trim(coalesce(p->>'chamber_no', '')), 40), '') else chamber_no end
  where user_id = auth.uid();
end $$;
revoke execute on function portal_update_my_profile(jsonb) from public, anon;
grant execute on function portal_update_my_profile(jsonb) to authenticated;

-- Giriş e-postası değişince üye kaydındaki e-postayı da güncelle (Supabase onaydan sonra auth.users'ı değiştirir)
create or replace function portal_sync_member_email() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email is distinct from old.email then
    update portal_members set email = new.email where user_id = new.id;
    update portal_accounts a set email = new.email
    from portal_members m where m.account_id = a.id and m.user_id = new.id and m.role = 'admin' and lower(coalesce(a.email, '')) = lower(coalesce(old.email, ''));
  end if;
  return new;
exception when others then return new;
end $$;
drop trigger if exists portal_sync_member_email on auth.users;
create trigger portal_sync_member_email after update of email on auth.users for each row execute function portal_sync_member_email();

-- Portal bilgileri → ERP cari kartı (hekim kaynaktır: iletişim ve fatura alanları)
create or replace function portal_account_to_lab() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_addr text;
begin
  if to_regclass('public.lab_customers') is null then return new; end if;
  v_addr := nullif(concat_ws(', ', coalesce(new.invoice_address, new.address), new.district, new.postal_code), '');
  update lab_customers set
    phone = coalesce(new.phone, phone),
    email = coalesce(new.contact_email, new.email, email),
    city = coalesce(new.city, city),
    country = coalesce(nullif(new.country, ''), country),
    address = coalesce(left(v_addr, 400), address),
    tax_office = coalesce(new.tax_office, tax_office),
    tax_no = coalesce(new.tax_no, tax_no),
    updated_at = now()
  where portal_account_id = new.id;
  return new;
exception when others then
  raise warning 'portal_account_to_lab: %', sqlerrm;
  return new;
end $$;
drop trigger if exists portal_account_to_lab on portal_accounts;
create trigger portal_account_to_lab after update of phone, email, contact_email, city, country, address, district, postal_code, invoice_address, tax_office, tax_no
  on portal_accounts for each row execute function portal_account_to_lab();

notify pgrst, 'reload schema';
