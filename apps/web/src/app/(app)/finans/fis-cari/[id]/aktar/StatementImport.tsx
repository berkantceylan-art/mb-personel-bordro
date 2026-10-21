"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parseStatementWorkbook, sectionClosing, type StmtBook, type StmtParse } from "@mb/core";
import { Notice, btnPrimary } from "@/components/erp";
import { importStatement, statementOverlap, type ImportResult } from "@/lib/supplier-group-actions";

type Member = { name: string; currency: string } | null;
type Opt = { on: boolean; opening: boolean; payments: boolean; invoices: boolean };

const LABEL: Record<StmtBook, string> = { main: "🧾 Faturalı (resmi) cari", slip: "📄 Fişli cari (iskontolu)", nodisc: "📄 İskontosuz fişli cari", vat: "🧾 KDV carisi" };
const f2 = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const d = (s: string | null) => (s ? s.split("-").reverse().join(".") : "");

export function StatementImport({ main, members }: { main: string; members: Record<StmtBook, Member> }) {
  const router = useRouter();
  const [parsed, setParsed] = useState<StmtParse | null>(null);
  const [opts, setOpts] = useState<Partial<Record<StmtBook, Opt>>>({});
  const [overlap, setOverlap] = useState<Record<string, number> | null>(null);
  const [createItems, setCreateItems] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [res, setRes] = useState<ImportResult | null>(null);

  async function read(f: File) {
    setMsg(null); setRes(null); setParsed(null);
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const sheets: Record<string, unknown[][]> = {};
      for (const n of wb.SheetNames) sheets[n] = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[n]!, { header: 1, raw: true, defval: "" });
      const r = parseStatementWorkbook(sheets);
      if (!r.sections.length) { setMsg({ ok: false, text: "Dosyada cari sayfası bulunamadı (Euro Cari, Peşin Cari, Resmi Cari, KDV Cari)." }); return; }
      const from = r.sections.map((s) => s.from).filter(Boolean).sort()[0]!;
      const to = r.sections.map((s) => s.to).filter(Boolean).sort().reverse()[0]!;
      const ov = await statementOverlap(main, from, to);
      setOverlap(ov);
      // carinin dönemde ERP'de kaydı varsa ödeme / fatura aktarımı kapalı başlar (çift kayıt olmasın)
      setOpts(Object.fromEntries(r.sections.map((s) => {
        const busyBook = (ov?.[s.book] ?? 0) > 0;
        return [s.book, { on: !!members[s.book], opening: true, payments: !busyBook, invoices: !busyBook }];
      })));
      setParsed(r);
    } catch (e) {
      setMsg({ ok: false, text: `Dosya okunamadı: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function run() {
    if (!parsed) return;
    setBusy(true); setMsg(null); setRes(null);
    const payload = {
      items: parsed.items, create_items: createItems,
      sections: parsed.sections.filter((s) => opts[s.book]?.on).map((s) => ({ book: s.book, opening: opts[s.book]!.opening, payments: opts[s.book]!.payments, invoices: opts[s.book]!.invoices, slips: s.slips, moves: s.moves })),
    };
    const r = await importStatement(main, payload);
    setRes(r); setBusy(false);
    if (r.ok) router.refresh();
  }

  const set = (b: StmtBook, k: keyof Opt, v: boolean) => setOpts((o) => ({ ...o, [b]: { ...o[b]!, [k]: v } }));

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[16px] border border-line bg-white p-4 md:p-5 flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm font-semibold">Ekstre dosyası (Excel)
          <input type="file" accept=".xlsx,.xls" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} className="text-sm" />
        </label>
        <p className="text-xs text-muted">Sayfalar: <b>Euro Cari</b>, <b>Peşin Cari</b>, <b>Resmi Cari</b>, <b>KDV Cari</b> ve <b>Malzeme Kartları</b>. Her sayfada Tarih, Açıklama, Hareket Tipi, Ürün, Miktar, Birim, Liste Fiyatı, Borç, Alacak sütunları okunur. Aynı dosyayı tekrar yüklemek güvenlidir: daha önce aktarılan satırlar atlanır.</p>
        {parsed?.warnings.map((w) => <Notice key={w}>{w}</Notice>)}
        {msg && <Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice>}
      </section>

      {parsed && (
        <section className="rounded-[16px] border border-line bg-white p-4 md:p-5 flex flex-col gap-4">
          <h2 className="font-display text-lg font-bold">Önizleme</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="p-2.5">Aktar</th><th className="p-2.5">Cari</th><th className="p-2.5">Dönem</th><th className="p-2.5 text-right">Fiş / kalem</th><th className="p-2.5 text-right">Diğer</th><th className="p-2.5 text-right">Devir</th><th className="p-2.5 text-right">Kapanış (borcumuz)</th><th className="p-2.5">Seçenekler</th></tr></thead>
              <tbody>
                {parsed.sections.map((s) => {
                  const m = members[s.book]; const o = opts[s.book]!;
                  const ov = overlap?.[s.book] ?? 0;
                  return (
                    <tr key={s.book} className="border-b border-[#EEF2F6] align-top">
                      <td className="p-2.5"><input type="checkbox" checked={o.on} disabled={!m} onChange={(e) => set(s.book, "on", e.target.checked)} className="h-4 w-4" /></td>
                      <td className="p-2.5"><b>{LABEL[s.book]}</b><span className="block text-xs text-muted">{m ? `${m.name} · ${m.currency}` : "cari açılmamış"} · sayfa “{s.sheet}”</span>
                        {ov > 0 && <span className="block text-xs text-[#B45309]">Bu caride dönem içinde ERP&apos;de {ov} kayıt zaten var.</span>}</td>
                      <td className="p-2.5 whitespace-nowrap">{d(s.from)} – {d(s.to)}</td>
                      <td className="p-2.5 text-right num">{s.slips.length} / {s.slips.reduce((a, x) => a + x.lines.length, 0)}</td>
                      <td className="p-2.5 text-right num">{s.moves.filter((x) => x.tip !== "DEVIR").length}</td>
                      <td className="p-2.5 text-right num">{f2(s.opening)}</td>
                      <td className="p-2.5 text-right num font-semibold">{f2(sectionClosing(s))}</td>
                      <td className="p-2.5 text-xs flex flex-col gap-1">
                        <label className="flex items-center gap-1.5"><input type="checkbox" checked={o.opening} onChange={(e) => set(s.book, "opening", e.target.checked)} /> Devri açılış bakiyesi yap</label>
                        <label className="flex items-center gap-1.5"><input type="checkbox" checked={o.payments} onChange={(e) => set(s.book, "payments", e.target.checked)} /> Ödemeleri aktar</label>
                        {s.book === "main" && <label className="flex items-center gap-1.5"><input type="checkbox" checked={o.invoices} onChange={(e) => set(s.book, "invoices", e.target.checked)} /> Faturaları aktar</label>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Notice tone="info">
            Fişler kalemleriyle (ürün, miktar, liste fiyatı) aktarılır; iskonto, iade ve KDV satırları kendi türleriyle yazılır. Geçmiş ödeme ve faturalar kasa / bankayı ve muhasebeyi etkilemez, yalnız cari bakiyesine işlenir.
            ERP&apos;de bu firmanın faturaları (e-fatura) ya da banka ödemeleri zaten kayıtlıysa o cari için “Ödemeleri / Faturaları aktar” işaretini kaldırın; yoksa çift sayılır. Aktarım sırasında ödeme yansıtması kapalıdır.
          </Notice>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={createItems} onChange={(e) => setCreateItems(e.target.checked)} className="h-4 w-4" />
            Ürün listesini kaydet ({parsed.items.length} ürün, {parsed.items.filter((i) => i.route === "nodisc").length} iskontosuz) ve stok kartı olmayanlara kart aç</label>
          <div><button onClick={run} disabled={busy || !parsed.sections.some((s) => opts[s.book]?.on)} className={btnPrimary}>{busy ? "Aktarılıyor…" : "Aktar"}</button></div>
          {res && (
            <Notice tone={res.ok ? "ok" : "bad"}>
              {res.message}
              {res.counts && <span className="block">{res.counts.slips} fiş ({res.counts.lines} kalem), {res.counts.moves} hareket, {res.counts.openings} açılış bakiyesi · {res.counts.items} ürün ({res.counts.new_items} yeni stok kartı){res.counts.skipped ? ` · ${res.counts.skipped} satır daha önce aktarılmış, atlandı` : ""}.</span>}
              {res.ok && <Link href={`/finans/fis-cari/${main}`} className="mt-1 block font-semibold text-brand-700">Firma ekstresine git →</Link>}
            </Notice>
          )}
        </section>
      )}
    </div>
  );
}
