import { useState } from "react";
import { Text, View } from "react-native";
import { Card, Empty, Row, Screen, Segmented, Stat } from "@/components/ui";
import { useAuth } from "@/lib/auth";
import { TYPE_LABEL, currentPeriod, dmy, periodLabel, tl } from "@/lib/format";
import { useLoad } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { C } from "@/lib/theme";

const CREDIT = ["ACCRUAL", "BONUS", "OVERTIME", "ADJUSTMENT"];

export default function Pay() {
  const { profile } = useAuth();
  const emp = profile?.employee;
  const [tab, setTab] = useState("ozet");
  const period = currentPeriod();

  const { data, refresh, refreshing } = useLoad(async () => {
    if (!emp) return null;
    const [sum, entries, payroll, punches] = await Promise.all([
      supabase.from("ledger_period_summary").select("accrued, paid_bank, paid_cash, deductions, balance").eq("employee_id", emp.id).eq("period", period).maybeSingle(),
      supabase.from("ledger_entries").select("id, entry_date, type, channel, amount, note").eq("employee_id", emp.id).is("voided_at", null).order("entry_date", { ascending: false }).limit(40),
      supabase.from("payroll_lines").select("period, days, official_gross, sgk_employee, unemployment_employee, income_tax, stamp_tax, official_net, bes, garnishment, net_to_bank").eq("employee_id", emp.id).order("period", { ascending: false }).limit(12),
      supabase.from("attendance_punches").select("direction, punched_at").eq("employee_id", emp.id).gte("punched_at", `${period}-01T00:00:00`).order("punched_at"),
    ]);
    const days = new Map<string, { in?: string; out?: string }>();
    for (const p of punches.data ?? []) {
      const d = p.punched_at.slice(0, 10);
      const cur = days.get(d) ?? {};
      if (p.direction === "IN" && !cur.in) cur.in = p.punched_at.slice(11, 16);
      if (p.direction === "OUT") cur.out = p.punched_at.slice(11, 16);
      days.set(d, cur);
    }
    return { sum: sum.data, entries: entries.data ?? [], payroll: payroll.data ?? [], days: [...days.entries()].reverse() };
  }, [emp?.id, period]);

  if (!emp) return <Screen><Empty text="Hesabınız bir personel kaydına bağlı değil." /></Screen>;
  const n = (v: unknown) => Number(v ?? 0);
  const s = data?.sum;

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Segmented value={tab} onChange={setTab} options={[["ozet", "Özet"], ["bordro", "Bordro"], ["puantaj", "Puantaj"]]} />
      {tab === "ozet" && (
        <>
          <Text style={{ color: C.muted, fontWeight: "600" }}>{periodLabel(period)}</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            <Stat label="Hakediş" value={tl(n(s?.accrued))} />
            <Stat label="Ödenen" value={tl(n(s?.paid_bank) + n(s?.paid_cash))} sub={`Banka ${tl(n(s?.paid_bank))}\nElden ${tl(n(s?.paid_cash))}`} />
            <Stat label="Kesinti" value={tl(n(s?.deductions))} />
            <Stat label="Kalan" value={tl(n(s?.balance))} />
          </View>
          <Card title="Hesap hareketleri">
            {(data?.entries ?? []).map((e) => (
              <Row
                key={e.id}
                left={TYPE_LABEL[e.type] ?? e.type}
                sub={`${dmy(e.entry_date)}${e.channel === "BANK" ? " · Banka" : e.channel === "CASH" ? " · Elden" : ""}${e.note ? ` · ${e.note}` : ""}`}
                right={<Text style={{ fontWeight: "700", color: CREDIT.includes(e.type) ? C.ok : C.ink, fontVariant: ["tabular-nums"] }}>{CREDIT.includes(e.type) ? "+" : "−"}{tl(e.amount)}</Text>}
              />
            ))}
            {(data?.entries ?? []).length === 0 && <Empty text="Hareket yok." />}
          </Card>
        </>
      )}
      {tab === "bordro" &&
        ((data?.payroll ?? []).length ? (
          (data?.payroll ?? []).map((p) => (
            <Card key={p.period} title={periodLabel(p.period)} right={<Text style={{ color: C.muted }}>{p.days} gün</Text>}>
              <Row left="Brüt ücret" right={tl(p.official_gross)} />
              <Row left="SGK işçi payı" right={`−${tl(p.sgk_employee)}`} />
              <Row left="İşsizlik sigortası" right={`−${tl(p.unemployment_employee)}`} />
              <Row left="Gelir vergisi" right={`−${tl(p.income_tax)}`} />
              <Row left="Damga vergisi" right={`−${tl(p.stamp_tax)}`} />
              <Row left="Net ücret" right={tl(p.official_net)} />
              {n(p.bes) > 0 && <Row left="BES" right={`−${tl(p.bes)}`} />}
              {n(p.garnishment) > 0 && <Row left="İcra / nafaka" right={`−${tl(p.garnishment)}`} />}
              <Row left="Bankaya yatan" right={<Text style={{ fontWeight: "800", color: C.brand700 }}>{tl(p.net_to_bank)}</Text>} />
            </Card>
          ))
        ) : (
          <Card><Empty text="Henüz bordro yok." /></Card>
        ))}
      {tab === "puantaj" && (
        <Card title={`${periodLabel(period)} okutmalar`}>
          {(data?.days ?? []).map(([d, v]) => (
            <Row key={d} left={dmy(d)} right={`${v.in ?? "—"}  →  ${v.out ?? "—"}`} />
          ))}
          {(data?.days ?? []).length === 0 && <Empty text="Bu ay okutma yok." />}
        </Card>
      )}
    </Screen>
  );
}
