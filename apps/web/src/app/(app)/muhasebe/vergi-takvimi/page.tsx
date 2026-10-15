import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, Notice, btnSecondary, page, selectCls, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { glError } from "@/lib/gl";
import { glFilingSet } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Item = { kind: string; period: string; due: string; status: string; amount: number | null; note: string | null };

const KIND: Record<string, [string, string | null]> = {
  kdv1: ["KDV1 beyannamesi", "kdv"],
  kdv2: ["KDV2 (sorumlu sıfatıyla)", "kdv2"],
  muhsgk: ["Muhtasar ve prim hizmet", "muhtasar"],
  damga: ["Damga vergisi beyannamesi", "damga"],
  gecici: ["Geçici vergi (kurumlar)", "vergi"],
  kurumlar: ["Kurumlar vergisi", "vergi"],
  edefter: ["e-Defter berat yükleme", null],
};
const STATUS: Array<[string, string, string]> = [
  ["todo", "Bekliyor", "text-ink"],
  ["prepared", "Hazırlandı", "text-[#B45309]"],
  ["filed", "Verildi", "text-ok"],
  ["paid", "Ödendi", "text-ok"],
  ["none", "Bu dönem yok", "text-muted"],
];

/** Vergi takvimi: önümüzdeki 3 ayın son günleri ve durumları */
export default async function TaxCalendar() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const end = new Date(Date.parse(today) + 92 * 86400000).toISOString().slice(0, 10);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_tax_calendar", { p_from: today, p_to: end });
  const items = (data ?? []) as Item[];
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  const days = (d: string) => Math.round((Date.parse(d) - Date.parse(today)) / 86400000);
  const open = items.filter((i) => !["filed", "paid", "none"].includes(i.status));
  const late = open.filter((i) => days(i.due) < 0);
  const week = open.filter((i) => days(i.due) >= 0 && days(i.due) <= 7);
  return (
    <>
      <PageHeader title="Vergi takvimi" subtitle="A.Ş. için beyanname son günleri · hafta sonuna denk gelen gün ilk iş gününe kayar" actions={<Link href="/muhasebe/beyanname" className="text-sm font-semibold text-brand-700">Beyanname hazırlık</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270212000000_tax_center.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <KPI label="Süresi geçmiş" value={String(late.length)} tone={late.length ? "bad" : "ok"} sub="son 31 gün" />
          <KPI label="Bu hafta" value={String(week.length)} tone={week.length ? "bad" : undefined} />
          <KPI label="Önümüzdeki 3 ay" value={String(items.length)} />
        </div>
        <Card>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Son gün</th><th className={th}>Beyanname</th><th className={th}>Dönem</th><th className={th}>Durum</th>{canEdit && <th className={th} />}</tr></thead>
            <tbody>
              {items.map((i) => {
                const d = days(i.due);
                const done = ["filed", "paid", "none"].includes(i.status);
                const [label, sekme] = KIND[i.kind] ?? [i.kind, null];
                const ay = /^\d{4}-\d{2}$/.test(i.period) ? i.period : null;
                const st = STATUS.find((x) => x[0] === i.status) ?? STATUS[0]!;
                return (
                  <tr key={`${i.kind}-${i.period}`} className={done ? "opacity-60" : ""}>
                    <td className={td}><b>{formatDate(i.due)}</b><div className={`text-xs ${!done && d < 0 ? "text-bad font-semibold" : !done && d <= 7 ? "text-[#B45309]" : "text-muted"}`}>{d === 0 ? "bugün" : d > 0 ? `${d} gün kaldı` : `${-d} gün geçti`}</div></td>
                    <td className={td}>{sekme === "vergi" ? <Link href={`/muhasebe/vergi?yil=${i.period.slice(0, 4)}&donem=${i.kind === "kurumlar" ? 4 : i.period.slice(-1)}`} className="font-semibold text-brand-700">{label}</Link> : sekme && ay ? <Link href={`/muhasebe/beyanname?ay=${ay}&sekme=${sekme}`} className="font-semibold text-brand-700">{label}</Link> : label}{i.note ? <div className="text-xs text-muted">{i.note}</div> : null}</td>
                    <td className={`${td} num`}>{i.period}</td>
                    <td className={`${td} font-semibold ${st[2]}`}>{st[1]}</td>
                    {canEdit && (
                      <td className={td}>
                        <form action={glFilingSet} className="flex gap-2">
                          <input type="hidden" name="kind" value={i.kind} /><input type="hidden" name="period" value={i.period} />
                          <select name="status" defaultValue={i.status} className={`${selectCls} h-9 w-40`}>{STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                          <PendingSubmit className={`${btnSecondary} h-9`}>Kaydet</PendingSubmit>
                        </form>
                      </td>
                    )}
                  </tr>
                );
              })}
              {!items.length && !error && <tr><td colSpan={5} className="py-6 text-center text-muted">Yaklaşan beyanname yok.</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <p className="text-xs text-muted">Son günler genel kurala göre hesaplanır: KDV2 izleyen ayın 25&apos;i, muhtasar ve damga 26&apos;sı, KDV1 28&apos;i; geçici vergi dönemi izleyen 2. ayın 17&apos;si; kurumlar vergisi Nisan sonu; e-Defter beratı (aylık seçim) 4. ayın 14&apos;ü. Resmi tatiller ve Gelir İdaresi&apos;nin süre uzatımları ayrıca kontrol edilmelidir.</p>
      </div>
    </>
  );
}
