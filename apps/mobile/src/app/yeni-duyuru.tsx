import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { Button, Card, Field, Notice, Screen, Segmented } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function NewAnnouncement() {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState("ALL");
  const [picked, setPicked] = useState<string[]>([]);
  const [pinned, setPinned] = useState(false);
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const { data } = useLoad(async () => {
    const [d, b] = await Promise.all([supabase.from("departments").select("id, name").order("name"), supabase.from("branches").select("id, name").order("name")]);
    return { depts: d.data ?? [], branches: b.data ?? [] };
  }, []);

  const options = audience === "DEPARTMENT" ? (data?.depts ?? []) : audience === "BRANCH" ? (data?.branches ?? []) : [];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  async function publish() {
    if (!title.trim() || !body.trim()) return setErr("Başlık ve metin zorunlu.");
    if (audience !== "ALL" && !picked.length) return setErr("En az bir seçim yapın.");
    setBusy(true);
    setErr(null);
    const { error } = await supabase.from("announcements").insert({
      company_id: profile?.companyId,
      title: title.trim(),
      body: body.trim(),
      audience,
      department_ids: audience === "DEPARTMENT" ? picked : [],
      branch_ids: audience === "BRANCH" ? picked : [],
      pinned,
      push,
    });
    setBusy(false);
    if (error) return setErr(error.message);
    router.back();
  }

  return (
    <Screen>
      <Card>
        <Field label="Başlık" value={title} onChangeText={setTitle} maxLength={140} />
        <Field label="Metin" value={body} onChangeText={setBody} multiline />
        <Text style={{ color: C.muted, fontSize: 13 }}>Kime</Text>
        <Segmented value={audience} onChange={(v) => { setAudience(v); setPicked([]); }} options={[["ALL", "Herkes"], ["DEPARTMENT", "Bölüm"], ["BRANCH", "Şube"]]} />
        {options.length > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {options.map((o) => (
              <Pressable key={o.id} onPress={() => toggle(o.id)} accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(o.id) }}
                style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: picked.includes(o.id) ? C.brand700 : "#D5DEE8", backgroundColor: picked.includes(o.id) ? "#EAF2FB" : C.white }}>
                <Text style={{ color: picked.includes(o.id) ? C.brand700 : C.ink, fontWeight: picked.includes(o.id) ? "700" : "500" }}>{o.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text>Üste sabitle</Text>
          <Switch value={pinned} onValueChange={setPinned} trackColor={{ true: C.accent }} />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text>Telefonlara bildirim gönder</Text>
          <Switch value={push} onValueChange={setPush} trackColor={{ true: C.accent }} />
        </View>
        {err && <Notice ok={false} text={err} />}
        <Button title="Yayınla" onPress={publish} busy={busy} />
      </Card>
    </Screen>
  );
}
