-- Var olan bir cariyi firmanın fişli carisi olarak bağlama (ör. Deka TL ve Deka Diş Euro → Deka)
--  p_kind 'slip'  : klasik fişli cari (ödemeler yansır, para birimi farklı olabilir; firmada bir tane)
--  p_kind 'nodisc': iskontosuz / ikinci fişli cari (ödemeler yansımaz, kendi ödemesi girilir)
--  sup_unlink_slip: bağı kaldırır (cari bağımsız olur, kayıtları kalır)
-- Tekrar çalıştırılabilir.

create or replace function sup_link_slip(p_main uuid, p_slip uuid, p_kind text default 'slip') returns void
language plpgsql security definer set search_path = public as $$
declare c uuid := lab_company(); m fin_parties; t fin_parties;
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  select * into m from fin_parties where id = p_main and company_id = c;
  select * into t from fin_parties where id = p_slip and company_id = c;
  if m.id is null or t.id is null then raise exception 'not_found'; end if;
  if m.id = t.id then raise exception 'same_party'; end if;
  if m.slip_of is not null then raise exception 'main_is_slip'; end if;
  if exists (select 1 from fin_parties where slip_of = t.id) then raise exception 'slip_has_children'; end if;
  if p_kind = 'nodisc' then
    if exists (select 1 from fin_parties where slip_of = m.id and sub_kind = 'nodisc' and id <> t.id) then raise exception 'nodisc_exists'; end if;
    update fin_parties set slip_of = m.id, sub_kind = 'nodisc' where id = t.id;
  else
    if exists (select 1 from fin_parties where slip_of = m.id and sub_kind is null and id <> t.id) then raise exception 'slip_exists'; end if;
    update fin_parties set slip_of = m.id, sub_kind = null where id = t.id;
  end if;
end $$;

create or replace function sup_unlink_slip(p_slip uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (can_module('finance', 2) or can_module('purchases', 2)) then raise exception 'not_allowed'; end if;
  update fin_parties set slip_of = null, sub_kind = null where id = p_slip and company_id = lab_company() and coalesce(sub_kind, '') <> 'vat';
end $$;

revoke execute on function sup_link_slip(uuid, uuid, text) from public, anon;
revoke execute on function sup_unlink_slip(uuid) from public, anon;
grant execute on function sup_link_slip(uuid, uuid, text) to authenticated;
grant execute on function sup_unlink_slip(uuid) to authenticated;

notify pgrst, 'reload schema';
