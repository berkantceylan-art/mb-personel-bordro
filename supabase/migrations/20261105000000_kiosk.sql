-- Kiosk ekranı: şubedeki son okutmalar ve bugünkü sayılar (yalnız yönetici oturumu)
create or replace function kiosk_feed(p_branch uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare b branches; v_day date := (now() at time zone 'Europe/Istanbul')::date; feed json; v_in int; v_out int; v_inside int;
begin
  select * into b from branches where id = p_branch;
  if b.id is null or not has_role(b.company_id, array['owner', 'hr', 'branch_manager']::app_role[]) then raise exception 'Yetki yok'; end if;
  select coalesce(json_agg(json_build_object('name', e.first_name || ' ' || e.last_name, 'direction', p.direction, 'at', to_char(p.punched_at, 'HH24:MI'), 'source', p.source) order by p.punched_at desc), '[]'::json)
    into feed
  from (select * from attendance_punches where branch_id = b.id and punched_at >= v_day and employee_id is not null order by punched_at desc limit 8) p
  join employees e on e.id = p.employee_id;
  select count(*) filter (where direction = 'IN'), count(*) filter (where direction = 'OUT') into v_in, v_out
  from attendance_punches where branch_id = b.id and punched_at >= v_day;
  -- İçeride: bugünkü son okutması giriş olanlar
  select count(*) into v_inside from (
    select distinct on (employee_id) employee_id, direction from attendance_punches
    where branch_id = b.id and punched_at >= v_day and employee_id is not null order by employee_id, punched_at desc
  ) t where t.direction = 'IN';
  return json_build_object('feed', feed, 'in', v_in, 'out', v_out, 'inside', v_inside, 'day', v_day);
end $$;
