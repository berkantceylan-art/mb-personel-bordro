-- Kontrol Merkezi · Nabız: canlı işlem akışı, anomali uyarıları, kullanım ısı haritası, kullanıcı 360°,
-- bulguları sorumluya görev olarak atama. Sabah raporu anomali ve açık görev sayısını da içerir. Tekrar çalıştırılabilir.

create table if not exists admin_tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  rule_key text,
  title text not null,
  note text,
  link text,
  assignee uuid references auth.users (id) on delete set null,
  due_date date,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  done_note text
);
create index if not exists admin_tasks_open_idx on admin_tasks (company_id, status, due_date);
alter table admin_tasks enable row level security;
drop policy if exists admin_tasks_read on admin_tasks;
create policy admin_tasks_read on admin_tasks for select to authenticated
  using (company_id = lab_company() and (assignee = auth.uid() or adm_allowed()));
grant select on admin_tasks to authenticated;
revoke insert, update, delete on admin_tasks from authenticated;

create or replace function adm_user_name(p_user uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select coalesce(nullif(m.display_name, ''), nullif(trim(e.first_name || ' ' || e.last_name), ''))
       from memberships m left join employees e on e.user_id = m.user_id and e.company_id = m.company_id
      where m.user_id = p_user and m.company_id = lab_company() limit 1),
    (select split_part(email, '@', 1) from auth.users where id = p_user),
    'Sistem');
$$;
revoke execute on function adm_user_name(uuid) from public, anon, authenticated;

create or replace function adm_tbl_label(t text) returns text language sql immutable as $$
  select case t
    when 'fin_txns' then 'Finans işlemi' when 'fin_accounts' then 'Kasa / banka' when 'fin_parties' then 'Cari kart' when 'fin_cheques' then 'Çek / senet'
    when 'fin_loans' then 'Kredi' when 'module_permissions' then 'Modül yetkisi' when 'inv_invoices' then 'Fatura' when 'stk_items' then 'Stok kartı'
    when 'stk_moves' then 'Stok hareketi' when 'stk_counts' then 'Sayım' when 'stk_transfers' then 'Depo transferi' when 'stk_lots' then 'Lot'
    when 'jobs' then 'İş kaydı' when 'lab_customers' then 'Müşteri kartı' when 'lab_products' then 'Protez ürünü' when 'lab_payments' then 'Müşteri tahsilatı'
    when 'lab_orders' then 'Sipariş' when 'prd_remakes' then 'Yeniden yapım' when 'exp_claims' then 'Masraf' when 'exp_recurring' then 'Tekrarlayan masraf'
    when 'employees' then 'Personel' when 'employee_private' then 'Personel özlük' when 'pay_contracts' then 'Ücret sözleşmesi' when 'payroll_lines' then 'Bordro satırı'
    when 'leave_requests' then 'İzin' when 'ledger_entries' then 'Hesap hareketi' when 'advance_requests' then 'Avans' when 'attendance_punches' then 'PDKS kaydı'
    when 'overtime_records' then 'Fazla mesai' when 'shifts' then 'Vardiya' when 'user_types' then 'Kullanıcı türü' when 'invites' then 'Davet'
    when 'portal_accounts' then 'Portal hesabı' when 'portal_cases' then 'Portal vakası' when 'pur_orders' then 'Satın alma' when 'shipments' then 'Sevkiyat'
    when 'company_settings' then 'Şirket ayarı' when 'site_settings' then 'Site ayarı' when 'health_exams' then 'Sağlık muayenesi' when 'training_records' then 'Eğitim'
    when 'safety_incidents' then 'İSG olayı' when 'qms_complaints' then 'Şikayet' when 'qms_ncrs' then 'Uygunsuzluk' when 'garnishment_files' then 'İcra dosyası'
    when 'bes_enrollments' then 'BES' else case when t like 'cms_%' then 'Site içeriği' else t end end;
$$;

