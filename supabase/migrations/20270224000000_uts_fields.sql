-- =====================================================================
-- ÜTS bildirim alanları (Takip ve İzleme Web Servis Tanımları dokümanına göre düzeltme)
--  Alma bildirimi ürün bilgisiyle değil, tedarikçinin VERME bildirim ID'si (VBI) ile yapılır.
--  Verme bildiriminde belge no (BNO: fatura / irsaliye no) zorunludur; BEN "bedelsiz numune" (EVET/HAYIR) alanıdır.
-- Tekrar çalıştırılabilir. Önce 20270205000000_uts.sql.
-- =====================================================================

alter table uts_notifications add column if not exists vbi text check (vbi is null or vbi ~ '^[0-9A-Za-z-]{8,40}$');
alter table uts_notifications add column if not exists bno text check (bno is null or length(bno) <= 50);

-- Düzeltme / yeniden dene: VBI ve belge no da düzeltilebilir
do $$
declare src text;
begin
  select pg_get_functiondef('uts_action(uuid,text,text,jsonb)'::regprocedure) into src;
  if position('p_patch ? ''vbi''' in src) > 0 then return; end if;
  if position('qty = coalesce(nullif(p_patch->>''qty'', '''')::numeric, qty)' in src) = 0 then raise exception 'uts_fields: uts_action satırı bulunamadı'; end if;
  src := replace(src, 'qty = coalesce(nullif(p_patch->>''qty'', '''')::numeric, qty)',
    'qty = coalesce(nullif(p_patch->>''qty'', '''')::numeric, qty),
      vbi = case when p_patch ? ''vbi'' then nullif(regexp_replace(trim(p_patch->>''vbi''), ''[^0-9A-Za-z-]'', '''', ''g''), '''') else vbi end,
      bno = case when p_patch ? ''bno'' then nullif(left(trim(p_patch->>''bno''), 50), '''') else bno end');
  execute src;
end $$;

-- Elle ekleme: VBI ve belge no
do $$
declare src text;
begin
  select pg_get_functiondef('uts_add(jsonb)'::regprocedure) into src;
  if position('vbi' in src) > 0 then return; end if;
  src := replace(src, 'counterparty_name, job_id, payload)', 'counterparty_name, job_id, payload, vbi, bno)');
  src := replace(src, 'jsonb_build_object(''note'', nullif(left(trim(p->>''note''), 300), '''')))',
    'jsonb_build_object(''note'', nullif(left(trim(p->>''note''), 300), '''')),
          nullif(regexp_replace(coalesce(p->>''vbi'', ''''), ''[^0-9A-Za-z-]'', '''', ''g''), ''''), nullif(left(trim(p->>''bno''), 50), ''''))');
  if position('payload, vbi, bno)' in src) = 0 or position('p->>''bno''' in src) = 0 then raise exception 'uts_fields: uts_add değiştirilemedi'; end if;
  execute src;
end $$;

notify pgrst, 'reload schema';
