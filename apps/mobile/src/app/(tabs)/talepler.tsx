import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Button, Card, Chip, Empty, Field, Notice, Row, Screen, Segmented } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { STATUS, dmy, isoFromDmy, parseTL, tl } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

export default function Requests() {
  const { profile } = useAuth();
  const emp = profile?.employee;
  const [tab, setTab] = useState("izin");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  // izin
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  // avans
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const { data, refresh, refreshing } = useLoad(async () => {
    if (!emp) return null;
    const year = new Date().getFullYear();
    const [types, leaves, adv] = await Promise.all([
      supabase.from("leave_types").select("id, name, code").order("sort_order"),
      supabase.from("leave_requests").select("id, start_date, end_date, days, status, leave_types(name, code)").eq("employee_id", emp.id).gte("start_date", `${year}-01-01`).order("start_date", { ascending: false }),
      supabase.from("advance_requests").select("id, amount, reason, status, created_at, decision_note").eq("employee_id", emp.id).order("created_at", { ascending: false }).limit(20),
    ]);
    return { types: types.data ?? [], leaves: leaves.data ?? [], adv: adv.data ?? [] };
  }, [emp?.id]);

  const types = data?.types ?? [];
  const selectedType = typeId ?? types[0]?.id ?? null;
  const usedAnnual = (data?.leaves ?? []).filter((l) => l.status === "approved" && (l.leave_types as unknown as { code: string } | null)?.code === "YILLIK").reduce((a, l) => a + Number(l.days), 0);

  async function sendLeave() {
    const s = isoFromDmy(start);
    const e = end ? isoFromDmy(end) : s;
    if (!s || !e) return setMsg({ ok: false, text: "Tarihleri GG.AA.YYYY biçiminde yazın (ör. 26.10.2026)." });
    setBusy(true);
    setMsg(null);
    const { data: r, error } = await supabase.rpc("request_leave_self", { p_type: selectedType, p_start: s, p_end: e, p_note: note || null });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: `${(r as { days: number }).days} günlük izin talebiniz iletildi.` });
    setStart(""); setEnd(""); setNote("");
    refresh();
  }

  async function sendAdvance() {
    const k = parseTL(amount);
    if (!k || k <= 0 || !emp || !profile) return setMsg({ ok: false, text: "Tutarı yazın." });
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.from("advance_requests").insert({ company_id: profile.companyId, employee_id: emp.id, amount: k, reason: reason || null });
    setBusy(false);
    if (error) return setMsg({ ok: false, text: error.message });
    setMsg({ ok: true, text: "Avans talebiniz iletildi." });
    setAmount(""); setReason("");
    refresh();
  }

  async function cancelAdvance(id: string) {
    await supabase.from("advance_requests").update({ status: "cancelled" }).eq("id", id).eq("status", "pending");
    refresh();
  }

  if (!emp) return <Screen><Empty text="Hesabınız bir personel kaydına bağlı değil." /></Screen>;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Segmented value={tab} onChange={(v) => { setTab(v); setMsg(null); }} options={[["izin", "İzin"], ["avans", "Avans"]]} />
      {tab === "izin" ? (
        <>
          <Card title="İzin iste" right={<Text style={{ color: C.muted, fontSize: 12 }}>Bu yıl yıllık izin: {usedAnnual} gün</Text>}>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {types.map((t) => (
                <Pressable key={t.id} onPress={() => setTypeId(t.id)} accessibilityRole="radio" accessibilityState={{ checked: selectedType === t.id }}
                  style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: selectedType === t.id ? C.brand700 : "#D5DEE8", backgroundColor: selectedType === t.id ? "#EAF2FB" : C.white }}>
                  <Text style={{ color: selectedType === t.id ? C.brand700 : C.ink, fontWeight: selectedType === t.id ? "700" : "500" }}>{t.name}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Field label="Başlangıç" placeholder="GG.AA.YYYY" value={start} onChangeText={setStart} keyboardType="numbers-and-punctuation" />
              <Field label="Bitiş" placeholder="aynı gün" value={end} onChangeText={setEnd} keyboardType="numbers-and-punctuation" />
            </View>
            <Field label="Açıklama" value={note} onChangeText={setNote} />
            <Text style={{ color: C.muted, fontSize: 12 }}>Pazar ve resmi tatiller sayılmaz; rapor takvim günüyle sayılır.</Text>
            {msg && <Notice ok={msg.ok} text={msg.text} />}
            <Button title="İzin iste" onPress={sendLeave} busy={busy} disabled={!start || !selectedType} />
          </Card>
          <Card title="İzinlerim">
            {(data?.leaves ?? []).map((l) => {
              const st = STATUS[l.status] ?? STATUS.pending!;
              return (
                <Row key={l.id} left={`${(l.leave_types as unknown as { name: string } | null)?.name ?? "İzin"} · ${l.days} gün`} sub={`${dmy(l.start_date)}${l.end_date !== l.start_date ? ` – ${dmy(l.end_date)}` : ""}`} right={<Chip label={st.label} bg={st.bg} fg={st.fg} />} />
              );
            })}
            {(data?.leaves ?? []).length === 0 && <Empty text="Bu yıl izin kaydı yok." />}
          </Card>
        </>
      ) : (
        <>
          <Card title="Avans iste">
            <Field label="Tutar (TL)" placeholder="5.000" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
            <Field label="Açıklama" value={reason} onChangeText={setReason} />
            {msg && <Notice ok={msg.ok} text={msg.text} />}
            <Button title="Avans iste" onPress={sendAdvance} busy={busy} disabled={!amount} />
          </Card>
          <Card title="Avans taleplerim">
            {(data?.adv ?? []).map((a) => {
              const st = STATUS[a.status] ?? STATUS.pending!;
              return (
                <Row
                  key={a.id}
                  left={tl(a.amount)}
                  sub={`${dmy(a.created_at)}${a.decision_note ? ` · ${a.decision_note}` : a.reason ? ` · ${a.reason}` : ""}`}
                  right={
                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Chip label={st.label} bg={st.bg} fg={st.fg} />
                      {a.status === "pending" && <Pressable onPress={() => cancelAdvance(a.id)}><Text style={{ color: C.bad, fontWeight: "700", fontSize: 12 }}>İptal et</Text></Pressable>}
                    </View>
                  }
                />
              );
            })}
            {(data?.adv ?? []).length === 0 && <Empty text="Avans talebi yok." />}
          </Card>
        </>
      )}
    </Screen>
  );
}
