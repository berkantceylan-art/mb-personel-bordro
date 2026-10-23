-- =====================================================================
-- e-Belgeler: çift kayıt önleme ve ERP'deki faturalarla eşleştirme
--  1) Aynı fatura hem e-postadan (PDF / XML) hem eLogo'dan gelirse tek satırda birleşir:
--     anahtar = yön + belge türü (fatura / irsaliye) + belge no + karşı taraf VKN'si.
--     PDF'ten okunan satıra sonradan eLogo XML'i gelirse satır gerçek ETTN ve XML ile güncellenir (PDF korunur).
--  2) Mevcut çift satırlar temizlenir (aktarılmış olan / XML'i olan tutulur).
--  3) einv_inbox_link_existing(): ERP'de aynı belge numarasıyla zaten kayıtlı faturalar (ETTN'i ERP'nin verdiği) (Bizim Hesap'tan aktarılan
--     satışlar, elle / fotoğraftan girilen alışlar) e-belgeye ETTN ile bağlanır → "Aktarılan" sekmesine geçer,
--     "daha önce kaydedilmiş" hatası vermez.
-- Önce: 20270225 / 20270226 / 20270228 einv. Tekrar çalıştırılabilir.
-- =====================================================================

create or replace function einv_doc_key(p text) returns text
language sql immutable as $$ select nullif(upper(regexp_replace(coalesce(p, ''), '[^0-9A-Za-z]', '', 'g')), '') $$;

create index if not exists einv_inbox_dockey_idx on einv_inbox (company_id, direction, einv_doc_key(doc_no));

-- Bir e-belgenin ERP'deki faturası (ETTN ile)
create or replace function einv_row_invoice(e einv_inbox) returns uuid
language sql stable security definer set search_path = public as $$
  select i.id from inv_invoices i
   where e.doc_kind <> 'eirsaliye' and i.company_id = e.company_id and i.status <> 'cancelled'
     and i.direction = case when e.direction = 'out' then 'sale' else 'purchase' end and i.ettn = e.ettn
   limit 1
$$;

-- ---------------------------------------------------------------------
-- 1) Kutuya ekleme: ETTN'e ek olarak belge no ile çift kontrolü
-- ---------------------------------------------------------------------
create or replace function einv_inbox_add(p_rows jsonb, p_source text default 'upload') returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c uuid := lab_company(); r jsonb; v_ettn uuid; v_dir text; v_kind text; v_key text; v_vkn text; v_xml text; v_pdf text; v_pay bigint;
  x einv_inbox; v_inv uuid;
  added int := 0; dup int := 0; merged int := 0; done_ int := 0; bad int := 0;
