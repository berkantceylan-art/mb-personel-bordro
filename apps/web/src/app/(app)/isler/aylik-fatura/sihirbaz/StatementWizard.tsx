"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BulkDocActions, DocActions, WizardSteps, type DocMarks } from "@/components/DocActions";
import { backfillLoose, createStatementsSel } from "@/lib/billing-actions";

export type SCust = { id: string; name: string; currency: string; address: string | null; tax_no: string | null; email: string | null; phone: string | null; doc_lang: string; langLabel: string; loose: number; billed: string[] };
export type SWaybill = { id: string; no: string; customer_id: string; date: string; dateLabel: string; job_count: number; total: number; currency: string; totalLabel: string; open: boolean };
export type SStatement = { id: string; no: string; customer: string; period: string; job_count: number; totalLabel: string; email: string | null; waHref: string | null; marks: DocMarks };
type Check = { key: string; level: "error" | "warn" | "info"; text: string; href?: string };

const STEPS = ["Dönem", "Müşteriler", "İrsaliyeler", "Kontrol listesi", "Kes ve gönder"];
const LV = { error: ["bg-bad-bg text-bad", "Hata"], warn: ["bg-warn-bg text-warn", "Uyarı"], info: ["bg-[#EEF2F6] text-muted", "Bilgi"] } as const;
const fmtSum = (ws: SWaybill[]) => {
  const by = new Map<string, number>();
  for (const w of ws) by.set(w.currency, (by.get(w.currency) ?? 0) + w.total);
  return [...by.entries()].map(([c, v]) => `${(v / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${c === "EUR" ? "€" : c === "USD" ? "$" : "₺"}`).join(" + ") || "0";
};

