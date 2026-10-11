-- =====================================================================
-- TEDARİKÇİ FİŞ / FATURA MUTABAKATI
--  Tedarikçiden mal fiş / irsaliye ile gelir (depo kontrol edip alır), fatura sonradan kesilir.
--  İki görünüm:
--    Fatura carisi (resmi) : mevcut cari bakiyesi (faturalar + ödemeler + çek / senet)
--    Fiş carisi            : fişler + aynı ödemeler (ödemeler bir kez girilir, iki cariye de düşer)
--  sup_slips      : fiş kaydı (tutar cari para biriminde; döviz fişte kur ile çevrilir), isteğe bağlı mal kabul bağlantısı ve fiş fotoğrafı
--  sup_slip_open  : fiş carisinin açılış bakiyesi (isteğe bağlı)
--  sup_summary()  : tedarikçi bazında fiş / fatura / ödeme toplamları ve iki bakiye
--  sup_ledger()   : tek tedarikçinin hareketleri (fiş, fatura, ödeme / çek)
-- İşaret: cari bakiyelerde (+) bize borçlu, (−) biz borçluyuz. Fiş = (−).
-- Tekrar çalıştırılabilir. Önce 20270107000000_barcode.sql.
-- =====================================================================
create table if not exists sup_slips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  party_id uuid not null references fin_parties (id) on delete restrict,
  slip_date date not null default current_date,
  doc_no text check (doc_no is null or length(doc_no) <= 60),
  amount bigint not null check (amount > 0),                -- cari para biriminde (kuruş / cent)
  orig_amount bigint,                                       -- fişteki tutar (farklı para birimiyse)
  orig_currency text check (orig_currency is null or orig_currency in ('TRY', 'EUR', 'USD', 'GBP', 'CHF')),
  receipt_id uuid unique references stk_receipts (id) on delete set null,
  note text check (note is null or length(note) <= 300),
  photo text check (photo is null or (photo like 'data:image/jpeg;base64,%' and length(photo) <= 900000)),
  cancelled boolean not null default false,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists sup_slips_party_idx on sup_slips (party_id, slip_date);
create table if not exists sup_slip_open (
  party_id uuid primary key references fin_parties (id) on delete cascade,
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  amount bigint not null default 0,                         -- (−) biz borçluyuz
  as_of date,
  updated_at timestamptz not null default now()
);
alter table sup_slips enable row level security;
alter table sup_slip_open enable row level security;
drop policy if exists sup_slips_read on sup_slips;
create policy sup_slips_read on sup_slips for select to authenticated using (company_id = lab_company() and (can_module('finance') or can_module('purchases')));
drop policy if exists sup_slip_open_rw on sup_slip_open;
create policy sup_slip_open_rw on sup_slip_open for all to authenticated using (company_id = lab_company() and can_module('finance', 2)) with check (company_id = lab_company() and can_module('finance', 2));
grant select on sup_slips to authenticated;
grant select, insert, update, delete on sup_slip_open to authenticated;

-- Fiş ekle: { party_id, slip_date, doc_no, amount (kuruş, fiş para biriminde), currency, receipt_id?, note, photo }
create or replace function sup_slip_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare pt fin_parties; v_id uuid; v_amt bigint := nullif(p ->> 'amount', '')::bigint; v_cur text := coalesce(nullif(p ->> 'currency', ''), 'TRY'); v_date date := coalesce(nullif(p ->> 'slip_date', '')::date, current_date); v_conv bigint;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2) or can_module('stock', 2)) then raise exception 'not_allowed'; end if;
  select * into pt from fin_parties where id = (p ->> 'party_id')::uuid and company_id = lab_company();
  if pt.id is null then raise exception 'party_required'; end if;
  if coalesce(v_amt, 0) <= 0 then raise exception 'amount_required'; end if;
  v_conv := case when v_cur = pt.currency then v_amt else fin_conv(v_amt, v_cur, pt.currency, v_date) end;
  insert into sup_slips (party_id, slip_date, doc_no, amount, orig_amount, orig_currency, receipt_id, note, photo)
  values (pt.id, v_date, nullif(left(trim(p ->> 'doc_no'), 60), ''), v_conv, case when v_cur <> pt.currency then v_amt end, case when v_cur <> pt.currency then v_cur end,
          nullif(p ->> 'receipt_id', '')::uuid, nullif(left(trim(p ->> 'note'), 300), ''),
          case when coalesce(p ->> 'photo', '') like 'data:image/jpeg;base64,%' and length(p ->> 'photo') <= 900000 then p ->> 'photo' end)
  returning id into v_id;
  return v_id;
end $$;
revoke execute on function sup_slip_save(jsonb) from public, anon;
grant execute on function sup_slip_save(jsonb) to authenticated;

