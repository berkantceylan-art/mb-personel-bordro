-- =====================================================================
-- GENEL MUHASEBE · fişli cariye yapılan ödeme
--  Fişli cariye girilen ödeme / tahsilat / çek / kart işlemi, faturalı (resmi) cariye de yansıdığı için gerçek bir
--  ödemedir: muhasebe fişi faturalı carinin hesabına (320.xxxx) yazılır. Yansıma kaydı yine muhasebe dışıdır
--  (çift kayıt olmaz). Fişli alım (faturasız mal) muhasebe dışı kalmaya devam eder.
--  Daha önce "Fişli cari" diye muhasebe dışı bırakılmış ödeme kayıtları yeniden fişlenir.
-- Tekrar çalıştırılabilir. Önce 20270209000000_gl_fixes.sql.
-- =====================================================================

do $$
declare d text;
begin
  -- 1) cari çözümleme: fişli cari → faturalı ikizinin hesabı
  select pg_get_functiondef('gl_resolve(uuid, fin_moves, fin_txns)'::regprocedure) into d;
  if position('-- fişli → faturalı' in d) = 0 then
    d := replace(d, $x$    select * into p from fin_parties where id = m.party_id;$x$,
                    $x$    select * into p from fin_parties where id = m.party_id;
    -- fişli → faturalı: ödeme resmi cariye yazılır
    if p.slip_of is not null then select * into p from fin_parties where id = p.slip_of; end if;$x$);
    if position('-- fişli → faturalı' in d) > 0 then execute d; else raise exception 'gl_resolve yaması uygulanamadı'; end if;
  end if;

  -- 2) muhasebe dışı kuralı: fişli cari yalnız ödeme türü olmayan işlemlerde (fişli alım vb.) dışarıda kalır
  select pg_get_functiondef('gl_post_txn(uuid)'::regprocedure) into d;
  if position('not sup_mirror_kind(t.kind) and exists' in d) = 0 then
    d := replace(d, $x$    when exists (select 1 from fin_moves mm join fin_parties p on p.id = mm.party_id where mm.txn_id = t.id and p.slip_of is not null) then 'Fişli cari'$x$,
                    $x$    when not sup_mirror_kind(t.kind) and exists (select 1 from fin_moves mm join fin_parties p on p.id = mm.party_id where mm.txn_id = t.id and p.slip_of is not null) then 'Fişli cari'$x$);
    d := replace(d, $x$    when exists (select 1 from fin_parties p where p.id = t.party_id and p.slip_of is not null) then 'Fişli cari'$x$,
                    $x$    when not sup_mirror_kind(t.kind) and exists (select 1 from fin_parties p where p.id = t.party_id and p.slip_of is not null) then 'Fişli cari'$x$);
    if position('not sup_mirror_kind(t.kind) and exists' in d) > 0 then execute d; else raise exception 'gl_post_txn yaması uygulanamadı'; end if;
  end if;
end $$;

-- 3) daha önce muhasebe dışı bırakılmış fişli cari ödemelerini yeniden fişle
do $$
declare r record;
begin
  for r in select v.fin_txn_id from gl_vouchers v join fin_txns t on t.id = v.fin_txn_id
           where v.status = 'excluded' and v.issues = 'Fişli cari' and sup_mirror_kind(t.kind) and t.voided_at is null loop
    begin
      perform gl_post_txn(r.fin_txn_id);
    exception when others then null;
    end;
  end loop;
end $$;

notify pgrst, 'reload schema';
