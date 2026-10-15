-- =====================================================================
-- Luca aktarımı: onaylı fişlerin Luca "Excel Veri Aktarımı" şablonuna göre dışa aktarılması
--  gl_luca_settings  : sütun düzeni (Luca şablonundaki başlıklar), hariç tutulan fiş etiketleri, belge türü / ödeme yöntemi eşlemesi
--  gl_luca_accounts  : Luca hesap planı (Excel'den içe alınır) — kodu Luca'da olmayan satır aktarılmaz
--  gl_luca_map       : ERP kodu → Luca kodu eşlemesi (boşsa aynı kod)
--  gl_luca_batches   : aktarım paketleri; fiş bir kez aktarılır, sonradan değişirse uyarılır
-- Luca kuralları: aynı Fiş No + Fiş Tarihi tek fiş; dosya başına en çok 50 fiş; mahsup fişi en çok 400 satır;
--   açılış / kapanış fişleri ayrı dosyada (Luca'da "Fiş Kes" sırasında fiş tipi dosya için seçilir).
-- Tekrar çalıştırılabilir. Önce 20270218000000_gl_checks.sql.
-- =====================================================================

create table if not exists gl_luca_settings (
  company_id uuid primary key default lab_company() references companies (id) on delete cascade,
  columns jsonb not null default '[]'::jsonb,           -- [{header, field}] Luca şablonundaki sırayla
  exclude_prefixes text[] not null default '{vat:,gecici:,cit:}',
  doc_map jsonb not null default '{}'::jsonb,           -- doc_type → Luca belge türü
  pay_map jsonb not null default '{}'::jsonb,           -- hesap kodu öneki → ödeme yöntemi (e-defter)
  template_name text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table gl_luca_settings enable row level security;
drop policy if exists gl_luca_settings_read on gl_luca_settings;
create policy gl_luca_settings_read on gl_luca_settings for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_luca_settings from anon;
grant select on gl_luca_settings to authenticated;

create table if not exists gl_luca_accounts (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  code text not null check (length(code) between 1 and 40),
  name text,
  imported_at timestamptz not null default now(),
  primary key (company_id, code)
);
alter table gl_luca_accounts enable row level security;
drop policy if exists gl_luca_accounts_read on gl_luca_accounts;
create policy gl_luca_accounts_read on gl_luca_accounts for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_luca_accounts from anon;
grant select on gl_luca_accounts to authenticated;

create table if not exists gl_luca_map (
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  erp_code text not null,
  luca_code text not null check (length(luca_code) between 1 and 40),
  updated_at timestamptz not null default now(),
  primary key (company_id, erp_code)
);
alter table gl_luca_map enable row level security;
drop policy if exists gl_luca_map_read on gl_luca_map;
create policy gl_luca_map_read on gl_luca_map for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_luca_map from anon;
grant select on gl_luca_map to authenticated;

create table if not exists gl_luca_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  no int not null,
  from_date date,
  to_date date,
  vouchers int not null default 0,
  lines int not null default 0,
  total bigint not null default 0,
  note text check (note is null or length(note) <= 300),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  undone_by uuid,
  undone_at timestamptz,
  unique (company_id, no)
);
alter table gl_luca_batches enable row level security;
drop policy if exists gl_luca_batches_read on gl_luca_batches;
create policy gl_luca_batches_read on gl_luca_batches for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_luca_batches from anon;
grant select on gl_luca_batches to authenticated;

create table if not exists gl_luca_batch_items (
  batch_id uuid not null references gl_luca_batches (id) on delete cascade,
  voucher_id uuid not null references gl_vouchers (id) on delete cascade,
  hash text not null,
  primary key (batch_id, voucher_id)
);
alter table gl_luca_batch_items enable row level security;
drop policy if exists gl_luca_batch_items_read on gl_luca_batch_items;
create policy gl_luca_batch_items_read on gl_luca_batch_items for select to authenticated
  using (exists (select 1 from gl_luca_batches b where b.id = batch_id and b.company_id = lab_company()) and can_module('ledger'));
revoke all on gl_luca_batch_items from anon;
grant select on gl_luca_batch_items to authenticated;

alter table gl_vouchers add column if not exists luca_batch_id uuid references gl_luca_batches (id) on delete set null;
create index if not exists gl_vouchers_luca_idx on gl_vouchers (company_id, luca_batch_id);

-- Varsayılan ayarlar (Luca şablonu yüklenince sütunlar onun başlıklarıyla değişir)
create or replace function gl_luca_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    -- Luca "Fiş Aktarım Şablon" (Excel Veri Aktarımı › Şablon indir) sütunları
    'columns', jsonb_build_array(
      jsonb_build_object('header', 'Fiş No', 'field', 'fis_no'),
      jsonb_build_object('header', 'Fiş Tarihi', 'field', 'fis_tarihi'),
      jsonb_build_object('header', 'Fiş Açıklama', 'field', 'fis_aciklama'),
      jsonb_build_object('header', 'Hesap Kodu', 'field', 'hesap_kodu'),
      jsonb_build_object('header', 'Evrak No', 'field', 'evrak_no'),
      jsonb_build_object('header', 'Evrak Tarihi', 'field', 'evrak_tarihi'),
      jsonb_build_object('header', 'Detay Açıklama', 'field', 'aciklama'),
      jsonb_build_object('header', 'Borç', 'field', 'borc'),
      jsonb_build_object('header', 'Alacak', 'field', 'alacak'),
      jsonb_build_object('header', 'Miktar', 'field', 'miktar'),
      jsonb_build_object('header', 'Belge Türü', 'field', 'belge_turu'),
      jsonb_build_object('header', 'Para Birimi', 'field', 'doviz'),
      jsonb_build_object('header', 'Kur', 'field', 'kur'),
      jsonb_build_object('header', 'Döviz Tutar', 'field', 'doviz_tutar'),
      jsonb_build_object('header', 'TC/Vergi No', 'field', 'vkn')),
    'exclude_prefixes', to_jsonb(array['vat:', 'gecici:', 'cit:']),
    'doc_map', jsonb_build_object('invoice', 'FATURA', 'check', 'ÇEK', 'note', 'SENET', 'receipt', 'MAKBUZ', 'voucher', 'DİĞER', 'other', 'DİĞER'),
    'pay_map', jsonb_build_object('100', 'NAKİT', '102', 'BANKA', '101', 'ÇEK', '103', 'ÇEK', '121', 'SENET', '321', 'SENET'));
$$;

create or replace function gl_luca_get_settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then (
    select jsonb_build_object(
      'columns', case when s.columns is null or jsonb_array_length(s.columns) = 0 then d->'columns' else s.columns end,
      'exclude_prefixes', coalesce(to_jsonb(s.exclude_prefixes), d->'exclude_prefixes'),
      'doc_map', d->'doc_map' || coalesce(s.doc_map, '{}'),
      'pay_map', case when s.pay_map is null or s.pay_map = '{}'::jsonb then d->'pay_map' else s.pay_map end,
      'template_name', s.template_name, 'updated_at', s.updated_at,
      'plan_count', (select count(*) from gl_luca_accounts where company_id = lab_company()),
      'plan_imported_at', (select max(imported_at) from gl_luca_accounts where company_id = lab_company()),
      'map_count', (select count(*) from gl_luca_map where company_id = lab_company()))
    from (select gl_luca_defaults() d) x left join gl_luca_settings s on s.company_id = lab_company()) end;
$$;
revoke execute on function gl_luca_get_settings() from public, anon;
grant execute on function gl_luca_get_settings() to authenticated;

create or replace function gl_luca_save_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare f text;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if p ? 'columns' and jsonb_typeof(p->'columns') = 'array' and jsonb_array_length(p->'columns') = 0 then
    null;  -- boş dizi: varsayılan sütunlara dön
  elsif p ? 'columns' then
    if jsonb_typeof(p->'columns') <> 'array' or jsonb_array_length(p->'columns') > 40 then raise exception 'luca_bad_columns'; end if;
    for f in select c->>'field' from jsonb_array_elements(p->'columns') c loop
      if f not in ('fis_no', 'fis_tarihi', 'fis_aciklama', 'fis_tipi', 'hesap_kodu', 'hesap_adi', 'evrak_no', 'evrak_tarihi', 'aciklama',
                   'borc', 'alacak', 'tutar', 'borc_alacak', 'miktar', 'belge_turu', 'odeme_yontemi', 'doviz', 'doviz_tutar', 'kur', 'vkn', 'bos') then
        raise exception 'luca_bad_columns';
      end if;
    end loop;
    if not exists (select 1 from jsonb_array_elements(p->'columns') c where c->>'field' = 'hesap_kodu')
       or not exists (select 1 from jsonb_array_elements(p->'columns') c where c->>'field' = 'fis_no') then
      raise exception 'luca_bad_columns';
    end if;
  end if;
  insert into gl_luca_settings (company_id) values (lab_company()) on conflict (company_id) do nothing;
  update gl_luca_settings set
    columns = case when p ? 'columns' then p->'columns' else columns end,
    exclude_prefixes = case when p ? 'exclude_prefixes' then array(select left(trim(x), 20) from jsonb_array_elements_text(p->'exclude_prefixes') x where trim(x) <> '') else exclude_prefixes end,
    doc_map = case when p ? 'doc_map' then p->'doc_map' else doc_map end,
    pay_map = case when p ? 'pay_map' then p->'pay_map' else pay_map end,
    template_name = case when p ? 'template_name' then left(p->>'template_name', 120) else template_name end,
    updated_by = auth.uid(), updated_at = now()
  where company_id = lab_company();
end $$;
revoke execute on function gl_luca_save_settings(jsonb) from public, anon;
grant execute on function gl_luca_save_settings(jsonb) to authenticated;

-- Luca hesap planı: [{code, name}] — öncekinin yerine geçer
create or replace function gl_luca_import_accounts(p_rows jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'luca_plan_empty'; end if;
  delete from gl_luca_accounts where company_id = lab_company();
  insert into gl_luca_accounts (company_id, code, name)
  select distinct on (c) lab_company(), c, left(nullif(trim(r->>'name'), ''), 200)
  from jsonb_array_elements(p_rows) r cross join lateral (select left(regexp_replace(trim(r->>'code'), '\s+', '', 'g'), 40) c) k
  where c ~ '^[0-9]' order by c;
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function gl_luca_import_accounts(jsonb) from public, anon;
grant execute on function gl_luca_import_accounts(jsonb) to authenticated;

create or replace function gl_luca_map_set(p_erp text, p_luca text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if nullif(trim(p_luca), '') is null or trim(p_luca) = trim(p_erp) then
    delete from gl_luca_map where company_id = lab_company() and erp_code = trim(p_erp);
  else
    insert into gl_luca_map (company_id, erp_code, luca_code) values (lab_company(), trim(p_erp), left(regexp_replace(trim(p_luca), '\s+', '', 'g'), 40))
    on conflict (company_id, erp_code) do update set luca_code = excluded.luca_code, updated_at = now();
  end if;
end $$;
revoke execute on function gl_luca_map_set(text, text) from public, anon;
grant execute on function gl_luca_map_set(text, text) to authenticated;

-- Fiş içeriğinin parmak izi: aktarımdan sonra değişti mi?
create or replace function gl_luca_hash(p_v uuid) returns text
language sql stable security definer set search_path = public as $$
  select md5(v.voucher_date::text || '|' || v.status || '|' || coalesce(v.doc_no, '') || '|' || coalesce(v.description, '') || '|' ||
    coalesce((select string_agg(a.code || ':' || l.debit || ':' || l.credit || ':' || coalesce(l.description, ''), ';' order by l.sort, l.id)
              from gl_lines l join gl_accounts a on a.id = l.account_id where l.voucher_id = v.id), ''))
  from gl_vouchers v where v.id = p_v;
$$;
revoke execute on function gl_luca_hash(uuid) from public, anon, authenticated;

-- Bir fişin Luca'ya gidecek satırları ve sorunları
create or replace function gl_luca_voucher(p_v uuid, p_set jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v gl_vouchers; co uuid := lab_company(); has_plan boolean; lines jsonb; issues jsonb := '[]'::jsonb;
  d bigint; c bigint; n int; miss int; nonleaf int; dt text; pay text; bi gl_luca_batch_items; changed boolean := false; excl text;
begin
  select * into v from gl_vouchers where id = p_v and company_id = co;
  if v.id is null then return null; end if;
  has_plan := exists (select 1 from gl_luca_accounts where company_id = co);
  dt := p_set->'doc_map'->>coalesce(v.doc_type, 'other');
  select coalesce(jsonb_agg(x order by (x->>'sort')::int, (x->>'line_id')::bigint), '[]'), coalesce(sum((x->>'debit')::bigint), 0), coalesce(sum((x->>'credit')::bigint), 0),
         count(*), count(*) filter (where (x->>'missing')::boolean), count(*) filter (where (x->>'not_leaf')::boolean)
    into lines, d, c, n, miss, nonleaf
  from (
    select jsonb_build_object('line_id', l.id, 'sort', l.sort, 'erp_code', a.code, 'luca_code', lc.code, 'name', coalesce(la.name, a.name),
             'debit', l.debit, 'credit', l.credit, 'description', coalesce(l.description, v.description), 'currency', l.currency, 'fx_amount', l.fx_amount, 'rate', l.rate,
             'vkn', (select fp.tax_no from fin_parties fp where fp.id = coalesce(l.party_id, case when a.link_type = 'party' then a.link_id end)),
             'pay', (select p_set->'pay_map'->>k from jsonb_object_keys(coalesce(p_set->'pay_map', '{}')) k where lc.code like k || '%' order by length(k) desc limit 1),
             'missing', has_plan and la.code is null,
             'not_leaf', has_plan and la.code is not null and exists (select 1 from gl_luca_accounts z where z.company_id = co and z.code like lc.code || '.%')) x
    from gl_lines l join gl_accounts a on a.id = l.account_id
    cross join lateral (select coalesce((select m.luca_code from gl_luca_map m where m.company_id = co and m.erp_code = a.code), a.code) code) lc
    left join gl_luca_accounts la on la.company_id = co and la.code = lc.code
    where l.voucher_id = v.id
  ) q;
  pay := (select string_agg(distinct e->>'pay', ',') from jsonb_array_elements(lines) e where e->>'pay' is not null);

  if n = 0 then issues := issues || jsonb_build_object('key', 'no_lines', 'block', true, 'text', 'Satırı yok'); end if;
  if d <> c then issues := issues || jsonb_build_object('key', 'unbalanced', 'block', true, 'text', 'Borç ve alacak eşit değil'); end if;
  if n > 400 and v.kind not in ('acilis', 'kapanis') then issues := issues || jsonb_build_object('key', 'too_many_lines', 'block', true, 'text', 'Luca mahsup fişi en çok 400 satır alır (' || n || ')'); end if;
  if miss > 0 then issues := issues || jsonb_build_object('key', 'missing_account', 'block', true, 'text', miss || ' satırın hesap kodu Luca hesap planında yok'); end if;
  if nonleaf > 0 then issues := issues || jsonb_build_object('key', 'not_leaf', 'block', true, 'text', nonleaf || ' satır Luca''da ana hesaba gidiyor (alt hesap seçilmeli)'); end if;
  if v.status <> 'posted' then issues := issues || jsonb_build_object('key', 'not_posted', 'block', true, 'text', case v.status when 'draft' then 'Onay bekliyor' when 'pending' then 'Eşleştirme bekliyor' when 'cancelled' then 'İptal edilmiş' else 'Kesinleşmemiş' end); end if;
  if v.doc_type in ('invoice', 'check', 'note', 'receipt') and (v.doc_no is null or v.doc_date is null) then
    issues := issues || jsonb_build_object('key', 'doc_missing', 'block', false, 'text', 'Belge no / tarihi eksik (e-defter 20042)');
  end if;
  if pay like '%,%' and exists (select 1 from jsonb_array_elements(coalesce(p_set->'columns', '[]')) cc where cc->>'field' = 'odeme_yontemi') then issues := issues || jsonb_build_object('key', 'multi_pay', 'block', false, 'text', 'Fişte birden fazla ödeme yöntemi var (e-defter 20047)'); end if;
  if exists (select 1 from jsonb_array_elements(lines) e where e->>'currency' <> 'TRY') then issues := issues || jsonb_build_object('key', 'fx', 'block', false, 'text', 'Dövizli satır var: döviz tutarı ve kur da aktarılır'); end if;

  if v.luca_batch_id is not null then
    select * into bi from gl_luca_batch_items where batch_id = v.luca_batch_id and voucher_id = v.id;
    changed := bi.hash is distinct from gl_luca_hash(v.id);
    if changed then issues := issues || jsonb_build_object('key', 'changed', 'block', false, 'text', case when v.status = 'cancelled' then 'Luca''ya aktarıldıktan sonra iptal edildi: Luca''da da silin' else 'Luca''ya aktarıldıktan sonra değişti: Luca''da düzeltin veya yeniden aktarın' end); end if;
  end if;
  select pfx into excl from unnest(array(select jsonb_array_elements_text(coalesce(p_set->'exclude_prefixes', '[]')))) pfx where v.tag like pfx || '%' limit 1;

  return jsonb_build_object('id', v.id, 'year', v.year, 'no', v.no, 'journal_no', v.journal_no, 'date', v.voucher_date, 'kind', v.kind, 'source', v.source, 'status', v.status,
    'tag', v.tag, 'description', v.description, 'doc_type', v.doc_type, 'belge_turu', dt, 'doc_no', v.doc_no, 'doc_date', v.doc_date, 'total', d,
    'line_count', n, 'lines', lines, 'issues', issues, 'blocked', exists (select 1 from jsonb_array_elements(issues) i where (i->>'block')::boolean),
    'batch_id', v.luca_batch_id, 'batch_no', (select b.no from gl_luca_batches b where b.id = v.luca_batch_id), 'changed', changed, 'excluded_by', excl);
end $$;
revoke execute on function gl_luca_voucher(uuid, jsonb) from public, anon, authenticated;

-- Ad karşılaştırması için sadeleştirme
create or replace function gl_luca_norm(t text) returns text language sql immutable as $$
  select regexp_replace(upper(translate(coalesce(t, ''), 'ığüşöçiİĞÜŞÖÇâÂîÎ', 'IGUSOCIIGUSOCAAII')), '[^A-Z0-9]', '', 'g');
$$;

create or replace function gl_luca_leaves(p_main text) returns table (code text, nm text)
language sql stable security definer set search_path = public as $$
  select la.code, gl_luca_norm(la.name) from gl_luca_accounts la
  where la.company_id = lab_company() and la.code like p_main || '.%'
    and not exists (select 1 from gl_luca_accounts c2 where c2.company_id = la.company_id and c2.code like la.code || '.%');
$$;
revoke execute on function gl_luca_leaves(text) from public, anon, authenticated;

-- ERP hesabı için Luca alt hesap önerisi: aynı ana hesabın altındaki tek alt hesap, banka hesap no, aynı ya da içeren ad
create or replace function gl_luca_suggest(p_erp text) returns text
language plpgsql stable security definer set search_path = public as $$
declare co uuid := lab_company(); a gl_accounts; main text := split_part(p_erp, '.', 1); n text; w text; dig text; r text; k int;
begin
  select * into a from gl_accounts where company_id = co and code = p_erp;
  if a.id is null then return null; end if;
  select count(*), min(l.code) into k, r from gl_luca_leaves(main) l;
  if k = 0 then return null; end if;
  if k = 1 then return r; end if;
  n := gl_luca_norm(a.name);
  w := gl_luca_norm(split_part(trim(a.name), ' ', 1));
  if a.link_type = 'fin_account' then
    select regexp_replace(coalesce(fa.account_no, ''), '\D', '', 'g') into dig from fin_accounts fa where fa.id = a.link_id;
    if length(coalesce(dig, '')) >= 6 then
      select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where position(dig in l.nm) > 0 or exists (select 1 from regexp_matches(l.nm, '([0-9]{6,})', 'g') m where position(m[1] in dig) > 0);
      if k = 1 then return r; end if;
    end if;
  end if;
  if length(n) >= 3 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where l.nm = n;
    if k = 1 then return r; end if;
  end if;
  if length(n) >= 5 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where length(l.nm) >= 5 and (l.nm like '%' || n || '%' or n like '%' || l.nm || '%');
    if k = 1 then return r; end if;
  end if;
  if length(w) >= 4 then
    select min(l.code), count(*) into r, k from gl_luca_leaves(main) l where l.nm like w || '%';
    if k = 1 then return r; end if;
  end if;
  return null;
end $$;
revoke execute on function gl_luca_suggest(text) from public, anon, authenticated;

-- Önerilerin hepsini eşleştirmeye yaz (kodu Luca'da geçerli alt hesap olmayan, kullanılmış hesaplar için)
create or replace function gl_luca_auto_map() returns jsonb
language plpgsql security definer set search_path = public as $$
declare co uuid := lab_company(); r record; sg text; done int := 0; left_ int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from gl_luca_accounts where company_id = co) then raise exception 'luca_plan_empty'; end if;
  for r in
    select a.code, coalesce(m.luca_code, a.code) lc from gl_accounts a left join gl_luca_map m on m.company_id = co and m.erp_code = a.code
    where a.company_id = co and a.postable and a.is_active and exists (select 1 from gl_lines l where l.account_id = a.id)
  loop
    if exists (select 1 from gl_luca_accounts la where la.company_id = co and la.code = r.lc)
       and not exists (select 1 from gl_luca_accounts z where z.company_id = co and z.code like r.lc || '.%') then continue; end if;
    sg := gl_luca_suggest(r.code);
    if sg is not null then
      insert into gl_luca_map (company_id, erp_code, luca_code) values (co, r.code, sg)
      on conflict (company_id, erp_code) do update set luca_code = excluded.luca_code, updated_at = now();
      done := done + 1;
    else left_ := left_ + 1; end if;
  end loop;
  return jsonb_build_object('mapped', done, 'left', left_);
end $$;
revoke execute on function gl_luca_auto_map() from public, anon;
grant execute on function gl_luca_auto_map() to authenticated;

-- Önizleme. p_mode: new (aktarılmamış onaylı fişler) | changed (aktarıldıktan sonra değişenler) | exported | all
create or replace function gl_luca_preview(p_from date, p_to date, p_mode text default 'new') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare co uuid := lab_company(); st jsonb; vs jsonb; miss jsonb;
begin
  if not can_module('ledger') then return null; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 400 then raise exception 'bad_period'; end if;
  st := gl_luca_get_settings();
  select coalesce(jsonb_agg(x order by (x->>'date'), (x->>'no')::int), '[]') into vs from (
    select gl_luca_voucher(v.id, st) x from gl_vouchers v
    where v.company_id = co and v.voucher_date between p_from and p_to
      and case p_mode
            when 'new' then v.status = 'posted' and v.luca_batch_id is null
            when 'exported' then v.luca_batch_id is not null
            when 'changed' then v.luca_batch_id is not null
            else v.status in ('posted', 'cancelled') or v.luca_batch_id is not null end
      and not (v.status = 'cancelled' and v.luca_batch_id is null)
    order by v.voucher_date, v.no limit 3000
  ) q where p_mode <> 'changed' or (x->>'changed')::boolean;

  select coalesce(jsonb_agg(jsonb_build_object('erp_code', g.erp_code, 'luca_code', g.luca_code, 'name', g.name, 'count', g.cnt, 'reason', g.reason,
           'suggest', gl_luca_suggest(g.erp_code),
           'options', (select coalesce(jsonb_agg(jsonb_build_object('code', la.code, 'name', la.name) order by la.code), '[]')
                       from (select l.code from gl_luca_leaves(split_part(g.erp_code, '.', 1)) l order by l.code limit 300) lv
                       join gl_luca_accounts la on la.company_id = co and la.code = lv.code))
         order by g.luca_code), '[]') into miss
  from (
    select e->>'erp_code' erp_code, e->>'luca_code' luca_code, min(e->>'name') name, count(*) cnt,
           case when bool_or((e->>'missing')::boolean) then 'missing' else 'not_leaf' end reason
    from jsonb_array_elements(vs) x cross join lateral jsonb_array_elements(x->'lines') e
    where (e->>'missing')::boolean or (e->>'not_leaf')::boolean
    group by e->>'erp_code', e->>'luca_code'
  ) g;

  return jsonb_build_object('settings', st, 'vouchers', vs, 'missing_accounts', miss,
    'drafts', (select count(*) from gl_vouchers where company_id = co and status = 'draft' and voucher_date between p_from and p_to),
    'pending', (select count(*) from gl_vouchers where company_id = co and status = 'pending' and voucher_date between p_from and p_to));
end $$;
revoke execute on function gl_luca_preview(date, date, text) from public, anon;
grant execute on function gl_luca_preview(date, date, text) to authenticated;

-- Aktarım paketi oluştur: seçilen fişler (engelli olan varsa hiçbiri aktarılmaz)
create or replace function gl_luca_export(p_ids uuid[], p_note text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare co uuid := lab_company(); st jsonb; b uuid; bad int; r record; nv int := 0; nl int := 0; tot bigint := 0; x jsonb;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'luca_nothing'; end if;
  if cardinality(p_ids) > 3000 then raise exception 'luca_too_many'; end if;
  st := gl_luca_get_settings();
  perform 1 from gl_vouchers where id = any (p_ids) and company_id = co for update;
  select count(*) into bad from unnest(p_ids) i where (gl_luca_voucher(i, st)->>'blocked')::boolean is distinct from false;
  if bad > 0 then raise exception 'luca_blocked:%', bad; end if;
  insert into gl_luca_batches (company_id, no, note) values (co, coalesce((select max(no) from gl_luca_batches where company_id = co), 0) + 1, nullif(left(trim(p_note), 300), ''))
  returning id into b;
  for r in select v.id from gl_vouchers v where v.id = any (p_ids) and v.company_id = co order by v.voucher_date, v.no loop
    x := gl_luca_voucher(r.id, st);
    insert into gl_luca_batch_items (batch_id, voucher_id, hash) values (b, r.id, gl_luca_hash(r.id));
    update gl_vouchers set luca_batch_id = b where id = r.id;
    nv := nv + 1; nl := nl + (x->>'line_count')::int; tot := tot + (x->>'total')::bigint;
  end loop;
  update gl_luca_batches set vouchers = nv, lines = nl, total = tot,
    from_date = (select min(voucher_date) from gl_vouchers where id = any (p_ids)), to_date = (select max(voucher_date) from gl_vouchers where id = any (p_ids))
  where id = b;
  return b;
end $$;
revoke execute on function gl_luca_export(uuid[], text) from public, anon;
grant execute on function gl_luca_export(uuid[], text) to authenticated;

-- Paketi geri al: fişler yeniden "aktarılmamış" olur (Luca'ya yüklenmediyse)
create or replace function gl_luca_batch_undo(p_batch uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  update gl_luca_batches set undone_at = now(), undone_by = auth.uid() where id = p_batch and company_id = lab_company() and undone_at is null;
  if not found then raise exception 'not_found'; end if;
  update gl_vouchers v set luca_batch_id = (
      select i.batch_id from gl_luca_batch_items i join gl_luca_batches b on b.id = i.batch_id
      where i.voucher_id = v.id and b.undone_at is null order by b.no desc limit 1)
  where v.luca_batch_id = p_batch;
end $$;
revoke execute on function gl_luca_batch_undo(uuid) from public, anon;
grant execute on function gl_luca_batch_undo(uuid) to authenticated;

-- Paket içeriği (dosya üretimi için): güncel fiş içerikleri
create or replace function gl_luca_batch(p_batch uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare st jsonb; bt gl_luca_batches;
begin
  if not can_module('ledger') then return null; end if;
  select * into bt from gl_luca_batches where id = p_batch and company_id = lab_company();
  if bt.id is null then raise exception 'not_found'; end if;
  st := gl_luca_get_settings();
  return jsonb_build_object('batch', to_jsonb(bt), 'settings', st,
    'vouchers', (select coalesce(jsonb_agg(gl_luca_voucher(i.voucher_id, st) order by v.voucher_date, v.no), '[]')
                 from gl_luca_batch_items i join gl_vouchers v on v.id = i.voucher_id where i.batch_id = p_batch));
end $$;
revoke execute on function gl_luca_batch(uuid) from public, anon;
grant execute on function gl_luca_batch(uuid) to authenticated;

-- ERP'de olup Luca planında olmayan (Luca'da açılması gereken) hesaplar
create or replace function gl_luca_new_accounts() returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then coalesce(jsonb_agg(jsonb_build_object('erp_code', a.code, 'luca_code', lc.code, 'name', a.name,
           'used', exists (select 1 from gl_lines l where l.account_id = a.id)) order by lc.code), '[]') end
  from gl_accounts a
  cross join lateral (select coalesce((select m.luca_code from gl_luca_map m where m.company_id = a.company_id and m.erp_code = a.code), a.code) code) lc
  where a.company_id = lab_company() and a.postable and a.is_active
    and exists (select 1 from gl_luca_accounts where company_id = lab_company())
    and not exists (select 1 from gl_luca_accounts z where z.company_id = a.company_id and z.code = lc.code);
$$;
revoke execute on function gl_luca_new_accounts() from public, anon;
grant execute on function gl_luca_new_accounts() to authenticated;
