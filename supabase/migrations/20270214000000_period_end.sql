-- =====================================================================
-- Dönem sonu işlemleri (Paket C)
--  * Aylık yansıtma (7/A: 710-780 → 711-781 / 620-660)
--  * Yeniden değerleme (VUK mükerrer 298/Ç): demirbaş bazında, 25x / 257 / 522; sonraki amortisman yeni değerden
--  * Dönemsellik: peşin ödenen giderler (180/280) ve peşin tahsil edilen gelirler (380/480)
--  * Kredi faiz tahakkuku (780 / 381) ve ertesi ay ters kaydı
--  * Yıl sonu 131 / 331 aktarımı (borç bakiyeli ortak hesabı) ve ertesi yıl ters kaydı
--  * Dönem sonu kontrol listesi
-- Tekrar çalıştırılabilir. Önce 20270213000000_corporate_tax.sql.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Aylık yansıtma
-- ---------------------------------------------------------------------
create or replace function gl_reflect_month(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date; t date; v uuid; y record; amt bigint;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('reflect:' || p_month, t, 'mahsup', 'period', 'Gider yansıtma (7/A) · ' || p_month);
  for y in select * from (values ('710', '711', '620'), ('720', '721', '620'), ('730', '731', '620'), ('740', '741', '622'), ('750', '751', '630'), ('760', '761', '631'), ('770', '771', '632'), ('780', '781', '660')) z(src, refl, dst) loop
    amt := gl_code_balance(y.src, t, f);
    perform gl_add_line(v, y.dst, amt, 'Yansıtma · ' || y.src);
    perform gl_add_line(v, y.refl, -amt, 'Yansıtma · ' || y.src);
  end loop;
  return gl_finish(v);
end $$;
revoke execute on function gl_reflect_month(text) from public, anon;
grant execute on function gl_reflect_month(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Yeniden değerleme
-- ---------------------------------------------------------------------
alter table assets add column if not exists reval_cost bigint not null default 0;
alter table assets add column if not exists reval_accum bigint not null default 0;

create table if not exists asset_revaluations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  asset_id uuid not null references assets (id) on delete cascade,
  rev_date date not null,
  rate numeric(8, 4) not null check (rate > 0 and rate <= 500),
  cost_before bigint not null, accum_before bigint not null,
  cost_inc bigint not null, accum_inc bigint not null, fund bigint not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (asset_id, rev_date)
);
alter table asset_revaluations enable row level security;
drop policy if exists asset_revaluations_read on asset_revaluations;
create policy asset_revaluations_read on asset_revaluations for select to authenticated using (company_id = lab_company() and (can_module('ledger') or can_module('assets')));
revoke all on asset_revaluations from anon;
grant select on asset_revaluations to authenticated;

-- amortisman ve elden çıkarma yeniden değerlenmiş tutarı kullanır
do $$
declare src text;
begin
  select pg_get_functiondef('asset_depreciation_run(date)'::regprocedure) into src;
  if position('reval_cost' in src) = 0 then
    if position('select coalesce(sum(amount), 0) into v_acc from asset_depreciation where asset_id = a.id;' in src) = 0
       or position('v_monthly := round((a.value - a.salvage_value)::numeric / a.useful_life_months);' in src) = 0
       or position('v_amt := least(v_monthly, a.value - a.salvage_value - v_acc);' in src) = 0 then
      raise exception 'asset_depreciation_run_patch_failed';
    end if;
    src := replace(src, 'select coalesce(sum(amount), 0) into v_acc from asset_depreciation where asset_id = a.id;', 'select coalesce(sum(amount), 0) + a.reval_accum into v_acc from asset_depreciation where asset_id = a.id;');
    src := replace(src, 'v_monthly := round((a.value - a.salvage_value)::numeric / a.useful_life_months);', 'v_monthly := round((a.value + a.reval_cost - a.salvage_value)::numeric / a.useful_life_months);');
    src := replace(src, 'v_amt := least(v_monthly, a.value - a.salvage_value - v_acc);', 'v_amt := least(v_monthly, a.value + a.reval_cost - a.salvage_value - v_acc);');
    execute src;
  end if;
  select pg_get_functiondef('asset_dispose(uuid, date, bigint, uuid, text)'::regprocedure) into src;
  if position('reval_cost' in src) = 0 then
    if position('select coalesce(sum(amount), 0) into v_accum from asset_depreciation where asset_id = a.id;' in src) = 0
       or position('v_nbv := greatest(coalesce(a.value, 0) - v_accum, 0);' in src) = 0 then
      raise exception 'asset_dispose_patch_failed';
    end if;
    src := replace(src, 'select coalesce(sum(amount), 0) into v_accum from asset_depreciation where asset_id = a.id;', 'select coalesce(sum(amount), 0) + a.reval_accum into v_accum from asset_depreciation where asset_id = a.id;');
    src := replace(src, 'v_nbv := greatest(coalesce(a.value, 0) - v_accum, 0);', 'v_nbv := greatest(coalesce(a.value, 0) + a.reval_cost - v_accum, 0);');
    execute src;
  end if;
end $$;

-- finans tarafı: demirbaş net artışı / yeniden değerleme fonu (muhasebe fişi ayrıca brüt kesilir)
insert into fin_categories (company_id, code, name, kind, is_system, sort)
select c.id, 'reval_fund', 'Yeniden değerleme fonu', 'equity', true, 82 from companies c
where not exists (select 1 from fin_categories x where x.company_id = c.id and x.code = 'reval_fund');

do $$
declare src text; old_txt text := $q$    when t.ref_type in ('mirror', 'sup_slip') then 'Fişli / yansıtma kaydı'$q$;
begin
  select pg_get_functiondef('gl_post_txn(uuid)'::regprocedure) into src;
  if position('gl_reval' in src) > 0 then return; end if;
  if position(old_txt in src) = 0 then raise exception 'gl_post_txn_patch_failed'; end if;
  execute replace(src, old_txt, old_txt || E'\n    when t.ref_type = ''gl_reval'' then ''Yeniden değerleme: muhasebe fişi ayrıca kesildi''');
end $$;

-- Önizleme: dönem başından önce aktifleştirilmiş, elden çıkarılmamış, net değeri olan demirbaşlar
create or replace function gl_reval_preview(p_date date, p_rate numeric) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when can_module('ledger') then (
    select coalesce(jsonb_agg(x order by x->>'name'), '[]') from (
      select jsonb_build_object('id', a.id, 'name', a.name, 'tag', a.code, 'purchase_date', coalesce(a.depreciation_start, a.purchase_date),
               'cost', c.cost, 'accum', c.accum, 'cost_inc', round(c.cost * p_rate / 100)::bigint, 'accum_inc', round(c.accum * p_rate / 100)::bigint,
               'fund', round(c.cost * p_rate / 100)::bigint - round(c.accum * p_rate / 100)::bigint,
               'done', exists (select 1 from asset_revaluations r where r.asset_id = a.id and r.rev_date = p_date)) x
      from assets a
      cross join lateral (select coalesce(a.value, 0) + a.reval_cost cost,
                                 coalesce((select sum(d.amount) from asset_depreciation d where d.asset_id = a.id and d.period <= p_date), 0) + a.reval_accum accum) c
      where a.company_id = lab_company() and coalesce(a.value, 0) > 0 and a.depreciation_method = 'straight'
        and coalesce(a.depreciation_start, a.purchase_date) < date_trunc('year', p_date)::date
        and (a.disposed_on is null or a.disposed_on > p_date) and c.cost > c.accum) q) end;
$$;
revoke execute on function gl_reval_preview(date, numeric) from public, anon;
grant execute on function gl_reval_preview(date, numeric) to authenticated;

create or replace function gl_reval_post(p_date date, p_rate numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid; r jsonb; n int := 0; tot bigint := 0; acc text; v_txn uuid;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 500 then raise exception 'bad_amount'; end if;
  if p_date is null or extract(month from p_date)::int not in (3, 6, 9, 12) or p_date <> (date_trunc('month', p_date) + interval '1 month - 1 day')::date then raise exception 'reval_bad_date'; end if;
  if exists (select 1 from asset_revaluations where company_id = lab_company() and rev_date = p_date) then raise exception 'reval_exists'; end if;
  select coalesce((select a.code from gl_maps m join gl_accounts a on a.id = m.account_id where m.company_id = lab_company() and m.source = 'category_code' and m.key = 'fixed_assets'), '255') into acc;
  v := gl_tag_voucher('reval:' || p_date, p_date, 'mahsup', 'period', 'Yeniden değerleme (VUK mük. 298/Ç) · %' || p_rate || ' · ' || to_char(p_date, 'DD.MM.YYYY'));
  for r in select * from jsonb_array_elements(gl_reval_preview(p_date, p_rate)) loop
    if (r->>'fund')::bigint <= 0 then continue; end if;
    insert into asset_revaluations (asset_id, rev_date, rate, cost_before, accum_before, cost_inc, accum_inc, fund)
    values ((r->>'id')::uuid, p_date, p_rate, (r->>'cost')::bigint, (r->>'accum')::bigint, (r->>'cost_inc')::bigint, (r->>'accum_inc')::bigint, (r->>'fund')::bigint);
    update assets set reval_cost = reval_cost + (r->>'cost_inc')::bigint, reval_accum = reval_accum + (r->>'accum_inc')::bigint where id = (r->>'id')::uuid;
    perform gl_add_line(v, acc, (r->>'cost_inc')::bigint, 'Değer artışı · ' || (r->>'name'));
    perform gl_add_line(v, '257', -(r->>'accum_inc')::bigint, 'Birikmiş amortisman artışı · ' || (r->>'name'));
    perform gl_add_line(v, '522', -(r->>'fund')::bigint, 'MDV yeniden değerleme artışı · ' || (r->>'name'));
    n := n + 1; tot := tot + (r->>'fund')::bigint;
  end loop;
  if tot > 0 then
    v_txn := fin_post_sys(jsonb_build_object('kind', 'adjust', 'txn_date', p_date, 'description', 'Yeniden değerleme · ' || n || ' demirbaş', 'amount', tot, 'currency', 'TRY', 'ref_type', 'gl_reval'),
      jsonb_build_array(jsonb_build_object('category_id', fin_category('fixed_assets'), 'amount', tot, 'currency', 'TRY', 'rate', 1, 'description', 'Yeniden değerleme net artışı'),
                        jsonb_build_object('category_id', fin_category('reval_fund'), 'amount', -tot, 'currency', 'TRY', 'rate', 1)));
  end if;
  return gl_finish(v) || jsonb_build_object('assets', n, 'fund', tot, 'txn', v_txn);
end $$;
revoke execute on function gl_reval_post(date, numeric) from public, anon;
grant execute on function gl_reval_post(date, numeric) to authenticated;

create or replace function gl_reval_undo(p_date date) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; t uuid;
begin
  if not can_module('ledger', 3) then raise exception 'not_allowed'; end if;
  if gl_locked(lab_company(), p_date) then raise exception 'gl_locked'; end if;
  if exists (select 1 from asset_revaluations x join asset_depreciation d on d.asset_id = x.asset_id and d.period > p_date where x.company_id = lab_company() and x.rev_date = p_date) then
    raise exception 'reval_has_later_depreciation';
  end if;
  for r in select * from asset_revaluations where company_id = lab_company() and rev_date = p_date loop
    update assets set reval_cost = reval_cost - r.cost_inc, reval_accum = reval_accum - r.accum_inc where id = r.asset_id;
    n := n + 1;
  end loop;
  delete from asset_revaluations where company_id = lab_company() and rev_date = p_date;
  update gl_vouchers set status = 'cancelled', updated_at = now() where company_id = lab_company() and tag = 'reval:' || p_date and status = 'posted';
  for t in select id from fin_txns where company_id = lab_company() and ref_type = 'gl_reval' and txn_date = p_date and voided_at is null loop
    perform fin_void_sys(t, 'Yeniden değerleme geri alındı');
  end loop;
  return n;
end $$;
revoke execute on function gl_reval_undo(date) from public, anon;
grant execute on function gl_reval_undo(date) to authenticated;

-- ---------------------------------------------------------------------
-- 3) Dönemsellik
-- ---------------------------------------------------------------------
create table if not exists gl_deferrals (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  description text not null check (length(description) between 1 and 200),
  total bigint not null check (total > 0),
  start_month date not null,          -- ilk payın ayı (ayın 1'i)
  months int not null check (months between 2 and 120),
  pl_code text not null check (pl_code ~ '^[67][0-9]{2}'),   -- gider / gelir hesabı (ör. 770, 649)
  setup_date date not null,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table gl_deferrals enable row level security;
drop policy if exists gl_deferrals_read on gl_deferrals;
create policy gl_deferrals_read on gl_deferrals for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_deferrals from anon;
grant select on gl_deferrals to authenticated;

create or replace function gl_deferral_share(p_total bigint, p_months int, k int) returns bigint language sql immutable as $$
  select case when k < 1 or k > p_months then 0 when k < p_months then p_total / p_months else p_total - (p_total / p_months) * (p_months - 1) end;
$$;

-- Kurulum: ödeme / tahsilat anında tamamı gider / gelir yazıldıysa ilk 12 ay 180 (380), kalanı 280 (480)
create or replace function gl_deferral_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare d gl_deferrals; v uuid; s12 bigint := 0; k int; st text; lt text;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  insert into gl_deferrals (kind, description, total, start_month, months, pl_code, setup_date)
  values (p->>'kind', left(trim(p->>'description'), 200), (p->>'total')::bigint, date_trunc('month', (p->>'start_month')::date)::date, (p->>'months')::int,
          trim(p->>'pl_code'), coalesce(nullif(p->>'setup_date', '')::date, date_trunc('month', (p->>'start_month')::date)::date))
  returning * into d;
  for k in 1 .. least(12, d.months) loop s12 := s12 + gl_deferral_share(d.total, d.months, k); end loop;
  st := case when d.kind = 'expense' then '180' else '380' end; lt := case when d.kind = 'expense' then '280' else '480' end;
  v := gl_tag_voucher('df:' || d.id, d.setup_date, 'mahsup', 'period', 'Dönemsellik kurulumu · ' || d.description);
  if d.kind = 'expense' then
    perform gl_add_line(v, st, s12, 'Gelecek aylara ait gider · ' || d.description);
    perform gl_add_line(v, lt, d.total - s12, 'Gelecek yıllara ait gider · ' || d.description);
    perform gl_add_line(v, d.pl_code, -d.total, 'Dönemselliğe ayrıldı · ' || d.description);
  else
    perform gl_add_line(v, d.pl_code, d.total, 'Dönemselliğe ayrıldı · ' || d.description);
    perform gl_add_line(v, st, -s12, 'Gelecek aylara ait gelir · ' || d.description);
    perform gl_add_line(v, lt, -(d.total - s12), 'Gelecek yıllara ait gelir · ' || d.description);
  end if;
  perform gl_finish(v);
  return d.id;
end $$;
revoke execute on function gl_deferral_save(jsonb) from public, anon;
grant execute on function gl_deferral_save(jsonb) to authenticated;

create or replace function gl_deferral_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d gl_deferrals;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select * into d from gl_deferrals where id = p_id and company_id = lab_company();
  if d.id is null then raise exception 'not_found'; end if;
  if exists (select 1 from gl_vouchers where company_id = lab_company() and status = 'posted' and tag like 'pdefer:%' and voucher_date >= d.start_month) then
    raise exception 'deferral_in_use';
  end if;
  update gl_vouchers set status = 'cancelled', updated_at = now() where company_id = lab_company() and tag = 'df:' || d.id and status = 'posted';
  delete from gl_deferrals where id = d.id;
end $$;
revoke execute on function gl_deferral_delete(uuid) from public, anon;
grant execute on function gl_deferral_delete(uuid) to authenticated;

-- Aylık: bu ayın payı gider / gelire; 12 ay sonrasının payı uzun vadeden kısa vadeye
create or replace function gl_deferrals_run(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date; t date; v uuid; d gl_deferrals; k int; a bigint; b bigint;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('pdefer:' || p_month, t, 'mahsup', 'period', 'Dönemsellik · ' || p_month);
  for d in select * from gl_deferrals where company_id = lab_company() order by created_at loop
    k := (extract(year from f) - extract(year from d.start_month))::int * 12 + (extract(month from f) - extract(month from d.start_month))::int + 1;
    a := gl_deferral_share(d.total, d.months, k);
    b := gl_deferral_share(d.total, d.months, k + 12);
    if d.kind = 'expense' then
      perform gl_add_line(v, d.pl_code, a, d.description || ' · ' || k || '/' || d.months);
      perform gl_add_line(v, '180', -a, d.description);
      perform gl_add_line(v, '180', b, 'Uzun vadeden aktarım · ' || d.description);
      perform gl_add_line(v, '280', -b, 'Uzun vadeden aktarım · ' || d.description);
    else
      perform gl_add_line(v, '380', a, d.description || ' · ' || k || '/' || d.months);
      perform gl_add_line(v, d.pl_code, -a, d.description);
      perform gl_add_line(v, '480', b, 'Uzun vadeden aktarım · ' || d.description);
      perform gl_add_line(v, '380', -b, 'Uzun vadeden aktarım · ' || d.description);
    end if;
  end loop;
  return gl_finish(v);
end $$;
revoke execute on function gl_deferrals_run(text) from public, anon;
grant execute on function gl_deferrals_run(text) to authenticated;

-- ---------------------------------------------------------------------
-- 4) Kredi faiz tahakkuku: ay sonuna kadar işlemiş, henüz ödenmemiş taksit faizi (+BSMV/KKDF)
-- ---------------------------------------------------------------------
create or replace function gl_loan_accrual_calc(p_month text) returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (select (p_month || '-01')::date f, ((p_month || '-01')::date + interval '1 month - 1 day')::date t),
  x as (
    select l.id, coalesce(l.bank_name, '') || coalesce(' ' || l.loan_no, '') loan, l.currency, i.no, i.due_date, i.interest + i.tax it,
           coalesce((select max(p.due_date) from fin_loan_installments p where p.loan_id = l.id and p.no < i.no), l.start_date) ps
    from fin_loans l join fin_loan_installments i on i.loan_id = l.id cross join b
    where l.company_id = lab_company() and (i.paid_at is null or i.paid_at > b.t) and i.interest + i.tax > 0
  )
  select case when can_module('ledger') then coalesce(jsonb_agg(jsonb_build_object('loan', loan, 'no', no, 'due_date', due_date, 'currency', currency, 'interest', it,
           'accrued_fx', acc, 'accrued', round(acc * coalesce(fin_rate(currency, b.t), 1))::bigint) order by loan, no), '[]') end
  from (select x.*, case when x.due_date <= b.t then x.it
                         when x.ps < b.t then round(x.it * (b.t - x.ps)::numeric / greatest(x.due_date - x.ps, 1))::bigint else 0 end acc
        from x cross join b) y cross join b
  where acc > 0;
$$;
revoke execute on function gl_loan_accrual_calc(text) from public, anon;
grant execute on function gl_loan_accrual_calc(text) to authenticated;

create or replace function gl_loan_accrual(p_month text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f date; t date; v uuid; w uuid; r jsonb; tot bigint := 0; res jsonb;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date;
  v := gl_tag_voucher('accint:' || p_month, t, 'mahsup', 'period', 'Kredi faiz tahakkuku · ' || p_month);
  for r in select * from jsonb_array_elements(gl_loan_accrual_calc(p_month)) loop
    perform gl_add_line(v, '780', (r->>'accrued')::bigint, 'Faiz tahakkuku · ' || (r->>'loan') || ' taksit ' || (r->>'no'));
    tot := tot + (r->>'accrued')::bigint;
  end loop;
  perform gl_add_line(v, '381', -tot, 'Gider tahakkukları · kredi faizi');
  res := gl_finish(v);
  -- ertesi ayın ilk günü ters kayıt (faiz ödendiğinde 780'e gider olarak işlenir)
  w := gl_tag_voucher('accintr:' || p_month, t + 1, 'mahsup', 'period', 'Kredi faiz tahakkuku ters kaydı · ' || p_month);
  perform gl_add_line(w, '381', tot, 'Tahakkuk ters kaydı');
  perform gl_add_line(w, '780', -tot, 'Tahakkuk ters kaydı');
  perform gl_finish(w);
  return res || jsonb_build_object('accrued', tot);
end $$;
revoke execute on function gl_loan_accrual(text) from public, anon;
grant execute on function gl_loan_accrual(text) to authenticated;

-- ---------------------------------------------------------------------
-- 5) 131 / 331: yıl sonunda borç bakiyesi veren ortak hesapları 131'e (ertesi yıl 1 Ocak ters kayıt)
-- ---------------------------------------------------------------------
create or replace function gl_partner_reclass(p_year int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t date := make_date(p_year, 12, 31); v uuid; w uuid; r record; c131 text; p131 uuid; n int := 0; tot bigint := 0; res jsonb;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select id into p131 from gl_accounts where company_id = lab_company() and code = '131';
  if p131 is null then
    insert into gl_accounts (company_id, code, name, kind, normal_side) values (lab_company(), '131', 'Ortaklardan Alacaklar', 'asset', 'D') returning id into p131;
  end if;
  v := gl_tag_voucher('p131:' || p_year, t, 'mahsup', 'period', '331 borç bakiyelerinin 131''e aktarımı · ' || p_year);
  w := gl_tag_voucher('p131r:' || p_year, t + 1, 'mahsup', 'period', '131 / 331 aktarımı ters kaydı · ' || (p_year + 1));
  for r in
    select a.code, a.name, sum(l.debit - l.credit)::bigint bal
    from gl_lines l join gl_vouchers x on x.id = l.voucher_id join gl_accounts a on a.id = l.account_id
    where x.company_id = lab_company() and x.status = 'posted' and x.voucher_date <= t and coalesce(x.tag, '') not in ('p131:' || p_year, 'p131r:' || p_year)
      and not (x.source = 'closing' and x.year = p_year) and (a.code = '331' or a.code like '331.%')
      and not exists (select 1 from gl_accounts c where c.parent_id = a.id)
    group by a.code, a.name having sum(l.debit - l.credit) > 0
  loop
    c131 := case when r.code = '331' then '131' else '131' || substr(r.code, 4) end;
    if not exists (select 1 from gl_accounts where company_id = lab_company() and code = c131) then
      insert into gl_accounts (company_id, code, name, parent_id, kind, normal_side)
      values (lab_company(), c131, left(r.name, 160), p131, 'asset', 'D');
    end if;
    perform gl_add_line(v, c131, r.bal, 'Ortaktan alacak · ' || r.name);
    perform gl_add_line(v, r.code, -r.bal, 'Borç bakiyesi 131''e aktarıldı');
    perform gl_add_line(w, r.code, r.bal, 'Ters kayıt');
    perform gl_add_line(w, c131, -r.bal, 'Ters kayıt');
    n := n + 1; tot := tot + r.bal;
  end loop;
  res := gl_finish(v);
  perform gl_finish(w);
  return res || jsonb_build_object('accounts', n, 'amount', tot);
end $$;
revoke execute on function gl_partner_reclass(int) from public, anon;
grant execute on function gl_partner_reclass(int) to authenticated;

-- ---------------------------------------------------------------------
-- 6) Kontrol listesi
-- ---------------------------------------------------------------------
create or replace function gl_period_checklist(p_month text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date; t date; mo int; y int; q int; tagv jsonb;
begin
  if not can_module('ledger') then return null; end if;
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'bad_period'; end if;
  f := (p_month || '-01')::date; t := (f + interval '1 month - 1 day')::date; mo := extract(month from f)::int; y := extract(year from f)::int; q := (mo + 2) / 3;
  select coalesce(jsonb_object_agg(tag, jsonb_build_object('id', id, 'no', no, 'year', year, 'total', total)), '{}') into tagv
  from gl_vouchers where company_id = lab_company() and status = 'posted'
    and tag in ('reflect:' || p_month, 'pdefer:' || p_month, 'accint:' || p_month, 'vat:' || p_month, 'payroll:' || p_month, 'stamp:' || p_month,
                'reval:' || t, 'gecici:' || y || '-Q' || q, 'cit:' || y, 'p131:' || y, 'close69:' || y);
  return jsonb_build_object('month', p_month, 'end', t, 'quarter_end', mo in (3, 6, 9, 12), 'year_end', mo = 12, 'quarter', q,
    'vouchers', tagv,
    'fx', (select jsonb_build_object('id', id, 'no', no, 'year', year) from gl_vouchers where company_id = lab_company() and status = 'posted' and source = 'fx' and voucher_date = t limit 1),
    'depreciation', jsonb_build_object(
      'done', (select count(*) from asset_depreciation d join assets a on a.id = d.asset_id where a.company_id = lab_company() and d.period = f),
      'eligible', (select count(*) from assets a where a.company_id = lab_company() and a.depreciation_method = 'straight' and coalesce(a.value, 0) > 0 and a.useful_life_months > 0
                     and coalesce(a.depreciation_start, a.purchase_date) <= t and (a.disposed_on is null or a.disposed_on > t)
                     and coalesce((select sum(amount) from asset_depreciation d where d.asset_id = a.id and d.period < f), 0) + a.reval_accum < a.value + a.reval_cost - a.salvage_value)),
    'deferrals', (select count(*) from gl_deferrals where company_id = lab_company() and start_month <= f and (start_month + make_interval(months => months)) > f),
    'loans', (select count(*) from fin_loans where company_id = lab_company() and status = 'active'),
    'pending', (select count(*) from gl_vouchers where company_id = lab_company() and status = 'pending' and voucher_date between f and t),
    'locked', gl_locked(lab_company(), t),
    'reval', (select coalesce(sum(fund), 0) from asset_revaluations where company_id = lab_company() and rev_date = t));
end $$;
revoke execute on function gl_period_checklist(text) from public, anon;
grant execute on function gl_period_checklist(text) to authenticated;

notify pgrst, 'reload schema';
