"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTransfer } from "@/lib/stock-actions";
import { Field, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";

type Wh = { id: string; name: string };
type It = { id: string; code: string; name: string; unit: string; track_lot: boolean };
type St = { item_id: string; warehouse_id: string; lot_no: string | null; qty: number };
type Line = { key: number; item_id: string; qty: string; lot_no: string };

/** Transfer fişi: kaynak depodaki stok ve lotlar gösterilir */
export function TransferForm({ warehouses, items, stock, today, from: initFrom }: { warehouses: Wh[]; items: It[]; stock: St[]; today: string; from?: string }) {
  const router = useRouter();
  const [from, setFrom] = useState(initFrom ?? warehouses[0]?.id ?? "");
  const [to, setTo] = useState(warehouses.find((w) => w.id !== (initFrom ?? warehouses[0]?.id))?.id ?? "");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ key: 1, item_id: "", qty: "", lot_no: "" }]);
  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const avail = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stock) if (s.warehouse_id === from) m.set(s.item_id, (m.get(s.item_id) ?? 0) + s.qty);
    return m;
  }, [stock, from]);
  const lots = (item: string) => stock.filter((s) => s.warehouse_id === from && s.item_id === item && s.lot_no && s.qty > 0);
  const inSource = items.filter((i) => (avail.get(i.id) ?? 0) > 0);
  const q = search.toLocaleLowerCase("tr");
  const pick = (q ? inSource.filter((i) => `${i.name} ${i.code}`.toLocaleLowerCase("tr").includes(q)) : inSource).slice(0, 40);
  const set = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...patch } : l)));
  const add = (item_id = "") => setLines((ls) => [...ls.filter((l) => l.item_id || ls.length === 1 ? true : false), { key: Date.now(), item_id, qty: "", lot_no: "" }]);
  const num = (s: string) => Number(s.replace(/\./g, (m) => (s.includes(",") ? "" : m)).replace(",", ".")) || 0;

  const submit = (send: "draft" | "send" | "now") =>
    start(async () => {
      setMsg(null);
      const res = await createTransfer({ from, to, date, note, send, lines: lines.filter((l) => l.item_id).map((l) => ({ item_id: l.item_id, qty: num(l.qty), lot_no: l.lot_no || null })) });
      setMsg({ ok: res.ok, text: res.message });
      if (res.id) router.push(`/stok/transfer/${res.id}`);
    });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 md:grid-cols-4">
        <Field label="Çıkış deposu"><select value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Giriş deposu"><select value={to} onChange={(e) => setTo(e.target.value)} className={selectCls}>{warehouses.filter((w) => w.id !== from).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Tarih"><input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} /></Field>
        <Field label="Not"><input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={inputCls} /></Field>
      </div>
      <div className="rounded-[12px] border border-line p-3 flex flex-col gap-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Çıkış deposunda malzeme ara ve ekle…" className={inputCls} />
        <div className="flex flex-wrap gap-1.5">
          {pick.map((i) => (
            <button key={i.id} type="button" onClick={() => add(i.id)} className="rounded-full border border-line bg-white px-3 py-1 text-xs font-semibold hover:border-brand-600">
              + {i.name} <span className="text-muted">({avail.get(i.id)?.toLocaleString("tr-TR")} {i.unit})</span>
            </button>
          ))}
          {pick.length === 0 && <span className="text-xs text-muted">Çıkış deposunda stoklu malzeme yok.</span>}
        </div>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-muted text-left"><th className="py-2">Malzeme</th><th>Mevcut</th><th>Lot</th><th>Miktar</th><th /></tr></thead>
        <tbody>
          {lines.map((l) => {
            const it = items.find((i) => i.id === l.item_id);
            const ls = l.item_id ? lots(l.item_id) : [];
            const max = l.lot_no ? ls.find((x) => x.lot_no === l.lot_no)?.qty ?? 0 : avail.get(l.item_id) ?? 0;
            const over = num(l.qty) > max;
            return (
              <tr key={l.key} className="border-t border-[#EEF2F6]">
                <td className="py-2 pr-2">
                  <select value={l.item_id} onChange={(e) => set(l.key, { item_id: e.target.value, lot_no: "" })} className={selectCls}>
                    <option value="">Seçin</option>
                    {inSource.map((i) => <option key={i.id} value={i.id}>{i.code} · {i.name}</option>)}
                  </select>
                </td>
                <td className="pr-2 num whitespace-nowrap">{it ? `${max.toLocaleString("tr-TR")} ${it.unit}` : ""}</td>
                <td className="pr-2">
                  {ls.length > 0 ? (
                    <select value={l.lot_no} onChange={(e) => set(l.key, { lot_no: e.target.value })} className={selectCls}>
                      <option value="">Otomatik (önce SKT yakın)</option>
                      {ls.map((x) => <option key={x.lot_no!} value={x.lot_no!}>{x.lot_no} ({x.qty.toLocaleString("tr-TR")})</option>)}
                    </select>
                  ) : <span className="text-xs text-muted">—</span>}
                </td>
                <td className="pr-2 w-32"><input value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} inputMode="decimal" className={`${inputCls} ${over ? "border-bad text-bad" : ""}`} /></td>
                <td><button type="button" onClick={() => setLines((x) => x.length > 1 ? x.filter((y) => y.key !== l.key) : x)} className="text-xs font-semibold text-bad">Sil</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button type="button" onClick={() => add()} className="self-start text-sm font-semibold text-brand-700">+ Satır</button>
      {msg && <p className={`text-sm rounded-lg px-3 py-2 ${msg.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{msg.text}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => submit("now")} className={btnPrimary}>Transferi tamamla (tek adım)</button>
        <button type="button" disabled={pending} onClick={() => submit("send")} className={btnSecondary}>Gönder (teslim alınınca girsin)</button>
        <button type="button" disabled={pending} onClick={() => submit("draft")} className={btnSecondary}>Taslak kaydet</button>
      </div>
    </div>
  );
}