create or replace function adm_tbl_group(t text) returns text language sql immutable as $$
  select case
    when t in ('fin_txns', 'fin_accounts', 'fin_parties', 'fin_cheques', 'fin_loans', 'ledger_entries') then 'Finans'
    when t in ('inv_invoices') then 'Fatura'
    when t like 'stk_%' or t in ('pur_orders') then 'Stok / satın alma'
    when t in ('jobs', 'lab_customers', 'lab_products', 'lab_payments', 'lab_orders', 'prd_remakes', 'shipments', 'portal_cases') then 'Laboratuvar'
    when t in ('employees', 'employee_private', 'pay_contracts', 'payroll_lines', 'advance_requests', 'garnishment_files', 'bes_enrollments') then 'Personel / bordro'
    when t in ('attendance_punches', 'leave_requests', 'overtime_records', 'shifts') then 'Puantaj'
    when t in ('exp_claims', 'exp_recurring') then 'Masraf'
    when t in ('module_permissions', 'user_types', 'invites', 'portal_accounts', 'company_settings') then 'Yetki / ayar'
    when t like 'cms_%' or t = 'site_settings' then 'Web sitesi'
    when t in ('health_exams', 'training_records', 'safety_incidents', 'qms_complaints', 'qms_ncrs') then 'İSG / kalite'
    else 'Diğer' end;
$$;

-- Anomaliler (son 24 saat): şüpheli ya da dikkat isteyen hareketler
create or replace function adm_anomalies() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); r jsonb;
begin
  with a as (
    select * from audit_log where company_id = c and at > now() - interval '24 hours'
  ), rules as (
    select 'mass_delete' k, 'high' sev, 'Toplu silme' title, 'Bir kullanıcı 24 saatte 10+ kayıt sildi' hint,
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'count', n)) from (select actor, count(*) n from a where action = 'DELETE' group by actor having count(*) >= 10) x) rows
    union all
    select 'night', 'medium', 'Mesai dışı işlem', '22:00–06:00 arası yapılan değişiklikler',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'count', n, 'last', l)) from (
        select actor, count(*) n, max(at) l from a where actor is not null and extract(hour from at at time zone 'Europe/Istanbul') not between 6 and 21 group by actor) x)
    union all
    select 'burst', 'medium', 'Ani yoğun işlem', 'Bir kullanıcı bir saatte 100+ değişiklik yaptı',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'count', n, 'hour', h)) from (
        select actor, date_trunc('hour', at) h, count(*) n from a where actor is not null group by 1, 2 having count(*) >= 100) x)
    union all
    select 'perm_change', 'high', 'Yetki / ayar değişikliği', 'Modül yetkisi, kullanıcı türü, davet veya şirket ayarı değişti',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'table', adm_tbl_label(table_name), 'action', action, 'at', at)) from (
        select * from a where table_name in ('module_permissions', 'user_types', 'invites', 'company_settings', 'portal_accounts') order by at desc limit 12) x)
    union all
    select 'money_backdate', 'high', 'Eski parasal kayıt değişti', '2 günden eski finans / tahsilat / bordro kaydı değiştirildi veya silindi',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'table', adm_tbl_label(table_name), 'action', action, 'at', at, 'row', row_id)) from (
        select * from a where table_name in ('fin_txns', 'lab_payments', 'payroll_lines', 'ledger_entries', 'inv_invoices', 'fin_cheques') and action in ('UPDATE', 'DELETE')
          and coalesce((old_data->>'created_at')::timestamptz, now()) < now() - interval '2 days' order by at desc limit 12) x)
    union all
    select 'salary_change', 'medium', 'Ücret / özlük değişikliği', 'Ücret sözleşmesi veya personel özlük bilgisi değişti',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'table', adm_tbl_label(table_name), 'action', action, 'at', at, 'row', row_id)) from (
        select * from a where table_name in ('pay_contracts', 'employee_private') and action in ('UPDATE', 'DELETE') order by at desc limit 12) x)
    union all
    select 'job_delete', 'medium', 'İş kaydı silindi', 'Silinen iş kayıtları (iptal yerine silme)',
      (select jsonb_agg(jsonb_build_object('actor', actor, 'name', adm_user_name(actor), 'at', at, 'no', old_data->>'no')) from (
        select * from a where table_name = 'jobs' and action = 'DELETE' order by at desc limit 12) x)
  )
  select coalesce(jsonb_agg(jsonb_build_object('key', k, 'sev', sev, 'title', title, 'hint', hint, 'rows', rows, 'count', jsonb_array_length(rows))
           order by case sev when 'high' then 0 else 1 end), '[]')
    into r from rules where rows is not null;
  return r;
end $$;
revoke execute on function adm_anomalies() from public, anon, authenticated;

