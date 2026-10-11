-- =====================================================================
-- WHATSAPP İK GELEN KUTUSU (WhatsApp Business Platform / Cloud API)
--  wa_settings : şirketin WhatsApp numarası (phone_number_id) → gelen mesajın şirketi
--  wa_threads  : kişi başına konuşma; status open = İK görevi (yanıt bekliyor), done = yanıtlandı / kapandı
--  wa_messages : gelen / giden mesajlar (metin, görsel, belge, ses), iletim durumu
--  wa_inbound(p)       : webhook'tan (service role) gelen mesajı kaydeder; telefondan personel eşleşir; İK'ya bildirim
--  wa_outbound(...)    : İK yanıtı gönderildikten sonra kaydeder ve görevi kapatır
-- Erişim: İK modülü (görüntüle ≥ 1, yanıtla ≥ 2). Tekrar çalıştırılabilir.
-- =====================================================================
create table if not exists wa_settings (
  company_id uuid primary key references companies (id) on delete cascade default lab_company(),
  phone_number_id text unique check (phone_number_id is null or length(phone_number_id) <= 40),
  display_phone text check (display_phone is null or length(display_phone) <= 40),
  auto_reply text check (auto_reply is null or length(auto_reply) <= 500),
  updated_at timestamptz not null default now()
);
create table if not exists wa_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  wa_id text not null check (wa_id ~ '^[0-9]{6,20}$'),
  name text check (name is null or length(name) <= 120),
  employee_id uuid references employees (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done')),
  assigned_to uuid references auth.users (id) on delete set null,
  last_in_at timestamptz,
  last_out_at timestamptz,
  last_text text check (last_text is null or length(last_text) <= 300),
  unread int not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, wa_id)
);
create index if not exists wa_threads_status_idx on wa_threads (company_id, status, last_in_at desc);
create table if not exists wa_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references wa_threads (id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  wa_message_id text unique,
  type text not null default 'text',
  body text check (body is null or length(body) <= 4096),
  media_id text, media_mime text, filename text,
  status text check (status is null or status in ('sent', 'delivered', 'read', 'failed', 'received')),
  error text check (error is null or length(error) <= 300),
  sent_by uuid references auth.users (id) on delete set null,
  at timestamptz not null default now()
);
create index if not exists wa_messages_thread_idx on wa_messages (thread_id, at);

alter table wa_settings enable row level security;
alter table wa_threads enable row level security;
alter table wa_messages enable row level security;
drop policy if exists wa_settings_read on wa_settings;
create policy wa_settings_read on wa_settings for select to authenticated using (company_id = lab_company() and can_module('hr'));
drop policy if exists wa_settings_write on wa_settings;
create policy wa_settings_write on wa_settings for all to authenticated using (company_id = lab_company() and can_module('hr', 3)) with check (company_id = lab_company() and can_module('hr', 3));
grant select, insert, update on wa_settings to authenticated;
drop policy if exists wa_threads_read on wa_threads;
create policy wa_threads_read on wa_threads for select to authenticated using (company_id = lab_company() and can_module('hr'));
drop policy if exists wa_messages_read on wa_messages;
create policy wa_messages_read on wa_messages for select to authenticated using (exists (select 1 from wa_threads t where t.id = thread_id));
grant select on wa_threads, wa_messages to authenticated;

