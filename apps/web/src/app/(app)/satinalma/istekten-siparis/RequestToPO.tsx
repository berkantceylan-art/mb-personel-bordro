"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { poFromRequests } from "@/lib/purchasing-actions";

export type RLine = { id: string; name: string; qty: string; unit: string; vendor: string | null; supplierId: string | null; price: number | null; req: string; reqId: string; who: string; needed: string | null };

/** Tedarikçi grubu başına: satırları seç, tedarikçiyi doğrula, termin ver → taslak sipariş */
export function RequestToPO({ lines, parties }: { lines: RLine[]; parties: { id: string; name: string }[] }) {
  const pname = useMemo(() => new Map(parties.map((p) => [p.id, p.name])), [parties]);
  const groups = useMemo(() => {
    const m = new Map<string, RLine[]>();
    for (const l of lines) { const k = l.supplierId ?? `?${l.vendor ?? ""}`; m.set(k, [...(m.get(k) ?? []), l]); }
    return [...m.entries()].sort((a, b) => (a[0].startsWith("?") ? 1 : 0) - (b[0].startsWith("?") ? 1 : 0) || b[1].length - a[1].length);
  }, [lines]);
  if (!lines.length) return <p className="rounded-[16px] border border-dashed border-[#C5D0DB] p-8 text-center text-muted">Siparişe dönüştürülecek onaylı istek satırı yok. Onay bekleyen istekler için <Link href="/stok/talepler?s=satin" className="font-semibold text-brand-700">İstekler</Link> sayfasına bakın.</p>;
  return <div className="flex flex-col gap-4">{groups.map(([k, ls]) => <Group key={k} k={k} lines={ls} parties={parties} title={k.startsWith("?") ? (k.slice(1) ? `“${k.slice(1)}” (cari kartı eşleşmedi)` : "Tedarikçisi belirtilmemiş") : pname.get(k) ?? "—"} />)}</div>;
}

function Group({ k, lines, parties, title }: { k: string; lines: RLine[]; parties: { id: string; name: string }[]; title: string }) {
  const [sel, setSel] = useState<Set<string>>(() => new Set(lines.map((l) => l.id)));
  const all = lines.every((l) => sel.has(l.id));
  return (
    <form action={poFromRequests} className="rounded-[16px] border border-line bg-white overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 bg-[#F3F6F9] px-4 py-3">
        <input type="checkbox" checked={all} onChange={() => setSel(all ? new Set() : new Set(lines.map((l) => l.id)))} className="w-5 h-5" aria-label="Hepsini seç" />
        <b className="mr-auto">{title}</b>
        <span className="text-sm text-muted">{sel.size}/{lines.length} satır</span>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-muted"><th className="p-2 w-10" /><th className="p-2">Kalem</th><th className="p-2 text-right">Miktar</th><th className="p-2 text-right">Tahmini birim</th><th className="p-2">İstek</th><th className="p-2">İsteyen</th><th className="p-2">Gerekli</th></tr></thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.id} className="border-t border-[#EEF2F6]">
              <td className="p-2"><input type="checkbox" name="line" value={l.id} checked={sel.has(l.id)} onChange={() => setSel((x) => { const n = new Set(x); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} className="w-5 h-5" /></td>
              <td className="p-2 font-semibold">{l.name}</td>
              <td className="p-2 text-right tabular-nums">{l.qty} {l.unit}</td>
              <td className="p-2 text-right tabular-nums">{l.price != null ? (l.price / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) + " ₺" : "—"}</td>
              <td className="p-2"><Link href={`/stok/talepler/${l.reqId}`} className="font-mono text-xs font-semibold text-brand-700">{l.req}</Link></td>
              <td className="p-2">{l.who}</td>
              <td className="p-2 text-xs">{l.needed ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-end gap-2 border-t border-line px-4 py-3">
        <label className="flex flex-col gap-1 text-xs text-muted">Tedarikçi
          <select name="party_id" defaultValue={k.startsWith("?") ? "" : k} required className="h-10 w-64 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm text-ink">
            <option value="">Seçin</option>{parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">İstenen teslim<input type="date" name="expected" className="h-10 rounded-[10px] border border-[#D5DEE8] px-2 text-sm text-ink" /></label>
        <label className="flex flex-col gap-1 text-xs text-muted flex-1 min-w-48">Sipariş notu<input name="note" maxLength={500} className="h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-sm text-ink" /></label>
        <PendingSubmit className="h-10 px-5 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{`Seçilenlerle sipariş oluştur (${sel.size})`}</PendingSubmit>
        <Link href={`/satinalma/teklifler/yeni?satir=${[...sel].join(",")}`} className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold text-brand-700">Önce teklif topla</Link>
      </div>
    </form>
  );
}
