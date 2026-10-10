import Link from "next/link";
import { redirect } from "next/navigation";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { IsgNav } from "@/components/IsgNav";
import { Card, PageHeader } from "@/components/ui";
import { HAZARD_LABEL } from "@/lib/compliance";
import { RENEW_YEARS, level5x5, levelFK } from "@/lib/isg";
import { createAssessment } from "@/lib/isg-actions";
import { isgBase } from "@/lib/isg-data";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";

const input = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2.5 text-sm w-full";
const ST: Record<string, [string, string]> = { taslak: ["Taslak", "bg-warn-bg text-warn"], yururlukte: ["Yürürlükte", "bg-ok-bg text-ok"], arsiv: ["Arşiv", "bg-[#EEF2F6] text-[#5A6878]"] };

export default async function RiskList() {
  const s = await getSession();
  if (!["owner", "hr", "safety", "accountant", "branch_manager"].includes(s.role)) redirect("/");
  const can = ["owner", "hr", "safety"].includes(s.role);
  const supabase = await createClient();
  const base = await isgBase(supabase);
  const today = todayIso();
  const [{ data: list, error }, { data: items }] = await Promise.all([
    supabase.from("risk_assessments").select("*").order("done_on", { ascending: false }),
    supabase.from("risk_items").select("assessment_id, p, s, f, due_date, done_on"),
  ]);
  if (error) return (<><PageHeader title="Risk değerlendirmesi" /><div className="p-6"><Card><p className="text-sm">Bu bölüm için Supabase&apos;de <b>20261119000000_isg.sql</b> çalıştırılmalı.</p></Card></div></>);
  const cur = (list ?? []).find((a) => a.status === "yururlukte");
  return (
    <>
      <PageHeader title="Risk değerlendirmesi" subtitle={`${HAZARD_LABEL[base.hazard]} · ${RENEW_YEARS[base.hazard]} yılda bir yenilenir`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <IsgNav active="/isg/risk" />
        {!cur ? <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm">⚠ Yürürlükte risk değerlendirmesi yok. 6331 sayılı Kanun md. 10 gereği zorunludur.</div>
          : cur.valid_until < today ? <div className="rounded-xl bg-[#FDECEA] text-[#9B1C1C] p-3 text-sm">⚠ Risk değerlendirmesinin süresi {formatDate(cur.valid_until)} tarihinde doldu; yenileyin.</div> : null}
        <Card title="Değerlendirmeler">
          <ul className="flex flex-col gap-2">{(list ?? []).map((a) => {
            const its = (items ?? []).filter((x) => x.assessment_id === a.id);
            const lv = its.map((x) => (a.method === "fine-kinney" ? levelFK(Number(x.p) * Number(x.s) * Number(x.f ?? 1)) : level5x5(Number(x.p) * Number(x.s)))[0]);
            const high = lv.filter((l) => /Yüksek|Tolerans|Esaslı/.test(l)).length;
            const openAct = its.filter((x) => !x.done_on && x.due_date && x.due_date < today).length;
            const [l, c] = ST[a.status]!;
            return (
              <li key={a.id}><Link href={`/isg/risk/${a.id}`} className="rounded-xl border border-line p-3 flex flex-wrap items-center gap-3 hover:border-brand-700">
                <span className="flex-1 min-w-[220px]"><b>{a.title}</b><span className="block text-xs text-muted">{formatDate(a.done_on)} · geçerlilik {formatDate(a.valid_until)} · {a.method === "fine-kinney" ? "Fine-Kinney" : "5×5 matris"}</span></span>
                <span className="text-xs">{its.length} risk · <b className={high ? "text-bad" : ""}>{high} yüksek</b>{openAct ? <> · <b className="text-bad">{openAct} geciken önlem</b></> : null}</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c}`}>{l}</span>
              </Link></li>
            );
          })}{(list ?? []).length === 0 && <li className="text-sm text-muted">Henüz değerlendirme yok.</li>}</ul>
        </Card>
        {can && (
          <Card title="Yeni risk değerlendirmesi">
            <form action={createAssessment} className="grid gap-2 md:grid-cols-3 text-sm">
              <input name="title" required defaultValue={`${new Date().getFullYear()} risk değerlendirmesi`} className={`${input} md:col-span-2`} aria-label="Başlık" />
              <input type="date" name="done_on" required defaultValue={today} className={input} aria-label="Tarih" />
              <select name="method" className={input} aria-label="Yöntem"><option value="5x5">5×5 matris (olasılık × şiddet)</option><option value="fine-kinney">Fine-Kinney (olasılık × frekans × şiddet)</option></select>
              <label className="flex items-center gap-2 md:col-span-2"><input type="checkbox" name="template" defaultChecked className="w-4 h-4" />Diş protez laboratuvarı şablonuyla başla (silika tozu, kumlama, döküm, kimyasal, kompresör…)</label>
              <textarea name="team" rows={4} placeholder={"Değerlendirme ekibi (her satır: Ad Soyad | Görev)\nAhmet Yılmaz | İşveren vekili\nAyşe Demir | İş güvenliği uzmanı\nDr. Can Kaya | İşyeri hekimi\nMehmet Öz | Çalışan temsilcisi\nAli Er | Destek elemanı"} className="md:col-span-3 rounded-[10px] border border-[#D5DEE8] bg-white px-3 py-2 text-sm" aria-label="Ekip" />
              <p className="md:col-span-3 text-xs text-muted">Ekipte işveren veya vekili, iş güvenliği uzmanı, işyeri hekimi, çalışan temsilcisi ve destek elemanı bulunmalıdır (Risk Değerlendirmesi Yönetmeliği md. 6).</p>
              <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white font-semibold justify-self-start">Oluştur</PendingSubmit>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