begin
  if not (can_module('purchases', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  if p_source not in ('upload', 'email', 'api') then raise exception 'bad_source'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    begin v_ettn := (r->>'ettn')::uuid; exception when others then v_ettn := null; end;
    v_xml := nullif(r->>'xml', ''); v_pdf := nullif(left(r->>'pdf_path', 300), '');
    if v_ettn is null or (v_xml is null and v_pdf is null) then bad := bad + 1; continue; end if;
    if exists (select 1 from einv_inbox where company_id = c and ettn = v_ettn) then dup := dup + 1; continue; end if;
    v_dir := case when r->>'direction' = 'out' then 'out' else 'in' end;
    v_kind := case when r->>'doc_kind' in ('efatura', 'earsiv', 'eirsaliye') then r->>'doc_kind' else 'efatura' end;
    v_key := einv_doc_key(r->>'doc_no');
    v_vkn := nullif(left(regexp_replace(coalesce(r->>'sender_vkn', ''), '\D', '', 'g'), 20), '');
    v_pay := nullif(r->>'payable', '')::bigint;

    -- aynı belge (başka kaynaktan, farklı / türetilmiş ETTN ile) kutuda mı?
    x := null;
    if length(coalesce(v_key, '')) >= 6 then
      select * into x from einv_inbox e
       where e.company_id = c and e.direction = v_dir and einv_doc_key(e.doc_no) = v_key
         and (e.doc_kind = 'eirsaliye') = (v_kind = 'eirsaliye')
         and (e.sender_vkn = v_vkn or ((e.sender_vkn is null or v_vkn is null) and (v_pay is null or e.payable is null or abs(e.payable - v_pay) <= 100)))
       order by (e.xml is not null) desc, e.received_at limit 1;
    end if;
    if x.id is not null then
      if v_xml is not null and x.xml is null then
        -- PDF'ten okunan satır: gerçek ETTN ve XML ile güncellenir; bağlı alış faturası da yeni ETTN'e geçer
        v_inv := einv_row_invoice(x);
        update einv_inbox set ettn = v_ettn, xml = v_xml, doc_kind = v_kind, doc_no = coalesce(left(r->>'doc_no', 40), doc_no),
               issue_date = coalesce(nullif(r->>'issue_date', '')::date, issue_date), profile = coalesce(left(r->>'profile', 40), profile),
               type_code = coalesce(left(r->>'type_code', 40), type_code), sender_vkn = coalesce(v_vkn, sender_vkn),
               sender_name = coalesce(left(r->>'sender_name', 250), sender_name), currency = left(coalesce(r->>'currency', currency), 3),
               payable = coalesce(v_pay, payable), vat_total = coalesce(nullif(r->>'vat_total', '')::bigint, vat_total),
               line_count = coalesce(nullif(r->>'line_count', '')::int, line_count), source = p_source, source_ref = coalesce(left(r->>'source_ref', 200), source_ref)
         where id = x.id;
        if v_inv is not null and not exists (select 1 from inv_invoices i where i.company_id = c and i.ettn = v_ettn and i.status <> 'cancelled') then
          update inv_invoices set ettn = v_ettn where id = v_inv;
        end if;
        merged := merged + 1;
      elsif v_pdf is not null and x.pdf_path is null then
        update einv_inbox set pdf_path = v_pdf, ai_data = coalesce(ai_data, case when jsonb_typeof(r->'ai_data') = 'object' then r->'ai_data' end) where id = x.id;
        merged := merged + 1;
      else
        dup := dup + 1;
      end if;
      continue;
    end if;

    insert into einv_inbox (company_id, ettn, direction, doc_kind, doc_no, issue_date, profile, type_code, sender_vkn, sender_name, currency, payable, vat_total, line_count, xml, source, source_ref, pdf_path, ai_data)
    values (c, v_ettn, v_dir, v_kind, left(r->>'doc_no', 40), nullif(r->>'issue_date', '')::date, left(r->>'profile', 40), left(r->>'type_code', 40),
            v_vkn, left(r->>'sender_name', 250), left(coalesce(r->>'currency', 'TRY'), 3),
            v_pay, nullif(r->>'vat_total', '')::bigint, nullif(r->>'line_count', '')::int, v_xml, p_source, left(r->>'source_ref', 200),
            v_pdf, case when jsonb_typeof(r->'ai_data') = 'object' then r->'ai_data' end);
    added := added + 1;
    if exists (select 1 from inv_invoices i where i.company_id = c and i.direction = case when v_dir = 'out' then 'sale' else 'purchase' end and i.ettn = v_ettn and i.status <> 'cancelled')
       or (v_kind = 'eirsaliye' and v_dir = 'in' and exists (select 1 from stk_receipts sr where sr.company_id = c and sr.supplier_doc = r->>'doc_no' and sr.status <> 'cancelled')) then done_ := done_ + 1; end if;
  end loop;
  return jsonb_build_object('added', added, 'duplicate', dup, 'merged', merged, 'already_imported', done_, 'invalid', bad);
end $$;
revoke execute on function einv_inbox_add(jsonb, text) from public, anon;
grant execute on function einv_inbox_add(jsonb, text) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_inbox_add(jsonb, text) to service_role; end if; end $$;

-- ---------------------------------------------------------------------
-- 3) ERP'de zaten kayıtlı faturaları e-belgeye bağla
-- ---------------------------------------------------------------------
create or replace function einv_inbox_link_existing() returns jsonb
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); r record; n_sale int := 0; n_pur int := 0;
begin
  if not (can_module('purchases', 2) or can_module('sales', 2) or einv_is_service()) then raise exception 'not_allowed'; end if;
  for r in
    select distinct on (e.id) e.id as eid, e.ettn, e.direction, i.id as iid
      from einv_inbox e
      join inv_invoices i on i.company_id = e.company_id and i.status <> 'cancelled'
                         and i.direction = case when e.direction = 'out' then 'sale' else 'purchase' end
                         and einv_doc_key(i.doc_no) = einv_doc_key(e.doc_no)
     where e.company_id = c and e.doc_kind <> 'eirsaliye' and length(coalesce(einv_doc_key(e.doc_no), '')) >= 6
       and einv_row_invoice(e) is null
       -- giden: belge no satışta tektir; gelen: tedarikçinin VKN'si tutmalı
       and (e.direction = 'out' or exists (select 1 from fin_parties p where p.id = i.party_id and regexp_replace(coalesce(p.tax_no, ''), '\D', '', 'g') = e.sender_vkn))
       -- faturanın ETTN'i kutudaki hiçbir belgeye ait değil (ERP'nin verdiği / PDF'ten türetilmiş); satışta ERP'den eLogo'ya gönderilmemiş olmalı
       and (i.ettn is null or not exists (select 1 from einv_inbox y where y.company_id = c and y.ettn = i.ettn))
       and (i.direction = 'purchase' or i.einvoice_status in ('none', 'ready', 'imported'))
       and not exists (select 1 from inv_invoices z where z.company_id = c and z.direction = i.direction and z.ettn = e.ettn and z.status <> 'cancelled')
     order by e.id, i.created_at
  loop
    begin
      update inv_invoices set ettn = r.ettn,
             einvoice_status = case when direction = 'sale' and einvoice_status in ('none', 'ready') then 'accepted' else einvoice_status end
       where id = r.iid and company_id = c;
      if r.direction = 'out' then n_sale := n_sale + 1; else n_pur := n_pur + 1; end if;
    exception when unique_violation then null;
    end;
  end loop;
  return jsonb_build_object('sales', n_sale, 'purchases', n_pur);
