-- =====================================================================
-- REÇETE SİHİRBAZI: TÜM ÜRÜNLER
--  * Pasif ürünler de reçete alır (yalnız aktifler yapılıyordu)
--  * Kural kelimeleri genişletildi (Türkçe, Fransızca, İngilizce, Almanca)
--  * Kuralın ve yapay zekânın eşleştiremediği ürünlere malzeme / birim bilgisinden tahmini şablon (kaynak: tahmin)
--  * prd_recipe_status(): eksik sebepleri (ekranda gösterilir)
-- Tekrar çalıştırılabilir. 20270251000000_recipe_templates.sql'den sonra çalıştırın.
-- =====================================================================

alter table prd_recipe_plan drop constraint if exists prd_recipe_plan_source_check;
alter table prd_recipe_plan add constraint prd_recipe_plan_source_check check (source in ('kural', 'ai', 'elle', 'tahmin'));

create or replace function prd_recipe_guess(p_name text) returns text language plpgsql immutable as $$
declare t text := ' ' || prd_norm(p_name) || ' ';
begin
  if t ~ '(wax.?up|cire diagnost|diagnostik mum|teshis mum|diagnostic wax|mock.?up)' then return 'wax_up'; end if;
  if t ~ '(stellite|chassis|squelet|iskelet|skelet|modellguss|framework|cr.?co.{0,12}(partiel|parsiyel|protez))' and t ~ '(montage|dizim|finition|bitim|dents?|dis |akrilik|resine|teeth|zahn|aufstell)' then return 'iskelet_dizim'; end if;
  if t ~ '(stellite|chassis|squelet|iskelet|skelet|modellguss|framework|cr.?co.{0,12}(partiel|parsiyel|protez)|hassas tutucu|attachment|barre|bar )' then return 'iskelet'; end if;
  if t ~ '(porte.?empreinte|\mpei\M|kasik|individuel|custom tray|loffel|special tray)' then return 'kasik'; end if;
  if t ~ '(bourrelet|maquette d.?occlusion|cire d.?occlusion|kapanis|mum duvar|olcu kaidesi|bite rim|bisswall|wax rim|occlusion rim|kayit)' then return 'kapanis'; end if;
  if t ~ '(cire|essayage|mum prova|\mprova\M|try.?in|wachs|wax)' then return 'mum_prova'; end if;
  if t ~ '(adjonction|ajout|dis ekleme|krose ekleme|ekleme|add tooth|add clasp|erweiterung)' then return 'dis_ekleme'; end if;
  if t ~ '(repar|tamir|rebasage|rebase|reline|kaide yenileme|besleme|soudure|fractur|kirik|refection|unterfutter|astar|onarim|lehim)' then return 'tamir'; end if;
  if t ~ '(disjoncteur|expansion|verin|\mvis\M|genisletme|quad.?helix|hyrax|rpe )' and t !~ '(implant|transvis|visse)' then return 'ortodonti_vida'; end if;
  if t ~ '(ortho|hawley|activateur|aktivator|mainteneur|yer tutucu|aparey|twin.?block|plaque amovible|appareil amovible|space maint|bionator|frankel|monoblok|monobloc)' then return 'ortodonti'; end if;
  if t ~ '(blanchiment|beyazlatma|contention|essix|retainer|pekistirme|souple|yumusak|protege.?dent|sporcu|bleaching|whitening|mouth.?guard|tiefzieh|seffaf plak)' then return 'plak_yumusak'; end if;
  if t ~ '(goutti|splint|\mplak\M|plaque|bruxis|bruksizm|occlusal|night.?guard|gece|michigan|schiene|aufbiss|\mnti\M)' then return 'plak_sert'; end if;
  if t ~ '(implant|pilier|abutment|transvis|vissee|visse|ti.?base|implant ustu|locator|multi.?unit|sur implant)' then return 'implant'; end if;
  if t ~ '(inlay.?core|faux.?moignon|pivot|tenon|post.?core|\mkor\M|dowel|kanal ici|stiftaufbau|stift|core build)' then return 'postcore'; end if;
  if t ~ '(provisoire|temporaire|gecici|\mpmma\M|\mtemp|provisori|langzeitprov)' and t !~ '(partiel|parsiyel|protez|prothese|complet|denture|stellite|iskelet)' then return 'gecici'; end if;
  if t ~ '(facette|veneer|lamin|laminat)' then return 'lamine'; end if;
  if t ~ '(e.?max|disilicat|lityum|lithium)' and t ~ '(cad|bloc|blok|frez)' then return 'emax_cad'; end if;
  if t ~ '(e.?max|disilicat|lityum|lithium|empress|pressee|pres seramik|ceramique press|presskeramik|tam seramik|all.?ceram|vollkeram|full ceram|cosmetic)' then return 'emax_press'; end if;
  if t ~ '(composite|kompozit|gradia|ceramage|sinfony|signum)' then return 'kompozit'; end if;
  if t ~ '(zirc|zirk)' and t ~ '(ceram|porsel|strati|layer|cut.?back|cosmet|tabakal|verblend)' then return 'zirkon_por'; end if;
  if t ~ '(zirc|zirk|monolit|full contour|\mzr\M|prettau|katana|bruxzir)' then return 'zirkon'; end if;
  if t ~ '(complet|\mtotal|tam protez|total protez|prothese complete|full denture|immediat|totalprothese|vollprothese|complete denture)' then return 'tam_protez'; end if;
  if t ~ '(partiel|partial|parsiyel|flexible|flexi|valplast|esnek|resine|akrilik|acryl|kunststoff|denture|protez|prothese|teilprothese|kroset|krose|crochet)' then return 'parsiyel'; end if;
  if t ~ '(inlay|onlay|inley|onley|overlay)' then return 'emax_press'; end if;
  if t ~ '(coulee|tout metal|full metal|metal kron|metal crown|couronne metal|dokum kron|tam metal|vollguss|gusskrone|altin|\mor\M|gold)' and t !~ '(ceram|porsel)' then return 'metal_kron'; end if;
  if t ~ '(ceram|porsel|\mccm\M|\mvmk\M|metal.?ceram|metal destekli|\mpfm\M|noritake|\mmk\M|vita|verblend)' then return 'pfm'; end if;
  if t ~ '(couronne|\mkron|krone|crown|bridge|brucke|kopru|element|\munite|\muye\M|dent sur|pontic|gövde|govde|ara uye|dayanak)' then return 'pfm'; end if;
  if t ~ '(\m3d\M|imprim|baski|print|druck)' then return 'model_3d'; end if;
  if t ~ '(modele|\mmodel|etude|antagon|alci|platre|gips|study|sockel|mounting|artikulat)' then return 'model'; end if;
  if t ~ '(retouche|rotus|transport|livraison|frais|\mport\M|kargo|kurye|remise|indirim|divers|teinte|renk|photo|foto|refait|refaire|yeniden|garanti|forfait|supplement|urgence|acil|scan|tarama|design|tasarim|teslim|ucret|fee|delivery|shipping|versand|discount|iskonto|hizmet|servis|danisma|konsult|depozito|avans|nakliye|posta|ekstra|fark)' then return 'hizmet'; end if;
  return null;
