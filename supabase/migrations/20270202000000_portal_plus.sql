-- Site büyüme · Paket 2: Hekim portalı
--  portal_cases.stage           : ERP iş akışı aşaması (kabul, üretim, şef kontrol, kalite, sevk, prova) portala yansır
--  portal_case_events.notified_at + portal_notify_queue(): durum değişince hekime e-posta / WhatsApp (ERP zamanlanmış görevi)
--  portal_case_lots()           : uygunluk beyanında kullanılan malzeme ve lot numaraları
--  portal_case_templates        : sık kullanılan reçete şablonları
--  portal_case_ratings          : teslim sonrası memnuniyet puanı (düşük puan laboratuvara bildirim)
-- Tekrar çalıştırılabilir.

alter table portal_cases add column if not exists stage text check (stage is null or stage in ('reception', 'production', 'chief', 'qc', 'dispatch', 'tryin', 'out'));
alter table portal_case_events add column if not exists notified_at timestamptz;
alter table portal_accounts add column if not exists notify_email boolean not null default true;
alter table portal_accounts add column if not exists notify_whatsapp boolean not null default true;

create or replace function sync_job_stage_to_case() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.portal_case_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.flow_stage is not distinct from old.flow_stage and new.portal_case_id is not distinct from old.portal_case_id then return new; end if;
  update portal_cases set stage = new.flow_stage where id = new.portal_case_id and stage is distinct from new.flow_stage;
  return new;
exception when others then return new;
end $$;
drop trigger if exists sync_job_stage_to_case on jobs;
create trigger sync_job_stage_to_case after insert or update on jobs for each row execute function sync_job_stage_to_case();
update portal_cases c set stage = j.flow_stage from jobs j where j.portal_case_id = c.id and c.stage is null;

-- Bildirim kuyruğu (ERP zamanlanmış görevi, sunucu anahtarıyla)
create or replace function portal_notify_queue(p_limit int default 40) returns table (
  event_id bigint, case_id uuid, case_no bigint, patient_ref text, status text, account_name text, email text, whatsapp text, language text, notify_email boolean, notify_whatsapp boolean
) language sql stable security definer set search_path = public as $$
  select e.id, c.id, c.no, c.patient_ref, e.status::text, coalesce(a.company, a.name),
         coalesce(nullif(a.contact_email, ''), a.email), coalesce(nullif(a.whatsapp, ''), a.phone), a.language, a.notify_email, a.notify_whatsapp
  from portal_case_events e join portal_cases c on c.id = e.case_id join portal_accounts a on a.id = c.account_id
  where e.kind = 'status' and e.from_lab and e.notified_at is null and e.created_at > now() - interval '2 days'
    and e.status in ('design', 'production', 'quality', 'shipped', 'delivered', 'on_hold')
  order by e.id limit p_limit;
$$;
revoke execute on function portal_notify_queue(int) from public, anon, authenticated;
create or replace function portal_notify_mark(p_ids bigint[]) returns void language sql security definer set search_path = public as $$
  update portal_case_events set notified_at = now() where id = any (p_ids);
$$;
revoke execute on function portal_notify_mark(bigint[]) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function portal_notify_queue(int) to service_role;
    grant execute on function portal_notify_mark(bigint[]) to service_role;
  end if;
end $$;

-- Vakada kullanılan malzemeler ve lotlar (uygunluk beyanı için)
create or replace function portal_case_lots(p_case uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('item', i.name, 'lot', m.lot_no, 'expiry', m.expiry_date, 'brand', i.brand) order by i.name), '[]')
  from (select distinct m.item_id, m.lot_no, m.expiry_date from prd_job_materials m join jobs j on j.id = m.job_id where j.portal_case_id = p_case) m
  join stk_items i on i.id = m.item_id
  where exists (select 1 from portal_cases c where c.id = p_case and (is_portal_member(c.account_id) or can_manage_site()));
$$;
revoke execute on function portal_case_lots(uuid) from public, anon;
grant execute on function portal_case_lots(uuid) to authenticated;

create table if not exists portal_case_templates (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references portal_accounts (id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  product_slug text check (product_slug is null or product_slug ~ '^[a-z0-9-]{1,60}$'),
  shade text check (shade is null or length(shade) <= 40),
  notes text check (notes is null or length(notes) <= 4000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists portal_case_templates_acc_idx on portal_case_templates (account_id, name);
alter table portal_case_templates enable row level security;
drop policy if exists portal_case_templates_rw on portal_case_templates;
create policy portal_case_templates_rw on portal_case_templates for all to authenticated using (is_portal_member(account_id)) with check (is_portal_member(account_id));
grant select, insert, update, delete on portal_case_templates to authenticated;

create table if not exists portal_case_ratings (
  case_id uuid primary key references portal_cases (id) on delete cascade,
  account_id uuid not null references portal_accounts (id) on delete cascade,
  fit int not null check (fit between 1 and 5),
  shade int not null check (shade between 1 and 5),
  service int not null check (service between 1 and 5),
  comment text check (comment is null or length(comment) <= 1000),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table portal_case_ratings enable row level security;
drop policy if exists portal_case_ratings_read on portal_case_ratings;
create policy portal_case_ratings_read on portal_case_ratings for select to authenticated using (is_portal_member(account_id) or can_manage_site());
grant select on portal_case_ratings to authenticated;

create or replace function portal_rate_case(p_case uuid, p_fit int, p_shade int, p_service int, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare c portal_cases; avg_ numeric;
begin
  select * into c from portal_cases where id = p_case;
  if c.id is null or not is_portal_member(c.account_id) then raise exception 'not_allowed'; end if;
  if c.status not in ('shipped', 'delivered') then raise exception 'not_delivered'; end if;
  if least(p_fit, p_shade, p_service) < 1 or greatest(p_fit, p_shade, p_service) > 5 then raise exception 'bad_score'; end if;
  insert into portal_case_ratings (case_id, account_id, fit, shade, service, comment)
  values (c.id, c.account_id, p_fit, p_shade, p_service, nullif(left(trim(coalesce(p_comment, '')), 1000), ''))
  on conflict (case_id) do update set fit = excluded.fit, shade = excluded.shade, service = excluded.service, comment = excluded.comment, created_at = now();
  avg_ := round((p_fit + p_shade + p_service) / 3.0, 1);
  if avg_ <= 3.5 then
    begin
    perform deliver(lab_company(), lab_recipients(), '⭐ Düşük memnuniyet · vaka #' || c.no,
      coalesce((select coalesce(company, name) from portal_accounts where id = c.account_id), '') || ' · uyum ' || p_fit || ', renk ' || p_shade || ', hizmet ' || p_service || coalesce(' · ' || nullif(trim(p_comment), ''), ''),
      '/isler?q=' || c.patient_ref);
    exception when others then null;
    end;
  end if;
end $$;
revoke execute on function portal_rate_case(uuid, int, int, int, text) from public, anon;
grant execute on function portal_rate_case(uuid, int, int, int, text) to authenticated;

notify pgrst, 'reload schema';