end $$;
revoke execute on function einv_inbox_link_existing() from public, anon;
grant execute on function einv_inbox_link_existing() to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function einv_inbox_link_existing() to service_role; end if; end $$;

-- ---------------------------------------------------------------------
-- 2) Mevcut çift satırları temizle (aynı yön + tür + belge no + VKN)
--    Tutulan: XML'i olan, sonra faturaya bağlı olan, sonra ilk gelen. Silinen satırın PDF'i tutulana taşınır;
--    silinen satıra bağlı alış faturası tutulan satırın ETTN'ine geçer. İkisi de ayrı faturaya bağlıysa dokunulmaz.
-- ---------------------------------------------------------------------
do $$
declare g record; k einv_inbox; d einv_inbox; v_ki uuid; v_di uuid; n_del int := 0;
begin
  for g in
    select direction, (doc_kind = 'eirsaliye') as irs, einv_doc_key(doc_no) as key, coalesce(sender_vkn, '') as vkn, company_id
      from einv_inbox
     where length(coalesce(einv_doc_key(doc_no), '')) >= 6
     group by 1, 2, 3, 4, 5 having count(*) > 1
  loop
    select * into k from einv_inbox e
     where e.company_id = g.company_id and e.direction = g.direction and (e.doc_kind = 'eirsaliye') = g.irs and einv_doc_key(e.doc_no) = g.key and coalesce(e.sender_vkn, '') = g.vkn
     order by (e.xml is not null) desc, (einv_row_invoice(e) is not null) desc, e.received_at limit 1;
    for d in
      select * from einv_inbox e
       where e.company_id = g.company_id and e.direction = g.direction and (e.doc_kind = 'eirsaliye') = g.irs and einv_doc_key(e.doc_no) = g.key and coalesce(e.sender_vkn, '') = g.vkn
         and e.id <> k.id
    loop
      v_ki := einv_row_invoice(k);
      v_di := einv_row_invoice(d);
      if v_di is not null and v_ki is not null then continue; end if;  -- iki ayrı fatura: elle bakılmalı (aşağıdaki sorgu)
      if v_di is not null then update inv_invoices set ettn = k.ettn where id = v_di; end if;
      update einv_inbox set pdf_path = coalesce(pdf_path, d.pdf_path), ai_data = coalesce(ai_data, d.ai_data),
             status = case when status = 'new' and d.status <> 'new' then d.status else status end, note = coalesce(note, d.note)
       where id = k.id;
      delete from einv_inbox where id = d.id;
      n_del := n_del + 1;
    end loop;
  end loop;
  raise notice 'e-belge çift satır temizlendi: %', n_del;
