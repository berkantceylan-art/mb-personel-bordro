-- =====================================================================
-- Hekim / klinik / aracı kuruluş portalı (temel)
--
-- portal_accounts : başvuran kurum ya da hekim (onay bekler → aktif)
-- portal_members  : hesaba bağlı kullanıcılar (auth.users)
-- portal_cases    : gönderilen vakalar (hasta adı değil, kısa hasta kodu tutulur)
-- portal_case_files / portal_case_events : dosyalar ve vaka geçmişi
-- portal-files    : gizli depo; yol = <hesap_id>/<vaka_id>/<uuid>-<dosya>
-- Laboratuvar tarafı (owner / site_editor) her şeyi görür ve yönetir.
-- =====================================================================

create type portal_account_type as enum ('doctor_tr', 'doctor_foreign', 'clinic', 'agency');
create type portal_account_status as enum ('pending', 'active', 'suspended');
create type portal_case_status as enum ('received', 'design', 'production', 'quality', 'shipped', 'delivered', 'on_hold', 'cancelled');

create table portal_accounts (
  id uuid primary key default gen_random_uuid(),
  type portal_account_type not null,
  status portal_account_status not null default 'pending',
  name text not null check (length(name) between 2 and 160),
  company text check (company is null or length(company) <= 160),
  country text not null default 'TR' check (length(country) between 2 and 60),
  city text check (city is null or length(city) <= 80),
  phone text check (phone is null or length(phone) <= 40),
  email text check (email is null or length(email) <= 200),
  language text not null default 'tr' check (language in ('tr', 'en', 'fr')),
  note text,
  approved_at timestamptz,
  approved_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on portal_accounts (status, created_at desc);

create table portal_members (
  account_id uuid not null references portal_accounts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (account_id, user_id)
);
create index on portal_members (user_id);

create trigger portal_accounts_touch before update on portal_accounts for each row execute function cms_touch();
create trigger audit_portal_accounts after insert or update or delete on portal_accounts for each row execute function audit_trigger();

-- Yetki yardımcıları
create or replace function is_portal_member(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from portal_members where account_id = p_account and user_id = auth.uid());
$$;

create or replace function is_portal_active(p_account uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from portal_members m join portal_accounts a on a.id = m.account_id
    where m.account_id = p_account and m.user_id = auth.uid() and a.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- Vakalar
-- ---------------------------------------------------------------------
create sequence portal_case_no start 1001;

create or replace function is_fdi_teeth(v smallint[]) returns boolean
language sql immutable as $$
  select v is null or (
    cardinality(v) <= 32
    and not exists (select 1 from unnest(v) t where t / 10 not between 1 and 4 or t % 10 not between 1 and 8)
  );
$$;

create table portal_cases (
  id uuid primary key default gen_random_uuid(),
  no bigint not null unique default nextval('portal_case_no'),
  account_id uuid not null references portal_accounts (id) on delete restrict,
  created_by uuid default auth.uid(),
  patient_ref text not null check (length(patient_ref) between 1 and 40),
  product_slug text check (product_slug is null or product_slug ~ '^[a-z0-9-]{1,60}$'),
  teeth smallint[] check (is_fdi_teeth(teeth)),
  shade text check (shade is null or length(shade) <= 40),
  due_date date,
  notes text check (notes is null or length(notes) <= 4000),
  status portal_case_status not null default 'received',
  tracking text check (tracking is null or length(tracking) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index on portal_cases (account_id, created_at desc);
create index on portal_cases (status, created_at desc);

create table portal_case_files (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references portal_cases (id) on delete cascade,
  path text not null unique,
  name text not null check (length(name) <= 200),
  size bigint,
  mime text,
  from_lab boolean not null default false,
  uploaded_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on portal_case_files (case_id);

create table portal_case_events (
  id bigint generated always as identity primary key,
  case_id uuid not null references portal_cases (id) on delete cascade,
  kind text not null check (kind in ('status', 'message', 'file')),
  status portal_case_status,
  body text check (body is null or length(body) <= 4000),
  from_lab boolean not null default false,
  author uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index on portal_case_events (case_id, id);

create trigger portal_cases_touch before update on portal_cases for each row execute function cms_touch();
create trigger audit_portal_cases after insert or update or delete on portal_cases for each row execute function audit_trigger();

-- Vaka açılınca ve durum değişince geçmişe kayıt düş
create or replace function portal_case_status_event() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into portal_case_events (case_id, kind, status, from_lab, author) values (new.id, 'status', new.status, false, new.created_by);
  elsif new.status is distinct from old.status then
    insert into portal_case_events (case_id, kind, status, from_lab, author) values (new.id, 'status', new.status, true, auth.uid());
  end if;
  return new;
end $$;
create trigger portal_case_status_event after insert or update of status on portal_cases for each row execute function portal_case_status_event();

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table portal_accounts enable row level security;
alter table portal_members enable row level security;
alter table portal_cases enable row level security;
alter table portal_case_files enable row level security;
alter table portal_case_events enable row level security;

create policy portal_accounts_read on portal_accounts for select to authenticated using (is_portal_member(id) or can_manage_site());
create policy portal_accounts_lab_write on portal_accounts for update to authenticated using (can_manage_site()) with check (can_manage_site());
create policy portal_accounts_lab_delete on portal_accounts for delete to authenticated using (can_manage_site());

create policy portal_members_read on portal_members for select to authenticated using (user_id = auth.uid() or can_manage_site());
create policy portal_members_lab_write on portal_members for all to authenticated using (can_manage_site()) with check (can_manage_site());

create policy portal_cases_read on portal_cases for select to authenticated using (is_portal_member(account_id) or can_manage_site());
create policy portal_cases_insert on portal_cases for insert to authenticated
  with check (is_portal_active(account_id) and created_by = auth.uid() and status = 'received');
create policy portal_cases_lab_update on portal_cases for update to authenticated using (can_manage_site()) with check (can_manage_site());

create policy portal_files_read on portal_case_files for select to authenticated
  using (can_manage_site() or exists (select 1 from portal_cases c where c.id = case_id and is_portal_member(c.account_id)));
create policy portal_files_insert on portal_case_files for insert to authenticated
  with check (
    uploaded_by = auth.uid() and (
      (can_manage_site() and from_lab)
      or (not from_lab and exists (select 1 from portal_cases c where c.id = case_id and is_portal_active(c.account_id)))
    )
  );
create policy portal_files_lab_delete on portal_case_files for delete to authenticated using (can_manage_site());

create policy portal_events_read on portal_case_events for select to authenticated
  using (can_manage_site() or exists (select 1 from portal_cases c where c.id = case_id and is_portal_member(c.account_id)));
create policy portal_events_insert on portal_case_events for insert to authenticated
  with check (
    author = auth.uid() and kind in ('message', 'file') and (
      (can_manage_site() and from_lab)
      or (not from_lab and exists (select 1 from portal_cases c where c.id = case_id and is_portal_active(c.account_id)))
    )
  );

grant select, update, delete on portal_accounts to authenticated;
grant select, insert, update, delete on portal_members to authenticated;
grant select, insert, update on portal_cases to authenticated;
grant usage on sequence portal_case_no to authenticated;
grant select, insert, delete on portal_case_files to authenticated;
grant select, insert on portal_case_events to authenticated;

-- ---------------------------------------------------------------------
-- Başvuru: giriş yapmış kullanıcı kendi hesabını (onay bekler) açar
-- ---------------------------------------------------------------------
create or replace function portal_register(
  p_type text, p_name text, p_company text, p_country text, p_city text, p_phone text, p_language text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_email text;
begin
  if v_uid is null then raise exception 'not_authenticated' using errcode = 'P0001'; end if;
  select account_id into v_id from portal_members where user_id = v_uid limit 1;
  if v_id is not null then return v_id; end if;
  if p_type not in ('doctor_tr', 'doctor_foreign', 'clinic', 'agency') then raise exception 'bad_type' using errcode = 'P0001'; end if;
  select email into v_email from auth.users where id = v_uid;
  insert into portal_accounts (type, name, company, country, city, phone, email, language)
  values (
    p_type::portal_account_type, left(trim(p_name), 160), nullif(left(trim(coalesce(p_company, '')), 160), ''),
    coalesce(nullif(left(trim(coalesce(p_country, '')), 60), ''), 'TR'), nullif(left(trim(coalesce(p_city, '')), 80), ''),
    nullif(left(trim(coalesce(p_phone, '')), 40), ''), v_email,
    case when p_language in ('tr', 'en', 'fr') then p_language else 'tr' end
  ) returning id into v_id;
  insert into portal_members (account_id, user_id, role) values (v_id, v_uid, 'admin');
  return v_id;
end $$;
revoke execute on function portal_register(text, text, text, text, text, text, text) from public, anon;
grant execute on function portal_register(text, text, text, text, text, text, text) to authenticated;

-- Onay bekleyen başvuru sayısı (admin menüsü)
create or replace function portal_pending_count() returns integer
language sql stable security invoker set search_path = public as $$
  select count(*)::int from portal_accounts where status = 'pending';
$$;
grant execute on function portal_pending_count() to authenticated;

-- ---------------------------------------------------------------------
-- Gizli dosya deposu
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portal-files', 'portal-files', false, 52428800, null)
on conflict (id) do nothing;

create policy "portal_files_read" on storage.objects for select to authenticated
  using (bucket_id = 'portal-files' and (can_manage_site() or is_portal_member(((storage.foldername(name))[1])::uuid)));
create policy "portal_files_write" on storage.objects for insert to authenticated
  with check (bucket_id = 'portal-files' and (can_manage_site() or is_portal_active(((storage.foldername(name))[1])::uuid)));
create policy "portal_files_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'portal-files' and can_manage_site());
