import * as Location from "expo-location";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Empty, Notice, Row, Screen } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { dmy, timeOf, todayIso } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

type Punch = { direction: "IN" | "OUT"; punched_at: string; source: string };

export default function Home() {
  const { profile } = useAuth();
  const emp = profile?.employee;
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, refresh, refreshing } = useLoad(async () => {
    const today = todayIso();
    const [punches, anns, reads] = await Promise.all([
      emp
        ? supabase.from("attendance_punches").select("direction, punched_at, source").eq("employee_id", emp.id).gte("punched_at", `${today}T00:00:00`).order("punched_at")
        : Promise.resolve({ data: [] as Punch[] }),
      supabase.from("announcements").select("id, title, body, published_at, pinned").order("pinned", { ascending: false }).order("published_at", { ascending: false }).limit(3),
      supabase.from("announcement_reads").select("announcement_id").eq("user_id", profile?.userId ?? ""),
    ]);
    const read = new Set((reads.data ?? []).map((r) => r.announcement_id as string));
    return { punches: (punches.data ?? []) as Punch[], anns: (anns.data ?? []).map((a) => ({ ...a, unread: !read.has(a.id) })) };
  }, [emp?.id, profile?.userId]);

  async function punchWithLocation() {
    setBusy(true);
    setMsg(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") throw new Error("Konum izni verilmedi. Ayarlardan izin verin ya da QR ile okutun.");
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const { data: r, error } = await supabase.rpc("mobile_punch", { p_lat: pos.coords.latitude, p_lng: pos.coords.longitude, p_accuracy: pos.coords.accuracy, p_qr: null });
      if (error) throw new Error(error.message);
      const d = r as { direction: string; at: string; branch: string };
      setMsg({ ok: true, text: `${d.direction === "IN" ? "Giriş" : "Çıkış"} kaydedildi · ${d.at.slice(11, 16)} · ${d.branch}` });
      refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const punches = data?.punches ?? [];
  const last = punches.at(-1);
  const inside = last?.direction === "IN";
  const hello = new Date().getHours() < 12 ? "Günaydın" : "Merhaba";

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", color: C.brand800 }}>{hello} {emp?.first_name ?? profile?.displayName}</Text>
        <Text style={{ color: C.muted }}>{[emp?.department, emp?.branch, dmy(todayIso())].filter(Boolean).join(" · ")}</Text>
      </View>

      {emp ? (
        <Card title="Giriş / çıkış">
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: inside ? "#1FA971" : "#9AA6B2" }} />
            <Text style={{ color: C.ink, fontSize: 15 }}>{last ? `${inside ? "İçeridesiniz" : "Çıkış yaptınız"} · son okutma ${last.punched_at.slice(11, 16)}` : "Bugün henüz okutma yok"}</Text>
          </View>
          <Button title={inside ? "Çıkış yap (konumla)" : "Giriş yap (konumla)"} kind="accent" onPress={punchWithLocation} busy={busy} />
          <Button title="QR kod okut" kind="ghost" onPress={() => router.push("/qr")} />
          {msg && <Notice ok={msg.ok} text={msg.text} />}
          {punches.length > 0 && (
            <View>
              {punches.map((p, i) => (
                <Row key={i} left={p.direction === "IN" ? "Giriş" : "Çıkış"} sub={p.source === "MOBILE" ? "Mobil" : p.source === "MANUAL" ? "Elle" : "Kart"} right={p.punched_at.slice(11, 16)} />
              ))}
            </View>
          )}
        </Card>
      ) : null}

      <Card title="Duyurular" right={<Pressable onPress={() => router.push("/duyurular")}><Text style={{ color: C.brand700, fontWeight: "700" }}>Tümü</Text></Pressable>}>
        {(data?.anns ?? []).map((a) => (
          <Pressable key={a.id} onPress={() => router.push("/duyurular")} style={{ gap: 2, paddingVertical: 6 }}>
            <Text style={{ fontWeight: a.unread ? "800" : "600", color: C.brand800 }}>{a.pinned ? "📌 " : ""}{a.title}{a.unread ? "  •" : ""}</Text>
            <Text numberOfLines={2} style={{ color: C.muted }}>{a.body}</Text>
            <Text style={{ color: C.muted, fontSize: 11 }}>{dmy(a.published_at)} {timeOf(a.published_at)}</Text>
          </Pressable>
        ))}
        {(data?.anns ?? []).length === 0 && <Empty text="Duyuru yok." />}
      </Card>
    </Screen>
  );
}
