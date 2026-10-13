-- Müşteri ciroları: hekim, klinik, hastane, aracı kurum ve yurt dışı müşterilerin günlük / aylık / iki tarih arası
-- cirosu (iş kayıtlarından), önceki döneme göre değişim, tahsilat, ürün kırılımı, yeni ve kaybedilen müşteriler.
-- Erişim: şirket sahibi, patron ekranı yetkilisi ve sahibin ayrıca yetki verdiği kullanıcılar (rev_viewers).
-- Tekrar çalıştırılabilir.

create table if not exists rev_viewers (
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
alter table rev_viewers enable row level security;
drop policy if exists rev_viewers_read on rev_viewers;
create policy rev_viewers_read on rev_viewers for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = rev_viewers.company_id and m.role = 'owner'));
grant select on rev_viewers to authenticated;
revoke insert, update, delete on rev_viewers from authenticated;

create or replace function rev_can() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and (m.role = 'owner' or m.is_boss))
      or exists (select 1 from rev_viewers v where v.user_id = auth.uid() and v.company_id = lab_company());
$$;
revoke execute on function rev_can() from public, anon;
grant execute on function rev_can() to authenticated;

create or replace function rev_viewer_set(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from memberships m where m.user_id = auth.uid() and m.company_id = lab_company() and m.role = 'owner') then raise exception 'not_owner'; end if;
  if p_on then
    if not exists (select 1 from memberships where user_id = p_user and company_id = lab_company()) then raise exception 'not_member'; end if;
    insert into rev_viewers (user_id) values (p_user) on conflict do nothing;
  else
    delete from rev_viewers where user_id = p_user and company_id = lab_company();
  end if;
end $$;
revoke execute on function rev_viewer_set(uuid, boolean) from public, anon;
grant execute on function rev_viewer_set(uuid, boolean) to authenticated;

