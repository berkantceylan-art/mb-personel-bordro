-- =====================================================================
-- Canlı destek: yapay zekâ asistanı mesajları (sender = 'bot')
-- Asistan cevabı sunucu tarafından, ziyaretçinin gizli anahtarıyla eklenir.
-- Her ziyaretçi mesajına en fazla bir asistan cevabı; ekip cevap verdiyse asistan susar.
-- =====================================================================

alter table cms_chat_messages drop constraint if exists cms_chat_messages_sender_check;
alter table cms_chat_messages add constraint cms_chat_messages_sender_check check (sender in ('visitor', 'staff', 'bot'));

create or replace function cms_chat_after_message() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.sender = 'visitor' then
    update cms_chats set last_message_at = new.created_at, last_visitor_at = new.created_at, status = 'open' where id = new.chat_id;
  elsif new.sender = 'staff' then
    update cms_chats set last_message_at = new.created_at, staff_read_at = new.created_at where id = new.chat_id;
  else
    update cms_chats set last_message_at = new.created_at where id = new.chat_id;
  end if;
  return null;
end $$;

create or replace function chat_bot_reply(p_chat uuid, p_token text, p_body text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_visitor int; v_bot int; v_staff int;
begin
  if not exists (select 1 from cms_chats where id = p_chat and token_hash = cms_chat_hash(p_token)) then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  select count(*) filter (where sender = 'visitor'), count(*) filter (where sender = 'bot'), count(*) filter (where sender = 'staff')
    into v_visitor, v_bot, v_staff from cms_chat_messages where chat_id = p_chat;
  if v_staff > 0 or v_bot >= v_visitor or v_bot >= 30 then
    return null;
  end if;
  insert into cms_chat_messages (chat_id, sender, body, staff_id) values (p_chat, 'bot', left(trim(p_body), 2000), null)
    returning id into v_id;
  return v_id;
end $$;
revoke execute on function chat_bot_reply(uuid, text, text) from public;
grant execute on function chat_bot_reply(uuid, text, text) to anon, authenticated;
