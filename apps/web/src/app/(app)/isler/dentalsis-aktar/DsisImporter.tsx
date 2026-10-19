"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { dsisCloseOld, dsisFixCountry, dsisFixCurrencyBatch, dsisFixCustomerCurrency, dsisFxBackfill, dsisImportBalance, dsisImportBatch, dsisImportYears, dsisImportRef, dsisProductsToStock, dsisRevenueSummary, dsisTranslateProducts, type DsisFiles, type DsisStep } from "@/lib/dsis-actions";

type Log = { ok: boolean; text: string };

const LABEL: Record<string, string> = {
  customers_new: "yeni hekim/hastane", customers_linked: "mevcut hekimle eşleşti", products_new: "yeni ürün", products_linked: "mevcut ürünle eşleşti",
  inserted: "iş eklendi", skipped_existing: "zaten aktarılmış", skipped_deleted: "silinmiş (atlandı)", customers_created: "işten hekim oluşturuldu",
  currency_mismatch: "para birimi hekimden farklı", renumbered: "numarası çakıştı, yeni no verildi",
  payments: "tahsilat", adjusted: "bakiye eşitlendi", unmatched_payments: "hekimi bulunamayan tahsilat",
  fixed: "iş düzeltildi", customers_fixed: "hekim para birimi düzeltildi", mixed_customers: "karışık para birimli hekim", closed: "iş kapatıldı",
  stock_items: "stok kartı açıldı", customers_foreign: "hekim yabancı olarak işaretlendi",
  items_updated: "işin kalemleri güncellendi", cancelled: "Dentalsis'te silinen iş iptal edildi", status_updated: "iş durumu güncellendi", summary_rows: "yıllık özet satırı",
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
    const total = files.jobs.length + 1 + (withBalance ? 1 + (files.years ? 1 : 0) : 0);
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
    if (withBalance) {
      await step(dsisImportBalance());
      if (files.years) await step(dsisImportYears());
    }
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
            <li>{files.years ? "✅" : "—"} 2016–2025 hekim bazında yıllık ciro / tahsilat özeti</li>
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
      <DsisFixes hasTahsilat={files.tahsilat} jobs={files.jobs} />
    </>
  );
}

type Summary = { by_currency?: { currency: string; jobs: number; total: number; try: number }[]; by_market?: { foreign: boolean; jobs: number; eur: number | null; try: number | null; try_total: number }[];
  by_month?: { m: string; eur: number | null; try: number | null; try_total: number; jobs: number }[]; open?: number; mismatch?: number; fx_first?: string | null; fx_days_2026?: number;
  products?: number; products_tr?: number; products_stock?: number };
