-- =====================================================================
-- Muhasebe kokpiti K1: fiş gelen kutusu (onaylı çalışma)
--  * Onaylı mod: ERP işlemlerinden oluşan fişler "taslak" (draft) olur; raporlara ve bakiyelere girmez
--  * Onay yalnız yönetici ve mali müşavir (genel muhasebe yetkisi 3) — elle / dönem sonu fişlerini onaylayıcı keserse doğrudan kayıtlı
--  * Güven: yeşil (özel kural), sarı (genel varsayımla bulunan hesap), kırmızı (eşleştirme yok)
--  * Satırdaki kategori için hesap değiştir → kural olarak kaydet, kuyruktaki tüm ilgili fişler yenilenir
--  * Muhasebe dışı say (kalıcı) / geri al
-- Tekrar çalıştırılabilir. Önce 20270216000000_provisions.sql.
-- =====================================================================

alter table gl_vouchers drop constraint if exists gl_vouchers_status_check;
alter table gl_vouchers add constraint gl_vouchers_status_check check (status in ('posted', 'pending', 'excluded', 'cancelled', 'draft'));
alter table gl_vouchers add column if not exists approved_by uuid;
alter table gl_vouchers add column if not exists approved_at timestamptz;
alter table gl_vouchers add column if not exists manual_excluded boolean not null default false;
create index if not exists gl_vouchers_draft_idx on gl_vouchers (company_id, voucher_date) where status in ('draft', 'pending');

alter table gl_settings add column if not exists approval_mode boolean not null default false;
-- karar (Ekim 2026): tüm fişler onaya düşer
update gl_settings set approval_mode = true where not approval_mode;

create or replace function gl_approval_on(p_company uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select approval_mode from gl_settings where company_id = p_company), false);
$$;
revoke execute on function gl_approval_on(uuid) from public, anon;
grant execute on function gl_approval_on(uuid) to authenticated;