create or replace function admin_pulse() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company();
begin
  if not adm_allowed() then raise exception 'not_allowed'; end if;
  return jsonb_build_object(
    'feed', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'at', at, 'actor', actor, 'name', adm_user_name(actor), 'table', table_name, 'label', adm_tbl_label(table_name),
        'group', adm_tbl_group(table_name), 'action', action, 'row', row_id,
        'title', coalesce(new_data->>'name', old_data->>'name', new_data->>'title', old_data->>'title', '#' || coalesce(new_data->>'no', old_data->>'no'),
                          nullif(trim(coalesce(new_data->>'first_name', old_data->>'first_name', '') || ' ' || coalesce(new_data->>'last_name', old_data->>'last_name', '')), ''), new_data->>'description', old_data->>'description'))
        order by at desc) from (select * from audit_log where company_id = c order by at desc limit 60) f), '[]'),
    'today', (select count(*) from audit_log where company_id = c and at >= date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'),
    'active_today', (select count(distinct actor) from audit_log where company_id = c and at >= date_trunc('day', now() at time zone 'Europe/Istanbul') at time zone 'Europe/Istanbul'),
    'anomalies', adm_anomalies(),
    -- haftanın günü (1=Pzt) x saat, son 28 gün
    'heat', coalesce((select jsonb_agg(jsonb_build_object('d', d, 'h', h, 'n', n)) from (
        select extract(isodow from at at time zone 'Europe/Istanbul')::int d, extract(hour from at at time zone 'Europe/Istanbul')::int h, count(*) n
        from audit_log where company_id = c and at > now() - interval '28 days' group by 1, 2) x), '[]'),
    'modules', coalesce((select jsonb_agg(jsonb_build_object('group', g.g, 'n', g.n, 'users', g.u,
        'days', (select jsonb_agg(coalesce(z.n, 0) order by s.d) from generate_series(current_date - 13, current_date, '1 day') s(d)
                   left join (select (b.at at time zone 'Europe/Istanbul')::date d, count(*) n from audit_log b
                              where b.company_id = c and b.at > now() - interval '15 days' and adm_tbl_group(b.table_name) = g.g group by 1) z on z.d = s.d)) order by g.n desc)
        from (select adm_tbl_group(table_name) g, count(*) n, count(distinct actor) u
              from audit_log where company_id = c and at > now() - interval '30 days' group by 1) g), '[]'),
    'users', coalesce((select jsonb_agg(jsonb_build_object('user', m.user_id, 'name', adm_user_name(m.user_id), 'role', m.role, 'email', u.email,
        'last_sign_in', u.last_sign_in_at, 'n7', coalesce(s.n7, 0), 'n30', coalesce(s.n30, 0), 'last', s.last, 'deletes', coalesce(s.del, 0))
        order by coalesce(s.n7, 0) desc, u.last_sign_in_at desc nulls last)
        from memberships m join auth.users u on u.id = m.user_id
        left join (select actor, count(*) filter (where at > now() - interval '7 days') n7, count(*) n30, max(at) last, count(*) filter (where action = 'DELETE') del
                   from audit_log where company_id = c and at > now() - interval '30 days' group by actor) s on s.actor = m.user_id
        where m.company_id = c), '[]')
  );
end $$;
revoke execute on function admin_pulse() from public, anon;
grant execute on function admin_pulse() to authenticated;

