import { Stack, useLocalSearchParams } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { timeOf } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

type Msg = { id: string; sender_id: string; body: string; created_at: string; pending?: boolean };

export default function Chat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { profile } = useAuth();
  const me = profile?.userId ?? "";
  const insets = useSafeAreaInsets();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("Mesaj");
  const [group, setGroup] = useState(false);
  const [text, setText] = useState("");
  const list = useRef<FlatList<Msg>>(null);

  const markRead = () => supabase.from("conversation_members").update({ last_read_at: new Date().toISOString() }).eq("conversation_id", id).eq("user_id", me);

  useEffect(() => {
    if (!id || !me) return;
    (async () => {
      const [{ data: conv }, { data: members }, { data: m }, { data: dir }] = await Promise.all([
        supabase.from("conversations").select("kind, title").eq("id", id).maybeSingle(),
        supabase.from("conversation_members").select("user_id").eq("conversation_id", id),
        supabase.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
        supabase.rpc("company_directory"),
      ]);
      const n = Object.fromEntries(((dir ?? []) as Array<{ user_id: string; display_name: string }>).map((d) => [d.user_id, d.display_name]));
      setNames(n);
      const others = (members ?? []).filter((x) => x.user_id !== me).map((x) => n[x.user_id] ?? "Kullanıcı");
      setGroup(conv?.kind === "GROUP");
      setTitle(conv?.kind === "GROUP" ? (conv.title ?? "Grup") : (others[0] ?? "Mesaj"));
      setMsgs((m ?? []) as Msg[]);
      markRead();
    })();
    const ch = supabase
      .channel(`chat:${id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${id}` }, (p) => {
        const m = p.new as Msg;
        setMsgs((cur) => {
          if (cur.some((x) => x.id === m.id)) return cur;
          const i = cur.findIndex((x) => x.pending && x.sender_id === m.sender_id && x.body === m.body);
          if (i >= 0) return cur.map((x, j) => (j === i ? m : x));
          return [m, ...cur];
        });
        if (m.sender_id !== me) markRead();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, me]);

  async function send() {
    const body = text.trim();
    if (!body) return;
    setText("");
    const temp: Msg = { id: `tmp-${Date.now()}`, sender_id: me, body, created_at: new Date().toISOString(), pending: true };
    setMsgs((c) => [temp, ...c]);
    const { data, error } = await supabase.from("messages").insert({ conversation_id: id, body: body.slice(0, 4000) }).select("id, sender_id, body, created_at").single();
    if (error) {
      setMsgs((c) => c.filter((x) => x.id !== temp.id));
      setText(body);
      return;
    }
    setMsgs((c) => (c.some((x) => x.id === data.id) ? c.filter((x) => x.id !== temp.id) : c.map((x) => (x.id === temp.id ? (data as Msg) : x))));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.ground }} behavior={Platform.OS === "ios" ? "padding" : undefined} keyboardVerticalOffset={Platform.OS === "ios" ? 90 : 0}>
      <Stack.Screen options={{ title }} />
      <FlatList
        ref={list}
        inverted
        data={msgs}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 6 }}
        renderItem={({ item: m, index }) => {
          const mine = m.sender_id === me;
          const prev = msgs[index + 1];
          const showName = group && !mine && prev?.sender_id !== m.sender_id;
          return (
            <View style={{ maxWidth: "80%", alignSelf: mine ? "flex-end" : "flex-start", alignItems: mine ? "flex-end" : "flex-start" }}>
              {showName && <Text style={{ color: C.accentInk, fontSize: 11, fontWeight: "700", paddingHorizontal: 4 }}>{names[m.sender_id] ?? "Kullanıcı"}</Text>}
              <View style={{ backgroundColor: mine ? C.brand700 : C.white, borderWidth: mine ? 0 : 1, borderColor: C.line, borderRadius: 18, borderBottomRightRadius: mine ? 6 : 18, borderBottomLeftRadius: mine ? 18 : 6, paddingHorizontal: 14, paddingVertical: 8, opacity: m.pending ? 0.6 : 1 }}>
                <Text style={{ color: mine ? C.white : C.ink, fontSize: 16 }}>{m.body}</Text>
              </View>
              <Text style={{ color: C.muted, fontSize: 10, paddingHorizontal: 4 }}>{timeOf(m.created_at)}</Text>
            </View>
          );
        }}
        ListEmptyComponent={<Text style={{ color: C.muted, textAlign: "center", marginTop: 40, transform: [{ scaleY: -1 }] }}>İlk mesajı yazın.</Text>}
      />
      <View style={{ flexDirection: "row", gap: 8, padding: 10, paddingBottom: 10 + insets.bottom, backgroundColor: C.white, borderTopWidth: 1, borderTopColor: C.line }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Mesaj yazın…"
          placeholderTextColor="#9AA6B2"
          multiline
          maxLength={4000}
          accessibilityLabel="Mesaj"
          style={{ flex: 1, minHeight: 44, maxHeight: 120, borderWidth: 1, borderColor: "#D5DEE8", borderRadius: 22, paddingHorizontal: 14, paddingTop: 11, paddingBottom: 11, fontSize: 16, color: C.ink }}
        />
        <Pressable onPress={send} accessibilityRole="button" accessibilityLabel="Gönder" style={{ height: 44, paddingHorizontal: 18, borderRadius: 22, backgroundColor: C.brand700, alignItems: "center", justifyContent: "center", alignSelf: "flex-end" }}>
          <Text style={{ color: C.white, fontWeight: "700" }}>Gönder</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