-- Gelen mesaj (webhook, service role): { phone_number_id, wa_id, name, id, type, body, media_id, media_mime, filename, ts }
create or replace function wa_inbound(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_company uuid; t wa_threads; v_emp uuid; v_was text; v_wa text := regexp_replace(coalesce(p ->> 'wa_id', ''), '\D', '', 'g');
begin
  select company_id into v_company from wa_settings where phone_number_id = p ->> 'phone_number_id';
  if v_company is null and (select count(*) from companies) = 1 then select id into v_company from companies limit 1; end if;
  if v_company is null then raise exception 'company_not_found'; end if;
  if v_wa = '' then raise exception 'bad_sender'; end if;
  if exists (select 1 from wa_messages where wa_message_id = p ->> 'id') then return null; end if;
  select e.id into v_emp from employees e join employee_private ep on ep.employee_id = e.id
    where e.company_id = v_company and ep.phone is not null and length(regexp_replace(ep.phone, '\D', '', 'g')) >= 10
      and right(regexp_replace(ep.phone, '\D', '', 'g'), 10) = right(v_wa, 10) order by (e.status = 'active') desc limit 1;
  select * into t from wa_threads where company_id = v_company and wa_id = v_wa for update;
  v_was := t.status;
  if t.id is null then
    insert into wa_threads (company_id, wa_id, name, employee_id) values (v_company, v_wa, nullif(left(p ->> 'name', 120), ''), v_emp) returning * into t;
  end if;
  insert into wa_messages (thread_id, direction, wa_message_id, type, body, media_id, media_mime, filename, status, at)
  values (t.id, 'in', p ->> 'id', coalesce(nullif(p ->> 'type', ''), 'text'), left(p ->> 'body', 4096), p ->> 'media_id', p ->> 'media_mime', left(p ->> 'filename', 200), 'received',
          coalesce(to_timestamp(nullif(p ->> 'ts', '')::bigint), now()));
  update wa_threads set status = 'open', last_in_at = now(), unread = unread + 1, name = coalesce(nullif(left(p ->> 'name', 120), ''), name), employee_id = coalesce(employee_id, v_emp),
         last_text = left(coalesce(nullif(p ->> 'body', ''), case p ->> 'type' when 'image' then '📷 Fotoğraf' when 'document' then '📎 Belge' when 'audio' then '🎤 Ses' else p ->> 'type' end), 300)
  where id = t.id;
  if t.id is not null and (v_was is null or v_was = 'done') then
    perform deliver(v_company, array(select distinct unnest(coalesce(module_recipients_for(v_company, 'hr', 2), '{}'::uuid[])) ),
      '💬 WhatsApp · ' || coalesce((select first_name || ' ' || last_name from employees where id = coalesce(t.employee_id, v_emp)), nullif(p ->> 'name', ''), '+' || v_wa),
      left(coalesce(nullif(p ->> 'body', ''), 'Yeni mesaj'), 180), '/ik-whatsapp?t=' || t.id);
  end if;
  return t.id;
end $$;
revoke execute on function wa_inbound(jsonb) from public, anon, authenticated;

-- Şirket bağlamı olmadan modül alıcıları (webhook'ta auth.uid() yok)
create or replace function module_recipients_for(p_company uuid, p_module text, p_level int) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}') from memberships m
  where m.company_id = p_company and (m.role in ('owner', 'hr') or module_level_for(m.user_id, p_module) >= p_level);
$$;
revoke execute on function module_recipients_for(uuid, text, int) from public, anon, authenticated;

-- İletim durumu (webhook): { id, status, error }
create or replace function wa_status(p jsonb) returns void
language sql security definer set search_path = public as $$
  update wa_messages set status = case when p ->> 'status' in ('sent', 'delivered', 'read', 'failed') then p ->> 'status' else status end,
         error = coalesce(left(p ->> 'error', 300), error)
  where wa_message_id = p ->> 'id' and direction = 'out';
$$;
revoke execute on function wa_status(jsonb) from public, anon, authenticated;

-- Giden mesaj (İK, gönderildikten sonra): görev kapanır
create or replace function wa_outbound(p_thread uuid, p_body text, p_wa_message_id text, p_type text default 'text', p_close boolean default true) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('hr', 2) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from wa_threads where id = p_thread and company_id = lab_company()) then raise exception 'not_found'; end if;
  insert into wa_messages (thread_id, direction, wa_message_id, type, body, status, sent_by) values (p_thread, 'out', p_wa_message_id, coalesce(p_type, 'text'), left(p_body, 4096), 'sent', auth.uid());
  update wa_threads set last_out_at = now(), unread = 0, last_text = left('↩ ' || coalesce(p_body, ''), 300), status = case when p_close then 'done' else status end, assigned_to = coalesce(assigned_to, auth.uid())
  where id = p_thread;
end $$;
revoke execute on function wa_outbound(uuid, text, text, text, boolean) from public, anon;
grant execute on function wa_outbound(uuid, text, text, text, boolean) to authenticated;

create or replace function wa_thread_action(p_thread uuid, p_action text, p_employee uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('hr', 2) then raise exception 'not_allowed'; end if;
  if p_action = 'close' then update wa_threads set status = 'done', unread = 0 where id = p_thread and company_id = lab_company();
  elsif p_action = 'open' then update wa_threads set status = 'open' where id = p_thread and company_id = lab_company();
  elsif p_action = 'read' then update wa_threads set unread = 0 where id = p_thread and company_id = lab_company();
  elsif p_action = 'assign' then update wa_threads set assigned_to = auth.uid() where id = p_thread and company_id = lab_company();
  elsif p_action = 'employee' then update wa_threads set employee_id = p_employee where id = p_thread and company_id = lab_company();
  else raise exception 'bad_action';
  end if;
end $$;
revoke execute on function wa_thread_action(uuid, text, uuid) from public, anon;
grant execute on function wa_thread_action(uuid, text, uuid) to authenticated;

notify pgrst, 'reload schema';
