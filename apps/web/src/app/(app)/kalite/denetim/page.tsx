import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { createAudit, saveAudit } from "@/lib/quality-actions";
import { QNav } from "../QNav";

export const dynamic = "force-dynamic";

type Item = { text: string; result: "ok" | "nok" | "na" | null; note: string };
type Au = { id: string; title: string; audit_date: string; auditor: string | null; items: Item[]; summary: string | null; status: string };

/** İç denetim kontrol listeleri */
export default async function AuditPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.production ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const canEdit = (s.modules.production ?? 0) >= 2 || (s.modules.lab ?? 0) >= 2;
  const supabase = await createClient();
  const { data } = await supabase.from("qms_audits").select("*").order("audit_date", { ascending: false }).limit(100);
  const audits = (data ?? []) as Au[];
  const sel = audits.find((a) => a.id === sp.id) ?? null;
  const score = (a: Au) => { const r = a.items.filter((i) => i.result === "ok" || i.result === "nok"); return r.length ? Math.round((r.filter((i) => i.result === "ok").length / r.length) * 100) : null; };
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm";

  return (
    <>
      <PageHeader title="İç denetim" subtitle="ISO 13485 / MDR ısmarlama cihaz temel maddeleriyle hazır kontrol listesi; madde ekleyip uyarlayabilirsiniz" />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        <QNav at="/kalite/denetim" />
        {sel ? (
          <Card title={`${sel.title} · ${formatDate(sel.audit_date)}`} action={<Link href="/kalite/denetim" className="text-sm font-semibold text-brand-700">Listeye dön</Link>}>
            <form action={saveAudit} className="flex flex-col gap-2">
              <input type="hidden" name="id" value={sel.id} />
              <input type="hidden" name="n" value={sel.items.length} />
              <ol className="divide-y divide-[#EEF2F6]">
                {sel.items.map((it, i) => (
                  <li key={i} className="py-2 flex flex-wrap gap-2 items-center text-sm">
                    <input type="hidden" name={`t${i}`} value={it.text} />
                    <span className="flex-1 min-w-[260px]">{i + 1}. {it.text}</span>
                    <span className="flex gap-1">
                      {([["ok", "Uygun", "peer-checked:bg-ok peer-checked:text-white"], ["nok", "Uygun değil", "peer-checked:bg-bad peer-checked:text-white"], ["na", "Kapsam dışı", "peer-checked:bg-[#64748B] peer-checked:text-white"]] as const).map(([v, l, cls]) => (
                        <label key={v} className="cursor-pointer"><input type="radio" name={`r${i}`} value={v} defaultChecked={it.result === v} className="peer sr-only" disabled={!canEdit} /><span className={`inline-block h-8 px-2 leading-8 rounded-[8px] border border-line text-xs font-semibold ${cls}`}>{l}</span></label>
                      ))}
                    </span>
                    <input name={`n${i}`} defaultValue={it.note} maxLength={300} placeholder="Bulgu / kanıt" className="h-8 w-56 rounded-[8px] border border-line px-2 text-xs" />
                  </li>
                ))}
              </ol>
              {canEdit && <input name="new_item" maxLength={300} placeholder="+ Yeni madde ekle (kaydedince listeye girer)" className={`${inp} w-full`} />}
              <textarea name="summary" defaultValue={sel.summary ?? ""} rows={3} maxLength={2000} placeholder="Denetim özeti, uygunsuzluklar için açılacak DÖF'ler" className="rounded-[10px] border border-line p-3 text-sm" />
              {canEdit && <div className="flex gap-2 items-center"><select name="status" defaultValue={sel.status} className={inp}><option value="draft">Sürüyor</option><option value="done">Tamamlandı</option></select><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit><span className="text-sm text-muted">Uygunluk: {score(sel) ?? "—"}{score(sel) !== null ? "%" : ""}</span></div>}
            </form>
          </Card>
        ) : (
          <>
            {canEdit && (
              <Card title="Yeni denetim">
                <form action={createAudit} className="flex flex-wrap gap-2 items-end">
                  <input name="title" defaultValue={`İç denetim ${new Date().getFullYear()}`} maxLength={160} className={`${inp} w-64`} />
                  <input name="auditor" maxLength={120} placeholder="Denetçi" className={`${inp} w-48`} />
                  <input type="date" name="audit_date" className={inp} />
                  <PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Başlat</PendingSubmit>
                </form>
              </Card>
            )}
            <section className="rounded-[18px] border border-line bg-white">
              <ul className="divide-y divide-[#EEF2F6]">
                {audits.map((a) => (
                  <li key={a.id} className="p-3 flex flex-wrap gap-3 items-center text-sm">
                    <Link href={`/kalite/denetim?id=${a.id}`} className="flex-1 font-semibold text-brand-700">{a.title}</Link>
                    <span className="text-muted">{formatDate(a.audit_date)}{a.auditor ? ` · ${a.auditor}` : ""}</span>
                    <span>{a.items.filter((i) => i.result === "nok").length ? <b className="text-bad">{a.items.filter((i) => i.result === "nok").length} uygunsuz</b> : null}</span>
                    <span className="font-semibold">{score(a) !== null ? `%${score(a)}` : "—"}</span>
                    <span className={`text-xs font-semibold ${a.status === "done" ? "text-ok" : "text-warn"}`}>{a.status === "done" ? "Tamamlandı" : "Sürüyor"}</span>
                  </li>
                ))}
                {audits.length === 0 && <li className="p-6 text-center text-sm text-muted">Denetim yok.</li>}
              </ul>
            </section>
          </>
        )}
      </div>
    </>
  );
}
