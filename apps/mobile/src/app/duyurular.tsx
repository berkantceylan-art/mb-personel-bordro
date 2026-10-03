import { router } from "expo-router";
import { useEffect } from "react";
import { Text, View } from "react-native";
import { Button, Card, Empty, Screen } from "@/components/ui";
import { canPublish, useAuth } from "@/lib/auth";
import { dmy, timeOf } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function Announcements() {
  const { profile } = useAuth();
  const { data, refresh, refreshing } = useLoad(async () => {
    const now = new Date().toISOString();
    const [{ data: list }, { data: reads }] = await Promise.all([
      supabase.from("announcements").select("id, title, body, published_at, pinned").or(`expires_at.is.null,expires_at.gt.${now}`).order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(60),
      supabase.from("announcement_reads").select("announcement_id").eq("user_id", profile?.userId ?? ""),
    ]);
    const read = new Set((reads ?? []).map((r) => r.announcement_id as string));
    return (list ?? []).map((a) => ({ ...a, unread: !read.has(a.id) }));
  }, [profile?.userId]);

  // Görülenleri okundu işaretle
  useEffect(() => {
    const unread = (data ?? []).filter((a) => a.unread).map((a) => ({ announcement_id: a.id, user_id: profile?.userId }));
    if (unread.length) supabase.from("announcement_reads").upsert(unread, { onConflict: "announcement_id,user_id", ignoreDuplicates: true }).then(() => {});
  }, [data, profile?.userId]);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      {canPublish(profile?.role) && <Button title="Yeni duyuru" kind="accent" onPress={() => router.push("/yeni-duyuru")} />}
      {(data ?? []).map((a) => (
        <Card key={a.id} style={a.pinned ? { borderColor: C.accent } : undefined}>
          <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: "800", color: C.brand800 }}>{a.pinned ? "📌 " : ""}{a.title}</Text>
            {a.unread && <Text style={{ color: C.warn, fontWeight: "700", fontSize: 12 }}>YENİ</Text>}
          </View>
          <Text style={{ fontSize: 15, color: C.ink, lineHeight: 22 }}>{a.body}</Text>
          <Text style={{ color: C.muted, fontSize: 12 }}>{dmy(a.published_at)} {timeOf(a.published_at)}</Text>
        </Card>
      ))}
      {(data ?? []).length === 0 && <Empty text="Duyuru yok." />}
    </Screen>
  );
}
