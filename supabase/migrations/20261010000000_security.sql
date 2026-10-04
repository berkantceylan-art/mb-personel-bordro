-- =====================================================================
-- Migration 8: Güvenlik düzeltmeleri (denetim raporu 1. adım)
--  K3  Personel kaydı ele geçirme (sahte şirket + davet) ve şirketler arası veri yazma
--  K4  Davet kodu deneme sınırı, ön izlemenin herkese açık olmaması
--  Y1  İK'nın kendine maaş yetkisi vermesi
--  Y7  Sahte bildirim ile oltalama
-- =====================================================================

-- ---------------------------------------------------------------------
-- K3a) Yeni şirket kurulumu: yalnız sistemde hiç şirket yokken (ilk kurulum)
-- ---------------------------------------------------------------------
create or replace function create_company(p_name text, p_branch text default 'Merkez')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_company uuid; v_branch uuid;
begin
  if auth.uid() is null then raise exception 'Giriş gerekli'; end if;
  if exists (select 1 from companies) then
    raise exception 'Yeni şirket kurulumu kapalı. Yöneticinizden davet kodu isteyin.';
  end if;
  insert into companies (name) values (p_name) returning id into v_company;
  insert into branches (company_id, name) values (v_company, p_branch) returning id into v_branch;
  insert into memberships (user_id, company_id, role, all_branches) values (auth.uid(), v_company, 'owner', true);
  insert into devices (company_id, branch_id, code, direction, name) values
    (v_company, v_branch, '002', 'IN', 'Giriş cihazı'),
    (v_company, v_branch, '001', 'OUT', 'Çıkış cihazı');
  return v_company;
end $$;
revoke execute on function create_company(text, text) from public, anon;

-- ---------------------------------------------------------------------
-- K3b) Personele bağlı her kayıt, personelin kendi şirketinde olmalı
--      (başka şirketin personeline ücret/hareket/izin yazılamaz)
-- ---------------------------------------------------------------------
create or replace function check_employee_company() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.employee_id is not null and not exists (
    select 1 from employees e where e.id = new.employee_id and e.company_id = new.company_id
  ) then
    raise exception 'Personel bu şirkete ait değil';
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'pay_contracts', 'ledger_entries', 'employee_private', 'employee_documents', 'leave_requests', 'leave_adjustments',
    'overtime_records', 'shift_assignments', 'attendance_punches', 'advance_requests', 'bes_enrollments',
    'garnishment_files', 'garnishment_deductions', 'payroll_lines', 'training_records', 'health_exams',
    'ppe_issues', 'safety_incidents', 'invites', 'shifts'
  ] loop
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'employee_id')
       and exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = t and column_name = 'company_id') then
      execute format('drop trigger if exists aaa_employee_company on %I', t);
      -- "aaa_" adı, aynı tablodaki diğer BEFORE tetikleyicilerinden önce çalışmasını sağlar
      execute format('create trigger aaa_employee_company before insert or update of employee_id, company_id on %I for each row execute function check_employee_company()', t);
    end if;
  end loop;
end $$;

-- Personelin şubesi de kendi şirketinde olmalı
create or replace function check_employee_branch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from branches b where b.id = new.branch_id and b.company_id = new.company_id) then
    raise exception 'Şube bu şirkete ait değil';
  end if;
  return new;
end $$;
drop trigger if exists aaa_employee_branch on employees;
create trigger aaa_employee_branch before insert or update of branch_id, company_id on employees
  for each row execute function check_employee_branch();

-- ---------------------------------------------------------------------
-- K3c / Y1) Personel kaydını bir hesaba bağlamak yalnız davetle olur
-- ---------------------------------------------------------------------
create or replace function guard_employee_user_link() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null
     and (tg_op = 'INSERT' or new.user_id is distinct from old.user_id)
     and coalesce(current_setting('mb.allow_user_link', true), '') <> 'on' then
    raise exception 'Personel kaydı bir hesaba yalnız davet koduyla bağlanabilir';
  end if;
  return new;
end $$;
drop trigger if exists aab_employee_user_link on employees;
create trigger aab_employee_user_link before insert or update of user_id on employees
  for each row execute function guard_employee_user_link();

-- ---------------------------------------------------------------------
-- Y1) Davet yetkisi: İK yalnız personel, şube sorumlusu ve İSG daveti oluşturur
-- ---------------------------------------------------------------------
drop policy if exists invites_manage on invites;
create policy invites_read on invites for select using (has_role(company_id, array['owner', 'hr']::app_role[]));
create policy invites_write on invites for insert with check (
  has_role(company_id, array['owner']::app_role[])
  or (has_role(company_id, array['hr']::app_role[]) and role in ('employee', 'branch_manager', 'safety'))
);
create policy invites_delete on invites for delete using (has_role(company_id, array['owner', 'hr']::app_role[]));