end $$;

-- Kural ve yapay zekâ eşleştiremezse: malzeme alanı + birim tipine göre tahmin
create or replace function prd_recipe_fallback(p_material text, p_per_unit boolean) returns text language plpgsql immutable as $$
declare m text := ' ' || prd_norm(p_material) || ' ';
begin
  if m ~ '(zirc|zirk)' then return 'zirkon'; end if;
  if m ~ '(e.?max|disilicat|lityum|lithium|press)' then return 'emax_press'; end if;
  if m ~ '(porsel|ceram|seramik)' then return 'pfm'; end if;
  if m ~ '(metal|cr.?co|dokum)' then return 'metal_kron'; end if;
  if m ~ '(akril|acryl|resin|protez)' then return 'parsiyel'; end if;
  if m ~ '(kompozit|composite)' then return 'kompozit'; end if;
  if m ~ '(pmma|gecici)' then return 'gecici'; end if;
  if coalesce(p_per_unit, true) then return 'pfm'; end if;       -- diş başına fiyatlanan, bilinmeyen: en yaygın sabit iş
  return 'hizmet';                                                -- iş başına, bilinmeyen: malzemesiz kabul (listeden değiştirilebilir)
end $$;

create or replace function prd_recipe_refresh() returns jsonb
language plpgsql security definer set search_path = public as $$
declare n_new int; n_upd int;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  insert into prd_recipe_plan (product_id, company_id, tpl, source)
  select p.id, coalesce(p.company_id, lab_company()), prd_recipe_guess(p.name || ' ' || coalesce(p.name_tr, '') || ' ' || coalesce(p.material, '')), 'kural'
    from lab_products p
   where (p.company_id = lab_company() or p.company_id is null)
     and not exists (select 1 from prd_recipe_plan x where x.product_id = p.id)
  on conflict (product_id) do nothing;
  get diagnostics n_new = row_count;
  -- kural kaynaklı (ve kuralın boş bıraktığı tahminler) yeni kurallarla yeniden değerlendirilir
  update prd_recipe_plan x set tpl = g.tpl, source = 'kural', updated_at = now()
    from (select p.id, prd_recipe_guess(p.name || ' ' || coalesce(p.name_tr, '') || ' ' || coalesce(p.material, '')) tpl from lab_products p) g
   where g.id = x.product_id and g.tpl is not null and (x.source = 'kural' or x.source = 'tahmin') and x.tpl is distinct from g.tpl;
  get diagnostics n_upd = row_count;
  return jsonb_build_object('new', n_new, 'updated', n_upd);