-- p_basis: 'in' = iş giriş tarihi, 'delivered' = teslim tarihi · p_kind: müşteri türü süzgeci (boş = hepsi)
create or replace function rev_report(p_from date, p_to date, p_basis text default 'in', p_kind text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  c uuid := lab_company();
  v_len int;
  p_from0 date;
  p_to0 date;
  v_bucket text;
  r jsonb;
begin
  if not rev_can() then raise exception 'not_allowed'; end if;
  if p_to < p_from then p_to := p_from; end if;
  v_len := p_to - p_from + 1;
  p_to0 := p_from - 1;
  p_from0 := p_from - v_len;
  v_bucket := case when v_len <= 62 then 'day' when v_len <= 800 then 'month' else 'year' end;

  with j as (
    select jb.id, jb.customer_id, jb.total, jb.currency,
           case when p_basis = 'delivered' then (jb.delivered_at at time zone 'Europe/Istanbul')::date else jb.in_date end as d
    from jobs jb join lab_customers lc on lc.id = jb.customer_id
    where jb.company_id = c and jb.status <> 'cancelled' and (p_kind is null or p_kind = '' or lc.kind = p_kind)
      and (p_basis <> 'delivered' or jb.delivered_at is not null)
  ),
  jt as (select j.*, round(j.total * case when j.currency = 'TRY' then 1 else coalesce(fx_rate(j.currency, j.d), 1) end)::bigint as try from j),
  cur as (select * from jt where d between p_from and p_to),
  prev as (select * from jt where d between p_from0 and p_to0),
  units as (select ji.job_id, sum(ji.qty) as u from job_items ji where ji.job_id in (select id from cur) group by ji.job_id),
  buckets as (
    select date_trunc(v_bucket, g)::date as b from generate_series(p_from, p_to, ('1 ' || v_bucket)::interval) g
  ),
  cust as (
    select lc.id, lc.name, lc.kind, lc.city, lc.country, lc.currency,
           count(cur.id) as jobs, coalesce(sum(cur.total), 0) as revenue, coalesce(sum(cur.try), 0) as revenue_try,
           coalesce(sum(u.u), 0) as units,
           coalesce((select sum(p.try) from prev p where p.customer_id = lc.id), 0) as prev_try,
           max(cur.d) as last_date
    from lab_customers lc
    join cur on cur.customer_id = lc.id
    left join units u on u.job_id = cur.id
    group by lc.id
  ),
  lost as (
    select lc.id, lc.name, lc.kind, sum(p.try) as prev_try
    from prev p join lab_customers lc on lc.id = p.customer_id
    where not exists (select 1 from cur where cur.customer_id = p.customer_id)
    group by lc.id order by sum(p.try) desc limit 15
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to, 'prev_from', p_from0, 'prev_to', p_to0, 'bucket', v_bucket, 'basis', p_basis,
    'total_try', (select coalesce(sum(try), 0) from cur),
    'prev_try', (select coalesce(sum(try), 0) from prev),
    'jobs', (select count(*) from cur),
    'prev_jobs', (select count(*) from prev),
    'units', (select coalesce(sum(u), 0) from units),
    'customers', (select count(distinct customer_id) from cur),
    'prev_customers', (select count(distinct customer_id) from prev),
    'collected_try', (select coalesce(sum(round(lp.amount * case when lp.currency = 'TRY' then 1 else coalesce(fx_rate(lp.currency, lp.paid_on), 1) end)), 0)
                      from lab_payments lp join lab_customers lc on lc.id = lp.customer_id
                      where lc.company_id = c and lp.paid_on between p_from and p_to and (p_kind is null or p_kind = '' or lc.kind = p_kind)),
    'series', coalesce((select jsonb_agg(jsonb_build_object('b', b.b, 'try', coalesce(x.t, 0), 'jobs', coalesce(x.n, 0)) order by b.b) from buckets b
                        left join (select date_trunc(v_bucket, d)::date as b, sum(try) t, count(*) n from cur group by 1) x on x.b = b.b), '[]'),
    'prev_series', coalesce((select jsonb_agg(jsonb_build_object('i', i, 'try', t) order by i) from (
                        select (case v_bucket when 'day' then d - p_from0 when 'month' then (extract(year from d) * 12 + extract(month from d) - extract(year from p_from0) * 12 - extract(month from p_from0))::int else (extract(year from d) - extract(year from p_from0))::int end) as i, sum(try) t
                        from prev group by 1) y), '[]'),
    'by_kind', coalesce((select jsonb_agg(jsonb_build_object('kind', k, 'try', t, 'customers', n, 'jobs', jn) order by t desc) from (
                        select lc.kind k, sum(cur.try) t, count(distinct cur.customer_id) n, count(*) jn from cur join lab_customers lc on lc.id = cur.customer_id group by lc.kind) z), '[]'),
    'by_customer', coalesce((select jsonb_agg(jsonb_build_object(
                        'id', id, 'name', name, 'kind', kind, 'city', city, 'country', country, 'currency', currency, 'jobs', jobs, 'units', units,
                        'revenue', revenue, 'try', revenue_try, 'prev_try', prev_try, 'last', last_date,
                        'collected', (select coalesce(sum(round(lp.amount * case when lp.currency = 'TRY' then 1 else coalesce(fx_rate(lp.currency, lp.paid_on), 1) end)), 0) from lab_payments lp where lp.customer_id = cust.id and lp.paid_on between p_from and p_to),
                        'new', not exists (select 1 from jt where jt.customer_id = cust.id and jt.d < p_from),
                        'spark', (select jsonb_agg(coalesce(x.t, 0) order by b.b) from buckets b left join (select date_trunc(v_bucket, d)::date b, sum(try) t from cur where cur.customer_id = cust.id group by 1) x on x.b = b.b)
                      ) order by revenue_try desc) from cust), '[]'),
    'by_product', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q, 'try', t) order by t desc) from (
                        select coalesce(lp.name, ji.name) n, sum(ji.qty) q,
                               sum(round(ji.amount * case when cur.currency = 'TRY' then 1 else coalesce(fx_rate(cur.currency, cur.d), 1) end))::bigint t
                        from job_items ji join cur on cur.id = ji.job_id left join lab_products lp on lp.id = ji.product_id
                        group by 1 order by 3 desc limit 15) w), '[]'),
    'lost', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'prev_try', prev_try)) from lost), '[]')
  ) into r;
  return r;
end $$;
revoke execute on function rev_report(date, date, text, text) from public, anon;
grant execute on function rev_report(date, date, text, text) to authenticated;

notify pgrst, 'reload schema';
