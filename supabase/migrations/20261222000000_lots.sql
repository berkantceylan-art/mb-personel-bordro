-- =====================================================================
-- MALZEME LOT İZLENEBİLİRLİĞİ
--  module_recipients(modül, seviye) : bildirim alıcıları (owner + modül yetkisi olanlar); lab_recipients modül yetkisine bağlanır
--  stk_lots            : lot durumu (kullanılabilir / karantina / geri çağrıldı), tedarikçi sertifikası, not
--  Karantina / geri çağrılmış lot iş tüketiminde ve satışta kullanılamaz; FIFO bu lotları atlar
--  stk_lot_overview()  : lotlar: eldeki miktar, SKT, kalan gün, durum, tedarikçi, kullanıldığı iş sayısı
--  stk_lot_trace()     : lotun kullanıldığı işler, hastalar, hekimler (telefonla), teslim durumu
--  stk_lot_set_status(): karantina / geri çağırma / serbest bırakma (geri çağırmada bildirim)
--  stk_expiry_alerts() : SKT'si 30 gün içinde dolacak, stokta olan lotlar için tek seferlik bildirim (günlük cron)
-- Tekrar çalıştırılabilir. Önce 20261221000000_case_files.sql.
-- =====================================================================

create or replace function module_recipients(p_module text, p_level int default 1) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from memberships m
  where m.company_id = lab_company() and (m.role = 'owner' or module_level_for(m.user_id, p_module) >= p_level);
$$;
revoke execute on function module_recipients(text, int) from public, anon, authenticated;

create or replace function lab_recipients() returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct m.user_id), '{}')
  from memberships m
  where m.role in ('owner', 'branch_manager') or m.logistics_access or module_level_for(m.user_id, 'lab') >= 1;
$$;
revoke execute on function lab_recipients() from public, anon, authenticated;

create table if not exists stk_lots (
  item_id uuid not null references stk_items (id) on delete cascade,
  lot_no text not null check (length(lot_no) between 1 and 60),
  status text not null default 'ok' check (status in ('ok', 'quarantine', 'recalled')),
  reason text check (reason is null or length(reason) <= 500),
  supplier_party_id uuid references fin_parties (id) on delete set null,
  cert_no text check (cert_no is null or length(cert_no) <= 80),
  note text check (note is null or length(note) <= 500),
  expiry_notified_at timestamptz,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (item_id, lot_no)
);
alter table stk_lots enable row level security;
drop policy if exists stk_lots_read on stk_lots;
create policy stk_lots_read on stk_lots for select to authenticated using (can_module('stock') or can_module('production') or can_logistics());
grant select on stk_lots to authenticated;
drop trigger if exists audit_stk_lots on stk_lots;
create trigger audit_stk_lots after insert or update or delete on stk_lots for each row execute function audit_trigger();

create or replace function stk_lot_blocked(p_item uuid, p_lot text) returns boolean
language sql stable security definer set search_path = public as $$
  select p_lot is not null and exists (select 1 from stk_lots where item_id = p_item and lot_no = p_lot and status <> 'ok');
$$;

-- Engelli lot tüketilemez / satılamaz (fire, sayım, transfer, iade serbest)
create or replace function stk_moves_lot_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.qty < 0 and new.kind in ('consume', 'sale') and stk_lot_blocked(new.item_id, new.lot_no) then
    raise exception 'lot_blocked';
  end if;
  return new;
end $$;
drop trigger if exists stk_moves_lot_guard on stk_moves;
create trigger stk_moves_lot_guard before insert on stk_moves for each row execute function stk_moves_lot_guard();