-- Kullanıcı 360°: kim, hangi yetkiler, ne yaptı, ne zaman girdi
create or replace function admin_user_360(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c uuid := lab_company(); m memberships;
begin
  if not adm_allowed() then raise exception 'not_allowed'; end if;
  select * into m from memberships where user_id = p_user and company_id = c;
  if m.user_id is null then raise exception 'not_member'; end if;
  return jsonb_build_object(
    'user', p_user, 'name', adm_user_name(p_user), 'role', m.role, 'is_boss', m.is_boss, 'all_branches', m.all_branches,
    'site_access', m.site_access, 'logistics_access', m.logistics_access, 'member_since', m.created_at,
    'user_type', (select name from user_types where id = m.user_type_id),
    'email', (select email from auth.users where id = p_user),
    'last_sign_in', (select last_sign_in_at from auth.users where id = p_user),
    'banned', (select banned_until > now() from auth.users where id = p_user),
    'employee', (select jsonb_build_object('id', e.id, 'name', e.first_name || ' ' || e.last_name, 'status', e.status, 'title', e.position_title) from employees e where e.user_id = p_user and e.company_id = c limit 1),
    'modules', coalesce((select jsonb_object_agg(x.k, module_level_for(p_user, x.k)) from unnest(array['hr', 'attendance', 'payroll', 'safety', 'lab', 'finance', 'sales', 'purchases', 'stock', 'production', 'assets', 'expenses', 'users']) x(k)), '{}'),
    'n7', (select count(*) from audit_log where company_id = c and actor = p_user and at > now() - interval '7 days'),
    'n30', (select count(*) from audit_log where company_id = c and actor = p_user and at > now() - interval '30 days'),
    'by_group', coalesce((select jsonb_agg(jsonb_build_object('group', g, 'ins', i, 'upd', u, 'del', d) order by i + u + d desc) from (
        select adm_tbl_group(table_name) g, count(*) filter (where action = 'INSERT') i, count(*) filter (where action = 'UPDATE') u, count(*) filter (where action = 'DELETE') d
        from audit_log where company_id = c and actor = p_user and at > now() - interval '30 days' group by 1) x), '[]'),
    'days', coalesce((select jsonb_agg(coalesce(z.n, 0) order by s.d) from generate_series(current_date - 29, current_date, '1 day') s(d)
        left join (select (at at time zone 'Europe/Istanbul')::date d, count(*) n from audit_log where company_id = c and actor = p_user and at > now() - interval '31 days' group by 1) z on z.d = s.d), '[]'),
    'hours', coalesce((select jsonb_agg(coalesce(z.n, 0) order by s.h) from generate_series(0, 23) s(h)
        left join (select extract(hour from at at time zone 'Europe/Istanbul')::int h, count(*) n from audit_log where company_id = c and actor = p_user and at > now() - interval '30 days' group by 1) z on z.h = s.h), '[]'),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'table', table_name, 'label', adm_tbl_label(table_name), 'action', action, 'row', row_id,
        'title', coalesce(new_data->>'name', old_data->>'name', new_data->>'title', old_data->>'title', '#' || coalesce(new_data->>'no', old_data->>'no'), new_data->>'description', old_data->>'description')) order by at desc)
        from (select * from audit_log where company_id = c and actor = p_user order by at desc limit 40) r), '[]'),
    'tasks', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'due', due_date, 'status', status) order by created_at desc) from admin_tasks where company_id = c and assignee = p_user and status = 'open'), '[]')
  );
end $$;
revoke execute on function admin_user_360(uuid) from public, anon;
grant execute on function admin_user_360(uuid) to authenticated;

-- Görevler: bulguyu sorumluya ata, takip et, kapat
create or replace function admin_task_create(p_title text, p_assignee uuid, p_due date default null, p_note text default null, p_link text default null, p_rule text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare v uuid;
begin
  if not adm_allowed() then raise exception 'not_allowed'; end if;
  if length(trim(coalesce(p_title, ''))) < 2 then raise exception 'title_required'; end if;
  if not exists (select 1 from memberships where user_id = p_assignee and company_id = lab_company()) then raise exception 'bad_assignee'; end if;
  insert into admin_tasks (title, assignee, due_date, note, link, rule_key)
  values (left(trim(p_title), 200), p_assignee, p_due, left(nullif(trim(p_note), ''), 1000), left(nullif(trim(p_link), ''), 300), p_rule) returning id into v;
  perform deliver(lab_company(), array[p_assignee], '📌 Size görev atandı', left(trim(p_title) || coalesce(' · son gün ' || to_char(p_due, 'DD.MM.YYYY'), '') || coalesce(' · ' || nullif(trim(p_note), ''), ''), 300), coalesce(nullif(trim(p_link), ''), '/benim/gorevler'));
  return v;
end $$;
revoke execute on function admin_task_create(text, uuid, date, text, text, text) from public, anon;
grant execute on function admin_task_create(text, uuid, date, text, text, text) to authenticated;

create or replace function admin_task_set(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare t admin_tasks;
begin
  select * into t from admin_tasks where id = p_id and company_id = lab_company() for update;
  if t.id is null then raise exception 'not_found'; end if;
  if not (adm_allowed() or t.assignee = auth.uid()) then raise exception 'not_allowed'; end if;
  if p_status not in ('open', 'done', 'dismissed') then raise exception 'bad_status'; end if;
  if p_status = 'dismissed' and not adm_allowed() then raise exception 'not_allowed'; end if;
  update admin_tasks set status = p_status, done_at = case when p_status = 'open' then null else now() end,
         done_note = coalesce(left(nullif(trim(p_note), ''), 500), done_note) where id = p_id;
  if p_status = 'done' and t.assignee = auth.uid() and t.created_by is not null and t.created_by <> auth.uid() then
    perform deliver(lab_company(), array[t.created_by], '✅ Görev tamamlandı', left(t.title || ' · ' || adm_user_name(auth.uid()) || coalesce(' · ' || nullif(trim(p_note), ''), ''), 300), '/yonetim/kontrol');
  end if;
end $$;
revoke execute on function admin_task_set(uuid, text, text) from public, anon;
grant execute on function admin_task_set(uuid, text, text) to authenticated;

create or replace function admin_tasks_list(p_mine boolean default false) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'note', t.note, 'link', t.link, 'assignee', t.assignee, 'assignee_name', adm_user_name(t.assignee),
           'due', t.due_date, 'status', t.status, 'created_at', t.created_at, 'by', adm_user_name(t.created_by), 'done_at', t.done_at, 'done_note', t.done_note,
           'overdue', t.status = 'open' and t.due_date < current_date)
           order by (t.status <> 'open'), t.due_date nulls last, t.created_at desc), '[]')
  from (select * from admin_tasks where company_id = lab_company()
          and (case when p_mine then assignee = auth.uid() else adm_allowed() or assignee = auth.uid() end)
          and (status = 'open' or done_at > now() - interval '14 days') limit 200) t;