create or replace function gl_set_approval_mode(p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  update gl_settings set approval_mode = coalesce(p_on, false), updated_at = now() where company_id = lab_company();
end $$;
revoke execute on function gl_set_approval_mode(boolean) from public, anon;
grant execute on function gl_set_approval_mode(boolean) to authenticated;

-- ---------------------------------------------------------------------
-- Otomatik / elle / dönem fişlerinin onaylı moda göre durumu
-- ---------------------------------------------------------------------
do $$
declare src text; o1 text; o2 text;
begin
  -- ERP işleminden fiş: onaylı modda taslak; elle "muhasebe dışı" sayılan fiş yeniden oluşturulmaz
  select pg_get_functiondef('gl_post_txn(uuid)'::regprocedure) into src;
  if position('gl_approval_on' in src) = 0 then
    o1 := $q$  update gl_vouchers set status = 'posted', issues = null, kind = v_kind,$q$;
    o2 := $q$  if v.id is not null and (v.status = 'cancelled' or (v.status = 'posted' and gl_locked(t.company_id, v.voucher_date))) then return v.id; end if;$q$;
    if position(o1 in src) = 0 or position(o2 in src) = 0 then raise exception 'gl_post_txn_patch_failed'; end if;
    src := replace(src, o1, $q$  update gl_vouchers set status = case when gl_approval_on(t.company_id) then 'draft' else 'posted' end, approved_by = null, approved_at = null, issues = null, kind = v_kind,$q$);
    src := replace(src, o2, o2 || E'\n  if v.id is not null and v.manual_excluded then return v.id; end if;');
    execute src;
  end if;

  -- dönem sonu / vergi fişleri: onaylayıcı değilse taslak
  select pg_get_functiondef('gl_finish(uuid)'::regprocedure) into src;
  if position('gl_approval_on' in src) = 0 then
    o1 := $q$update gl_vouchers set status = 'posted', total = d where id = p_v;$q$;
    if position(o1 in src) = 0 then raise exception 'gl_finish_patch_failed'; end if;
    execute replace(src, o1, $q$update gl_vouchers set status = case when gl_approval_on(lab_company()) and not can_module('ledger', 3) then 'draft' else 'posted' end, total = d,
         approved_by = case when gl_approval_on(lab_company()) and can_module('ledger', 3) then auth.uid() end, approved_at = case when gl_approval_on(lab_company()) and can_module('ledger', 3) then now() end where id = p_v;$q$);
  end if;

  -- elle fiş: onaylayıcı değilse taslak
  select pg_get_functiondef('gl_voucher_save(jsonb)'::regprocedure) into src;
  if position('gl_approval_on' in src) = 0 then
    o1 := $q$  if dsum <> csum then raise exception 'gl_unbalanced:% / %', dsum, csum; end if;
  return v_id;$q$;
    if position(o1 in src) = 0 then raise exception 'gl_voucher_save_patch_failed'; end if;
    execute replace(src, o1, $q$  if dsum <> csum then raise exception 'gl_unbalanced:% / %', dsum, csum; end if;
  if gl_approval_on(lab_company()) then
    update gl_vouchers set status = case when can_module('ledger', 3) then 'posted' else 'draft' end, total = dsum,
           approved_by = case when can_module('ledger', 3) then auth.uid() end, approved_at = case when can_module('ledger', 3) then now() end
    where id = v_id and status in ('posted', 'draft');
  end if;
  return v_id;$q$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Gelen kutusu
-- ---------------------------------------------------------------------
-- sarı: kategorisi özel kurala bağlı olmayan (genel varsayımla hesap bulunan) satır var
create or replace function gl_voucher_confidence(p_v uuid) returns text language sql stable security definer set search_path = public as $$
  select case
    when v.status = 'pending' then 'red'
    when v.source <> 'auto' then 'manual'
    when exists (select 1 from gl_lines l join fin_moves m on m.id = l.fin_move_id join fin_categories c on c.id = m.category_id
                 where l.voucher_id = v.id
                   and not exists (select 1 from gl_maps g where g.company_id = v.company_id and ((g.source = 'category' and g.key = c.id::text) or (g.source = 'category_code' and g.key = c.code)))) then 'yellow'
    else 'green' end
  from gl_vouchers v where v.id = p_v;
$$;
revoke execute on function gl_voucher_confidence(uuid) from public, anon, authenticated;

create or replace function gl_inbox(p_from date, p_to date, p_filter text default null, p_limit int default 300) returns jsonb
language sql stable security definer set search_path = public as $$
  with v as (
    select x.*, gl_voucher_confidence(x.id) conf from gl_vouchers x
    where x.company_id = lab_company() and x.status in ('draft', 'pending') and x.voucher_date between p_from and p_to
  ),
  f as (select * from v where p_filter is null or conf = p_filter order by voucher_date, no limit least(coalesce(p_limit, 300), 1000))
  select case when can_module('ledger') then jsonb_build_object(
    'counts', (select jsonb_build_object('green', count(*) filter (where conf = 'green'), 'yellow', count(*) filter (where conf = 'yellow'),
                                          'red', count(*) filter (where conf = 'red'), 'manual', count(*) filter (where conf = 'manual'), 'total', count(*)) from v),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'no', f.no, 'year', f.year, 'date', f.voucher_date, 'kind', f.kind, 'source', f.source, 'status', f.status, 'conf', f.conf,
        'description', f.description, 'doc_no', f.doc_no, 'issues', f.issues, 'total', f.total,
        'txn', (select jsonb_build_object('id', t.id, 'kind', t.kind, 'ref_type', t.ref_type, 'ref_id', t.ref_id, 'party', (select name from fin_parties where id = t.party_id)) from fin_txns t where t.id = f.fin_txn_id),
        'lines', case when f.status = 'draft' or f.fin_txn_id is null then
            (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'code', a.code, 'name', a.name, 'debit', l.debit, 'credit', l.credit, 'description', l.description,
                     'category_id', m.category_id, 'category', c.name,
                     'ruled', m.category_id is null or exists (select 1 from gl_maps g where g.company_id = f.company_id and ((g.source = 'category' and g.key = c.id::text) or (g.source = 'category_code' and g.key = c.code))))
                     order by l.sort), '[]')
             from gl_lines l join gl_accounts a on a.id = l.account_id left join fin_moves m on m.id = l.fin_move_id left join fin_categories c on c.id = m.category_id where l.voucher_id = f.id)
          else
            (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'code', null, 'name', coalesce((select name from fin_accounts where id = m.account_id), (select name from fin_parties where id = m.party_id), c.name),
                     'debit', greatest(m.amount_try, 0), 'credit', greatest(-m.amount_try, 0), 'description', m.description, 'category_id', m.category_id, 'category', c.name, 'ruled', false) order by m.id), '[]')
             from fin_moves m left join fin_categories c on c.id = m.category_id where m.txn_id = f.fin_txn_id and m.amount_try <> 0)
          end) order by f.voucher_date, f.no), '[]') from f)
  ) end;
$$;
revoke execute on function gl_inbox(date, date, text, int) from public, anon;
grant execute on function gl_inbox(date, date, text, int) to authenticated;

