import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

/** Ekran odaklandığında veri yükler; çekip yenileme için refresh döner */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await run());
    } finally {
      setRefreshing(false);
    }
  }, [run]);
  useFocusEffect(
    useCallback(() => {
      run().then(setData).catch(() => {});
    }, [run]),
  );
  return { data, refresh, refreshing, setData };
}

/** Okunmamış konuşma ve bildirim sayısı (sekme rozetleri) */
export function useUnread(userId: string | undefined) {
  const [counts, setCounts] = useState({ messages: 0, notifications: 0 });
  const load = useCallback(async () => {
    if (!userId) return;
    const [{ data: convs }, { count }] = await Promise.all([
      supabase.from("conversation_members").select("last_read_at, conversations(last_message_at)").eq("user_id", userId),
      supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("silent", false).is("read_at", null),
    ]);
    const messages = (convs ?? []).filter((c) => {
      const last = (c.conversations as unknown as { last_message_at: string } | null)?.last_message_at;
      return last && last > c.last_read_at;
    }).length;
    setCounts({ messages, notifications: count ?? 0 });
  }, [userId]);
  useEffect(() => {
    load();
    const ch = supabase
      .channel(`unread:${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, () => load())
      .subscribe();
    const t = setInterval(load, 60_000);
    return () => {
      supabase.removeChannel(ch);
      clearInterval(t);
    };
  }, [load, userId]);
  return { ...counts, reload: load };
}