$$;
revoke execute on function admin_tasks_list(boolean) from public, anon;
grant execute on function admin_tasks_list(boolean) to authenticated;

-- Sabah raporu: anomali ve açık görevleri de söyler
create or replace function admin_morning_report() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := lab_company();
  y admin_health_log;
  res jsonb;
  rows jsonb;
  top text;
  newc text;
  targets uuid[];
  body text;
  an text;
  open_t int;
  late_t int;
begin
  select * into y from admin_health_log where company_id = c and day < current_date order by day desc limit 1;
  res := adm_compute();
  rows := res->'checks';
  select string_agg(x->>'title' || ' (' || (x->>'count') || ')', ' · ' order by case x->>'sev' when 'high' then 0 when 'medium' then 1 else 2 end, (x->>'count')::int desc)
    into top from (select * from jsonb_array_elements(rows) x where coalesce((x->>'count')::int, 0) > 0 limit 4) t(x);
  select string_agg(x->>'title', ', ') into newc
    from jsonb_array_elements(rows) x
    where coalesce((x->>'count')::int, 0) > 0 and y.day is not null and not (y.counts ? (x->>'key'));
  select string_agg(x->>'title', ', ') into an from jsonb_array_elements(adm_anomalies()) x where x->>'sev' = 'high';
  select count(*), count(*) filter (where due_date < current_date) into open_t, late_t from admin_tasks where company_id = c and status = 'open';
  targets := array(select m.user_id from memberships m where m.company_id = c and (m.role = 'owner' or m.is_boss or module_level_for(m.user_id, 'users') >= 3));
  body := 'Sağlık skoru ' || (res->>'score') ||
          case when y.day is not null then ' (' || case when (res->>'score')::int - y.score >= 0 then '+' else '' end || ((res->>'score')::int - y.score) || ')' else '' end ||
          case when (res->>'issues')::int = 0 then ' · her şey yolunda ✨' else ' · ' || (res->>'issues') || ' konu: ' || coalesce(top, '') end ||
          coalesce(' · YENİ: ' || newc, '') ||
          coalesce(' · ⚠ Dikkat: ' || an, '') ||
          case when open_t > 0 then ' · ' || open_t || ' açık görev' || case when late_t > 0 then ' (' || late_t || ' gecikmiş)' else '' end else '' end;
  perform deliver(c, targets, '🛰 Sabah kontrol raporu', left(body, 900), '/yonetim/kontrol');
  -- gecikmiş görevler: sorumlusuna hatırlatma
  perform deliver(c, array[a.assignee], '⏰ Görevin gecikti', left(a.title, 200), coalesce(a.link, '/benim/gorevler'))
    from admin_tasks a where a.company_id = c and a.status = 'open' and a.due_date < current_date and a.assignee is not null;
  return jsonb_build_object('score', res->'score', 'issues', res->'issues', 'sent_to', cardinality(targets), 'body', body);
end $$;
revoke execute on function admin_morning_report() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function admin_morning_report() to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';
