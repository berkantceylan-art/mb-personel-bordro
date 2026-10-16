-- Hız: büyük veri (Dentalsis aktarımı, ~45 bin iş) sonrası yavaşlayan sayfalar
--  1) RLS kurallarındaki yetki fonksiyonları (can_logistics(), can_module('x'), auth.uid() …) her satır için ayrı ayrı
--     çalışıyordu. Bunlar satıra bağlı değil; "(SELECT f())" biçimine çevrilince sorgu başına bir kez çalışır.
--     Kuralların anlamı değişmez; yalnız sütun almayan ve tek değer döndüren çağrılar sarılır.
--  2) Tarih / durum aramaları için eksik indeksler, istatistik güncelleme.
-- Tekrar çalıştırılabilir.

do $$
declare
  names text;
  pat text;
  p record;
  q text; c text; nq text; nc text; n int := 0;
begin
  select string_agg(regexp_replace(fn, '\.', '\\.', 'g'), '|') into names from (
    select distinct m[1] fn
    from pg_policies pp, regexp_matches(coalesce(pp.qual, '') || ' ' || coalesce(pp.with_check, ''), '([a-z_\.]+)\(\s*(''[^'']*''(::text)?(\s*,\s*\d+)?)?\s*\)', 'g') m
    where pp.schemaname = 'public'
  ) f
  where fn not in ('now', 'coalesce', 'exists', 'lower', 'upper')
    and exists (select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                where ns.nspname || '.' || pr.proname = case when fn like '%.%' then fn else 'public.' || fn end and not pr.proretset)
    and not exists (select 1 from pg_proc pr join pg_namespace ns on ns.oid = pr.pronamespace
                where ns.nspname || '.' || pr.proname = case when fn like '%.%' then fn else 'public.' || fn end and pr.proretset);
  if names is null then return; end if;
  pat := '(?<!SELECT )(?<![a-z_\.])(' || names || ')\((\s*''[^'']*''(::text)?(\s*,\s*\d+)?\s*)?\)';

  for p in select schemaname, tablename, policyname, cmd, qual, with_check from pg_policies where schemaname = 'public' loop
    q := p.qual; c := p.with_check;
    nq := case when q is null then null else regexp_replace(q, pat, '(SELECT \1(\2))', 'g') end;
    nc := case when c is null then null else regexp_replace(c, pat, '(SELECT \1(\2))', 'g') end;
    if nq is distinct from q then
      execute format('alter policy %I on %I.%I using (%s)', p.policyname, p.schemaname, p.tablename, nq);
    end if;
    if nc is distinct from c then
      execute format('alter policy %I on %I.%I with check (%s)', p.policyname, p.schemaname, p.tablename, nc);
    end if;
    if nq is distinct from q or nc is distinct from c then n := n + 1; end if;
  end loop;
  raise notice 'RLS kuralı hızlandırıldı: %', n;
end $$;

create index if not exists jobs_delivered_idx on jobs (delivered_at) where status = 'delivered';
create index if not exists jobs_in_date_idx on jobs (in_date);
create index if not exists jobs_customer_status_idx on jobs (customer_id, status);
create index if not exists job_items_product_idx on job_items (product_id) where product_id is not null;
create index if not exists lab_payments_paid_idx on lab_payments (paid_on);

analyze jobs;
analyze job_items;
analyze job_steps;
analyze lab_customers;
analyze lab_products;
analyze lab_payments;

notify pgrst, 'reload schema';
