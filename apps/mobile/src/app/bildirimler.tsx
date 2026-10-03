import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Button, Empty, Screen, s } from "@/components/ui";
import { isManager, useAuth } from "@/lib/auth";
import { appRoute, dmy, timeOf } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function Notifications() {
  const { profile } = useAuth();
  const { data, refresh, refreshing } = useLoad(async () => {
    const { data } = await supabase.from("notifications").select("id, title, body, link, read_at, created_at").eq("user_id", profile?.userId ?? "").order("created_at", { ascending: false }).limit(100);
    return data ?? [];
  }, [profile?.userId]);

  async function readAll() {
    await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("user_id", profile?.userId ?? "").is("read_at", null);
    refresh();
  }
  async function open(n: { id: string; link: string | null; read_at: string | null }) {
    if (!n.read_at) await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", n.id);
    router.push(appRoute(n.link, isManager(profile?.role)) as never);
  }

  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {unread > 0 && <Button title={`Tümünü okundu say (${unread})`} kind="ghost" onPress={readAll} />}
      <View style={[s.card, { padding: 0, gap: 0 }]}>
        {(data ?? []).map((n) => (
          <Pressable key={n.id} onPress={() => open(n)} style={{ flexDirection: "row", gap: 10, padding: 14, borderBottomWidth: 1, borderBottomColor: "#EEF2F6" }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, marginTop: 6, backgroundColor: n.read_at ? "transparent" : C.accent }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontWeight: n.read_at ? "500" : "800", color: C.ink }}>{n.title}</Text>
              {n.body ? <Text style={{ color: C.muted }} numberOfLines={2}>{n.body}</Text> : null}
              <Text style={{ color: C.muted, fontSize: 11 }}>{dmy(n.created_at)} {timeOf(n.created_at)}</Text>
            </View>
          </Pressable>
        ))}
        {(data ?? []).length === 0 && <Empty text="Bildirim yok." />}
      </View>
    </Screen>
  );
}