-- FIFO / ilk SKT tüketim: engelli lotları atlar
create or replace function stk_consume_fifo(p_item uuid, p_warehouse uuid, p_qty numeric, p_kind text, p_date date, p_doc_type text, p_doc_id uuid, p_job uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r record; v_left numeric := p_qty; v_take numeric; v_used jsonb := '[]'::jsonb; v_wh uuid := coalesce(p_warehouse, stk_default_warehouse());
begin
  if p_qty is null or p_qty <= 0 then return v_used; end if;
  for r in
    select m.lot_no, max(m.expiry_date) as expiry_date, sum(m.qty) as qty
    from stk_moves m where m.item_id = p_item and m.warehouse_id = v_wh and m.lot_no is not null
      and not stk_lot_blocked(p_item, m.lot_no)
    group by m.lot_no having sum(m.qty) > 0
    order by max(m.expiry_date) nulls last, min(m.move_date), m.lot_no
  loop
    exit when v_left <= 0;
    v_take := least(v_left, r.qty);
    perform stk_move_sys(p_item, v_wh, -v_take, p_kind, null, r.lot_no, r.expiry_date, p_date, p_doc_type, p_doc_id, p_job, null, p_note);
    v_used := v_used || jsonb_build_object('lot', r.lot_no, 'expiry', r.expiry_date, 'qty', v_take);
    v_left := v_left - v_take;
  end loop;
  if v_left > 0 then
    perform stk_move_sys(p_item, v_wh, -v_left, p_kind, null, null, null, p_date, p_doc_type, p_doc_id, p_job, null, p_note);
    v_used := v_used || jsonb_build_object('lot', null, 'qty', v_left);
  end if;
  return v_used;
end $$;
revoke execute on function stk_consume_fifo(uuid, uuid, numeric, text, date, text, uuid, uuid, text) from public, anon, authenticated;

create or replace function stk_lot_overview(p_q text default null, p_status text default null, p_days int default null)
returns table (item_id uuid, code text, item text, unit text, lot_no text, qty numeric, expiry_date date, days_left int,
               status text, reason text, supplier text, cert_no text, first_in date, jobs int)
language sql stable security definer set search_path = public as $$
  with lots as (
    select m.item_id, m.lot_no, sum(m.qty) qty, max(m.expiry_date) expiry_date, min(m.move_date) filter (where m.qty > 0) first_in,
           (array_agg(m.party_id order by m.move_date) filter (where m.kind = 'purchase' and m.party_id is not null))[1] party_id
    from stk_moves m where m.lot_no is not null group by m.item_id, m.lot_no
  )
  select l.item_id, i.code, i.name, i.unit, l.lot_no, round(l.qty, 3), l.expiry_date,
         case when l.expiry_date is not null then (l.expiry_date - current_date) end,
         coalesce(s.status, 'ok'), s.reason, coalesce(p2.name, p.name), s.cert_no, l.first_in,
         (select count(distinct jm.job_id)::int from prd_job_materials jm where jm.item_id = l.item_id and jm.lot_no = l.lot_no)
  from lots l join stk_items i on i.id = l.item_id
  left join stk_lots s on s.item_id = l.item_id and s.lot_no = l.lot_no
  left join fin_parties p on p.id = l.party_id
  left join fin_parties p2 on p2.id = s.supplier_party_id
  where (can_module('stock') or can_module('production') or can_logistics())
    and (p_q is null or i.name ilike '%' || p_q || '%' or l.lot_no ilike '%' || p_q || '%' or i.code ilike '%' || p_q || '%')
    and (p_status is null or coalesce(s.status, 'ok') = p_status)
    and (p_days is null or (l.qty > 0 and l.expiry_date is not null and l.expiry_date <= current_date + p_days))
  order by (coalesce(s.status, 'ok') = 'ok'), (l.qty <= 0), l.expiry_date nulls last, i.name, l.lot_no
  limit 1000;
$$;
revoke execute on function stk_lot_overview(text, text, int) from public, anon;
grant execute on function stk_lot_overview(text, text, int) to authenticated;

create or replace function stk_lot_trace(p_item uuid, p_lot text)
returns table (job_id uuid, job_no bigint, patient text, customer_id uuid, customer text, phone text, job_status text, delivered_at timestamptz, used_at timestamptz, qty numeric)
language sql stable security definer set search_path = public as $$
  select j.id, j.no, j.patient, c.id, c.name, c.phone, j.status::text, j.delivered_at, min(m.created_at), sum(m.qty)
  from prd_job_materials m join jobs j on j.id = m.job_id left join lab_customers c on c.id = j.customer_id
  where m.item_id = p_item and m.lot_no = p_lot and (can_module('stock') or can_module('production') or can_logistics())
  group by j.id, c.id
  order by min(m.created_at);
$$;
revoke execute on function stk_lot_trace(uuid, text) from public, anon;
grant execute on function stk_lot_trace(uuid, text) to authenticated;

create or replace function stk_lot_set_status(p_item uuid, p_lot text, p_status text, p_reason text default null, p_cert text default null, p_supplier uuid default null, p_note text default null)
returns int language plpgsql security definer set search_path = public as $$
declare v_old text; v_jobs int; v_name text;
begin
  if not (can_module('stock', 2) or can_module('production', 3)) then raise exception 'not_allowed'; end if;
  if p_status not in ('ok', 'quarantine', 'recalled') then raise exception 'bad_status'; end if;
  if nullif(trim(coalesce(p_lot, '')), '') is null then raise exception 'lot_required'; end if;
  if p_status <> 'ok' and nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'reason_required'; end if;
  select status into v_old from stk_lots where item_id = p_item and lot_no = trim(p_lot);
  insert into stk_lots (item_id, lot_no, status, reason, cert_no, supplier_party_id, note, updated_by, updated_at)
  values (p_item, trim(p_lot), p_status, nullif(left(trim(coalesce(p_reason, '')), 500), ''), nullif(left(trim(coalesce(p_cert, '')), 80), ''), p_supplier, nullif(left(trim(coalesce(p_note, '')), 500), ''), auth.uid(), now())
  on conflict (item_id, lot_no) do update set status = excluded.status,
    reason = coalesce(excluded.reason, stk_lots.reason), cert_no = coalesce(excluded.cert_no, stk_lots.cert_no),
    supplier_party_id = coalesce(excluded.supplier_party_id, stk_lots.supplier_party_id), note = coalesce(excluded.note, stk_lots.note),
    updated_by = auth.uid(), updated_at = now();
  select count(distinct job_id)::int into v_jobs from prd_job_materials where item_id = p_item and lot_no = trim(p_lot);
  if p_status = 'recalled' and v_old is distinct from 'recalled' then
    select name into v_name from stk_items where id = p_item;
    perform deliver(lab_company(), module_recipients('stock', 1) || lab_recipients(), 'Lot geri çağrıldı: ' || coalesce(v_name, '') || ' / ' || trim(p_lot),
                    v_jobs || ' işte kullanılmış. Neden: ' || left(coalesce(p_reason, ''), 140), '/stok/lotlar?malzeme=' || p_item || '&lot=' || trim(p_lot));
  end if;
  return v_jobs;
end $$;
revoke execute on function stk_lot_set_status(uuid, text, text, text, text, uuid, text) from public, anon;
grant execute on function stk_lot_set_status(uuid, text, text, text, text, uuid, text) to authenticated;

-- Günlük: 30 gün içinde SKT'si dolacak, stokta olan lotlar (her lot için bir kez)
create or replace function stk_expiry_alerts() returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_lines text := '';
begin
  for r in
    select m.item_id, m.lot_no, i.name, max(m.expiry_date) exp, sum(m.qty) qty
    from stk_moves m join stk_items i on i.id = m.item_id
    where m.lot_no is not null
    group by m.item_id, m.lot_no, i.name
    having sum(m.qty) > 0 and max(m.expiry_date) is not null and max(m.expiry_date) <= current_date + 30
       and not exists (select 1 from stk_lots s where s.item_id = m.item_id and s.lot_no = m.lot_no and s.expiry_notified_at is not null)
    order by max(m.expiry_date)
  loop
    insert into stk_lots (item_id, lot_no, expiry_notified_at, updated_by) values (r.item_id, r.lot_no, now(), null)
    on conflict (item_id, lot_no) do update set expiry_notified_at = now();
    n := n + 1;
    if n <= 5 then v_lines := v_lines || r.name || ' / ' || r.lot_no || ' (' || to_char(r.exp, 'DD.MM.YYYY') || '), '; end if;
  end loop;
  if n > 0 then
    perform deliver(lab_company(), module_recipients('stock', 1), n || ' lotun son kullanma tarihi yaklaşıyor',
                    rtrim(v_lines, ', ') || case when n > 5 then ' …' else '' end, '/stok/lotlar?sure=30');
  end if;
  return n;
end $$;
revoke execute on function stk_expiry_alerts() from public, anon, authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function stk_expiry_alerts() to service_role; end if; end $$;

notify pgrst, 'reload schema';
