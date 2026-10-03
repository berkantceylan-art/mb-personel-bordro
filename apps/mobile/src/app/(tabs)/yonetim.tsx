import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { Button, Card, Empty, Notice, Row, Screen, Segmented, Stat } from "@/components/ui";
import { canHr, canPay, canPublish, useAuth } from "@/lib/auth";
import { dmy, tl, todayIso } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

type Emp = { id: string; first_name: string; last_name: string; departments: { name: string } | null };

export default function Admin() {
  const { profile } = useAuth();
  const role = profile?.role;
  const [tab, setTab] = useState("bugun");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAbsent, setShowAbsent] = useState(false);

  const { data, refresh, refreshing } = useLoad(async () => {
    const today = todayIso();
    const [emps, punches, adv, leaves, onLeave] = await Promise.all([
      supabase.from("employees").select("id, first_name, last_name, departments(name)").eq("status", "active").order("first_name"),
      supabase.from("attendance_punches").select("employee_id, direction, punched_at").gte("punched_at", `${today}T00:00:00`).not("employee_id", "is", null).order("punched_at"),
      canPay(role) ? supabase.from("advance_requests").select("id, amount, reason, created_at, employees(first_name, last_name)").eq("status", "pending").order("created_at") : Promise.resolve({ data: [] }),
      canHr(role) ? supabase.from("leave_requests").select("id, start_date, end_date, days, note, leave_types(name), employees(first_name, last_name)").eq("status", "pending").order("start_date") : Promise.resolve({ data: [] }),
      supabase.from("leave_requests").select("employee_id").eq("status", "approved").lte("start_date", today).gte("end_date", today),
    ]);
    const state = new Map<string, { dir: string; first: string; last: string }>();
    for (const p of punches.data ?? []) {
      const cur = state.get(p.employee_id!) ?? { dir: p.direction, first: p.punched_at.slice(11, 16), last: p.punched_at.slice(11, 16) };
      cur.dir = p.direction;
      cur.last = p.punched_at.slice(11, 16);
      state.set(p.employee_id!, cur);
    }
    const leaveSet = new Set((onLeave.data ?? []).map((l) => l.employee_id as string));
    const list = (emps.data ?? []) as unknown as Emp[];
    return {
      inside: list.filter((e) => state.get(e.id)?.dir === "IN").map((e) => ({ ...e, ...state.get(e.id)! })),
      left: list.filter((e) => state.get(e.id)?.dir === "OUT").map((e) => ({ ...e, ...state.get(e.id)! })),
      absent: list.filter((e) => !state.has(e.id) && !leaveSet.has(e.id)),
      leaveCount: leaveSet.size,
      total: list.length,
      adv: (adv.data ?? []) as unknown as Array<{ id: string; amount: number; reason: string | null; created_at: string; employees: { first_name: string; last_name: string } | null }>,
      leaves: (leaves.data ?? []) as unknown as Array<{ id: string; start_date: string; end_date: string; days: number; note: string | null; leave_types: { name: string } | null; employees: { first_name: string; last_name: string } | null }>,
    };
  }, [role]);

  async function decideAdv(id: string, approve: boolean, channel: "CASH" | "BANK" = "CASH") {
    setMsg(null);
    const { error } = await supabase.rpc("decide_advance", { p_id: id, p_approve: approve, p_channel: channel, p_date: todayIso() });
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: approve ? `Avans onaylandı, cari hesaba ${channel === "BANK" ? "banka" : "elden"} avans işlendi.` : "Talep reddedildi." });
    refresh();
  }

  function askAdv(id: string, name: string, amount: number) {
    Alert.alert("Avans talebi", `${name} · ${tl(amount)}`, [
      { text: "Vazgeç", style: "cancel" },
      { text: "Reddet", style: "destructive", onPress: () => decideAdv(id, false) },
      { text: "Bankaya öde", onPress: () => decideAdv(id, true, "BANK") },
      { text: "Elden öde", onPress: () => decideAdv(id, true, "CASH") },
    ]);
  }

  async function decideLeave(id: string, status: "approved" | "rejected") {
    setMsg(null);
    const { error } = await supabase.from("leave_requests").update({ status, decided_by: profile?.userId, decided_at: new Date().toISOString() }).eq("id", id);
    setMsg(error ? { ok: false, text: error.message } : { ok: true, text: status === "approved" ? "İzin onaylandı." : "İzin reddedildi." });
    refresh();
  }

  const pending = (data?.adv.length ?? 0) + (data?.leaves.length ?? 0);
  const name = (e: { first_name: string; last_name: string } | null) => (e ? `${e.first_name} ${e.last_name}` : "");

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Segmented value={tab} onChange={setTab} options={[["bugun", "Bugün"], ["onay", `Onaylar${pending ? ` (${pending})` : ""}`]]} />
      {msg && <Notice ok={msg.ok} text={msg.text} />}
      {tab === "bugun" ? (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Stat label="İçeride" value={`${data?.inside.length ?? 0}`} sub={`${data?.total ?? 0} aktif personel`} />
            <Stat label="Gelmedi" value={`${data?.absent.length ?? 0}`} sub={`${data?.leaveCount ?? 0} kişi izinde`} />
          </View>
          {canPublish(role) && <Button title="Duyuru yayınla" kind="accent" onPress={() => router.push("/yeni-duyuru")} />}
          <Card title={`İçeride (${data?.inside.length ?? 0})`}>
            {(data?.inside ?? []).map((e) => <Row key={e.id} left={`${e.first_name} ${e.last_name}`} sub={e.departments?.name ?? ""} right={`${e.first}`} />)}
            {(data?.inside ?? []).length === 0 && <Empty text="Şu an içeride kimse görünmüyor." />}
          </Card>
          <Card title={`Gelmeyenler (${data?.absent.length ?? 0})`} right={<Pressable onPress={() => setShowAbsent((v) => !v)}><Text style={{ color: C.brand700, fontWeight: "700" }}>{showAbsent ? "Gizle" : "Göster"}</Text></Pressable>}>
            {showAbsent && (data?.absent ?? []).map((e) => <Row key={e.id} left={`${e.first_name} ${e.last_name}`} sub={e.departments?.name ?? ""} />)}
            {!showAbsent && <Text style={{ color: C.muted }}>Okutma yapmamış ve izinde olmayan personel.</Text>}
          </Card>
          {(data?.left ?? []).length > 0 && (
            <Card title={`Çıkış yapanlar (${data?.left.length})`}>
              {(data?.left ?? []).map((e) => <Row key={e.id} left={`${e.first_name} ${e.last_name}`} sub={e.departments?.name ?? ""} right={`${e.first} → ${e.last}`} />)}
            </Card>
          )}
        </>
      ) : (
        <>
          {canPay(role) && (
            <Card title="Avans talepleri">
              {(data?.adv ?? []).map((a) => (
                <Row key={a.id} left={name(a.employees)} sub={`${dmy(a.created_at)}${a.reason ? ` · ${a.reason}` : ""}`}
                  right={<Pressable onPress={() => askAdv(a.id, name(a.employees), a.amount)} style={{ alignItems: "flex-end" }}><Text style={{ fontWeight: "800", color: C.ink }}>{tl(a.amount)}</Text><Text style={{ color: C.brand700, fontWeight: "700", fontSize: 12 }}>Karar ver ›</Text></Pressable>} />
              ))}
              {(data?.adv ?? []).length === 0 && <Empty text="Bekleyen avans talebi yok." />}
            </Card>
          )}
          {canHr(role) && (
            <Card title="İzin talepleri">
              {(data?.leaves ?? []).map((l) => (
                <View key={l.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#EEF2F6", gap: 8 }}>
                  <Text style={{ fontWeight: "700", color: C.ink }}>{name(l.employees)}</Text>
                  <Text style={{ color: C.muted }}>{l.leave_types?.name} · {dmy(l.start_date)}{l.end_date !== l.start_date ? ` – ${dmy(l.end_date)}` : ""} · {l.days} gün{l.note ? ` · ${l.note}` : ""}</Text>
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Button title="Onayla" onPress={() => decideLeave(l.id, "approved")} style={{ flex: 1, height: 42 }} />
                    <Button title="Reddet" kind="danger" onPress={() => decideLeave(l.id, "rejected")} style={{ flex: 1, height: 42 }} />
                  </View>
                </View>
              ))}
              {(data?.leaves ?? []).length === 0 && <Empty text="Bekleyen izin talebi yok." />}
            </Card>
          )}
        </>
      )}
    </Screen>
  );
}
