-- e-Belge gönderimi (eLogo): fatura senaryo / tip alanları, ihracat, kamu, e-arşiv, gönderim durumu
-- Önce: 20261204000000_invoices.sql, 20270212000000_tax_center.sql, 20270225000000_einv_inbox.sql

-- ---------------------------------------------------------------------
-- Şirket: numaralama, taslak modu, tasarım, kamu IBAN
-- ---------------------------------------------------------------------
alter table companies add column if not exists einv_numbering text not null default 'erp' check (einv_numbering in ('erp', 'elogo'));
alter table companies add column if not exists einv_draft boolean not null default true;          -- eLogo taslaklarına gönder (portalda onay)
alter table companies add column if not exists einv_xslt_efatura text check (einv_xslt_efatura is null or einv_xslt_efatura ~ '^[0-9a-fA-F-]{36}$');
alter table companies add column if not exists einv_xslt_earsiv text check (einv_xslt_earsiv is null or einv_xslt_earsiv ~ '^[0-9a-fA-F-]{36}$');
alter table companies add column if not exists einv_xslt_irsaliye text check (einv_xslt_irsaliye is null or einv_xslt_irsaliye ~ '^[0-9a-fA-F-]{36}$');
alter table companies add column if not exists inv_prefix_irsaliye text not null default 'MBI' check (inv_prefix_irsaliye ~ '^[A-Z0-9]{3}$');
alter table companies add column if not exists einv_iban text check (einv_iban is null or einv_iban ~ '^TR[0-9]{24}$');
alter table companies add column if not exists einv_web text check (einv_web is null or length(einv_web) <= 200);

-- ---------------------------------------------------------------------
-- Cari: GİB mükellef bilgisi
-- ---------------------------------------------------------------------
alter table fin_parties add column if not exists einv_alias text check (einv_alias is null or length(einv_alias) <= 200);
alter table fin_parties add column if not exists is_edespatch boolean not null default false;
alter table fin_parties add column if not exists edsp_alias text check (edsp_alias is null or length(edsp_alias) <= 200);
alter table fin_parties add column if not exists gib_checked_at timestamptz;
alter table fin_parties add column if not exists foreign_tax_id text check (foreign_tax_id is null or length(foreign_tax_id) <= 40);

-- ---------------------------------------------------------------------
-- Fatura: senaryo / tip ve türe özel alanlar
-- ---------------------------------------------------------------------
alter table inv_invoices drop constraint if exists inv_invoices_profile_check;
alter table inv_invoices add constraint inv_invoices_profile_check
  check (profile in ('TEMELFATURA', 'TICARIFATURA', 'EARSIVFATURA', 'IHRACAT', 'KAMU', 'ILAC_TIBBICIHAZ', 'KAGIT'));
alter table inv_invoices drop constraint if exists inv_invoices_einvoice_status_check;
alter table inv_invoices add constraint inv_invoices_einvoice_status_check
  check (einvoice_status in ('none', 'ready', 'sending', 'draft_sent', 'sent', 'accepted', 'rejected', 'imported', 'error', 'cancelled'));

alter table inv_invoices add column if not exists type_code text check (type_code is null or type_code in ('SATIS', 'IADE', 'TEVKIFAT', 'TEVKIFATIADE', 'ISTISNA', 'IHRACKAYITLI'));
alter table inv_invoices add column if not exists send_method text not null default 'ELEKTRONIK' check (send_method in ('ELEKTRONIK', 'KAGIT'));
-- ihracat (gümrük): teslim şartı, taşıma şekli, kap
alter table inv_invoices add column if not exists incoterm text check (incoterm is null or incoterm ~ '^[A-Z]{3}$');
alter table inv_invoices add column if not exists transport_mode smallint check (transport_mode is null or transport_mode between 1 and 8);
alter table inv_invoices add column if not exists package_kind text check (package_kind is null or package_kind ~ '^[A-Z0-9]{2,3}$');
alter table inv_invoices add column if not exists package_no text check (package_no is null or length(package_no) <= 40);
alter table inv_invoices add column if not exists package_count int check (package_count is null or package_count between 1 and 100000);
alter table inv_invoices add column if not exists delivery_address text check (delivery_address is null or length(delivery_address) <= 300);
-- kamu: asıl alıcı birim
alter table inv_invoices add column if not exists buyer_name text check (buyer_name is null or length(buyer_name) <= 200);
alter table inv_invoices add column if not exists buyer_tax_no text check (buyer_tax_no is null or buyer_tax_no ~ '^[0-9]{10,11}$');
-- e-arşiv internet satışı
alter table inv_invoices add column if not exists online_sale boolean not null default false;
alter table inv_invoices add column if not exists pay_method text check (pay_method is null or pay_method in ('KREDIKARTI/BANKAKARTI', 'EFT/HAVALE', 'KAPIDAODEME', 'ODEMEARACISI', 'DIGER'));
alter table inv_invoices add column if not exists pay_agent text check (pay_agent is null or length(pay_agent) <= 120);
alter table inv_invoices add column if not exists pay_date date;
alter table inv_invoices add column if not exists ship_date date;
alter table inv_invoices add column if not exists carrier_tax_no text check (carrier_tax_no is null or carrier_tax_no ~ '^[0-9]{10,11}$');
alter table inv_invoices add column if not exists carrier_name text check (carrier_name is null or length(carrier_name) <= 200);
-- gönderim
alter table inv_invoices add column if not exists einv_alias text check (einv_alias is null or length(einv_alias) <= 200);
alter table inv_invoices add column if not exists einv_draft boolean;
alter table inv_invoices add column if not exists einv_sent_at timestamptz;
alter table inv_invoices add column if not exists einv_sent_by uuid;
alter table inv_invoices add column if not exists einv_ref bigint;
alter table inv_invoices add column if not exists einv_code int;
alter table inv_invoices add column if not exists einv_desc text check (einv_desc is null or length(einv_desc) <= 500);
alter table inv_invoices add column if not exists einv_checked_at timestamptz;
create index if not exists inv_invoices_einv_track_idx on inv_invoices (einv_checked_at) where einvoice_status in ('sending', 'draft_sent', 'sent');

