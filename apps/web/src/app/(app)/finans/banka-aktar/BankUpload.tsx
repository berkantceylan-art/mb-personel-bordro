"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { guessMapping, parseCamt, parseMt940, rowsFromTable, type BankRow, type Mapping } from "@/lib/bank-parse";
import { importBankRows } from "@/lib/bank-actions";

const fmt = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Ekstre dosyasını tarayıcıda okur (Excel, CSV, CAMT.053, MT940), sütunları tahmin eder, önizletir ve yükler */
export function BankUpload({ accounts, defaultAccount }: { accounts: { id: string; name: string; currency: string }[]; defaultAccount: string | null }) {
  const router = useRouter();
  const [account, setAccount] = useState(defaultAccount ?? accounts[0]?.id ?? "");
  const [file, setFile] = useState<string>("");
  const [table, setTable] = useState<unknown[][] | null>(null);
  const [map, setMap] = useState<Mapping | null>(null);
  const [rows, setRows] = useState<BankRow[]>([]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();

  async function read(f: File) {
    setMsg(null); setTable(null); setMap(null); setRows([]); setFile(f.name);
    try {
      const name = f.name.toLowerCase();
      if (name.endsWith(".xml") || name.endsWith(".053")) {
        const r = parseCamt(await f.text());
        setRows(r);
        if (!r.length) setMsg({ ok: false, text: "CAMT dosyasında hareket bulunamadı." });
        return;
      }
      if (name.endsWith(".sta") || name.endsWith(".940") || name.endsWith(".mt940") || name.endsWith(".txt")) {
        const txt = await f.text();
        if (txt.includes(":61:")) {
          const r = parseMt940(txt);
          setRows(r);
          if (!r.length) setMsg({ ok: false, text: "MT940 dosyasında hareket bulunamadı." });
          return;
        }
      }
      const XLSX = await import("xlsx");
      const buf = await f.arrayBuffer();
      const wb = name.endsWith(".csv") || name.endsWith(".txt") ? XLSX.read(new TextDecoder(detectEnc(buf)).decode(buf), { type: "string", raw: true }) : XLSX.read(buf, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]!]!;
      const t = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      setTable(t);
      const m = guessMapping(t);
      setMap(m);
      if (m) setRows(rowsFromTable(t, m));
      else setMsg({ ok: false, text: "Tarih ve tutar sütunları otomatik bulunamadı; aşağıdan seçin." });
    } catch (e) {
      setMsg({ ok: false, text: `Dosya okunamadı: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  function remap(k: keyof Mapping, v: number) {
    if (!table) return;
    const base: Mapping = map ?? { header: 0, date: -1, description: [], amount: -1, debit: -1, credit: -1, balance: -1, ref: -1 };
    const m: Mapping = { ...base, [k]: k === "description" ? (v >= 0 ? [v] : []) : v };
    setMap(m);
    setRows(m.date >= 0 && (m.amount >= 0 || m.debit >= 0 || m.credit >= 0) ? rowsFromTable(table, m) : []);
  }

  const headers = table && map ? (table[map.header] ?? []).map((h, i) => String(h || `Sütun ${i + 1}`)) : table ? (table[0] ?? []).map((_, i) => `Sütun ${i + 1}`) : [];
  const sumIn = rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0);
  const sumOut = rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0);
  const sel = "h-9 rounded-[8px] border border-line bg-white px-2 text-sm";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={account} onChange={(e) => setAccount(e.target.value)} className="h-10 rounded-[10px] border border-line bg-white px-3 text-sm">
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
        </select>
        <label className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold cursor-pointer">
          Ekstre dosyası seç
          <input type="file" accept=".xlsx,.xls,.csv,.txt,.xml,.sta,.940,.mt940" className="sr-only" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
        </label>
        <span className="text-xs text-muted">Excel / CSV (internet bankacılığından &quot;Excel&apos;e aktar&quot;), CAMT.053 XML ya da MT940</span>
      </div>
      {table && (
        <div className="flex flex-wrap gap-2 text-xs items-center">
          <span className="font-semibold text-muted">Sütunlar:</span>
          {([["date", "Tarih"], ["description", "Açıklama"], ["amount", "Tutar (±)"], ["debit", "Borç / çıkan"], ["credit", "Alacak / giren"], ["balance", "Bakiye"]] as [keyof Mapping, string][]).map(([k, l]) => (
            <label key={k} className="flex items-center gap-1">{l}
              <select value={k === "description" ? (map?.description[0] ?? -1) : ((map?.[k] as number | undefined) ?? -1)} onChange={(e) => remap(k, Number(e.target.value))} className={sel}>
                <option value={-1}>—</option>{headers.map((h, i) => <option key={i} value={i}>{h.slice(0, 30)}</option>)}
              </select>
            </label>
          ))}
          <label className="flex items-center gap-1">Başlık satırı<input type="number" min={1} value={(map?.header ?? 0) + 1} onChange={(e) => remap("header", Math.max(0, Number(e.target.value) - 1))} className={`${sel} w-16`} /></label>
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="flex flex-wrap gap-4 items-center text-sm">
            <span><b>{rows.length}</b> hareket · {file}</span>
            <span className="text-ok">Giriş {fmt(sumIn)}</span>
            <span className="text-bad">Çıkış {fmt(sumOut)}</span>
            <span className="text-muted">{rows[0]?.date} – {rows[rows.length - 1]?.date}</span>
            <button type="button" disabled={pending || !account} onClick={() => start(async () => { const r = await importBankRows(account, file, rows); setMsg({ ok: r.ok, text: r.message }); if (r.ok) { setRows([]); setTable(null); router.refresh(); } })} className="h-10 px-4 rounded-[10px] bg-ok text-white font-semibold disabled:opacity-60">{pending ? "Yükleniyor…" : "İçe aktar ve eşleştir"}</button>
          </div>
          <div className="max-h-64 overflow-auto rounded-[12px] border border-line">
            <table className="w-full text-xs">
              <tbody>{rows.slice(0, 200).map((r, i) => <tr key={i} className="border-t border-[#EEF2F6]"><td className="p-1.5 whitespace-nowrap">{r.date}</td><td className="p-1.5">{r.description}</td><td className={`p-1.5 text-right whitespace-nowrap ${r.amount < 0 ? "text-bad" : "text-ok"}`}>{fmt(r.amount)}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {msg && <p className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}

/** Türk bankalarının CSV'leri çoğu zaman Windows-1254 */
function detectEnc(buf: ArrayBuffer): string {
  const b = new Uint8Array(buf.slice(0, 4000));
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return "utf-8";
  try { new TextDecoder("utf-8", { fatal: true }).decode(b, { stream: true }); return "utf-8"; } catch { return "windows-1254"; }
}
