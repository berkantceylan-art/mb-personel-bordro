-- =====================================================================
-- Mevzuat ve gelişmeler merkezi
--  Bülten içeriği uygulamadaki mevzuat.json dosyasındadır (haftada iki kez otomatik güncellenir).
--  Bu dosya: kullanıcı bazında okundu / yapıldı takibi ve yeni gelişmelerin bildirimi.
-- Tekrar çalıştırılabilir.
-- =====================================================================

create table if not exists reg_reads (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  item_id text not null check (length(item_id) between 1 and 120),
  read_at timestamptz,
  done_at timestamptz,
  primary key (company_id, user_id, item_id)
);
alter table reg_reads enable row level security;
drop policy if exists reg_reads_own on reg_reads;
create policy reg_reads_own on reg_reads for select to authenticated using (user_id = auth.uid() and company_id = lab_company());
revoke all on reg_reads from anon;
grant select on reg_reads to authenticated;

create table if not exists reg_notified (
  company_id uuid not null references companies (id) on delete cascade,
  item_id text not null,
  notified_at timestamptz not null default now(),
  reminded_at timestamptz,
  primary key (company_id, item_id)
);
alter table reg_notified enable row level security;
revoke all on reg_notified from anon, authenticated;

-- p_action: read | unread | done | undone | read_all (p_items)
create or replace function reg_mark(p_action text, p_items text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or lab_company() is null then raise exception 'not_allowed'; end if;
  if p_action not in ('read', 'unread', 'done', 'undone') then raise exception 'bad_action'; end if;
  insert into reg_reads (company_id, user_id, item_id, read_at, done_at)
  select lab_company(), auth.uid(), left(i, 120), case when p_action in ('read', 'done') then now() end, case when p_action = 'done' then now() end
  from unnest(coalesce(p_items, '{}')) i where length(i) between 1 and 120
  on conflict (company_id, user_id, item_id) do update set
    read_at = case when p_action = 'unread' then null when p_action in ('read', 'done') then coalesce(reg_reads.read_at, now()) else reg_reads.read_at end,
    done_at = case when p_action = 'done' then coalesce(reg_reads.done_at, now()) when p_action = 'undone' then null else reg_reads.done_at end;
end $$;
revoke execute on function reg_mark(text, text[]) from public, anon;
grant execute on function reg_mark(text, text[]) to authenticated;

-- Günlük: yeni gelişmeleri ilgili kişilere bildir, son günü yaklaşan aksiyonları hatırlat (yalnız servis rolü)
-- p_items: [{id, title, date, area, severity, due, note}]
create or replace function reg_notify(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare co record; it jsonb; first_run boolean; users uuid[]; n_new int := 0; n_rem int := 0; v_area text; v_sev text; v_due date;
begin
  for co in select id from companies loop
    first_run := not exists (select 1 from reg_notified where company_id = co.id);
    for it in select * from jsonb_array_elements(coalesce(p_items, '[]')) loop
      v_area := coalesce(it->>'area', 'muhasebe'); v_sev := coalesce(it->>'severity', 'bilgi'); v_due := nullif(it->>'due', '')::date;
      select coalesce(array_agg(distinct m.user_id), '{}') into users from memberships m
      where m.company_id = co.id and (m.role in ('owner', 'accountant') or (m.role = 'hr' and v_area = 'sgk'));
      if not exists (select 1 from reg_notified where company_id = co.id and item_id = it->>'id') then
        insert into reg_notified (company_id, item_id) values (co.id, it->>'id');
        -- ilk çalıştırmada yalnız son 14 günün gelişmeleri bildirilir
        if not first_run or (it->>'date')::date >= current_date - 14 then
          perform deliver(co.id, users, case v_sev when 'kritik' then 'Önemli mevzuat: ' when 'aksiyon' then 'Mevzuat (yapılacak): ' else 'Mevzuat: ' end || left(it->>'title', 120),
                          left(coalesce(case when v_due is not null then 'Son gün ' || to_char(v_due, 'DD.MM.YYYY') || '. ' end, '') || coalesce(it->>'note', ''), 280), '/mevzuat?id=' || (it->>'id'), true);
          -- son günü zaten yakınsa ayrıca hatırlatma gönderme
          if v_due is not null and v_due <= current_date + 7 then update reg_notified set reminded_at = now() where company_id = co.id and item_id = it->>'id'; end if;
          n_new := n_new + 1;
        end if;
      end if;
      -- son güne 7 gün kala, yapılmadıysa bir kez hatırlat
      if v_due is not null and v_sev in ('aksiyon', 'kritik') and v_due between current_date and current_date + 7 then
        if exists (select 1 from reg_notified where company_id = co.id and item_id = it->>'id' and reminded_at is null) then
          select coalesce(array_agg(u), '{}') into users from unnest(users) u
          where not exists (select 1 from reg_reads r where r.company_id = co.id and r.user_id = u and r.item_id = it->>'id' and r.done_at is not null);
          perform deliver(co.id, users, 'Son gün ' || to_char(v_due, 'DD.MM.YYYY') || ': ' || left(it->>'title', 110), left(coalesce(it->>'note', ''), 280), '/mevzuat?id=' || (it->>'id'), true);
          update reg_notified set reminded_at = now() where company_id = co.id and item_id = it->>'id';
          n_rem := n_rem + 1;
        end if;
      end if;
    end loop;
  end loop;
  return jsonb_build_object('notified', n_new, 'reminded', n_rem);
end $$;
revoke execute on function reg_notify(jsonb) from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function reg_notify(jsonb) to service_role; end if; end $$;

notify pgrst, 'reload schema';
