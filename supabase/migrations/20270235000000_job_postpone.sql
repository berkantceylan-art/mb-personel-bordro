-- İş erteleme: bugün çıkamayan işlerin teslim tarihini ileri almak (tek tek ya da toplu), sebep ve geçmiş, rapor
-- Önce 20261125000000_lab_jobs.sql. Tekrar çalıştırılabilir.

alter table jobs add column if not exists original_due_date date;
alter table jobs add column if not exists postpone_count int not null default 0;

create table if not exists job_postpones (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  from_date date,
  to_date date not null,
  reason text not null default 'capacity' check (reason in ('capacity', 'material', 'doctor', 'remake', 'quality', 'tryin', 'other')),
  note text check (note is null or length(note) <= 500),
  by_user uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists job_postpones_job_idx on job_postpones (job_id, created_at desc);
create index if not exists job_postpones_day_idx on job_postpones (company_id, created_at desc);
alter table job_postpones enable row level security;
drop policy if exists job_postpones_read on job_postpones;
create policy job_postpones_read on job_postpones for select to authenticated using ((select can_logistics()) or (select can_module('production')));
revoke insert, update, delete on job_postpones from anon, authenticated;

-- Toplu / tekli erteleme: açık, provadaki ya da hazır işler. Bekleyen prova adımları da aynı güne kayar.
create or replace function job_postpone(p_ids uuid[], p_to date, p_reason text default 'capacity', p_note text default null) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); j jobs; n int := 0; v_today date := (now() at time zone 'Europe/Istanbul')::date;
begin
  if not (can_logistics() or can_module('production', 2)) then raise exception 'Erteleme yetkiniz yok'; end if;
  if p_to is null or p_to < v_today then raise exception 'Yeni teslim tarihi bugünden önce olamaz'; end if;
  if p_to > v_today + 90 then raise exception 'En fazla 90 gün ileri ertelenebilir'; end if;
  if coalesce(p_reason, '') not in ('capacity', 'material', 'doctor', 'remake', 'quality', 'tryin', 'other') then p_reason := 'other'; end if;
  for j in select * from jobs where id = any (coalesce(p_ids, '{}')) and company_id = c and status in ('open', 'tryin', 'ready') for update loop
    if j.due_date is not distinct from p_to then continue; end if;
    insert into job_postpones (company_id, job_id, from_date, to_date, reason, note)
    values (c, j.id, j.due_date, p_to, p_reason, left(nullif(trim(p_note), ''), 500));
    update job_steps set out_date = p_to where job_id = j.id and not done and (out_date is null or out_date <= coalesce(j.due_date, out_date));
    update jobs set due_date = p_to, original_due_date = coalesce(original_due_date, j.due_date), postpone_count = postpone_count + 1 where id = j.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function job_postpone(uuid[], date, text, text) from public, anon;
grant execute on function job_postpone(uuid[], date, text, text) to authenticated;

-- Rapor: dönemdeki ertelemeler (sebep, hekim, gün kırılımı ve liste)
create or replace function job_postpone_report(p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with r as (
    select p.*, j.no, j.patient, j.status, j.customer_id, lc.name customer, (p.created_at at time zone 'Europe/Istanbul')::date d
    from job_postpones p join jobs j on j.id = p.job_id left join lab_customers lc on lc.id = j.customer_id
    where p.company_id = lab_company() and (p.created_at at time zone 'Europe/Istanbul')::date between p_from and p_to
  )
  select case when (can_logistics() or can_module('production')) then jsonb_build_object(
    'total', (select count(*) from r),
    'jobs', (select count(distinct job_id) from r),
    'by_reason', (select coalesce(jsonb_agg(jsonb_build_object('reason', reason, 'n', n) order by n desc), '[]') from (select reason, count(*) n from r group by 1) x),
    'by_customer', (select coalesce(jsonb_agg(jsonb_build_object('customer', customer, 'n', n) order by n desc), '[]') from (select coalesce(customer, '—') customer, count(*) n from r group by 1 order by 2 desc limit 10) y),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]') from (select d, count(*) n from r group by 1) z),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'job_id', job_id, 'no', no, 'patient', patient, 'customer', customer, 'status', status,
               'from', from_date, 'to', to_date, 'reason', reason, 'note', note, 'at', created_at) order by created_at desc), '[]') from (select * from r order by created_at desc limit 300) w)
  ) end
$$;
revoke execute on function job_postpone_report(date, date) from public, anon;
grant execute on function job_postpone_report(date, date) to authenticated;

notify pgrst, 'reload schema';