end $$;

-- Tüm ürünler (pasifler dahil). p_fallback: eşleşmeyenlere tahmini şablon ver.
drop function if exists prd_recipe_apply_all(boolean);
create or replace function prd_recipe_apply_all(p_force boolean default false, p_fallback boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n_app int := 0; n_skip int := 0; n_none int := 0; n_svc int := 0; n_guess int := 0;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  perform prd_recipe_refresh();
  if p_fallback then
    update prd_recipe_plan x set tpl = prd_recipe_fallback(p.material, p.per_unit), source = 'tahmin', updated_at = now()
      from lab_products p
     where p.id = x.product_id and x.company_id = lab_company() and x.tpl is null
       and not exists (select 1 from stk_boms b where b.lab_product_id = x.product_id and x.applied_tpl is null);
    get diagnostics n_guess = row_count;
  end if;
  for r in
    select x.product_id, x.tpl, x.applied_tpl,
           exists (select 1 from stk_boms b where b.lab_product_id = x.product_id) or exists (select 1 from prd_route_steps s where s.lab_product_id = x.product_id) as has_recipe
      from prd_recipe_plan x
     where x.company_id = lab_company()
  loop
    if r.tpl is null then n_none := n_none + 1; continue; end if;
    if r.has_recipe and r.applied_tpl is null then n_skip := n_skip + 1; continue; end if;
    if r.applied_tpl is not null and r.applied_tpl = r.tpl and not p_force then continue; end if;
    perform prd_recipe_apply_core(r.product_id, case when r.tpl = 'hizmet' then null else r.tpl end);
    if r.tpl = 'hizmet' then n_svc := n_svc + 1; else n_app := n_app + 1; end if;
  end loop;
  return jsonb_build_object('applied', n_app, 'service', n_svc, 'kept_manual', n_skip, 'unmatched', n_none, 'guessed', n_guess);
end $$;
revoke execute on function prd_recipe_apply_all(boolean, boolean) from public, anon;
grant execute on function prd_recipe_apply_all(boolean, boolean) to authenticated;

-- Yapay zekâ eşleştirmesi: tahmin ve kural kaynaklıları da günceller, elle seçilenlere dokunmaz
create or replace function prd_recipe_set_bulk(p jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare e jsonb; n int := 0;
begin
  if not prd_recipe_can_edit() then raise exception 'not_allowed'; end if;
  for e in select * from jsonb_array_elements(coalesce(p, '[]')) loop
    if (e->>'tpl') is null or not exists (select 1 from prd_tpl where key = e->>'tpl') then continue; end if;
    insert into prd_recipe_plan (product_id, company_id, tpl, source)
    select l.id, lab_company(), e->>'tpl', 'ai' from lab_products l where l.id = (e->>'id')::uuid and (l.company_id = lab_company() or l.company_id is null)
    on conflict (product_id) do update set tpl = excluded.tpl, source = 'ai', updated_at = now() where prd_recipe_plan.source <> 'elle';
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;

-- Hemen uygula: yeni kurallar + pasifler + tahmin
select prd_recipe_apply_all(false, true);

notify pgrst, 'reload schema';
