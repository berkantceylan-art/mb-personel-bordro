-- Dış laboratuvar fiyat listesi + toplu ekstre (PDF) satırları, iş kayıtlarıyla eşleştirme
create table if not exists outsource_prices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  name text not null check (length(name) between 1 and 160),
  price bigint not null check (price >= 0),              -- kuruş
  currency text not null default 'TRY' check (currency in ('TRY', 'EUR', 'USD')),
  sort int not null default 0,
  created_at timestamptz not null default now(),
  unique (party_id, name)
);
-- ekstredeki ürün adı → fiyat listesi kalemi (öğrenilen eşleşme)
create table if not exists outsource_price_alias (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  norm_name text not null,
  price_id uuid not null references outsource_prices (id) on delete cascade,
  primary key (company_id, party_id, norm_name)
);
create table if not exists outsource_statements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  file_name text,
  mail_ref text,
  doc_date date,
  total bigint,
  lines int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists outsource_statements_mail_idx on outsource_statements (company_id, mail_ref) where mail_ref is not null;
create table if not exists outsource_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  statement_id uuid references outsource_statements (id) on delete cascade,
  party_id uuid not null references fin_parties (id) on delete cascade,
  line_date date,
  kind text not null default 'charge' check (kind in ('charge', 'payment')),
  product text,
  ref text,
  job_no bigint,
  amount bigint not null default 0,
  job_id uuid references jobs (id) on delete set null,
  outsource_id uuid references job_outsource (id) on delete set null,
  disputed boolean not null default false,
  note text check (note is null or length(note) <= 500),
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  unique (company_id, party_id, dedupe_key)
);
create index if not exists outsource_lines_job_idx on outsource_lines (job_id);
create index if not exists outsource_lines_date_idx on outsource_lines (company_id, party_id, line_date desc);

do $rls$ declare t text; begin
  foreach t in array array['outsource_prices', 'outsource_price_alias', 'outsource_statements', 'outsource_lines'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists %I on %I', t || '_rw', t);
    execute format('create policy %I on %I for all to authenticated using (company_id = lab_company() and (can_logistics() or can_module(''finance''))) with check (company_id = lab_company() and (can_logistics() or can_module(''finance'', 2)))', t || '_rw', t);
  end loop;
end $rls$;

-- Ekstre kaydet. p: {file_name, mail_ref, doc_date, total, email, lines:[{date, kind, product, ref, job_no, amount, key}]}
-- Aynı satır (tarih + iş no + ürün + tutar + sıra) ikinci kez gelirse atlanır. İş no → iş + dış lab gönderimi bağlanır, gönderime maliyet yazılır.
create or replace function outsource_statement_save(p_party uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); v_id uuid; r jsonb; n int := 0; dup int := 0; v_job uuid; v_os uuid;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = p_party and company_id = c and outsource_lab) then raise exception 'bad_lab'; end if;
  if p->>'mail_ref' is not null and exists (select 1 from outsource_statements where company_id = c and mail_ref = p->>'mail_ref') then
    return jsonb_build_object('statement', null, 'lines', 0, 'skipped', 0, 'already', true);
  end if;
  insert into outsource_statements (company_id, party_id, file_name, mail_ref, doc_date, total)
  values (c, p_party, left(p->>'file_name', 200), nullif(p->>'mail_ref', ''), nullif(p->>'doc_date', '')::date, nullif(p->>'total', '')::bigint) returning id into v_id;
  if coalesce(p->>'email', '') <> '' then
    update fin_parties set email = left(p->>'email', 200) where id = p_party and coalesce(email, '') = '';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    v_job := null; v_os := null;
    if (r->>'job_no') ~ '^[0-9]{1,12}$' then
      select id into v_job from jobs where company_id = c and no = (r->>'job_no')::bigint;
      if v_job is not null then
        select id into v_os from job_outsource where job_id = v_job and party_id = p_party order by (status = 'back') desc, sent_at desc limit 1;
      end if;
    end if;
    insert into outsource_lines (company_id, statement_id, party_id, line_date, kind, product, ref, job_no, amount, job_id, outsource_id, dedupe_key)
    values (c, v_id, p_party, nullif(r->>'date', '')::date, coalesce(nullif(r->>'kind', ''), 'charge'), left(r->>'product', 200), left(r->>'ref', 200),
            case when (r->>'job_no') ~ '^[0-9]{1,12}$' then (r->>'job_no')::bigint end, coalesce((r->>'amount')::bigint, 0), v_job, v_os, r->>'key')
    on conflict (company_id, party_id, dedupe_key) do nothing;
    if found then n := n + 1; else dup := dup + 1; end if;
  end loop;
  update outsource_statements set lines = n where id = v_id;
  -- gönderimlere maliyet (aynı gönderime ait satırların toplamı)
  update job_outsource o set cost = s.t, currency = 'TRY'
    from (select outsource_id, sum(amount) t from outsource_lines where company_id = c and outsource_id is not null and kind = 'charge' group by outsource_id) s
   where o.id = s.outsource_id and o.company_id = c;
  if n = 0 then delete from outsource_statements where id = v_id; v_id := null; end if;
  return jsonb_build_object('statement', v_id, 'lines', n, 'skipped', dup);
end $$;

-- fiyat listesini toplu kaydet: p: [{name, price}]  (aynı ad güncellenir)
create or replace function outsource_prices_save(p_party uuid, p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); r jsonb; n int := 0; i int := 0;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from fin_parties where id = p_party and company_id = c) then raise exception 'bad_lab'; end if;
  for r in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    i := i + 1;
    insert into outsource_prices (company_id, party_id, name, price, sort) values (c, p_party, left(trim(r->>'name'), 160), (r->>'price')::bigint, i)
    on conflict (party_id, name) do update set price = excluded.price, sort = excluded.sort;
    n := n + 1;
  end loop;
  return n;
end $$;

-- satırları yeniden bağla (iş sonradan gönderildiyse)
create or replace function outsource_lines_relink(p_party uuid) returns int
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); n int;
begin
  if not (can_logistics() or can_module('finance', 2)) then raise exception 'not_allowed'; end if;
  update outsource_lines l set job_id = j.id from jobs j where l.company_id = c and l.party_id = p_party and l.job_id is null and j.company_id = c and j.no = l.job_no;
  update outsource_lines l set outsource_id = (select o.id from job_outsource o where o.job_id = l.job_id and o.party_id = l.party_id order by (o.status = 'back') desc, o.sent_at desc limit 1)
   where l.company_id = c and l.party_id = p_party and l.outsource_id is null and l.job_id is not null;
  get diagnostics n = row_count;
  update job_outsource o set cost = s.t, currency = 'TRY'
    from (select outsource_id, sum(amount) t from outsource_lines where company_id = c and outsource_id is not null and kind = 'charge' group by outsource_id) s
   where o.id = s.outsource_id and o.company_id = c;
  return n;
end $$;

revoke execute on function outsource_statement_save(uuid, jsonb) from public, anon;
revoke execute on function outsource_prices_save(uuid, jsonb) from public, anon;
revoke execute on function outsource_lines_relink(uuid) from public, anon;
grant execute on function outsource_statement_save(uuid, jsonb) to authenticated;
grant execute on function outsource_prices_save(uuid, jsonb) to authenticated;
grant execute on function outsource_lines_relink(uuid) to authenticated;