const money = (minor: number | null | undefined, cur: string) => (Number(minor ?? 0) / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + (cur === "EUR" ? " €" : " ₺");

function DsisFixes({ hasTahsilat, jobs }: { hasTahsilat: boolean; jobs: string[] }) {
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<Log[]>([]);
  const [sum, setSum] = useState<Summary | null>(null);
  const router = useRouter();
  const add = (l: Log) => setLog((x) => [l, ...x].slice(0, 200));
  const show = (r: DsisStep) => add({ ok: r.ok, text: `${r.message}${r.result ? " — " + fmt(r.result) : ""}` });
  async function analyze() { setSum((await dsisRevenueSummary()) as Summary | null); }

  async function runAll() {
    setBusy(true); setLog([]);
    try {
      // 1) Kurlar (EUR → TL çevrimi için 2026 günlük TCMB kurları)
      let cur = "2026-01-01";
      for (let i = 0; i < 15; i++) { const r = await dsisFxBackfill(cur); show(r); if (!r.ok || !r.left || !r.next) break; cur = r.next; }
      // 2) Ülke → yerli / yabancı
      show(await dsisFixCountry());
      // 3) Para birimi: işler Dentalsis kalemlerine göre, sonra hekimler
      for (const n of jobs) { const r = await dsisFixCurrencyBatch(n); if (!r.ok) { show(r); break; } if (Number(r.result?.fixed ?? 0)) show(r); }
      show(await dsisFixCustomerCurrency());
      // 4) Bugünden önceki açık işler → teslim edildi
      show(await dsisCloseOld());
      // 5) Cari bakiyeler Dentalsis'e yeniden eşitlensin
      if (hasTahsilat) show(await dsisImportBalance());
      // 6) Ürün adları Türkçe, 7) stok kartları
      for (let i = 0; i < 10; i++) { const r = await dsisTranslateProducts(); show(r); if (!r.ok || !r.left) break; }
      show(await dsisProductsToStock());
      add({ ok: true, text: "Düzenlemeler tamamlandı." });
    } finally {
      setBusy(false); await analyze(); router.refresh();
    }
  }

  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <h2 className="font-display text-lg font-bold">Aktarım sonrası düzenlemeler</h2>
      <ul className="text-sm text-muted list-disc pl-5 grid gap-1">
        <li>2026 için eksik TCMB kurları çekilir (€ işler TL&apos;ye o günün kuruyla çevrilir).</li>
        <li>Hekimlerin ülkesi Dentalsis&apos;ten alınır: yurt dışı hekimler <b>yabancı</b>, diğerleri <b>yerli</b> sayılır.</li>
        <li>Her işin para birimi Dentalsis kalemlerine göre düzeltilir (€ / ₺), hekimin para birimi işlerine göre ayarlanır.</li>
        <li>Bugünden önce girilmiş açık / provadaki işler <b>teslim edildi</b> olarak kapanır ve cariye yansır; bakiyeler Dentalsis&apos;e yeniden eşitlenir.</li>
        <li>Fransızca ürün adlarına Türkçe karşılık yazılır (yapay zekâ), ürünlerin stok kartları açılır.</li>
      </ul>
      <div className="flex flex-wrap gap-3">
        <button disabled={busy} onClick={runAll} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Çalışıyor…" : "Düzenlemeleri yap"}</button>
        <button disabled={busy} onClick={analyze} className="h-12 px-5 rounded-[12px] border border-[#D5DEE8] bg-white text-brand-700 font-bold disabled:opacity-50">Ciro analizi</button>
      </div>
      {log.length > 0 && (
        <ol className="text-xs font-mono max-h-[300px] overflow-auto rounded-lg bg-[#F7F9FC] border border-line p-2 grid gap-0.5">
          {log.map((l, i) => <li key={i} className={l.ok ? "text-[#33414F]" : "text-bad"}>{l.text}</li>)}
        </ol>
      )}
      {sum && (
        <div className="flex flex-col gap-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-2">
            {(sum.by_market ?? []).sort((a, b) => Number(a.foreign) - Number(b.foreign)).map((k) => (
              <div key={String(k.foreign)} className="rounded-xl border border-line p-3">
                <div className="text-xs text-muted font-semibold">{k.foreign ? "Yabancı işler (teslim edilen)" : "Yerli işler (teslim edilen)"}</div>
                <div className="text-lg font-bold tabular-nums">{money(k.try_total, "TRY")}</div>
                <div className="text-xs text-muted tabular-nums">{k.jobs.toLocaleString("tr-TR")} iş{k.eur ? ` · ${money(k.eur, "EUR")}` : ""}{k.try ? ` · ${money(k.try, "TRY")} TL işler` : ""}</div>
              </div>
            ))}
          </div>
          <table className="w-full text-xs tabular-nums">
            <thead><tr className="text-left text-muted"><th className="py-1">Ay</th><th className="text-right">İş</th><th className="text-right">€ ciro</th><th className="text-right">₺ ciro</th><th className="text-right">Toplam (₺, kurla)</th></tr></thead>
            <tbody>{(sum.by_month ?? []).map((r) => <tr key={r.m} className="border-t border-line"><td className="py-1">{r.m}</td><td className="text-right">{r.jobs.toLocaleString("tr-TR")}</td><td className="text-right">{money(r.eur, "EUR")}</td><td className="text-right">{money(r.try, "TRY")}</td><td className="text-right font-semibold">{money(r.try_total, "TRY")}</td></tr>)}</tbody>
          </table>
          <ul className="text-xs grid gap-1">
            <li>{Number(sum.mismatch ?? 0) === 0 ? "✅" : "⚠️"} Hekiminden farklı para biriminde iş: {sum.mismatch ?? 0}</li>
            <li>{Number(sum.open ?? 0) === 0 ? "✅" : "ℹ️"} Açık (teslim edilmemiş) aktarılmış iş: {sum.open ?? 0}</li>
            <li>{Number(sum.fx_days_2026 ?? 0) > 150 ? "✅" : "⚠️"} 2026 kur günü: {sum.fx_days_2026 ?? 0}{sum.fx_first ? ` (ilk kur ${sum.fx_first})` : " — kur yok, € işler TL'ye 1:1 çevriliyor!"}</li>
            <li>{sum.products_tr === sum.products ? "✅" : "ℹ️"} Türkçe adı olan ürün: {sum.products_tr}/{sum.products} · stok kartı olan: {sum.products_stock}/{sum.products}</li>
          </ul>
        </div>
      )}
    </section>
  );
}
