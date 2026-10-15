import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnSecondary, inputCls, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { glError } from "@/lib/gl";

export const dynamic = "force-dynamic";

type Item = { key: string; label: string; count: number; ok: boolean; acked?: boolean; severity: string; link: string; status?: string; late?: boolean };
type Stage = { key: string; no: number; title: string; desc: string; link: string; items: Item[]; status: "done" | "active" | "blocked" | "todo"; open: number; total: number; blocked_by: string[] };
type Cockpit = { month: string; locked: boolean; stages: Stage[]; next: { stage: string; label: string; count: string; link: string } | null; done: number; quarter_end: boolean; year_end: boolean };

const STATUS: Record<Stage["status"], [string, string, string]> = {
  done: ["Tamam", "bg-[#E6F4EC] text-[#1A7F52]", "bg-[#1A7F52] text-white"],
  active: ["Devam ediyor", "bg-[#FFF4E0] text-[#7A4F00]", "bg-[#E0A100] text-white"],
  blocked: ["Önceki aşamayı bekliyor", "bg-[#F2F4F7] text-muted", "bg-[#D5DEE8] text-ink"],
  todo: ["Başlanmadı", "bg-[#EEF3F9] text-brand-700", "bg-brand-700 text-white"],
};
const FILING: Record<string, string> = { todo: "yapılacak", prepared: "hazırlandı", filed: "verildi", paid: "ödendi", none: "yok" };
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const monthName = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
const shift = (m: string, d: number) => { const x = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + d, 1)); return x.toISOString().slice(0, 7); };

/** Muhasebe kokpiti: ayın kapanışı 6 aşamada, sıradaki iş ve eksikler tek ekranda */
export default async function Cockpit({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  let month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : null;
  if (!month) {
    const { data: wm } = await supabase.rpc("gl_working_month");
    month = typeof wm === "string" ? wm : new Date(Date.now() + 3 * 3600000 - 30 * 86400000).toISOString().slice(0, 7);
  }
  const { data, error } = await supabase.rpc("gl_cockpit", { p_month: month });
  const c = data as Cockpit | null;
  const titleOf = (k: string) => c?.stages.find((x) => x.key === k)?.title ?? k;

  return (
    <>
      <PageHeader title="Muhasebe kokpiti" subtitle={`${monthName(month)} · ayın kapanışı adım adım; hiçbir iş kaçmasın`} actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/muhasebe/kokpit?ay=${shift(month, -1)}`} className={btnSecondary} aria-label="Önceki ay">‹</Link>
          <form className="flex gap-2"><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button></form>
          <Link href={`/muhasebe/kokpit?ay=${shift(month, 1)}`} className={btnSecondary} aria-label="Sonraki ay">›</Link>
          {c?.locked && <span className="rounded-full bg-[#E6F4EC] text-[#1A7F52] px-3 py-1 text-sm font-semibold">Dönem kilitli</span>}
          {c?.quarter_end && <span className="rounded-full bg-[#EEF3F9] text-brand-700 px-3 py-1 text-sm font-semibold">{c.year_end ? "Yıl sonu" : "Çeyrek sonu"}</span>}
        </div>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270221000000_gl_cockpit.sql çalıştırılmalı." : glError(error.message)}</Notice>}

        {c && (
          <>
            <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
              <div className="flex flex-wrap items-baseline gap-2"><b className="text-lg">{c.done} / 6 aşama tamam</b><span className="text-sm text-muted">· {c.stages.reduce((a, x) => a + x.open, 0)} açık madde</span></div>
              <ol className="grid grid-cols-6 gap-1" aria-label="Aşamalar">
                {c.stages.map((x) => <li key={x.key} title={`${x.no}. ${x.title}: ${STATUS[x.status][0]}`} className={`h-2.5 rounded-full ${x.status === "done" ? "bg-[#1A7F52]" : x.status === "active" ? "bg-[#E0A100]" : x.status === "todo" ? "bg-brand-600" : "bg-[#D5DEE8]"}`} />)}
              </ol>
              {c.next ? (
                <div className="flex flex-wrap items-center gap-3 rounded-[12px] bg-[#EEF3F9] p-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-brand-700">Sıradaki iş</span>
                  <span className="font-semibold">{c.next.label}{Number(c.next.count) > 1 ? ` · ${c.next.count}` : ""}</span>
                  <span className="text-sm text-muted">({c.next.stage})</span>
                  <Link href={c.next.link} className="ml-auto text-sm font-semibold text-brand-700">Yap →</Link>
                </div>
              ) : <Notice tone="ok">Bu ayın bütün işleri tamam.</Notice>}
            </section>

            <ol className="flex flex-col gap-3">
              {c.stages.map((x) => {
                const [label, chip, num] = STATUS[x.status];
                return (
                  <li key={x.key} className={`bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3 ${x.status === "blocked" ? "opacity-80" : ""}`}>
                    <div className="flex flex-wrap items-center gap-3">
                      <span className={`grid place-items-center w-8 h-8 rounded-full font-bold text-sm ${num}`}>{x.status === "done" ? "✓" : x.no}</span>
                      <div className="flex flex-col">
                        <b>{x.title}</b>
                        <span className="text-sm text-muted">{x.desc}</span>
                      </div>
                      <span className={`ml-auto rounded-full px-2.5 py-1 text-xs font-semibold ${chip}`}>{label}{x.status !== "done" && x.total ? ` · ${x.total - x.open}/${x.total}` : ""}</span>
                      <Link href={x.link} className="text-sm font-semibold text-brand-700">Aç →</Link>
                    </div>
                    {x.status === "blocked" && x.blocked_by.length > 0 && <p className="text-xs text-muted">Önce: {x.blocked_by.map(titleOf).join(", ")}. Bu aşamada iş yapılabilir ama sıra bozulursa rakamlar değişebilir.</p>}
                    <ul className="text-sm divide-y divide-[#EEF2F6]">
                      {x.items.map((i) => (
                        <li key={i.key} className="py-2 flex items-center gap-3">
                          <span aria-hidden className={`w-5 text-center ${i.ok ? "text-[#1A7F52]" : i.severity === "critical" ? "text-bad" : i.severity === "warning" ? "text-[#B07A00]" : "text-muted"}`}>{i.ok ? "✓" : "●"}</span>
                          <Link href={i.link} className={i.ok ? "text-muted" : "text-ink hover:text-brand-700"}>{i.label}</Link>
                          {!i.ok && i.count > 0 && !i.status && <span className="text-xs rounded-full bg-[#F2F4F7] px-2 py-0.5">{i.count}</span>}
                          {i.status && <span className={`text-xs rounded-full px-2 py-0.5 ${i.ok ? "bg-[#E6F4EC] text-[#1A7F52]" : i.late ? "bg-[#FDECEC] text-bad" : "bg-[#F2F4F7]"}`}>{i.late ? "gecikti" : FILING[i.status] ?? i.status}</span>}
                          {i.acked && <span className="text-xs text-muted">bilerek geçildi</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
            <p className="text-xs text-muted">Her sabah 07:30&apos;da yönetici ve mali müşavire bu ekranın özeti bildirim olarak gider (açık iş varsa). Beyanname durumlarını Vergi takvimi ekranından işaretleyin.</p>
          </>
        )}
      </div>
    </>
  );
}