export function StatementWizard({ ym, from, to, customers, waybills, statements }: { ym: string; from: string; to: string; customers: SCust[]; waybills: SWaybill[]; statements: SStatement[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const billable = useMemo(() => customers.filter((c) => waybills.some((w) => w.customer_id === c.id)), [customers, waybills]);
  const [custSel, setCustSel] = useState<Set<string>>(() => new Set(billable.map((c) => c.id)));
  const [wbSel, setWbSel] = useState<Set<string>>(() => new Set(waybills.map((w) => w.id)));
  const [ack, setAck] = useState<Set<string>>(new Set());
  const [issue, setIssue] = useState(to);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; list?: string[] } | null>(null);
  const [created, setCreated] = useState<string[]>([]);
  const wOf = (cid: string) => waybills.filter((w) => w.customer_id === cid);
  const chosen = billable.filter((c) => custSel.has(c.id) && wOf(c.id).some((w) => wbSel.has(w.id)));
  const toggle = (set: Set<string>, id: string) => { const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); return n; };

  const checks = useMemo<Check[]>(() => {
    const out: Check[] = [];
    for (const c of chosen) {
      const sel = wOf(c.id).filter((w) => wbSel.has(w.id));
      const curs = [...new Set(sel.map((w) => w.currency))];
      if (curs.length > 1) out.push({ key: `mix-${c.id}`, level: "error", text: `${c.name}: seçilen irsaliyelerde farklı para birimi var (${curs.join(", ")}). Tek para birimi seçin.` });
      else if (curs[0] && curs[0] !== c.currency) out.push({ key: `cur-${c.id}`, level: "warn", text: `${c.name}: irsaliyeler ${curs[0]}, müşterinin para birimi ${c.currency}.`, href: `/isler/hekimler/${c.id}` });
      if (c.loose) out.push({ key: `loose-${c.id}`, level: "warn", text: `${c.name}: bu ay ${c.loose} iş irsaliyesiz teslim edilmiş; faturaya girmesi için önce irsaliyeye ekleyin (aşağıdaki düğme).` });
      if (c.billed.length) out.push({ key: `dup-${c.id}`, level: "warn", text: `${c.name}: bu dönem için zaten fatura var (${c.billed.join(", ")}). Mükerrer olmadığından emin olun.` });
      const unselected = wOf(c.id).filter((w) => !wbSel.has(w.id)).length;
      if (unselected) out.push({ key: `uns-${c.id}`, level: "info", text: `${c.name}: ${unselected} irsaliye seçilmedi; sonraki faturada seçilebilir.` });
      if (!c.address?.trim()) out.push({ key: `adr-${c.id}`, level: "warn", text: `${c.name}: adres eksik.`, href: `/isler/hekimler/${c.id}` });
      if (!c.tax_no?.trim()) out.push({ key: `tax-${c.id}`, level: "info", text: `${c.name}: vergi no eksik.`, href: `/isler/hekimler/${c.id}` });
      if (!c.email) out.push({ key: `mail-${c.id}`, level: "info", text: `${c.name}: e-posta yok — fatura e-postayla gönderilemez.`, href: `/isler/hekimler/${c.id}` });
    }
    const looseOthers = customers.filter((c) => c.loose && !waybills.some((w) => w.customer_id === c.id));
    for (const c of looseOthers) out.push({ key: `lo2-${c.id}`, level: "warn", text: `${c.name}: ${c.loose} irsaliyesiz teslim var ama hiç irsaliyesi yok; faturalanması için irsaliyeye ekleyin.` });
    return out;
  }, [chosen, wbSel, customers, waybills]); // eslint-disable-line react-hooks/exhaustive-deps
  const blocking = checks.filter((c) => c.level !== "info");
  const hasError = checks.some((c) => c.level === "error");
  const checksDone = !hasError && blocking.filter((c) => c.level === "warn").every((c) => ack.has(c.key));
  const looseCust = customers.filter((c) => c.loose).map((c) => c.id);
  const done = [billable.length > 0, chosen.length > 0, chosen.length > 0, checksDone && chosen.length > 0, created.length > 0];
  const canNext = step === 0 ? billable.length > 0 : step === 1 || step === 2 ? chosen.length > 0 : step === 3 ? checksDone : true;
  const next = step < 4 && <button type="button" onClick={() => setStep(step + 1)} disabled={!canNext} className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-40">Devam →</button>;
  const back = step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="h-11 px-4 rounded-[10px] border border-line bg-white font-semibold">← Geri</button>;
  const resultList = created.length ? statements.filter((x) => created.includes(x.id)) : statements;

  return (
    <section className="flex flex-col gap-4">
      <WizardSteps steps={STEPS} current={step} done={done} onGo={setStep} />
      <div className="rounded-[18px] border border-line bg-white p-4 md:p-5 flex flex-col gap-4">
        {step === 0 && (
          <>
            <h2 className="font-display text-xl font-bold">1. Dönem özeti</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {[["Faturalanacak müşteri", String(billable.length)], ["Faturalanmamış irsaliye", String(waybills.length)], ["Faturalanmamış tutar", fmtSum(waybills)], ["Bu ay kesilen fatura", String(statements.length)]].map(([l, v]) => (
                <div key={l} className="rounded-xl border border-line p-3"><div className="text-xs text-muted">{l}</div><div className="font-display text-xl font-bold">{v}</div></div>
              ))}
            </div>
            {looseCust.length > 0 && <p className="rounded-xl bg-warn-bg text-warn p-3 text-sm font-semibold">⚠ {looseCust.length} müşteride irsaliyesiz teslim var; kontrol listesinde irsaliyeye ekleyebilirsiniz.</p>}
            {!billable.length && <p className="text-muted">Bu ay faturalanacak irsaliye yok.</p>}
            <div className="flex gap-2">{next}</div>
          </>
        )}
        {step === 1 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-xl font-bold mr-auto">2. Müşteriler</h2>
              <button type="button" onClick={() => setCustSel(custSel.size === billable.length ? new Set() : new Set(billable.map((c) => c.id)))} className="h-10 px-3 rounded-[10px] border border-line text-sm font-semibold text-brand-700">Tümünü seç / kaldır</button>
            </div>
            <ul className="flex flex-col divide-y divide-[#EEF2F6]">
              {billable.map((c) => {
                const ws = wOf(c.id);
                const tags = [c.loose ? "irsaliyesiz iş var" : null, c.billed.length ? "bu ay faturası var" : null, !c.address || !c.tax_no ? "bilgi eksik" : null].filter(Boolean);
                return (
                  <li key={c.id}>
                    <label className="py-2.5 flex flex-wrap items-center gap-3 cursor-pointer">
                      <input type="checkbox" checked={custSel.has(c.id)} onChange={() => setCustSel(toggle(custSel, c.id))} className="w-5 h-5" />
                      <b className="min-w-56">{c.name}</b>
                      <span className="text-sm text-muted">{ws.length} irsaliye · {ws.reduce((a, w) => a + w.job_count, 0)} iş</span>
                      <span className="text-sm font-semibold">{fmtSum(ws)}</span>
                      <span className="text-xs text-muted">{c.langLabel}</span>
                      {tags.length ? tags.map((t) => <span key={t} className="text-[11px] font-semibold rounded bg-warn-bg text-warn px-1.5 py-0.5">{t}</span>) : <span className="text-[11px] font-semibold rounded bg-ok-bg text-ok px-1.5 py-0.5">hazır</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-2">{back}{next}</div>
          </>
        )}
        {step === 2 && (
          <>
            <h2 className="font-display text-xl font-bold">3. Faturaya girecek irsaliyeler</h2>
            <p className="text-sm text-muted">İstemediğiniz irsaliyenin işaretini kaldırın; faturaya girmez ve sonra faturalanabilir.</p>
            {billable.filter((c) => custSel.has(c.id)).map((c) => {
              const ws = wOf(c.id);
              const all = ws.every((w) => wbSel.has(w.id));
              const sel = ws.filter((w) => wbSel.has(w.id));
              return (
                <div key={c.id} className="rounded-xl border border-line overflow-hidden">
                  <label className="flex flex-wrap items-center gap-3 bg-[#F3F6F9] px-3 py-2 font-semibold">
                    <input type="checkbox" checked={all} onChange={() => setWbSel((x) => { const n = new Set(x); for (const w of ws) { if (all) n.delete(w.id); else n.add(w.id); } return n; })} className="w-5 h-5" />
                    {c.name}<span className="ml-auto text-sm">{sel.length}/{ws.length} irsaliye · {fmtSum(sel)}</span>
                  </label>
                  <table className="w-full text-sm">
                    <tbody>
                      {ws.map((w) => (
                        <tr key={w.id} className="border-t border-[#EEF2F6]">
                          <td className="p-2 w-10"><input type="checkbox" checked={wbSel.has(w.id)} onChange={() => setWbSel(toggle(wbSel, w.id))} className="w-5 h-5" aria-label={w.no} /></td>
                          <td className="p-2 font-mono text-xs">{w.no}</td><td className="p-2">{w.dateLabel}</td><td className="p-2 text-right">{w.job_count} iş</td><td className="p-2 text-right font-semibold">{w.totalLabel}</td>
                          <td className="p-2 text-xs">{w.open ? <span className="text-warn">açık</span> : <span className="text-ok">kesildi</span>}</td>
                          <td className="p-2 text-right"><Link href={`/yazdir/irsaliye/${w.id}`} target="_blank" className="text-xs font-semibold text-brand-700">Gör ↗</Link></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
            <div className="flex gap-2">{back}{next}</div>
          </>
        )}
        {step === 3 && (
          <>
            <h2 className="font-display text-xl font-bold">4. Kontrol listesi</h2>
            <p className="text-sm text-muted">{chosen.length} müşteriye fatura kesilecek. Hatalar düzeltilmeden ilerlenemez; uyarıları kontrol edip işaretleyin.</p>
            {looseCust.length > 0 && (
              <button type="button" disabled={busy} onClick={async () => { setBusy(true); const r = await backfillLoose(looseCust, from, to); setBusy(false); setMsg({ ok: r.ok, text: r.message }); router.refresh(); }}
                className="self-start h-10 px-4 rounded-[10px] border border-warn text-warn text-sm font-semibold">İrsaliyesiz teslimleri irsaliyeye ekle ({customers.filter((c) => c.loose).reduce((a, c) => a + c.loose, 0)} iş)</button>
            )}
            {checks.length === 0 && <p className="rounded-xl bg-ok-bg text-ok p-3 font-semibold">✓ Bütün kontroller tamam.</p>}
            <ul className="flex flex-col gap-1.5">
              {checks.map((i) => (
                <li key={i.key} className="flex flex-wrap items-center gap-2 text-sm rounded-lg border border-[#EEF2F6] px-3 py-2">
                  {i.level === "warn" ? <input type="checkbox" checked={ack.has(i.key)} onChange={() => setAck(toggle(ack, i.key))} className="w-5 h-5" aria-label="Kontrol ettim" /> : <span className="w-5 text-center">{i.level === "error" ? "✗" : ""}</span>}
                  <span className={`text-[11px] font-semibold rounded px-1.5 py-0.5 ${LV[i.level][0]}`}>{LV[i.level][1]}</span>
                  <span className="flex-1">{i.text}</span>
                  {i.href && <Link href={i.href} target="_blank" className="text-xs font-semibold text-brand-700">Aç ↗</Link>}
                </li>
              ))}
            </ul>
            {blocking.some((c) => c.level === "warn") && <button type="button" onClick={() => setAck(new Set(blocking.map((c) => c.key)))} className="self-start text-sm font-semibold text-brand-700">Tüm uyarıları kontrol ettim</button>}
            <div className="grid gap-3 md:grid-cols-[200px_1fr] items-end">
              <label className="flex flex-col gap-1 text-sm">Fatura tarihi<input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" /></label>
              <label className="flex flex-col gap-1 text-sm">Faturaya not (isteğe bağlı)<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3" /></label>
            </div>
            {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
            <div className="flex flex-wrap gap-2">{back}
              <button type="button" disabled={!checksDone || busy || !chosen.length} onClick={async () => {
                if (!confirm(`${chosen.length} müşteriye fatura kesilsin mi?`)) return;
                setBusy(true); setMsg(null);
                const r = await createStatementsSel(chosen.map((c) => ({ customer: c.id, waybills: wOf(c.id).filter((w) => wbSel.has(w.id)).map((w) => w.id) })), issue, note);
                setBusy(false);
                const errs = (r.errors ?? []).map((e) => `${customers.find((c) => c.id === e.customer)?.name ?? ""}: ${e.message}`);
                setMsg({ ok: r.ok, text: r.message, list: errs });
                if (r.created?.length) { setCreated(r.created); setStep(4); }
                router.refresh();
              }} className="h-11 px-6 rounded-[10px] bg-[#0F7B4F] text-white font-bold disabled:opacity-40">{busy ? "Kesiliyor…" : `✓ ${chosen.length} faturayı kes`}</button>
            </div>
          </>
        )}
        {step === 4 && (
          <>
            <h2 className="font-display text-xl font-bold">5. Yazdır ve gönder</h2>
            {msg && <div className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}{msg.list && msg.list.length > 0 && <ul className="list-disc pl-5 text-xs mt-1 text-bad">{msg.list.map((x, i) => <li key={i}>{x}</li>)}</ul>}</div>}
            <p className="text-sm text-muted">{created.length ? `Yeni kesilen ${resultList.length} fatura` : `Bu ayın ${resultList.length} faturası`} · her satırda yapılanların yanında ✓ görünür.</p>
            <BulkDocActions kind="statement" ids={resultList.map((x) => x.id)} printHref={created.length ? `/yazdir/ic-fatura/toplu?ay=${ym}&id=${created.join(",")}` : `/yazdir/ic-fatura/toplu?ay=${ym}`} excelHref={`/isler/belge-excel?tur=fatura&id=${resultList.map((x) => x.id).join(",")}`} />
            <div className="flex flex-col divide-y divide-[#EEF2F6]">
              {resultList.map((x) => (
                <div key={x.id} className="py-3 flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-3"><b>{x.customer}</b><span className="font-mono text-xs text-muted">{x.no}</span><span className="text-sm text-muted">{x.period}</span><span className="text-sm">{x.job_count} iş · <b>{x.totalLabel}</b></span></div>
                  <DocActions kind="statement" id={x.id} printHref={`/yazdir/ic-fatura/${x.id}`} waHref={x.waHref} email={x.email} marks={x.marks} />
                </div>
              ))}
              {!resultList.length && <p className="py-6 text-center text-muted">Henüz fatura yok.</p>}
            </div>
            <div className="flex gap-2">{back}</div>
          </>
        )}
      </div>
    </section>
  );
}