-- Onay (yalnız yetki 3): dengeli taslaklar kayıtlı olur; kilitli dönemdekiler atlanır
create or replace function gl_approve(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r gl_vouchers; d bigint; c bigint; ok int := 0; skipped int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  for r in select * from gl_vouchers where company_id = lab_company() and id = any (coalesce(p_ids, '{}')) and status = 'draft' for update loop
    select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from gl_lines where voucher_id = r.id;
    if d = 0 or d <> c or gl_locked(lab_company(), r.voucher_date) then skipped := skipped + 1; continue; end if;
    update gl_vouchers set status = 'posted', total = d, approved_by = auth.uid(), approved_at = now(), updated_at = now() where id = r.id;
    ok := ok + 1;
  end loop;
  return jsonb_build_object('approved', ok, 'skipped', skipped);
end $$;
revoke execute on function gl_approve(uuid[]) from public, anon;
grant execute on function gl_approve(uuid[]) to authenticated;

create or replace function gl_approve_green(p_from date, p_to date) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  return gl_approve(array(select id from gl_vouchers where company_id = lab_company() and status = 'draft' and voucher_date between p_from and p_to and gl_voucher_confidence(id) in ('green', 'manual')));
end $$;
revoke execute on function gl_approve_green(date, date) from public, anon;
grant execute on function gl_approve_green(date, date) to authenticated;

-- Onayı geri al (kilitli dönem değilse kayıtlı fiş tekrar taslağa)
create or replace function gl_unapprove(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  update gl_vouchers set status = 'draft', approved_by = null, approved_at = null, updated_at = now()
  where id = p_id and company_id = lab_company() and status = 'posted' and source not in ('closing', 'opening', 'reversal') and not gl_locked(lab_company(), voucher_date);
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function gl_unapprove(uuid) from public, anon;
grant execute on function gl_unapprove(uuid) to authenticated;

-- Kategori → hesap kuralı kaydet ve kuyruktaki ilgili fişleri yenile
create or replace function gl_inbox_map_category(p_category uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t uuid; n int := 0;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  perform gl_map_save('category', p_category::text, p_code);
  for t in select distinct v.fin_txn_id from gl_vouchers v join fin_moves m on m.txn_id = v.fin_txn_id
           where v.company_id = lab_company() and v.status in ('draft', 'pending') and m.category_id = p_category and not v.manual_excluded loop
    perform gl_post_txn(t);
    n := n + 1;
  end loop;
  return jsonb_build_object('refreshed', n);
end $$;
revoke execute on function gl_inbox_map_category(uuid, text) from public, anon;
grant execute on function gl_inbox_map_category(uuid, text) to authenticated;

-- Tek satırın hesabını bu fişe özel değiştir (kaynak işlem değişirse fiş yeniden oluşur)
create or replace function gl_line_set_account(p_line uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
declare a gl_accounts;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  select * into a from gl_accounts where company_id = lab_company() and code = trim(p_code);
  if a.id is null then raise exception 'gl_account_missing:%', p_code; end if;
  if not a.postable then raise exception 'gl_not_postable:%', a.code; end if;
  update gl_lines l set account_id = a.id from gl_vouchers v
  where l.id = p_line and v.id = l.voucher_id and v.company_id = lab_company() and v.status = 'draft';
  if not found then raise exception 'not_found'; end if;
end $$;
revoke execute on function gl_line_set_account(uuid, text) from public, anon;
grant execute on function gl_line_set_account(uuid, text) to authenticated;

create or replace function gl_inbox_exclude(p_id uuid, p_note text, p_on boolean default true) returns void
language plpgsql security definer set search_path = public as $$
declare v gl_vouchers;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  select * into v from gl_vouchers where id = p_id and company_id = lab_company() for update;
  if v.id is null or v.source <> 'auto' then raise exception 'not_found'; end if;
  if coalesce(p_on, true) then
    if v.status not in ('draft', 'pending', 'excluded') then raise exception 'not_found'; end if;
    delete from gl_lines where voucher_id = v.id;
    update gl_vouchers set status = 'excluded', manual_excluded = true, issues = left('Elle muhasebe dışı sayıldı' || coalesce(': ' || nullif(trim(p_note), ''), ''), 1000), updated_at = now() where id = v.id;
  else
    update gl_vouchers set manual_excluded = false, updated_at = now() where id = v.id;
    perform gl_post_txn(v.fin_txn_id);
  end if;
end $$;
revoke execute on function gl_inbox_exclude(uuid, text, boolean) from public, anon;
grant execute on function gl_inbox_exclude(uuid, text, boolean) to authenticated;

-- dönem sonu kontrol listesi: onay bekleyenler de "bekleyen" sayılır
do $$
declare src text; o1 text := $q$where company_id = lab_company() and status = 'pending' and voucher_date between f and t)$q$;
begin
  select pg_get_functiondef('gl_period_checklist(text)'::regprocedure) into src;
  if position(o1 in src) > 0 then execute replace(src, o1, $q$where company_id = lab_company() and status in ('pending', 'draft') and voucher_date between f and t)$q$); end if;
end $$;

notify pgrst, 'reload schema';
