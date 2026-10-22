-- "Müşteri ve kalite sorumlusu" kullanıcı türü (Cansu Bilgin, Dilan Özgür)
--  * Kalite kontrol: işleri okutur, son kontrol onayı / geri gönderme (akış rolü: kontrol sorumlusu)
--  * Paketleme: kontrol sorumlusu da paketleyebilir (önceden yalnız "pazarlama / çıkış" rolü)
--  * İş kayıt, hekim kartları, fiyat listeleri, pazarlama (CRM), cariler: laboratuvar modülü tam
--  * Müşteri ciroları ve alacaklar: ciro görme izni + finans ve satış görüntüleme
--  * Teknisyenlere bilgi mesajı: Mesajlar ekranından (her kullanıcı açık)
-- Tekrar çalıştırılabilir. Kişinin ERP kullanıcı hesabı yoksa türü sonra Yönetim › Kullanıcılar'dan atanır.

-- 1) Paketleme kontrol sorumlusuna da açık
do $$ declare d text; begin
  select pg_get_functiondef('prd_pack_scan(text, uuid, uuid)'::regprocedure) into d;
  if position($x$coalesce(v_role, '') not in ('dispatch', 'qc')$x$ in d) = 0 then
    if position($x$coalesce(v_role, '') <> 'dispatch'$x$ in d) = 0 then raise exception 'prd_pack_scan yaması uygulanamadı'; end if;
    execute replace(d, $x$coalesce(v_role, '') <> 'dispatch'$x$, $x$coalesce(v_role, '') not in ('dispatch', 'qc')$x$);
  end if;
end $$;

-- 2) Tür + 3) kişilere atama
do $$
declare c uuid := lab_company(); v_type uuid; r record; v_user uuid; n text;
  v_levels jsonb := '{"lab": 3, "production": 2, "sales": 1, "finance": 1}'::jsonb;
begin
  insert into user_types (company_id, name, description, color, levels, scoped, site_access, boss, flow_role, sort)
  values (c, 'Müşteri ve kalite sorumlusu',
          'İş kayıt, kalite kontrol (okutma, son kontrol), paketleme, hekim kartları, fiyat listeleri, pazarlama, cariler, müşteri ciro ve alacak takibi; teknisyenlere mesaj',
          '#0891B2', user_type_clean(v_levels), false, false, false, 'qc', 40)
  on conflict (company_id, name) do update set description = excluded.description, levels = excluded.levels, flow_role = excluded.flow_role, updated_at = now()
  returning id into v_type;

  foreach n in array array['CANSUBILGIN', 'DILANOZGUR'] loop
    select e.user_id, e.first_name || ' ' || e.last_name as name into r
      from employees e
     where e.company_id = c and dsis_norm(e.first_name || e.last_name) = n
     order by (e.user_id is null), e.created_at limit 1;
    if r.name is null then raise notice '% personel listesinde bulunamadı', n; continue; end if;
    v_user := r.user_id;
    if v_user is null or not exists (select 1 from memberships where user_id = v_user and company_id = c) then
      raise notice '%: ERP kullanıcı hesabı yok (davet gönderip türü sonra atayın)', r.name; continue;
    end if;
    perform user_type_apply_sys(c, v_user, v_type);
    insert into rev_viewers (company_id, user_id) values (c, v_user) on conflict do nothing;
    raise notice '%: tür atandı', r.name;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- Sonuç
select e.first_name || ' ' || e.last_name as personel,
       case when m.user_type_id = t.id then 'Tür atandı' when e.user_id is null then 'ERP kullanıcı hesabı yok: davet edip türü atayın' else 'Atanamadı' end as durum
  from employees e
  left join memberships m on m.user_id = e.user_id and m.company_id = e.company_id
  left join user_types t on t.company_id = e.company_id and t.name = 'Müşteri ve kalite sorumlusu'
 where e.company_id = lab_company() and dsis_norm(e.first_name || e.last_name) in ('CANSUBILGIN', 'DILANOZGUR');
