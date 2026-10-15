-- =====================================================================
-- Geçici vergi ve kurumlar vergisi (Paket B)
--  * KKEG: hesap bazında oran (ör. binek araç giderlerinin %30'u) + elle düzeltmeler
--  * İndirim / istisna, geçmiş yıl zararı, mahsup edilecek vergiler (elle)
--  * Kurumlar vergisi %25, ihracat kazancına 5 puan indirim (%20), yurt içi asgari kurumlar vergisi %10
--  * Geçici vergi fişi (193 / 360) ve yıl sonu vergi karşılığı fişi (691 / 370, 371 / 193)
-- Hesaplar tahminidir; beyannameyi mali müşavir verir. Tekrar çalıştırılabilir. Önce 20270212000000_tax_center.sql.
-- =====================================================================

alter table gl_vouchers drop constraint if exists gl_vouchers_source_check;
alter table gl_vouchers add constraint gl_vouchers_source_check check (source in ('auto', 'manual', 'opening', 'closing', 'fx', 'payroll', 'reversal', 'vat', 'tax', 'period'));

alter table gl_accounts add column if not exists kkeg_pct numeric(5, 2) not null default 0 check (kkeg_pct between 0 and 100);

create table if not exists gl_tax_adjustments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null default lab_company() references companies (id) on delete cascade,
  adj_date date not null,
  kind text not null check (kind in ('kkeg', 'deduction', 'loss', 'prepaid')),
  description text not null check (length(description) between 1 and 200),
  amount bigint not null check (amount > 0),
  min_allowed boolean not null default false,   -- indirim / istisna asgari kurumlar vergisinde de düşülebiliyorsa
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists gl_tax_adjustments_idx on gl_tax_adjustments (company_id, adj_date);
alter table gl_tax_adjustments enable row level security;
drop policy if exists gl_tax_adjustments_read on gl_tax_adjustments;
create policy gl_tax_adjustments_read on gl_tax_adjustments for select to authenticated using (company_id = lab_company() and can_module('ledger'));
revoke all on gl_tax_adjustments from anon;
grant select on gl_tax_adjustments to authenticated;

create or replace function gl_kkeg_set(p_code text, p_pct numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'bad_amount'; end if;
  update gl_accounts set kkeg_pct = p_pct where company_id = lab_company() and code = p_code;
  if not found then raise exception 'gl_account_missing:%', p_code; end if;
end $$;
revoke execute on function gl_kkeg_set(text, numeric) from public, anon;
grant execute on function gl_kkeg_set(text, numeric) to authenticated;

create or replace function gl_tax_adj_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  if (p->>'adj_date') is null then raise exception 'bad_date'; end if;
  if coalesce((p->>'amount')::bigint, 0) <= 0 then raise exception 'bad_amount'; end if;
  if gl_locked(lab_company(), (p->>'adj_date')::date) then raise exception 'gl_locked'; end if;
  insert into gl_tax_adjustments (adj_date, kind, description, amount, min_allowed)
  values ((p->>'adj_date')::date, p->>'kind', left(trim(p->>'description'), 200), (p->>'amount')::bigint, coalesce((p->>'min_allowed')::boolean, false))
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function gl_tax_adj_save(jsonb) from public, anon;
grant execute on function gl_tax_adj_save(jsonb) to authenticated;

create or replace function gl_tax_adj_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare d date;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  select adj_date into d from gl_tax_adjustments where id = p_id and company_id = lab_company();
  if d is null then raise exception 'not_found'; end if;
  if gl_locked(lab_company(), d) then raise exception 'gl_locked'; end if;
  delete from gl_tax_adjustments where id = p_id;
end $$;
revoke execute on function gl_tax_adj_delete(uuid) from public, anon;
grant execute on function gl_tax_adj_delete(uuid) to authenticated;

-- Dönem (yıl başından itibaren) ticari kâr: 6 sınıfı (690-692 hariç) + 7/A gider hesapları; kapanış fişleri hariç
create or replace function gl_pl_ytd(p_from date, p_to date) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.credit - l.debit), 0)::bigint
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.source <> 'closing' and v.voucher_date between p_from and p_to
    and (left(a.code, 1) = '7' or (left(a.code, 1) = '6' and left(a.code, 3) not in ('690', '691', '692')));
$$;
revoke execute on function gl_pl_ytd(date, date) from public, anon, authenticated;