alter table inv_lines add column if not exists gtip text check (gtip is null or gtip ~ '^[0-9.]{4,16}$');
alter table inv_lines add column if not exists ident_scheme text check (ident_scheme is null or ident_scheme in ('TIBBICIHAZ', 'ILAC', 'DIGER'));
alter table inv_lines add column if not exists ident text check (ident is null or length(ident) <= 200);
alter table inv_lines add column if not exists diib_line text check (diib_line is null or length(diib_line) <= 40);

-- ---------------------------------------------------------------------
-- inv_save: satır ek alanları ve alış iadesinde senaryo
-- ---------------------------------------------------------------------
do $$
declare src text; o text; n text;
begin
  select pg_get_functiondef('inv_save(jsonb)'::regprocedure) into src;
  if position('ident_scheme' in src) > 0 then return; end if;
  o := 'withholding_code, vat_exemption_code, lot_no, expiry_date, gross, discount, net, vat, withholding, total)';
  n := 'withholding_code, vat_exemption_code, lot_no, expiry_date, gross, discount, net, vat, withholding, total, gtip, ident_scheme, ident, diib_line)';
  if position(o in src) = 0 then raise exception 'inv_save_patch_failed:1'; end if;
  src := replace(src, o, n);
  o := 'v_gross, v_discount, v_net, v_vat, v_wh, v_net + v_vat);';
  n := 'v_gross, v_discount, v_net, v_vat, v_wh, v_net + v_vat,
            case when l->>''gtip'' ~ ''^[0-9.]{4,16}$'' then l->>''gtip'' end,
            case when l->>''ident_scheme'' in (''TIBBICIHAZ'', ''ILAC'', ''DIGER'') then l->>''ident_scheme'' end,
            nullif(left(trim(coalesce(l->>''ident'', '''')), 200), ''''), nullif(left(trim(coalesce(l->>''diib_line'', '''')), 40), ''''));';
  if position(o in src) = 0 then raise exception 'inv_save_patch_failed:2'; end if;
  src := replace(src, o, n);
  -- alış iadesini biz keseriz: tedarikçi e-fatura mükellefiyse TEMELFATURA, değilse e-arşiv
  o := 'case when v_dir = ''purchase'' then ''TICARIFATURA''';
  n := 'case when v_dir = ''purchase'' and p->>''type'' = ''return'' then (case when pt.is_einvoice then ''TEMELFATURA'' else ''EARSIVFATURA'' end) when v_dir = ''purchase'' then ''TICARIFATURA''';
  if position(o in src) = 0 then raise exception 'inv_save_patch_failed:3'; end if;
  src := replace(src, o, n);
  execute src;
end $$;

-- ---------------------------------------------------------------------
-- inv_post: alış iadesine kendi serimizden numara; gönderime hazır
-- ---------------------------------------------------------------------
do $$
declare src text; o text; n text;
begin
  select pg_get_functiondef('inv_post(uuid)'::regprocedure) into src;
  if position('einv_numbering' in src) > 0 then return; end if;
  o := 'if v.direction = ''sale'' and v.doc_no is null and v.profile <> ''KAGIT'' then';
  n := 'if (v.direction = ''sale'' or (v.direction = ''purchase'' and v.type = ''return'')) and v.doc_no is null and v.profile <> ''KAGIT''
     and not (co.einv_numbering = ''elogo'' and (v.direction = ''purchase'' or v.type = ''invoice'')) then';
  if position(o in src) = 0 then raise exception 'inv_post_patch_failed:1'; end if;
  src := replace(src, o, n);
  o := 'einvoice_status = case when einvoice_status = ''none'' and direction = ''sale'' and profile <> ''KAGIT'' then ''ready'' else einvoice_status end';
  n := 'einvoice_status = case when einvoice_status = ''none'' and profile <> ''KAGIT'' and source <> ''ubl''
                              and ((direction = ''sale'' and type = ''invoice'') or (direction = ''purchase'' and type = ''return'')) then ''ready'' else einvoice_status end';
  if position(o in src) = 0 then raise exception 'inv_post_patch_failed:2'; end if;
  src := replace(src, o, n);
  execute src;
end $$;

-- inv_cancel: gönderilmiş / gönderilmekte olan belge iptal edilemez (e-arşiv iptali önce eLogo'dan yapılır → 'cancelled')
do $$
declare src text; o text;
begin
  select pg_get_functiondef('inv_cancel(uuid, text)'::regprocedure) into src;
  o := 'v.einvoice_status in (''sent'', ''accepted'')';
  if position(o in src) = 0 then
    if position('''draft_sent''' in src) > 0 then return; end if;
    raise exception 'inv_cancel_patch_failed';
  end if;
  execute replace(replace(src, 'if v.direction = ''sale'' and ' || o, 'if ' || o), o, 'v.einvoice_status in (''sent'', ''accepted'', ''sending'', ''draft_sent'')');
end $$;

-- inv_set_einvoice: yeni durumlar (elle işaretleme)
create or replace function inv_set_einvoice(p_id uuid, p_status text, p_note text, p_doc_no text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v inv_invoices;
begin
  select * into v from inv_invoices where id = p_id for update;
  if v.id is null then raise exception 'not_found'; end if;
  if not can_module(inv_module(v.direction), 2) then raise exception 'not_allowed'; end if;
  if p_status not in ('none', 'ready', 'sent', 'accepted', 'rejected', 'imported', 'cancelled') then raise exception 'bad_status'; end if;
  update inv_invoices set einvoice_status = p_status, einvoice_note = nullif(left(coalesce(p_note, ''), 500), ''),
    doc_no = coalesce(nullif(upper(trim(coalesce(p_doc_no, ''))), ''), doc_no)
  where id = p_id;
end $$;
revoke execute on function inv_set_einvoice(uuid, text, text, text) from public, anon;
grant execute on function inv_set_einvoice(uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Türe özel alanlar (taslak ya da henüz gönderilmemiş fatura)
-- ---------------------------------------------------------------------
create or replace function inv_set_edoc(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v inv_invoices;
begin
  select * into v from inv_invoices where id = p_id for update;
  if v.id is null then raise exception 'not_found'; end if;
  if not can_module(inv_module(v.direction), 2) then raise exception 'not_allowed'; end if;
  if v.status = 'cancelled' or v.einvoice_status not in ('none', 'ready', 'error') then raise exception 'einv_locked'; end if;
  update inv_invoices set
    type_code = case when p ? 'type_code' then nullif(p->>'type_code', '') else type_code end,
    profile = case when v.status = 'draft' and nullif(p->>'profile', '') is not null then p->>'profile' else profile end,
    send_method = coalesce(nullif(p->>'send_method', ''), send_method),
    incoterm = case when p ? 'incoterm' then nullif(upper(p->>'incoterm'), '') else incoterm end,
    transport_mode = case when p ? 'transport_mode' then nullif(p->>'transport_mode', '')::smallint else transport_mode end,
    package_kind = case when p ? 'package_kind' then nullif(upper(p->>'package_kind'), '') else package_kind end,
    package_no = case when p ? 'package_no' then nullif(left(trim(p->>'package_no'), 40), '') else package_no end,
    package_count = case when p ? 'package_count' then nullif(p->>'package_count', '')::int else package_count end,
    delivery_address = case when p ? 'delivery_address' then nullif(left(trim(p->>'delivery_address'), 300), '') else delivery_address end,
    buyer_name = case when p ? 'buyer_name' then nullif(left(trim(p->>'buyer_name'), 200), '') else buyer_name end,
    buyer_tax_no = case when p ? 'buyer_tax_no' then nullif(regexp_replace(p->>'buyer_tax_no', '\D', '', 'g'), '') else buyer_tax_no end,
    online_sale = coalesce((p->>'online_sale')::boolean, online_sale),
    pay_method = case when p ? 'pay_method' then nullif(p->>'pay_method', '') else pay_method end,
    pay_agent = case when p ? 'pay_agent' then nullif(left(trim(p->>'pay_agent'), 120), '') else pay_agent end,
    pay_date = case when p ? 'pay_date' then nullif(p->>'pay_date', '')::date else pay_date end,
    ship_date = case when p ? 'ship_date' then nullif(p->>'ship_date', '')::date else ship_date end,
    carrier_tax_no = case when p ? 'carrier_tax_no' then nullif(regexp_replace(p->>'carrier_tax_no', '\D', '', 'g'), '') else carrier_tax_no end,
    carrier_name = case when p ? 'carrier_name' then nullif(left(trim(p->>'carrier_name'), 200), '') else carrier_name end,
    export_doc_kind = case when p ? 'export_doc_no' then (case when nullif(trim(p->>'export_doc_no'), '') is null then null else coalesce(nullif(p->>'export_doc_kind', ''), 'gb') end) else export_doc_kind end,
    export_doc_no = case when p ? 'export_doc_no' then nullif(left(trim(p->>'export_doc_no'), 40), '') else export_doc_no end,
    export_doc_date = case when p ? 'export_doc_date' then nullif(p->>'export_doc_date', '')::date else export_doc_date end,
    updated_at = now()
  where id = p_id;
end $$;
revoke execute on function inv_set_edoc(uuid, jsonb) from public, anon;
grant execute on function inv_set_edoc(uuid, jsonb) to authenticated;

-- Satır ek alanları (gönderilmemiş, işlenmiş faturada da düzeltilebilir: tutarı etkilemez)
create or replace function inv_set_line_edoc(p_line uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v inv_invoices;
begin
  select i.* into v from inv_invoices i join inv_lines l on l.invoice_id = i.id where l.id = p_line;
  if v.id is null then raise exception 'not_found'; end if;
  if not can_module(inv_module(v.direction), 2) then raise exception 'not_allowed'; end if;
  if v.status = 'cancelled' or v.einvoice_status not in ('none', 'ready', 'error') then raise exception 'einv_locked'; end if;
  update inv_lines set
    gtip = case when p ? 'gtip' then (case when p->>'gtip' ~ '^[0-9.]{4,16}$' then p->>'gtip' end) else gtip end,
    ident_scheme = case when p ? 'ident_scheme' then nullif(p->>'ident_scheme', '') else ident_scheme end,
    ident = case when p ? 'ident' then nullif(left(trim(p->>'ident'), 200), '') else ident end,
    diib_line = case when p ? 'diib_line' then nullif(left(trim(p->>'diib_line'), 40), '') else diib_line end,
    vat_exemption_code = case when p ? 'vat_exemption_code' and vat_rate = 0 then (case when p->>'vat_exemption_code' ~ '^[0-9]{3}$' then p->>'vat_exemption_code' end) else vat_exemption_code end,
    withholding_code = case when p ? 'withholding_code' and withholding_rate > 0 then (case when p->>'withholding_code' ~ '^[0-9]{3}$' then p->>'withholding_code' end) else withholding_code end
  where id = p_line;
end $$;
revoke execute on function inv_set_line_edoc(uuid, jsonb) from public, anon;
grant execute on function inv_set_line_edoc(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Gönderim akışı
-- ---------------------------------------------------------------------
-- Gönderime başla: çift gönderimi engeller (yalnız ready / error / none durumunda, işlenmiş faturada)
create or replace function inv_einv_begin(p_id uuid) returns inv_invoices
language plpgsql security definer set search_path = public as $$
declare v inv_invoices;
begin
  select * into v from inv_invoices where id = p_id for update;
  if v.id is null then raise exception 'not_found'; end if;
  if not can_module(inv_module(v.direction), 2) then raise exception 'not_allowed'; end if;
  if v.status <> 'posted' then raise exception 'einv_not_posted'; end if;
  if v.profile = 'KAGIT' or v.source = 'ubl' then raise exception 'einv_not_sendable'; end if;
  if not ((v.direction = 'sale' and v.type = 'invoice') or (v.direction = 'purchase' and v.type = 'return')) then raise exception 'einv_not_sendable'; end if;
  if v.einvoice_status not in ('none', 'ready', 'error') then raise exception 'einv_already'; end if;
  update inv_invoices set einvoice_status = 'sending', einv_sent_at = now(), einv_sent_by = auth.uid(), einv_desc = null where id = p_id returning * into v;
  return v;
end $$;
revoke execute on function inv_einv_begin(uuid) from public, anon;
grant execute on function inv_einv_begin(uuid) to authenticated;

-- Sonuç / durum güncellemesi (gönderen kullanıcı ya da cron)
create or replace function inv_einv_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v inv_invoices; st text := nullif(p->>'status', '');
begin
  select * into v from inv_invoices where id = p_id for update;
  if v.id is null then raise exception 'not_found'; end if;
  if not (einv_is_service() or can_module(inv_module(v.direction), 2)) then raise exception 'not_allowed'; end if;
  if st is not null and st not in ('ready', 'sending', 'draft_sent', 'sent', 'accepted', 'rejected', 'error', 'cancelled') then raise exception 'bad_status'; end if;
  update inv_invoices set
    einvoice_status = coalesce(st, einvoice_status),
    doc_no = case when nullif(p->>'doc_no', '') ~ '^[A-Z0-9]{3}20[0-9]{11}$' and (doc_no is null or v.einvoice_status in ('sending', 'draft_sent')) then p->>'doc_no' else doc_no end,
    -- senaryo değişimi: aynı seri içinde (e-fatura ↔ e-fatura) ya da henüz numara almamışsa
    profile = case when nullif(p->>'profile', '') in ('TEMELFATURA', 'TICARIFATURA', 'EARSIVFATURA') and v.einvoice_status in ('ready', 'error', 'none', 'sending')
                    and ((p->>'profile' = 'EARSIVFATURA') = (v.profile = 'EARSIVFATURA') or v.doc_no is null) then p->>'profile' else profile end,
    einv_alias = case when p ? 'alias' then nullif(left(p->>'alias', 200), '') else einv_alias end,
    einv_draft = case when p ? 'draft' then (p->>'draft')::boolean else einv_draft end,
    ettn = case when coalesce((p->>'new_ettn')::boolean, false) and v.einvoice_status = 'error' then gen_random_uuid() else ettn end,
    einv_ref = case when coalesce((p->>'new_ettn')::boolean, false) and v.einvoice_status = 'error' then null else coalesce(nullif(p->>'ref', '')::bigint, einv_ref) end,
    einv_code = coalesce(nullif(p->>'code', '')::int, einv_code),
    einv_desc = case when p ? 'desc' then nullif(left(p->>'desc', 500), '') else einv_desc end,
    einv_checked_at = now(),
    einvoice_note = case when st = 'cancelled' then left('e-Arşiv iptal edildi ' || to_char(now() at time zone 'Europe/Istanbul', 'DD.MM.YYYY HH24:MI'), 500) else einvoice_note end
  where id = p_id;
  -- eLogo'nun verdiği numara muhasebe kaydına da yazılır
  if v.doc_no is null and nullif(p->>'doc_no', '') ~ '^[A-Z0-9]{3}20[0-9]{11}$' and v.fin_txn_id is not null then
    update fin_txns set doc_no = p->>'doc_no' where id = v.fin_txn_id and doc_no is null;
  end if;
end $$;
revoke execute on function inv_einv_update(uuid, jsonb) from public, anon;
grant execute on function inv_einv_update(uuid, jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function inv_einv_update(uuid, jsonb) to service_role; end if; end $$;

-- Durum takibi bekleyen belgeler (cron)
create or replace function inv_einv_pending(p_limit int default 40) returns table (id uuid, ettn uuid, profile text, einvoice_status text, einv_draft boolean, doc_no text)
language sql stable security definer set search_path = public as $$
  select i.id, i.ettn, i.profile, i.einvoice_status, i.einv_draft, i.doc_no from inv_invoices i
  where (einv_is_service() or can_module('sales', 2)) and i.company_id = lab_company()
    and i.einvoice_status in ('sending', 'draft_sent', 'sent')
    and i.einv_sent_at > now() - interval '30 days'
    and (i.einvoice_status <> 'sent' or coalesce(i.einv_code, 0) not in (1300))
  order by i.einv_checked_at nulls first limit greatest(1, least(p_limit, 200))
$$;
revoke execute on function inv_einv_pending(int) from public, anon;
grant execute on function inv_einv_pending(int) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function inv_einv_pending(int) to service_role; end if; end $$;

-- Cari GİB bilgisi
create or replace function fin_party_gib_set(p_party uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (einv_is_service() or can_module('sales', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  update fin_parties set
    is_einvoice = coalesce((p->>'is_einvoice')::boolean, is_einvoice),
    einv_alias = case when p ? 'einv_alias' then nullif(left(p->>'einv_alias', 200), '') else einv_alias end,
    is_edespatch = coalesce((p->>'is_edespatch')::boolean, is_edespatch),
    edsp_alias = case when p ? 'edsp_alias' then nullif(left(p->>'edsp_alias', 200), '') else edsp_alias end,
    foreign_tax_id = case when p ? 'foreign_tax_id' then nullif(left(trim(p->>'foreign_tax_id'), 40), '') else foreign_tax_id end,
    gib_checked_at = case when p ? 'is_einvoice' then now() else gib_checked_at end
  where id = p_party and company_id = lab_company();
end $$;
revoke execute on function fin_party_gib_set(uuid, jsonb) from public, anon;
grant execute on function fin_party_gib_set(uuid, jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function fin_party_gib_set(uuid, jsonb) to service_role; end if; end $$;

-- Şirket e-belge ayarları
create or replace function einv_company_settings(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_module('sales', 3) then raise exception 'not_allowed'; end if;
  update companies set
    einv_numbering = coalesce(nullif(p->>'numbering', ''), einv_numbering),
    einv_draft = coalesce((p->>'draft')::boolean, einv_draft),
    einv_xslt_efatura = case when p ? 'xslt_efatura' then nullif(trim(p->>'xslt_efatura'), '') else einv_xslt_efatura end,
    einv_xslt_earsiv = case when p ? 'xslt_earsiv' then nullif(trim(p->>'xslt_earsiv'), '') else einv_xslt_earsiv end,
    einv_xslt_irsaliye = case when p ? 'xslt_irsaliye' then nullif(trim(p->>'xslt_irsaliye'), '') else einv_xslt_irsaliye end,
    inv_prefix_irsaliye = coalesce(nullif(upper(trim(p->>'prefix_irsaliye')), ''), inv_prefix_irsaliye),
    einv_iban = case when p ? 'iban' then nullif(upper(replace(p->>'iban', ' ', '')), '') else einv_iban end,
    einv_web = case when p ? 'web' then nullif(left(trim(p->>'web'), 200), '') else einv_web end
  where id = lab_company();
end $$;
revoke execute on function einv_company_settings(jsonb) from public, anon;
grant execute on function einv_company_settings(jsonb) to authenticated;

-- =====================================================================
-- e-İrsaliye (giden): laboratuvar irsaliyesinden, satış faturasından ya da elle
-- =====================================================================
create table if not exists edsp_despatches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies (id) on delete cascade default lab_company(),
  no bigint generated by default as identity,
  doc_no text check (doc_no is null or doc_no ~ '^[A-Z0-9]{3}20[0-9]{11}$'),
  ettn uuid not null default gen_random_uuid(),
  type_code text not null default 'SEVK' check (type_code in ('SEVK', 'MATBUDAN')),
  status text not null default 'draft' check (status in ('draft', 'cancelled')),
  party_id uuid references fin_parties (id) on delete restrict,
  party_name text not null check (length(party_name) between 1 and 200),
  party_tax_no text check (party_tax_no is null or party_tax_no ~ '^[0-9]{10,11}$'),
  party_tax_office text, party_address text, party_district text, party_city text, party_country text default 'TR', party_email text,
  issue_date date not null default (now() at time zone 'Europe/Istanbul')::date,
  issue_time time not null default (now() at time zone 'Europe/Istanbul')::time(0),
  ship_date date not null default (now() at time zone 'Europe/Istanbul')::date,
  ship_time time not null default (now() at time zone 'Europe/Istanbul')::time(0),
  delivery_address text check (delivery_address is null or length(delivery_address) <= 300),
  plate text check (plate is null or length(plate) <= 20),
  trailer_plate text check (trailer_plate is null or length(trailer_plate) <= 20),
  driver_name text check (driver_name is null or length(driver_name) <= 120),
  driver_tckn text check (driver_tckn is null or driver_tckn ~ '^[0-9]{11}$'),
  carrier_name text check (carrier_name is null or length(carrier_name) <= 200),
  carrier_tax_no text check (carrier_tax_no is null or carrier_tax_no ~ '^[0-9]{10,11}$'),
  matbu_no text check (matbu_no is null or length(matbu_no) <= 40),
  matbu_date date,
  order_no text check (order_no is null or length(order_no) <= 40),
  order_date date,
  note text check (note is null or length(note) <= 500),
  waybill_id uuid references lab_waybills (id) on delete set null,
  invoice_id uuid references inv_invoices (id) on delete set null,
  einv_status text not null default 'none' check (einv_status in ('none', 'sending', 'draft_sent', 'sent', 'accepted', 'rejected', 'error', 'cancelled')),
  einv_alias text, einv_draft boolean, einv_sent_at timestamptz, einv_sent_by uuid, einv_ref bigint, einv_code int,
  einv_desc text check (einv_desc is null or length(einv_desc) <= 500), einv_checked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists edsp_list_idx on edsp_despatches (company_id, issue_date desc, no desc);
create unique index if not exists edsp_doc_uidx on edsp_despatches (company_id, doc_no) where doc_no is not null;
create table if not exists edsp_lines (
  id uuid primary key default gen_random_uuid(),
  despatch_id uuid not null references edsp_despatches (id) on delete cascade,
  sort int not null default 0,
  name text not null check (length(name) between 1 and 300),
  qty numeric(14, 3) not null check (qty > 0),
  unit text not null default 'adet' check (length(unit) <= 20),
  seller_code text check (seller_code is null or length(seller_code) <= 60),
  unit_price numeric(18, 4),
  currency text
);
create index if not exists edsp_lines_idx on edsp_lines (despatch_id, sort);
alter table edsp_despatches enable row level security;
alter table edsp_lines enable row level security;
drop policy if exists edsp_read on edsp_despatches;
create policy edsp_read on edsp_despatches for select to authenticated using (company_id = lab_company() and (can_module('sales') or can_logistics()));
drop policy if exists edsp_lines_read on edsp_lines;
create policy edsp_lines_read on edsp_lines for select to authenticated using (exists (select 1 from edsp_despatches d where d.id = despatch_id and d.company_id = lab_company() and (can_module('sales') or can_logistics())));
grant select on edsp_despatches, edsp_lines to authenticated;
revoke insert, update, delete on edsp_despatches, edsp_lines from authenticated;

create or replace function edsp_can() returns boolean language sql stable security definer set search_path = public as $$ select can_module('sales', 2) or can_logistics() $$;

-- Kaydet (yeni ya da gönderilmemiş): başlık + satırlar
create or replace function edsp_save(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id', '')::uuid; v edsp_despatches; pt fin_parties; l jsonb; i int := 0;
begin
  if not edsp_can() then raise exception 'not_allowed'; end if;
  if v_id is not null then
    select * into v from edsp_despatches where id = v_id and company_id = lab_company() for update;
    if v.id is null then raise exception 'not_found'; end if;
    if v.status <> 'draft' or v.einv_status not in ('none', 'error') then raise exception 'einv_locked'; end if;
  end if;
  if nullif(p->>'party_id', '') is not null then select * into pt from fin_parties where id = (p->>'party_id')::uuid and company_id = lab_company(); end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'lines_required'; end if;
  if v_id is null then
    insert into edsp_despatches (party_id, party_name) values (pt.id, coalesce(pt.name, nullif(trim(p->>'party_name'), ''), 'Alıcı')) returning id into v_id;
  end if;
  update edsp_despatches set
    party_id = coalesce(pt.id, party_id),
    party_name = coalesce(nullif(left(trim(p->>'party_name'), 200), ''), pt.name, party_name),
    party_tax_no = coalesce(nullif(regexp_replace(coalesce(p->>'party_tax_no', ''), '\D', '', 'g'), ''), pt.tax_no),
    party_tax_office = coalesce(nullif(trim(p->>'party_tax_office'), ''), pt.tax_office),
    party_address = coalesce(nullif(trim(p->>'party_address'), ''), pt.address),
    party_district = coalesce(nullif(trim(p->>'party_district'), ''), pt.district),
    party_city = coalesce(nullif(trim(p->>'party_city'), ''), pt.city),
    party_country = coalesce(nullif(trim(p->>'party_country'), ''), pt.country, 'TR'),
    party_email = coalesce(nullif(trim(p->>'party_email'), ''), pt.email),
    type_code = case when p->>'type_code' = 'MATBUDAN' then 'MATBUDAN' else 'SEVK' end,
    issue_date = coalesce(nullif(p->>'issue_date', '')::date, issue_date),
    issue_time = coalesce(nullif(p->>'issue_time', '')::time, issue_time),
    ship_date = coalesce(nullif(p->>'ship_date', '')::date, ship_date),
    ship_time = coalesce(nullif(p->>'ship_time', '')::time, ship_time),
    delivery_address = nullif(left(trim(coalesce(p->>'delivery_address', '')), 300), ''),
    plate = nullif(upper(replace(coalesce(p->>'plate', ''), ' ', '')), ''),
    trailer_plate = nullif(upper(replace(coalesce(p->>'trailer_plate', ''), ' ', '')), ''),
    driver_name = nullif(left(trim(coalesce(p->>'driver_name', '')), 120), ''),
    driver_tckn = nullif(regexp_replace(coalesce(p->>'driver_tckn', ''), '\D', '', 'g'), ''),
    carrier_name = nullif(left(trim(coalesce(p->>'carrier_name', '')), 200), ''),
    carrier_tax_no = nullif(regexp_replace(coalesce(p->>'carrier_tax_no', ''), '\D', '', 'g'), ''),
    matbu_no = nullif(left(trim(coalesce(p->>'matbu_no', '')), 40), ''),
    matbu_date = nullif(p->>'matbu_date', '')::date,
    order_no = nullif(left(trim(coalesce(p->>'order_no', '')), 40), ''),
    order_date = nullif(p->>'order_date', '')::date,
    note = nullif(left(trim(coalesce(p->>'note', '')), 500), ''),
    waybill_id = coalesce(nullif(p->>'waybill_id', '')::uuid, waybill_id),
    invoice_id = coalesce(nullif(p->>'invoice_id', '')::uuid, invoice_id),
    updated_at = now()
  where id = v_id;
  delete from edsp_lines where despatch_id = v_id;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce(nullif(l->>'qty', '')::numeric, 0) <= 0 or nullif(trim(l->>'name'), '') is null then continue; end if;
    i := i + 1;
    insert into edsp_lines (despatch_id, sort, name, qty, unit, seller_code, unit_price, currency)
    values (v_id, i, left(trim(l->>'name'), 300), (l->>'qty')::numeric, left(coalesce(nullif(l->>'unit', ''), 'adet'), 20), nullif(left(l->>'seller_code', 60), ''),
            nullif(l->>'unit_price', '')::numeric, nullif(l->>'currency', ''));
  end loop;
  if i = 0 then raise exception 'lines_required'; end if;
  return v_id;
end $$;
revoke execute on function edsp_save(jsonb) from public, anon;
grant execute on function edsp_save(jsonb) to authenticated;

create or replace function edsp_delete(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not edsp_can() then raise exception 'not_allowed'; end if;
  delete from edsp_despatches where id = p_id and company_id = lab_company() and einv_status in ('none', 'error') and doc_no is null;
  if not found then
    update edsp_despatches set status = 'cancelled' where id = p_id and company_id = lab_company() and einv_status in ('none', 'error', 'cancelled');
    if not found then raise exception 'einv_locked'; end if;
  end if;
end $$;
revoke execute on function edsp_delete(uuid) from public, anon;
grant execute on function edsp_delete(uuid) to authenticated;

-- Gönderime başla: kilit + numara (ERP numaralamasında)
create or replace function edsp_begin(p_id uuid, p_number boolean default true) returns edsp_despatches
language plpgsql security definer set search_path = public as $$
declare v edsp_despatches; co companies;
begin
  if not edsp_can() then raise exception 'not_allowed'; end if;
  select * into v from edsp_despatches where id = p_id and company_id = lab_company() for update;
  if v.id is null then raise exception 'not_found'; end if;
  if v.status <> 'draft' or v.einv_status not in ('none', 'error') then raise exception 'einv_already'; end if;
  select * into co from companies where id = v.company_id;
  if v.doc_no is null and p_number then
    v.doc_no := inv_next_no(co.inv_prefix_irsaliye, extract(year from v.issue_date)::int);
  end if;
  update edsp_despatches set doc_no = v.doc_no, einv_status = 'sending', einv_sent_at = now(), einv_sent_by = auth.uid(), einv_desc = null where id = p_id returning * into v;
  return v;
end $$;
revoke execute on function edsp_begin(uuid, boolean) from public, anon;
grant execute on function edsp_begin(uuid, boolean) to authenticated;

create or replace function edsp_update(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v edsp_despatches; st text := nullif(p->>'status', '');
begin
  select * into v from edsp_despatches where id = p_id for update;
  if v.id is null then raise exception 'not_found'; end if;
  if not (einv_is_service() or edsp_can()) then raise exception 'not_allowed'; end if;
  if st is not null and st not in ('sending', 'draft_sent', 'sent', 'accepted', 'rejected', 'error', 'cancelled') then raise exception 'bad_status'; end if;
  update edsp_despatches set
    einv_status = coalesce(st, einv_status),
    doc_no = case when nullif(p->>'doc_no', '') ~ '^[A-Z0-9]{3}20[0-9]{11}$' and doc_no is null then p->>'doc_no' else doc_no end,
    ettn = case when coalesce((p->>'new_ettn')::boolean, false) and v.einv_status = 'error' then gen_random_uuid() else ettn end,
    einv_alias = case when p ? 'alias' then nullif(left(p->>'alias', 200), '') else einv_alias end,
    einv_draft = case when p ? 'draft' then (p->>'draft')::boolean else einv_draft end,
    einv_ref = case when coalesce((p->>'new_ettn')::boolean, false) and v.einv_status = 'error' then null else coalesce(nullif(p->>'ref', '')::bigint, einv_ref) end,
    einv_code = coalesce(nullif(p->>'code', '')::int, einv_code),
    einv_desc = case when p ? 'desc' then nullif(left(p->>'desc', 500), '') else einv_desc end,
    einv_checked_at = now()
  where id = p_id;
end $$;
revoke execute on function edsp_update(uuid, jsonb) from public, anon;
grant execute on function edsp_update(uuid, jsonb) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function edsp_update(uuid, jsonb) to service_role; end if; end $$;

create or replace function edsp_pending(p_limit int default 40) returns table (id uuid, ettn uuid, einv_status text, doc_no text)
language sql stable security definer set search_path = public as $$
  select d.id, d.ettn, d.einv_status, d.doc_no from edsp_despatches d
  where (einv_is_service() or edsp_can()) and d.company_id = lab_company()
    and d.einv_status in ('sending', 'draft_sent', 'sent') and d.einv_sent_at > now() - interval '30 days'
    and (d.einv_status <> 'sent' or coalesce(d.einv_code, 0) <> 1300)
  order by d.einv_checked_at nulls first limit greatest(1, least(p_limit, 200))
$$;
revoke execute on function edsp_pending(int) from public, anon;
grant execute on function edsp_pending(int) to authenticated;
do $$ begin if exists (select 1 from pg_roles where rolname = 'service_role') then grant execute on function edsp_pending(int) to service_role; end if; end $$;
