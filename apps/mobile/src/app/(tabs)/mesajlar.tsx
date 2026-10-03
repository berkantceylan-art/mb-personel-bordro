import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { Card, Empty, Screen, s } from "@/components/ui";
import { canPublish, useAuth } from "@/lib/auth";
import { dmy, timeOf } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

type Dir = { user_id: string; display_name: string; role: string; department: string | null };

export default function Inbox() {
  const { profile } = useAuth();
  const [q, setQ] = useState("");
  const [picking, setPicking] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data, refresh, refreshing } = useLoad(async () => {
    const uid = profile?.userId ?? "";
    const [{ data: mine }, { data: dir }, { data: depts }] = await Promise.all([
      supabase.from("conversation_members").select("conversation_id, last_read_at, conversations(id, kind, title, last_message_at)").eq("user_id", uid),
      supabase.rpc("company_directory"),
      canPublish(profile?.role) ? supabase.from("departments").select("id, name").order("name") : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
    ]);
    const people = (dir ?? []) as Dir[];
    const names = new Map(people.map((d) => [d.user_id, d.display_name]));
    const ids = (mine ?? []).map((m) => m.conversation_id as string);
    const [{ data: members }, { data: msgs }] = ids.length
      ? await Promise.all([
          supabase.from("conversation_members").select("conversation_id, user_id").in("conversation_id", ids),
          supabase.from("messages").select("conversation_id, body, sender_id, created_at").in("conversation_id", ids).order("created_at", { ascending: false }).limit(300),
        ])
      : [{ data: [] as Array<{ conversation_id: string; user_id: string }> }, { data: [] as Array<{ conversation_id: string; body: string; sender_id: string; created_at: string }> }];
    const last = new Map<string, { body: string; sender_id: string }>();
    for (const m of msgs ?? []) if (!last.has(m.conversation_id)) last.set(m.conversation_id, m);
    const convs = (mine ?? [])
      .map((m) => {
        const c = m.conversations as unknown as { id: string; kind: string; title: string | null; last_message_at: string };
        const others = (members ?? []).filter((x) => x.conversation_id === c.id && x.user_id !== uid).map((x) => names.get(x.user_id) ?? "Kullanıcı");
        return { id: c.id, title: c.kind === "GROUP" ? (c.title ?? "Grup") : (others[0] ?? "Ben"), at: c.last_message_at, unread: c.last_message_at > m.last_read_at, last: last.get(c.id) };
      })
      .sort((a, b) => b.at.localeCompare(a.at));
    return { convs, people: people.filter((p) => p.user_id !== uid), depts: depts ?? [] };
  }, [profile?.userId, profile?.role]);

  async function open(fn: "open_direct_conversation" | "open_department_group", arg: Record<string, string>) {
    setErr(null);
    const { data: id, error } = await supabase.rpc(fn, arg);
    if (error) return setErr(error.message);
    setPicking(false);
    setQ("");
    router.push(`/mesaj/${id as string}`);
  }

  const norm = (v: string) => v.toLocaleLowerCase("tr-TR");
  const hits = (data?.people ?? []).filter((p) => !q || norm(`${p.display_name} ${p.department ?? ""}`).includes(norm(q))).slice(0, 40);

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <TextInput
        value={q}
        onChangeText={(v) => { setQ(v); setPicking(true); }}
        onFocus={() => setPicking(true)}
        placeholder="Yeni mesaj: kişi ara…"
        placeholderTextColor="#9AA6B2"
        style={s.input}
        accessibilityLabel="Kişi ara"
      />
      {err && <Text style={{ color: C.bad }}>{err}</Text>}
      {picking ? (
        <Card title="Kime yazacaksınız?" right={<Pressable onPress={() => { setPicking(false); setQ(""); }}><Text style={{ color: C.brand700, fontWeight: "700" }}>Kapat</Text></Pressable>}>
          {!q && (data?.depts ?? []).length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
              {(data?.depts ?? []).map((d) => (
                <Pressable key={d.id} onPress={() => open("open_department_group", { p_department: d.id })} style={{ backgroundColor: "#EAF2FB", paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 }}>
                  <Text style={{ color: C.brand700, fontWeight: "700", fontSize: 13 }}>{d.name} grubu</Text>
                </Pressable>
              ))}
            </View>
          )}
          {hits.map((p) => (
            <Pressable key={p.user_id} onPress={() => open("open_direct_conversation", { p_other: p.user_id })} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F6" }}>
              <Text style={{ fontWeight: "600", color: C.ink }}>{p.display_name}</Text>
              {p.department ? <Text style={{ color: C.muted, fontSize: 12 }}>{p.department}</Text> : null}
            </Pressable>
          ))}
          {hits.length === 0 && <Empty text="Kimse bulunamadı." />}
        </Card>
      ) : (
        <View style={[s.card, { padding: 0, gap: 0 }]}>
          {(data?.convs ?? []).map((c) => (
            <Pressable key={c.id} onPress={() => router.push(`/mesaj/${c.id}`)} style={{ paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#EEF2F6", gap: 2 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ flex: 1, fontWeight: c.unread ? "800" : "600", color: C.brand800 }} numberOfLines={1}>{c.title}</Text>
                <Text style={{ color: C.muted, fontSize: 11 }}>{new Date(c.at).toDateString() === new Date().toDateString() ? timeOf(c.at) : dmy(c.at)}</Text>
                {c.unread && <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.accent }} />}
              </View>
              <Text style={{ color: C.muted }} numberOfLines={1}>{c.last ? `${c.last.sender_id === profile?.userId ? "Siz: " : ""}${c.last.body}` : "Henüz mesaj yok"}</Text>
            </Pressable>
          ))}
          {(data?.convs ?? []).length === 0 && <Empty text="Henüz konuşma yok. Yukarıdan bir kişi arayın." />}
        </View>
      )}
    </Screen>
  );
}
