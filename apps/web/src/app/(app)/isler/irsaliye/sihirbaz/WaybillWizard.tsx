"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkDocActions, DocActions, WizardSteps, type DocMarks } from "@/components/DocActions";
import { createWaybillsFor, issueWaybillsIds } from "@/lib/billing-actions";

export type WCust = { id: string; name: string; currency: string; address: string | null; tax_no: string | null; email: string | null; phone: string | null; doc_lang: string | null };
export type WJob = { id: string; no: number; patient: string | null; total: number; currency: string; customer_id: string; waybill_id: string | null; items: number; totalLabel: string };
export type WIssue = { key: string; level: "error" | "warn" | "info"; text: string; href?: string };
export type WWaybill = { id: string; no: string; customer_id: string; customer: string; status: string; billed: boolean; job_count: number; totalLabel: string; email: string | null; waHref: string | null; marks: DocMarks };

const STEPS = ["Teslimler", "Kontroller", "İrsaliye kes", "Yazdır ve gönder"];
const LV = { error: ["bg-bad-bg text-bad", "Hata"], warn: ["bg-warn-bg text-warn", "Uyarı"], info: ["bg-[#EEF2F6] text-muted", "Bilgi"] } as const;

export function WaybillWizard({ day, jobs, customers, issues, waybills }: { day: string; jobs: WJob[]; customers: WCust[]; issues: WIssue[]; waybills: WWaybill[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [ack, setAck] = useState<Set<string>>(new Set());
  const loose = jobs.filter((j) => !j.waybill_id);
  const [sel, setSel] = useState<Set<string>>(() => new Set(loose.map((j) => j.id)));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const cname = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const byCust = useMemo(() => {
    const m = new Map<string, WJob[]>();
    for (const j of loose) m.set(j.customer_id, [...(m.get(j.customer_id) ?? []), j]);
    return [...m.entries()];
  }, [loose]);
  const blocking = issues.filter((i) => i.level !== "info");
  const checksDone = blocking.every((i) => ack.has(i.key));
  const done = [jobs.length > 0 || waybills.length > 0, checksDone, loose.length === 0, waybills.length > 0 && waybills.every((w) => w.marks.print || w.marks.email || w.marks.whatsapp)];
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };
  const next = <button type="button" onClick={() => setStep(step + 1)} disabled={(step === 1 && !checksDone)} className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-40">Devam →</button>;
  const back = step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="h-11 px-4 rounded-[10px] border border-line bg-white font-semibold">← Geri</button>;
  const openIds = waybills.filter((w) => w.status === "open").map((w) => w.id);

  return (
    <section className="flex flex-col gap-4">
      <WizardSteps steps={STEPS} current={step} done={done} onGo={setStep} />
      <div className="rounded-[18px] border border-line bg-white p-4 md:p-5 flex flex-col gap-4">
        {step === 0 && (
          <>
            <h2 className="font-display text-xl font-bold">1. Günün teslimleri</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {[["Teslim edilen iş", jobs.length], ["İrsaliyeli", jobs.length - loose.length], ["İrsaliyesiz", loose.length], ["İrsaliye", waybills.length]].map(([l, v]) => (
                <div key={l as string} className={`rounded-xl border p-3 ${l === "İrsaliyesiz" && Number(v) > 0 ? "border-warn" : "border-line"}`}><div className="text-xs text-muted">{l}</div><div className="font-display text-2xl font-bold">{v}</div></div>
              ))}
            </div>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] text-sm">
              {customers.map((c) => {
                const cj = jobs.filter((j) => j.customer_id === c.id);
                if (!cj.length) return null;
                const lo = cj.filter((j) => !j.waybill_id).length;
                return <li key={c.id} className="py-2 flex flex-wrap items-center gap-2"><b className="min-w-56">{c.name}</b><span className="text-muted">{cj.length} iş</span>{lo ? <span className="text-warn font-semibold">⚠ {lo} irsaliyesiz</span> : <span className="text-ok font-semibold">✓ irsaliyeli</span>}</li>;
              })}
              {!jobs.length && <li className="py-6 text-center text-muted">Bu gün teslim edilen iş yok.</li>}
            </ul>
            <div className="flex gap-2">{next}</div>
          </>
        )}
        {step === 1 && (
          <>
            <h2 className="font-display text-xl font-bold">2. Kontroller</h2>
            <p className="text-sm text-muted">Her satırı kontrol edip işaretleyin. Hatalı işi bağlantıdan açıp düzeltebilirsiniz; düzelttikten sonra sayfayı yenileyin.</p>
            {issues.length === 0 && <p className="rounded-xl bg-ok-bg text-ok p-3 font-semibold">✓ Sorun bulunmadı.</p>}
            <ul className="flex flex-col gap-1.5">
              {issues.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-[#EEF2F6] px-3 py-2">
                  {i.level !== "info" ? <input type="checkbox" checked={ack.has(i.key)} onChange={() => setAck(toggle(ack, i.key))} className="w-5 h-5" aria-label="Kontrol ettim" /> : <span className="w-5" />}
                  <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${LV[i.level][0]}`}>{LV[i.level][1]}</span>
                  <span className="flex-1">{i.text}</span>
                  {i.href && <Link href={i.href} target="_blank" className="text-xs font-semibold text-brand-700">Aç ↗</Link>}
                </li>
              ))}
            </ul>
            {blocking.length > 0 && <button type="button" onClick={() => setAck(new Set(blocking.map((i) => i.key)))} className="self-start text-sm font-semibold text-brand-700">Hepsini kontrol ettim olarak işaretle</button>}
            <div className="flex gap-2">{back}{next}<button type="button" onClick={() => router.refresh()} className="h-11 px-4 rounded-[10px] border border-line bg-white font-semibold">↻ Yenile</button></div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="font-display text-xl font-bold">3. İrsaliye kes</h2>
            {!loose.length ? <p className="rounded-xl bg-ok-bg text-ok p-3 font-semibold">✓ Bütün teslimlerin irsaliyesi var.</p> : (
              <>
                <p className="text-sm text-muted">İrsaliyeye girecek işleri seçin; her müşteri için ayrı irsaliye açılır.</p>
                {byCust.map(([cid, js]) => {
                  const all = js.every((j) => sel.has(j.id));
                  return (
                    <div key={cid} className="rounded-xl border border-line p-3 flex flex-col gap-2">
                      <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={all} onChange={() => setSel((x) => { const n = new Set(x); for (const j of js) { if (all) n.delete(j.id); else n.add(j.id); } return n; })} className="w-5 h-5" />{cname.get(cid) ?? "—"} <span className="text-xs font-normal text-muted">{js.length} iş</span></label>
                      <div className="flex flex-wrap gap-2">{js.map((j) => <label key={j.id} className="flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-xs"><input type="checkbox" checked={sel.has(j.id)} onChange={() => setSel(toggle(sel, j.id))} />#{j.no}{j.patient ? ` ${j.patient}` : ""} · {j.totalLabel}</label>)}</div>
                    </div>
                  );
                })}
                <button type="button" disabled={busy || !loose.some((j) => sel.has(j.id))} onClick={async () => {
                  setBusy(true); setMsg(null);
                  const r = await createWaybillsFor(day, byCust.map(([cid, js]) => ({ customer: cid, jobs: js.filter((j) => sel.has(j.id)).map((j) => j.id) })).filter((g) => g.jobs.length));
                  setBusy(false); setMsg({ ok: r.ok, text: r.message }); router.refresh();
                }} className="self-start h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-40">{busy ? "Oluşturuluyor…" : `Seçilenlere irsaliye kes (${loose.filter((j) => sel.has(j.id)).length} iş)`}</button>
              </>
            )}
            {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
            <div className="flex gap-2">{back}{next}</div>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="font-display text-xl font-bold">4. Yazdır ve gönder</h2>
            <BulkDocActions kind="waybill" ids={waybills.map((w) => w.id)} printHref={`/yazdir/irsaliye/toplu?gun=${day}`} excelHref={`/isler/belge-excel?tur=irsaliye&gun=${day}`} />
            {openIds.length > 0 && (
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await issueWaybillsIds(openIds); setBusy(false); setMsg({ ok: r.ok, text: r.message }); router.refresh(); }}
                className="self-start h-10 px-4 rounded-[10px] border border-ok text-ok text-sm font-semibold">Açık {openIds.length} irsaliyeyi “kesildi” yap</button>
            )}
            {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
            <div className="flex flex-col divide-y divide-[#EEF2F6]">
              {waybills.map((w) => (
                <div key={w.id} className="py-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Link href={`/isler/irsaliye/${w.id}`} className="font-semibold text-brand-700">{w.customer}</Link>
                    <span className="font-mono text-xs text-muted">{w.no}</span>
                    <span className="text-sm">{w.job_count} iş · <b>{w.totalLabel}</b></span>
                    <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${w.billed ? "bg-[#EEF2F6]" : w.status === "issued" ? "bg-ok-bg text-ok" : "bg-warn-bg text-warn"}`}>{w.billed ? "Faturalandı" : w.status === "issued" ? "Kesildi" : "Açık"}</span>
                  </div>
                  <DocActions kind="waybill" id={w.id} printHref={`/yazdir/irsaliye/${w.id}`} waHref={w.waHref} email={w.email} marks={w.marks} />
                </div>
              ))}
              {!waybills.length && <p className="py-6 text-center text-muted">Bu gün irsaliye yok.</p>}
            </div>
            <div className="flex gap-2">{back}<Link href={`/isler/aylik-fatura/sihirbaz?ay=${day.slice(0, 7)}`} className="h-11 px-5 inline-flex items-center rounded-[10px] border border-line font-semibold text-brand-700">Ay sonu fatura sihirbazına geç →</Link></div>
          </>
        )}
      </div>
    </section>
  );
}
