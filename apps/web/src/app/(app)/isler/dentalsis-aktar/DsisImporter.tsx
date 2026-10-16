"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dsisImportBalance, dsisImportBatch, dsisImportRef, type DsisFiles, type DsisStep } from "@/lib/dsis-actions";

type Log = { ok: boolean; text: string };

const LABEL: Record<string, string> = {
  customers_new: "yeni hekim/hastane", customers_linked: "mevcut hekimle eşleşti", products_new: "yeni ürün", products_linked: "mevcut ürünle eşleşti",
  inserted: "iş eklendi", skipped_existing: "zaten aktarılmış", skipped_deleted: "silinmiş (atlandı)", customers_created: "işten hekim oluşturuldu",
  currency_mismatch: "para birimi hekimden farklı", renumbered: "numarası çakıştı, yeni no verildi",
  payments: "tahsilat", adjusted: "bakiye eşitlendi", unmatched_payments: "hekimi bulunamayan tahsilat",
};
const fmt = (r?: Record<string, unknown>) => (r ? Object.entries(r).filter(([k, v]) => LABEL[k] && Number(v)).map(([k, v]) => `${Number(v).toLocaleString("tr-TR")} ${LABEL[k]}`).join(" · ") : "");

export function DsisImporter({ files }: { files: DsisFiles }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Log[]>([]);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const stop = useRef(false);
  const router = useRouter();
  const st = files.status as Record<string, number | string | null> | null;
  const add = (l: Log) => setLog((x) => [l, ...x].slice(0, 200));

  async function run(withBalance: boolean) {
    setBusy(true); stop.current = false; setLog([]); setTotals({});
    const total = files.jobs.length + 1 + (withBalance ? 1 : 0);
    let done = 0; setProg({ done, total });
    const step = async (p: Promise<DsisStep>) => { const r = await p.catch((e) => ({ ok: false, message: String(e) }) as DsisStep); add({ ok: r.ok, text: `${r.message}${r.result ? " — " + fmt(r.result) : ""}` }); setProg({ done: ++done, total }); return r; };
    const ref = await step(dsisImportRef());
    if (!ref.ok) { setBusy(false); return; }
    const sum: Record<string, number> = {};
    for (const name of files.jobs) {
      if (stop.current) { add({ ok: false, text: "Durduruldu. Tekrar başlatınca kaldığı yerden devam eder." }); setBusy(false); router.refresh(); return; }
      let r = await step(dsisImportBatch(name));
      if (!r.ok) { add({ ok: true, text: `${name} tekrar deneniyor…` }); r = await dsisImportBatch(name); add({ ok: r.ok, text: r.message }); if (!r.ok) { setBusy(false); router.refresh(); return; } }
      for (const [k, v] of Object.entries(r.result ?? {})) sum[k] = (sum[k] ?? 0) + Number(v || 0);
      setTotals({ ...sum });
    }
    if (withBalance) await step(dsisImportBalance());
    add({ ok: true, text: "Aktarım tamamlandı." });
    setBusy(false); router.refresh();
  }

  return (
    <>
      <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Hazır dökümler</h2>
        {!files.ok ? <p className="text-sm text-bad">{files.message}</p> : (
          <ul className="text-sm grid gap-1">
            <li>{files.ref ? "✅" : "❌"} Hekim / hastane ve ürün listesi</li>
            <li>{files.jobs.length ? "✅" : "❌"} İş kayıtları: {files.jobs.length} parti (yaklaşık {(files.jobs.length * 1000).toLocaleString("tr-TR")} iş)</li>
            <li>{files.tahsilat ? "✅" : "❌"} Tahsilatlar ve güncel cari bakiyeler</li>
          </ul>
        )}
        {st && (
          <p className="text-sm text-muted">ERP&apos;de şu an Dentalsis&apos;ten gelen: <b>{Number(st.jobs ?? 0).toLocaleString("tr-TR")}</b> iş ({Number(st.delivered ?? 0).toLocaleString("tr-TR")} teslim edilmiş), <b>{String(st.customers ?? 0)}</b> hekim, <b>{String(st.products ?? 0)}</b> ürün, <b>{String(st.payments ?? 0)}</b> tahsilat{st.first ? ` · ${String(st.first)} – ${String(st.last)}` : ""}</p>
        )}
      </section>

      <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
        <h2 className="font-display text-lg font-bold">Aktar</h2>
        <ul className="text-sm text-muted list-disc pl-5 grid gap-1">
          <li>Hekimler ve ürünler adına göre mevcut kayıtlarla eşleşir; bulunamayanlar yeni açılır.</li>
          <li>İşler Dentalsis numarası, giriş / çıkış tarihleri, diş şeması, kalemler ve provalarıyla gelir. Teslim edilenler &quot;teslim edildi&quot; olur ve Kâr/Zarar ile raporlara girer.</li>
          <li>Toplu aktarımda ÜTS bildirimi, irsaliye ve üretim akışı çalışmaz; denetim kaydı yazılmaz. Muhasebe fişi oluşmaz.</li>
          <li><b>Cari bakiye eşitleme</b> (ikinci düğme): 2026 tahsilatları eklenir, her hekimin bakiyesi Dentalsis&apos;teki güncel bakiyeye eşitlenir. Fark 31.12.2025 tarihli &quot;devir&quot; satırıyla kapanır, 2026 cirosunu etkilemez.</li>
        </ul>
        <div className="flex flex-wrap gap-3">
          <button disabled={busy || !files.jobs.length || !files.ref} onClick={() => run(true)} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">İşleri aktar + cari bakiyeleri eşitle</button>
          <button disabled={busy || !files.jobs.length || !files.ref} onClick={() => run(false)} className="h-12 px-5 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-bold disabled:opacity-50">Sadece işleri aktar</button>
          {busy && <button onClick={() => { stop.current = true; }} className="h-12 px-4 rounded-[12px] border border-[#F3C3BE] text-bad font-semibold">Durdur</button>}
        </div>
        {prog && (
          <div className="flex flex-col gap-1">
            <div className="h-3 rounded-full bg-[#EEF2F6] overflow-hidden" role="progressbar" aria-valuenow={prog.done} aria-valuemax={prog.total}><div className="h-full bg-[#2a78d6] transition-all" style={{ width: `${Math.round((prog.done / Math.max(1, prog.total)) * 100)}%` }} /></div>
            <span className="text-xs text-muted">{prog.done} / {prog.total} adım {busy ? "· sayfayı kapatmayın" : ""}{Object.keys(totals).length ? ` · toplam: ${fmt(totals)}` : ""}</span>
          </div>
        )}
        {log.length > 0 && (
          <ol className="text-xs font-mono max-h-[360px] overflow-auto rounded-lg bg-[#F7F9FC] border border-line p-2 grid gap-0.5">
            {log.map((l, i) => <li key={i} className={l.ok ? "text-[#33414F]" : "text-bad"}>{l.text}</li>)}
          </ol>
        )}
      </section>
    </>
  );
}