-- ---------------------------------------------------------------------
-- K4) Davet denemeleri: sınırlı, sunucu tarafında
-- ---------------------------------------------------------------------
create table if not exists invite_attempts (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists invite_attempts_key_at on invite_attempts (key, at desc);
alter table invite_attempts enable row level security;  -- politika yok: istemciler erişemez

-- Son 15 dakikada 10 denemeden fazlası reddedilir (anahtar: IP veya kullanıcı)
create or replace function invite_rate_ok(p_key text) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  delete from invite_attempts where at < now() - interval '1 day';
  select count(*) into n from invite_attempts where key = p_key and at > now() - interval '15 minutes';
  if n >= 10 then return false; end if;
  insert into invite_attempts (key) values (p_key);
  return true;
end $$;
revoke execute on function invite_rate_ok(text) from public, anon, authenticated;

-- Kod karşılaştırması: tire/boşluk yok sayılır, büyük harf
create or replace function invite_norm(p_code text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
$$;

-- Ön izleme artık yalnız sunucu (service_role) üzerinden: herkese açık deneme yok
create or replace function invite_preview(p_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'company', c.name,
    'role', i.role,
    'display_name', coalesce(i.display_name, e.first_name || ' ' || e.last_name),
    'login_email', i.login_email,
    'valid', i.used_at is null and i.expires_at > now()
  )
  from invites i
  join companies c on c.id = i.company_id
  left join employees e on e.id = i.employee_id
  where i.code = invite_norm(p_code);
$$;
revoke execute on function invite_preview(text) from public, anon, authenticated;

-- Davet kullanma: şirket/personel tutarlılığı, rol değiştirmeme, deneme sınırı
create or replace function claim_invite(p_code text)
returns json language plpgsql security definer set search_path = public as $$
declare inv invites; name text; emp employees; cur memberships;
begin
  if auth.uid() is null then raise exception 'Önce giriş yapın'; end if;
  if not invite_rate_ok('claim:' || auth.uid()) then
    return json_build_object('error', 'Çok fazla deneme. 15 dakika sonra tekrar deneyin.');
  end if;
  select * into inv from invites where code = invite_norm(p_code) for update;
  if inv.id is null or (inv.used_at is not null and inv.used_by is distinct from auth.uid()) or inv.expires_at < now() then
    return json_build_object('error', 'Davet kodu geçersiz, kullanılmış ya da süresi dolmuş.');
  end if;

  if inv.employee_id is not null then
    select * into emp from employees where id = inv.employee_id;
    if emp.id is null or emp.company_id <> inv.company_id then raise exception 'Davet geçersiz'; end if;
    if emp.user_id is not null and emp.user_id <> auth.uid() then
      raise exception 'Bu personel kaydı başka bir hesaba bağlı. Yöneticinizle görüşün.';
    end if;
  end if;

  select * into cur from memberships where user_id = auth.uid() and company_id = inv.company_id;
  if cur.user_id is not null and cur.role <> inv.role then
    raise exception 'Bu hesap şirkete zaten farklı bir rolle bağlı.';
  end if;

  name := coalesce(inv.display_name, emp.first_name || ' ' || emp.last_name);
  if cur.user_id is null then
    insert into memberships (user_id, company_id, role, all_branches, display_name)
    values (auth.uid(), inv.company_id, inv.role, inv.all_branches or inv.role in ('owner', 'accountant', 'hr', 'safety'), name);
  end if;

  if inv.employee_id is not null then
    perform set_config('mb.allow_user_link', 'on', true);
    update employees set user_id = auth.uid() where id = inv.employee_id;
    perform set_config('mb.allow_user_link', 'off', true);
  end if;
  update invites set used_by = auth.uid(), used_at = now() where id = inv.id;
  return json_build_object('company_id', inv.company_id, 'role', inv.role);
end $$;

-- Sunucunun hesap araması için (service_role): tüm kullanıcıları sayfalamadan
create or replace function auth_user_by_email(p_email text)
returns table (id uuid, created_at timestamptz) language sql stable security definer set search_path = public, auth as $$
  select u.id, u.created_at from auth.users u where lower(u.email) = lower(p_email) limit 1;
$$;
revoke execute on function auth_user_by_email(text) from public, anon, authenticated;

-- İç yardımcılar herkese açık olmasın
revoke execute on function role_users(uuid, app_role[]) from public, anon, authenticated;
revoke execute on function employee_name(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Y7) Bildirimleri yalnız sistem üretir; bağlantılar yalnız site içi
-- ---------------------------------------------------------------------
drop policy if exists notif_insert on notifications;
alter table notifications drop constraint if exists notifications_link_internal;
update notifications set link = null where link is not null and (link not like '/%' or link like '//%');
alter table notifications add constraint notifications_link_internal check (link is null or (link like '/%' and link not like '//%'));

-- API şema önbelleğini yenile (yeni fonksiyonlar hemen görünsün)
notify pgrst, 'reload schema';
