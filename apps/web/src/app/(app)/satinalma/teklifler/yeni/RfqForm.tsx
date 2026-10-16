"use client";
import { useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createRfq } from "@/lib/rfq-actions";

type L = { name: string; qty: string; unit: string; item_id: string; req: string };
const inp = "h-10 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm";

export function RfqForm({ initial, items, parties }: { initial: L[]; items: { id: string; code: string; name: string; unit: string }[]; parties: { id: string; name: string; contact: boolean; score: number | null }[] }) {
  const [lines, setLines] = useState<L[]>(initial.length ? initial : [{ name: "", qty: "1", unit: "adet", item_id: "", req: "" }]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const set = (i: number, p: Partial<L>) => setLines((x) => x.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const shown = parties.filter((p) => !q.trim() || p.name.toLocaleLowerCase("tr").includes(q.trim().toLocaleLowerCase("tr")));
  return (
    <form action={createRfq} className="flex flex-col gap-4">
      <section className="rounded-[16px] border border-line bg-white p-4 grid gap-3 md:grid-cols-[1fr_180px_140px]">
        <label className="flex flex-col gap-1 text-xs text-muted">Konu<input name="title" required maxLength={160} placeholder="ör. Zirkon disk ve frez alımı" className={inp} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Son teklif tarihi<input type="date" name="due_date" className={inp} /></label>
        <label className="flex flex-col gap-1 text-xs text-muted">Para birimi<select name="currency" className={inp}><option>TRY</option><option>EUR</option><option>USD</option></select></label>
        <label className="flex flex-col gap-1 text-xs text-muted md:col-span-3">Tedarikçiye not<input name="note" maxLength={1000} placeholder="Marka, ölçü, teslim yeri gibi ayrıntılar" className={inp} /></label>
      </section>
      <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
        <h2 className="font-display font-bold">Kalemler</h2>
        {lines.map((l, i) => (
          <div key={i} className="grid gap-2 md:grid-cols-[1fr_220px_90px_90px_32px] items-center">
            <input name="l_name" value={l.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Kalem adı" className={inp} />
            <select name="l_item" value={l.item_id} onChange={(e) => { const it = items.find((x) => x.id === e.target.value); set(i, { item_id: e.target.value, ...(it ? { name: l.name || it.name, unit: it.unit } : {}) }); }} className={inp}>
              <option value="">Stok kartı (isteğe bağlı)</option>{items.map((it) => <option key={it.id} value={it.id}>{it.code ? `${it.code} · ` : ""}{it.name}</option>)}
            </select>
            <input name="l_qty" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} inputMode="decimal" className={`${inp} text-right`} aria-label="Miktar" />
            <input name="l_unit" value={l.unit} onChange={(e) => set(i, { unit: e.target.value })} className={inp} aria-label="Birim" />
            <input type="hidden" name="l_req" value={l.req} />
            <button type="button" onClick={() => setLines((x) => x.filter((_, k) => k !== i))} className="text-bad text-lg" aria-label="Sil">×</button>
          </div>
        ))}
        <button type="button" onClick={() => setLines((x) => [...x, { name: "", qty: "1", unit: "adet", item_id: "", req: "" }])} className="self-start text-sm font-semibold text-brand-700">+ Kalem ekle</button>
      </section>
      <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2"><h2 className="font-display font-bold mr-auto">Teklif istenecek tedarikçiler ({sel.size})</h2><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara" className={`${inp} w-56`} /></div>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 max-h-80 overflow-y-auto">
          {shown.map((p) => (
            <label key={p.id} className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-sm cursor-pointer ${sel.has(p.id) ? "border-brand-600 bg-[#EEF4FB]" : "border-line"}`}>
              <input type="checkbox" name="party" value={p.id} checked={sel.has(p.id)} onChange={() => setSel((x) => { const n = new Set(x); if (n.has(p.id)) n.delete(p.id); else n.add(p.id); return n; })} />
              <span className="flex-1 truncate">{p.name}</span>
              {p.score != null && <span className={`text-[11px] font-bold rounded px-1.5 ${p.score >= 80 ? "bg-ok-bg text-ok" : p.score >= 60 ? "bg-warn-bg text-warn" : "bg-bad-bg text-bad"}`} title="Tedarikçi puanı">{p.score}</span>}
              {!p.contact && <span className="text-[10px] text-muted" title="E-posta / telefon yok">iletişim yok</span>}
            </label>
          ))}
        </div>
      </section>
      <PendingSubmit className="self-start h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">Teklif isteğini oluştur</PendingSubmit>
    </form>
  );
}