-- p_q: 1-3 geçici vergi dönemi, 4 yıllık (kurumlar vergisi)
create or replace function gl_cit_calc(p_year int, p_q int) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare f date := make_date(p_year, 1, 1); t date; v_pl bigint; v_kkeg_auto bigint; v_kkeg bigint; v_ded bigint; v_ded_min bigint; v_loss bigint; v_prep bigint;
        v_base bigint; v_matrah bigint; v_s601 bigint; v_sall bigint; v_ratio numeric; v_exp bigint; v_normal bigint; v_minbase bigint; v_cut bigint; v_min bigint; v_tax bigint;
        v_prior bigint := 0; v_193 bigint := 0; v_pay bigint; r_kkeg jsonb; c_rate numeric := 0.25; c_cut numeric := 0.05; c_min numeric := 0.10;
begin
  if not can_module('ledger') then return null; end if;
  if p_q not between 1 and 4 then raise exception 'bad_period'; end if;
  t := (make_date(p_year, p_q * 3, 1) + interval '1 month - 1 day')::date;
  v_pl := gl_pl_ytd(f, t);
  -- KKEG: işaretli hesapların (alt hesaplar dahil) borç bakiyesinin oranı
  select coalesce(sum(x.amt), 0)::bigint, coalesce(jsonb_agg(jsonb_build_object('code', x.code, 'name', x.name, 'pct', x.pct, 'expense', x.exp, 'amount', x.amt) order by x.code) filter (where x.amt <> 0), '[]')
  into v_kkeg_auto, r_kkeg
  from (
    select p.code, p.name, p.kkeg_pct pct, greatest(coalesce(sum(l.debit - l.credit), 0), 0)::bigint exp,
           round(greatest(coalesce(sum(l.debit - l.credit), 0), 0) * p.kkeg_pct / 100)::bigint amt
    from gl_accounts p
    left join gl_accounts a on a.company_id = p.company_id and (a.code = p.code or a.code like p.code || '.%')
    left join gl_lines l on l.account_id = a.id
    left join gl_vouchers v on v.id = l.voucher_id
    where p.company_id = lab_company() and p.kkeg_pct > 0
      and (l.id is null or (v.status = 'posted' and v.source <> 'closing' and v.voucher_date between f and t))
    group by p.code, p.name, p.kkeg_pct
  ) x;
  select coalesce(sum(amount) filter (where kind = 'kkeg'), 0), coalesce(sum(amount) filter (where kind = 'deduction'), 0),
         coalesce(sum(amount) filter (where kind = 'deduction' and min_allowed), 0), coalesce(sum(amount) filter (where kind = 'loss'), 0),
         coalesce(sum(amount) filter (where kind = 'prepaid'), 0)
  into v_kkeg, v_ded, v_ded_min, v_loss, v_prep
  from gl_tax_adjustments where company_id = lab_company() and adj_date between f and t;
  v_kkeg := v_kkeg + v_kkeg_auto;
  v_base := v_pl + v_kkeg;
  v_matrah := greatest(0, v_base - v_ded - v_loss);
  -- ihracat payı: 601 / (600 + 601 + 602) net satış
  select coalesce(sum(l.credit - l.debit) filter (where left(a.code, 3) = '601'), 0), coalesce(sum(l.credit - l.debit), 0)
  into v_s601, v_sall
  from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
  where v.company_id = lab_company() and v.status = 'posted' and v.source <> 'closing' and v.voucher_date between f and t and left(a.code, 3) in ('600', '601', '602');
  v_ratio := case when v_sall > 0 then least(greatest(v_s601::numeric / v_sall, 0), 1) else 0 end;
  v_exp := round(v_matrah * v_ratio)::bigint;
  v_normal := round((v_matrah - v_exp) * c_rate + v_exp * (c_rate - c_cut))::bigint;
  v_minbase := greatest(0, v_base - v_ded_min);
  v_cut := round(v_exp * c_cut)::bigint;
  v_min := greatest(0, round(v_minbase * c_min)::bigint - v_cut);
  v_tax := greatest(v_normal, v_min);
  if p_q < 4 then
    select coalesce(sum(total), 0) into v_prior from gl_vouchers
    where company_id = lab_company() and status = 'posted' and tag in (select 'gecici:' || p_year || '-Q' || k from generate_series(1, p_q - 1) k);
    v_pay := greatest(0, v_tax - v_prior - v_prep);
  else
    -- peşin ödenen vergiler (193), yıl sonu karşılık fişinin kendi mahsubu hariç
    select coalesce(sum(l.debit - l.credit), 0)::bigint into v_193
    from gl_lines l join gl_vouchers v on v.id = l.voucher_id join gl_accounts a on a.id = l.account_id
    where v.company_id = lab_company() and v.status = 'posted' and v.voucher_date <= t and v.tag is distinct from 'cit:' || p_year
      and (a.code = '193' or a.code like '193.%')
      and not (v.source = 'closing' and v.year = p_year);
    v_pay := v_tax - v_193;
  end if;
  return jsonb_build_object('year', p_year, 'q', p_q, 'from', f, 'to', t,
    'profit', v_pl, 'kkeg_auto', v_kkeg_auto, 'kkeg_manual', v_kkeg - v_kkeg_auto, 'kkeg', v_kkeg, 'kkeg_accounts', r_kkeg,
    'base', v_base, 'deductions', v_ded, 'deductions_min', v_ded_min, 'loss', v_loss, 'matrah', v_matrah,
    'sales_export', v_s601, 'sales_total', v_sall, 'export_ratio', round(v_ratio, 4), 'export_matrah', v_exp,
    'tax_normal', v_normal, 'min_base', v_minbase, 'export_cut', v_cut, 'tax_min', v_min, 'min_applies', v_min > v_normal, 'tax', v_tax,
    'prior', v_prior, 'prepaid', v_prep, 'prepaid_193', v_193, 'payable', v_pay,
    'rates', jsonb_build_object('cit', c_rate, 'export_cut', c_cut, 'min', c_min),
    'voucher', (select jsonb_build_object('id', id, 'no', no, 'year', year, 'total', total) from gl_vouchers
                where company_id = lab_company() and status = 'posted' and tag = case when p_q < 4 then 'gecici:' || p_year || '-Q' || p_q else 'cit:' || p_year end),
    'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'date', adj_date, 'kind', kind, 'description', description, 'amount', amount, 'min_allowed', min_allowed) order by adj_date, created_at), '[]')
                    from gl_tax_adjustments where company_id = lab_company() and adj_date between f and t));
