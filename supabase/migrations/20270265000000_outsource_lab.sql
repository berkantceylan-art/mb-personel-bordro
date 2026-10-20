-- Dış laboratuvar (ortodonti) iş takibi: gönderim listesi, dışarıda bekleyenler, iş geldi.
--  fin_parties.outsource_lab   : bu cari dış laboratuvar
--  lab_products.outsource_party_id : bu ürün dışarıda (bu labda) yapılır → iş kaydında otomatik "gönderilecek"
--  outsource_batches            : günlük gönderim listesi (yazdırılır)
--  job_outsource                : iş başına gönderim (sent → back / problem)

alter table fin_parties add column if not exists outsource_lab boolean not null default false;
alter table lab_products add column if not exists outsource_party_id uuid references fin_parties (id) on delete set null;

create sequence if not exists outsource_batch_no start 1;
create table if not exists outsource_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  no bigint not null default nextval('outsource_batch_no'),
  party_id uuid not null references fin_parties (id) on delete restrict,
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid(),
  note text check (note is null or length(note) <= 500),
  created_at timestamptz not null default now()
);
create index if not exists outsource_batches_idx on outsource_batches (company_id, sent_at desc);

create table if not exists job_outsource (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  job_id uuid not null references jobs (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete restrict,
  batch_id uuid references outsource_batches (id) on delete set null,
  status text not null default 'sent' check (status in ('sent', 'back', 'problem', 'cancelled')),
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid(),
  back_at timestamptz,
  back_by uuid,
  note text check (note is null or length(note) <= 500),
  back_note text check (back_note is null or length(back_note) <= 500),
  cost bigint,
  currency text check (currency is null or currency in ('TRY', 'EUR', 'USD')),
  created_at timestamptz not null default now()
);
create unique index if not exists job_outsource_open_idx on job_outsource (job_id) where status = 'sent';
create index if not exists job_outsource_status_idx on job_outsource (company_id, status, sent_at);
create index if not exists job_outsource_job_idx on job_outsource (job_id);

alter table outsource_batches enable row level security;
alter table job_outsource enable row level security;
drop policy if exists outsource_batches_rw on outsource_batches;
create policy outsource_batches_rw on outsource_batches for all to authenticated
  using (company_id = lab_company() and can_logistics()) with check (company_id = lab_company() and can_logistics());
drop policy if exists job_outsource_rw on job_outsource;
create policy job_outsource_rw on job_outsource for all to authenticated
  using (company_id = lab_company() and can_logistics()) with check (company_id = lab_company() and can_logistics());

-- Gönderilecek işler: dışarıda yapılan ürün içeren, açık, henüz gönderilmemiş (sorunlu dönenler yeniden listelenir)
create or replace function outsource_pending() returns table (
  job_id uuid, no bigint, in_date date, due_date date, customer text, doctor_name text, patient text, items text, qty int, party_id uuid, party text)
language sql stable security definer set search_path = public as $$
  select j.id, j.no, j.in_date, j.due_date, c.name, j.doctor_name, j.patient,
         string_agg(ji.name || case when ji.qty > 1 then ' ×' || ji.qty else '' end, ', ' order by ji.sort),
         sum(ji.qty)::int, (array_agg(p.outsource_party_id))[1], (array_agg(fp.name))[1]
    from jobs j
    join job_items ji on ji.job_id = j.id
    join lab_products p on p.id = ji.product_id and p.outsource_party_id is not null
    join fin_parties fp on fp.id = p.outsource_party_id
    left join lab_customers c on c.id = j.customer_id
   where can_logistics() and j.company_id = lab_company() and j.status in ('open', 'tryin', 'ready') and j.in_date >= current_date - 120
     and not exists (select 1 from job_outsource o where o.job_id = j.id and o.status in ('sent', 'back'))
   group by j.id, c.name
   order by j.in_date, j.no
$$;

-- Toplu gönderim: liste numarası döner
create or replace function outsource_send(p_jobs uuid[], p_party uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_batch outsource_batches; n int := 0; v_job uuid;
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = p_party and company_id = c and outsource_lab) then raise exception 'bad_lab'; end if;
  insert into outsource_batches (company_id, party_id, note) values (c, p_party, nullif(left(trim(coalesce(p_note, '')), 500), '')) returning * into v_batch;
  foreach v_job in array coalesce(p_jobs, '{}') loop
    if not exists (select 1 from jobs where id = v_job and company_id = c) then continue; end if;
    if exists (select 1 from job_outsource where job_id = v_job and status = 'sent') then continue; end if;
    insert into job_outsource (company_id, job_id, party_id, batch_id) values (c, v_job, p_party, v_batch.id);
    n := n + 1;
  end loop;
  if n = 0 then delete from outsource_batches where id = v_batch.id; return jsonb_build_object('batch', null, 'no', null, 'jobs', 0); end if;
  return jsonb_build_object('batch', v_batch.id, 'no', v_batch.no, 'jobs', n);
end $$;

-- İş geldi: iş no / barkod okutulur. p_problem: sorunlu geldi (iş yeniden "gönderilecek"e düşer)
create or replace function outsource_receive(p_code text, p_problem boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); j jobs; o job_outsource; v_cust text;
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  j := prd_find_job(p_code);
  if j.id is null or j.company_id is distinct from c then return jsonb_build_object('ok', false, 'message', 'İş bulunamadı: ' || coalesce(p_code, '')); end if;
  select name into v_cust from lab_customers where id = j.customer_id;
  select * into o from job_outsource where job_id = j.id and status = 'sent';
  if o.id is null then
    return jsonb_build_object('ok', false, 'job', j.no, 'job_id', j.id, 'patient', j.patient, 'customer', v_cust,
      'message', case when exists (select 1 from job_outsource where job_id = j.id and status = 'back') then 'Bu iş zaten geldi olarak işaretli.' else 'Bu iş dış laboratuvara gönderilmemiş görünüyor.' end);
  end if;
  update job_outsource set status = case when p_problem then 'problem' else 'back' end, back_at = now(), back_by = auth.uid(),
         back_note = nullif(left(trim(coalesce(p_note, '')), 500), '') where id = o.id;
  return jsonb_build_object('ok', true, 'job', j.no, 'job_id', j.id, 'patient', j.patient, 'customer', v_cust, 'problem', p_problem,
    'days', round(extract(epoch from now() - o.sent_at) / 86400.0, 1),
    'message', case when p_problem then 'Sorunlu geldi olarak kaydedildi; iş yeniden gönderilecekler listesinde.' else 'İş geldi.' end);
end $$;

-- Geri al (yanlış okutma): son durumu "dışarıda"ya döndürür
create or replace function outsource_undo(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_logistics() then raise exception 'not_allowed'; end if;
  update job_outsource set status = 'sent', back_at = null, back_by = null, back_note = null
   where id = p_id and company_id = lab_company() and status in ('back', 'problem')
     and not exists (select 1 from job_outsource x where x.job_id = job_outsource.job_id and x.status = 'sent');
end $$;

revoke execute on function outsource_pending() from public, anon;
revoke execute on function outsource_send(uuid[], uuid, text) from public, anon;
revoke execute on function outsource_receive(text, boolean, text) from public, anon;
revoke execute on function outsource_undo(uuid) from public, anon;
grant execute on function outsource_pending() to authenticated;
grant execute on function outsource_send(uuid[], uuid, text) to authenticated;
grant execute on function outsource_receive(text, boolean, text) to authenticated;
grant execute on function outsource_undo(uuid) to authenticated;