create or replace function sup_slip_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  update sup_slips set cancelled = true, receipt_id = null where id = p_id and company_id = lab_company();
end $$;
revoke execute on function sup_slip_cancel(uuid) from public, anon;
grant execute on function sup_slip_cancel(uuid) to authenticated;

-- Mal kabulden fiş tutarı önerisi: (gelen − hasarlı) × birim maliyet (TL)
create or replace function sup_receipt_amount(p_receipt uuid) returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(sum(round((l.qty - l.damaged) * coalesce(l.unit_cost, 0))), 0)::bigint from stk_receipt_lines l join stk_receipts r on r.id = l.receipt_id
  where l.receipt_id = p_receipt and r.company_id = lab_company() and (can_module('finance') or can_module('purchases'));
$$;
revoke execute on function sup_receipt_amount(uuid) from public, anon;
grant execute on function sup_receipt_amount(uuid) to authenticated;

-- Fatura dışı (ödeme / çek / senet / iade) cari hareketleri: fiş carisine de düşer
create or replace function sup_is_payment_kind(k text) returns boolean language sql immutable as $$
  select k not in ('purchase_invoice', 'purchase_return', 'sale_invoice', 'sale_return', 'opening');
$$;

create or replace function sup_summary() returns table (
  party_id uuid, name text, currency text, slips bigint, slip_count int, invoices bigint, payments bigint, official_balance bigint, slip_balance bigint, unbilled bigint, last_slip date, receipts_waiting int
) language sql stable security definer set search_path = public as $$
  with mv as (
    select m.party_id, t.kind, m.amount from fin_moves m join fin_txns t on t.id = m.txn_id where t.voided_at is null and m.party_id is not null and t.company_id = lab_company()
  ), s as (
    select party_id, sum(amount) amt, count(*) n, max(slip_date) last from sup_slips where company_id = lab_company() and not cancelled group by party_id
  )
  select p.id, p.name, p.currency,
         coalesce(s.amt, 0)::bigint, coalesce(s.n, 0)::int,
         coalesce((select -sum(amount) from mv where mv.party_id = p.id and mv.kind in ('purchase_invoice', 'purchase_return')), 0)::bigint,
         coalesce((select sum(amount) from mv where mv.party_id = p.id and sup_is_payment_kind(mv.kind)), 0)::bigint,
         (p.opening_balance + coalesce((select sum(amount) from mv where mv.party_id = p.id), 0))::bigint,
         (coalesce((select o.amount from sup_slip_open o where o.party_id = p.id), 0) - coalesce(s.amt, 0) + coalesce((select sum(amount) from mv where mv.party_id = p.id and sup_is_payment_kind(mv.kind)), 0))::bigint,
         (coalesce(s.amt, 0) - coalesce((select -sum(amount) from mv where mv.party_id = p.id and mv.kind in ('purchase_invoice', 'purchase_return')), 0))::bigint,
         s.last,
         (select count(*)::int from stk_receipts r where r.party_id = p.id and r.status = 'confirmed' and not exists (select 1 from sup_slips x where x.receipt_id = r.id and not x.cancelled))
  from fin_parties p left join s on s.party_id = p.id
  where p.company_id = lab_company() and p.kind in ('supplier', 'both') and (can_module('finance') or can_module('purchases'))
    and (s.party_id is not null or exists (select 1 from sup_slip_open o where o.party_id = p.id) or exists (select 1 from stk_receipts r where r.party_id = p.id and r.status = 'confirmed'))
  order by p.name;
$$;
revoke execute on function sup_summary() from public, anon;
grant execute on function sup_summary() to authenticated;

-- Tek tedarikçinin hareketleri: kind slip | invoice | payment (fatura dışı), tutar cari para biriminde, işaretli
create or replace function sup_ledger(p_party uuid) returns table (at date, kind text, txn_kind text, doc text, description text, amount bigint, ref uuid, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.slip_date, 'slip', null, s.doc_no, coalesce(s.note, 'Fiş') || case when s.orig_currency is not null then ' (' || to_char(s.orig_amount / 100.0, 'FM999G999G990D00') || ' ' || s.orig_currency || ')' else '' end,
         -s.amount, s.id, s.created_at
  from sup_slips s where s.party_id = p_party and s.company_id = lab_company() and not s.cancelled and (can_module('finance') or can_module('purchases'))
  union all
  select t.txn_date, case when t.kind in ('purchase_invoice', 'purchase_return', 'sale_invoice', 'sale_return') then 'invoice' when t.kind = 'opening' then 'opening' else 'payment' end, t.kind, t.doc_no, t.description, m.amount, t.id, t.created_at
  from fin_moves m join fin_txns t on t.id = m.txn_id
  where m.party_id = p_party and t.voided_at is null and t.company_id = lab_company() and (can_module('finance') or can_module('purchases'))
  order by 1, 8;
$$;
revoke execute on function sup_ledger(uuid) from public, anon;
grant execute on function sup_ledger(uuid) to authenticated;

notify pgrst, 'reload schema';
