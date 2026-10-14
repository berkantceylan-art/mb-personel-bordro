-- Randevusuz ziyaretçi (kapıda kayıt): ziyaretçi kapıdaki QR afişi okutur → telefondan bilgilerini girer →
-- görüşeceği kişi ya da güvenlik onaylar → telefonundaki sayfada QR çıkar → güvenlik okutup içeri alır.
-- Ziyaretçi türü (tedarikçi / müşteri / hekim / diğer) randevu ve kapı kayıtlarında tutulur. Tekrar çalıştırılabilir.

alter table vis_visits add column if not exists visitor_type text check (visitor_type is null or visitor_type in ('supplier', 'customer', 'doctor', 'other'));
create index if not exists vis_visits_walkin_idx on vis_visits (company_id, created_at desc) where source = 'walkin';

-- Kapıda kayıt (giriş gerektirmez)
--  p: { host_id?, visitor_name, visitor_company, phone, purpose, count, visitor_type, plate, kvkk }
create or replace function vis_walkin(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare h vis_hosts; v vis_visits; v_phone text := regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'); v_year int := extract(year from now())::int; c uuid := lab_company(); v_to uuid[];
begin
  if nullif(p->>'host_id', '') is not null then
    select * into h from vis_hosts where id = (p->>'host_id')::uuid and company_id = c and is_active;
  end if;
  if length(trim(coalesce(p->>'visitor_name', ''))) < 2 then raise exception 'name_required'; end if;
  if length(v_phone) < 10 then raise exception 'phone_required'; end if;
  if coalesce((p->>'kvkk')::boolean, false) is not true then raise exception 'kvkk_required'; end if;
  if (select count(*) from vis_visits where source = 'walkin' and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone and created_at > now() - interval '1 day') >= 4 then raise exception 'too_many'; end if;
  if (select count(*) from vis_visits where source = 'walkin' and created_at > now() - interval '1 hour') >= 40 then raise exception 'too_many'; end if;
  -- aynı telefonla bekleyen kapı kaydı varsa onu döndür (sayfa yenilenirse çift kayıt olmasın)
  select * into v from vis_visits where source = 'walkin' and status = 'requested' and regexp_replace(coalesce(phone, ''), '\D', '', 'g') = v_phone and created_at > now() - interval '2 hours' order by created_at desc limit 1;
  if v.id is not null then return jsonb_build_object('token', v.token, 'no', vis_no(v)); end if;

  insert into vis_visits (company_id, year, no, visitor_name, visitor_company, phone, purpose, plate, host_user, host_target, expected_at, status, source, requested_at, kvkk_ok, visitor_count, visitor_type, created_by)
  values (c, v_year, lab_next_no('zy', v_year), left(trim(p->>'visitor_name'), 120), nullif(left(trim(coalesce(p->>'visitor_company', '')), 120), ''), left(trim(p->>'phone'), 40),
          nullif(left(trim(coalesce(p->>'purpose', '')), 200), ''), nullif(upper(left(trim(coalesce(p->>'plate', '')), 20)), ''),
          case when h.id is not null then h.approver_ids[1] end, h.id, now(), 'requested', 'walkin', now(), true,
          least(greatest(coalesce(nullif(p->>'count', '')::int, 1), 1), 20),
          case when p->>'visitor_type' in ('supplier', 'customer', 'doctor', 'other') then p->>'visitor_type' end, null)
  returning * into v;
  v_to := array(select distinct x from unnest(coalesce(h.approver_ids, '{}') || array(select g.user_id from vis_guards g where g.company_id = c and g.is_active)) x);
  if cardinality(v_to) = 0 then
    v_to := array(select m.user_id from memberships m where m.company_id = c and m.role in ('owner', 'hr'));
  end if;
  perform deliver(c, v_to, '🚪 Kapıda randevusuz ziyaretçi',
    v.visitor_name || coalesce(' · ' || v.visitor_company, '') || coalesce(' · ' || h.label, '') || coalesce(' · ' || v.purpose, '') || ' — onay bekliyor', '/guvenlik');
  return jsonb_build_object('token', v.token, 'no', vis_no(v));
end $$;
revoke execute on function vis_walkin(jsonb) from public;
grant execute on function vis_walkin(jsonb) to anon, authenticated;

-- Onay: kapı kaydını güvenlik görevlisi de onaylayabilir (saat = şimdi)
create or replace function vis_decide(p_id uuid, p_ok boolean, p_at timestamptz default null, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v vis_visits;
begin
  select * into v from vis_visits where id = p_id and company_id = lab_company() for update;
  if v.id is null then raise exception 'visit_not_found'; end if;
  if not (vis_is_admin() or v.host_user = auth.uid() or exists (select 1 from vis_hosts h where h.id = v.host_target and auth.uid() = any (h.approver_ids))
          or (v.source = 'walkin' and vis_is_guard())) then raise exception 'not_allowed'; end if;
  if v.status <> 'requested' then raise exception 'bad_status'; end if;
  if p_ok then
    update vis_visits set status = 'expected',
      expected_at = case when v.source = 'walkin' then now() else coalesce(p_at, expected_at) end,
      host_user = case when v.source = 'walkin' and v.host_user is not null then v.host_user else auth.uid() end,
      decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
    perform deliver(v.company_id, array(select g.user_id from vis_guards g where g.company_id = v.company_id and g.is_active and g.user_id <> auth.uid()),
      case when v.source = 'walkin' then 'Onaylandı, içeri alınabilir · ' else 'Beklenen ziyaretçi · ' end || v.visitor_name,
      coalesce(to_char(v.expected_at at time zone 'Europe/Istanbul', 'DD.MM HH24:MI') || ' · ', '') || coalesce(req_user_name(v.host_user), ''), '/guvenlik');
  else
    if length(trim(coalesce(p_reason, ''))) < 2 then raise exception 'reason_required'; end if;
    update vis_visits set status = 'rejected', reject_reason = left(trim(p_reason), 300), decided_by = auth.uid(), decided_at = now() where id = p_id returning * into v;
  end if;
  return jsonb_build_object('token', v.token, 'no', vis_no(v), 'phone', v.phone, 'email', v.visitor_email, 'name', v.visitor_name, 'status', v.status,
                            'expected_at', v.expected_at, 'host', req_user_name(v.host_user), 'reason', v.reject_reason, 'source', v.source);
end $$;
revoke execute on function vis_decide(uuid, boolean, timestamptz, text) from public, anon;
grant execute on function vis_decide(uuid, boolean, timestamptz, text) to authenticated;

-- Takip sayfası: kaynak (kapı / site) bilgisi de döner
create or replace function vis_public(p_token text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('name', v.visitor_name, 'company', c.name, 'host', coalesce(
            (select nullif(m.display_name, '') from memberships m where m.user_id = v.host_user and m.company_id = v.company_id limit 1),
            (select e.first_name || ' ' || e.last_name from employees e where e.user_id = v.host_user and e.company_id = v.company_id limit 1)),
         'target', (select label from vis_hosts h where h.id = v.host_target),
         'expected_at', v.expected_at, 'status', v.status, 'no', vis_no(v), 'purpose', v.purpose, 'reason', v.reject_reason, 'source', v.source,
         'address', concat_ws(', ', c.address, c.district, c.city), 'phone', c.phone)
  from vis_visits v join companies c on c.id = v.company_id
  where p_token ~ '^[0-9a-f]{24}$' and v.token = p_token and v.status <> 'cancelled';
$$;
revoke execute on function vis_public(text) from public;
grant execute on function vis_public(text) to anon, authenticated;

-- Site randevusunda ziyaretçi türü (isteğe bağlı) — vis_request sonrası güncellenir
create or replace function vis_set_type(p_token text, p_type text) returns void
language sql security definer set search_path = public as $$
  update vis_visits set visitor_type = p_type
  where p_token ~ '^[0-9a-f]{24}$' and token = p_token and visitor_type is null and p_type in ('supplier', 'customer', 'doctor', 'other') and created_at > now() - interval '10 minutes';
$$;
revoke execute on function vis_set_type(text, text) from public;
grant execute on function vis_set_type(text, text) to anon, authenticated;

notify pgrst, 'reload schema';