end $$;
revoke execute on function gl_cit_calc(int, int) from public, anon;
grant execute on function gl_cit_calc(int, int) to authenticated;

-- Fiş: geçici vergi 193 B / 360 A · yıllık 691 B / 370 A ve peşin ödenenlerin mahsubu 371 B / 193 A
create or replace function gl_cit_post(p_year int, p_q int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c jsonb; v uuid; t date;
begin
  if not can_module('ledger', 2) then raise exception 'not_allowed'; end if;
  c := gl_cit_calc(p_year, p_q);
  t := (c->>'to')::date;
  if p_q < 4 then
    v := gl_tag_voucher('gecici:' || p_year || '-Q' || p_q, t, 'mahsup', 'tax', 'Geçici vergi · ' || p_year || '/' || p_q || '. dönem');
    -- gl_tag_voucher eski fişi iptal etti; önceki dönemler değişmediği için tutar yeniden hesaplanır
    c := gl_cit_calc(p_year, p_q);
    perform gl_add_line(v, '193', (c->>'payable')::bigint, 'Peşin ödenen geçici vergi');
    perform gl_add_line(v, '360', -(c->>'payable')::bigint, 'Ödenecek geçici vergi');
  else
    v := gl_tag_voucher('cit:' || p_year, t, 'mahsup', 'tax', 'Kurumlar vergisi karşılığı · ' || p_year);
    c := gl_cit_calc(p_year, p_q);  -- eski fiş iptal edildi: 193 bakiyesi yeniden okunur
    perform gl_add_line(v, '691', (c->>'tax')::bigint, 'Dönem kârı vergi karşılığı');
    perform gl_add_line(v, '370', -(c->>'tax')::bigint, 'Kurumlar vergisi karşılığı');
    perform gl_add_line(v, '371', (c->>'prepaid_193')::bigint, 'Peşin ödenen vergilerin mahsubu');
    perform gl_add_line(v, '193', -(c->>'prepaid_193')::bigint, 'Peşin ödenen vergiler kapatıldı');
  end if;
  return gl_finish(v) || jsonb_build_object('tax', c->'tax', 'payable', c->'payable');
end $$;
revoke execute on function gl_cit_post(int, int) from public, anon;
grant execute on function gl_cit_post(int, int) to authenticated;

notify pgrst, 'reload schema';