end $$;

-- Var olan kayıtları bir kez eşleştir (oturum yok: doğrudan)
do $$
declare c uuid; n int;
begin
  for c in select distinct company_id from einv_inbox loop
    with m as (
      select distinct on (e.id) e.id as eid, e.ettn, i.id as iid
        from einv_inbox e
        join inv_invoices i on i.company_id = e.company_id and i.status <> 'cancelled'
                           and i.direction = case when e.direction = 'out' then 'sale' else 'purchase' end
                           and einv_doc_key(i.doc_no) = einv_doc_key(e.doc_no)
       where e.company_id = c and e.doc_kind <> 'eirsaliye' and length(coalesce(einv_doc_key(e.doc_no), '')) >= 6
         and einv_row_invoice(e) is null
         and (e.direction = 'out' or exists (select 1 from fin_parties p where p.id = i.party_id and regexp_replace(coalesce(p.tax_no, ''), '\D', '', 'g') = e.sender_vkn))
         and (i.ettn is null or not exists (select 1 from einv_inbox y where y.company_id = c and y.ettn = i.ettn))
         and (i.direction = 'purchase' or i.einvoice_status in ('none', 'ready', 'imported'))
         and not exists (select 1 from inv_invoices z where z.company_id = c and z.direction = i.direction and z.ettn = e.ettn and z.status <> 'cancelled')
       order by e.id, i.created_at
    ), one as (select distinct on (iid) * from m order by iid, eid)
    update inv_invoices i set ettn = one.ettn,
           einvoice_status = case when i.direction = 'sale' and i.einvoice_status in ('none', 'ready') then 'accepted' else i.einvoice_status end
      from one where i.id = one.iid;
    get diagnostics n = row_count;
    raise notice 'ERP faturasıyla eşleşen e-belge: %', n;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Sonuç
select 'Bekleyen gelen' as durum, count(*) as adet from einv_inbox e where e.direction = 'in' and e.status = 'new' and e.doc_kind <> 'eirsaliye' and einv_row_invoice(e) is null
union all select 'Bekleyen giden (ERP''de yok)', count(*) from einv_inbox e where e.direction = 'out' and e.status = 'new' and e.doc_kind <> 'eirsaliye' and einv_row_invoice(e) is null
union all select 'Aktarılan (ERP''de kayıtlı)', count(*) from einv_inbox e where einv_row_invoice(e) is not null
union all select 'Aynı belge iki ayrı alış faturası (elle bakın)', count(*) from (
  select einv_doc_key(i.doc_no), i.party_id from inv_invoices i where i.direction = 'purchase' and i.status <> 'cancelled' and length(coalesce(einv_doc_key(i.doc_no), '')) >= 6
   group by 1, 2 having count(*) > 1) q;
