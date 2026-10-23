"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { bhCashAccounts } from "@/lib/bh-cari-actions";

type K = { name: string; currency: string; balance: string; holder: string };
const START: K[] = [
  { name: "TL Kasa", currency: "TRY", balance: "", holder: "" },
  { name: "Euro Kasa", currency: "EUR", balance: "", holder: "" },
  { name: "Dolar Kasa", currency: "USD", balance: "", holder: "" },
  { name: "Mustafa Özgür Kasası", currency: "TRY", balance: "", holder: "Mustafa Özgür" },
  { name: "Murat Bilgin Kasası", currency: "TRY", balance: "", holder: "Murat Bilgin" },
];
const num = (s: string) => { const t = s.replace(/\s|₺|€|\$/g, "").replace(/\./g, "").replace(",", "."); const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

/** Bizim Hesap'taki kasaları ERP'de aç: güncel bakiye açılış bakiyesi olarak girilir */
export function BhCash({ existing }: { existing: Array<{ name: string; currency: string; opening_balance: number }> }) {
  const router = useRouter();
  const [rows, setRows] = useState<K[]>(() => START.map((r) => { const e = existing.find((x) => x.name.toLocaleLowerCase("tr") === r.name.toLocaleLowerCase("tr")); return e ? { ...r, currency: e.currency, balance: (e.opening_balance / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) } : r; }));
  const [date, setDate] = useState(() => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (i: number, p: Partial<K>) => setRows((x) => x.map((r, k) => (k === i ? { ...r, ...p } : r)));
  async function save() {
    const bad = rows.filter((r) => r.name.trim() && r.balance.trim() && Number.isNaN(num(r.balance)));
    if (bad.length) { setMsg({ ok: false, text: `Tutar okunamadı: ${bad.map((r) => r.name).join(", ")}` }); return; }
    setBusy(true); setMsg(null);
    const r = await bhCashAccounts(rows.filter((x) => x.name.trim()).map((x) => ({ name: x.name, currency: x.currency, balance: x.balance.trim() ? num(x.balance) : 0, date, holder: x.holder })));
    setMsg({ ok: r.ok, text: r.message }); setBusy(false); router.refresh();
  }
  const inp = "h-10 rounded-lg border border-[#D5DEE8] px-2 text-sm bg-white";
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
      <b className="text-brand-800">Bizim Hesap kasaları → ERP</b>
      <p className="text-xs text-muted">Bizim Hesap&apos;taki her kasanın güncel bakiyesini yazın. ERP&apos;de aynı adla kasa hesabı açılır (varsa açılış bakiyesi güncellenir); bakiye seçtiğiniz tarih itibarıyla açılış bakiyesi olur. Pazartesi ERP&apos;ye geçiyorsanız tarih olarak geçiş gününden bir önceki günü seçin ve o günün kapanış bakiyelerini yazın.</p>
      <div className="flex flex-col gap-2">
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap gap-2 items-center">
            <input value={r.name} onChange={(e) => set(i, { name: e.target.value })} className={`${inp} w-56`} aria-label="Kasa adı" />
            <select value={r.currency} onChange={(e) => set(i, { currency: e.target.value })} className={inp} aria-label="Para birimi">{["TRY", "EUR", "USD"].map((c) => <option key={c}>{c}</option>)}</select>
            <input value={r.balance} onChange={(e) => set(i, { balance: e.target.value })} placeholder="Bakiye (ör. 12.450,00)" inputMode="decimal" className={`${inp} w-44 text-right`} aria-label="Bakiye" />
            <input value={r.holder} onChange={(e) => set(i, { holder: e.target.value })} placeholder="Sorumlu (isteğe bağlı)" className={`${inp} w-44`} aria-label="Sorumlu" />
            <button type="button" onClick={() => setRows((x) => x.filter((_, k) => k !== i))} className="text-xs text-muted">Çıkar</button>
          </div>
        ))}
        <div className="flex flex-wrap gap-3 items-center">
          <button type="button" onClick={() => setRows((x) => [...x, { name: "", currency: "TRY", balance: "", holder: "" }])} className="text-sm font-semibold text-brand-700">+ Kasa ekle</button>
          <label className="flex items-center gap-2 text-sm">Bakiye tarihi <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inp} /></label>
          <button type="button" disabled={busy} onClick={save} className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold disabled:opacity-50">{busy ? "Kaydediliyor…" : "Kasaları ERP'de aç / güncelle"}</button>
        </div>
      </div>
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
    </section>
  );
}
