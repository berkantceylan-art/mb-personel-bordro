"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Notice, btnPrimary, inputCls } from "@/components/erp";
import { saveItemRoutes, type ItemRouteRow } from "@/lib/supplier-group-actions";

export type ItemRow = { id: string; supplier_name: string; unit: string | null; route: "slip" | "nodisc"; price: number | null; currency: string; price_date: string | null; is_active: boolean; item_id: string | null; code?: string | null };

const f2 = (k: number | null) => (k === null ? "" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const cents = (s: string) => { const n = Number(s.replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : null; };

/** Firmanın ürün listesi: hangi fişli cariye gider (ürün bazlı kural) ve son liste fiyatı */
export function ItemRoutes({ main, rows, canEdit, hasNodisc }: { main: string; rows: ItemRow[]; canEdit: boolean; hasNodisc: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "slip" | "nodisc">("");
  const [edit, setEdit] = useState<Record<string, { route?: "slip" | "nodisc"; price?: string }>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const list = useMemo(() => {
    const t = q.trim().toLocaleLowerCase("tr-TR");
    return rows.filter((r) => (!t || r.supplier_name.toLocaleLowerCase("tr-TR").includes(t)) && (!only || (edit[r.id]?.route ?? r.route) === only));
  }, [rows, q, only, edit]);
  const changed = Object.keys(edit).length;

  async function save() {
    setBusy(true); setMsg(null);
    const out: ItemRouteRow[] = rows.filter((r) => edit[r.id]).map((r) => {
      const e = edit[r.id] ?? {};
      const row: ItemRouteRow = { supplier_name: r.supplier_name, route: e.route ?? r.route };
      if (e.price !== undefined) { row.price = cents(e.price); row.currency = r.currency; }
      return row;
    });
    const res = await saveItemRoutes(main, out);
    setMsg({ ok: !!res.ok, text: res.message }); setBusy(false);
    if (res.ok) { setEdit({}); router.refresh(); }
  }

  return (
    <section className="rounded-[16px] border border-line bg-white p-4 md:p-5 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-display text-lg font-bold mr-auto">Ürünler ve cari kuralı ({rows.length})</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün ara…" className={`${inputCls} max-w-[260px]`} />
        <select value={only} onChange={(e) => setOnly(e.target.value as typeof only)} className={`${inputCls} max-w-[200px]`}>
          <option value="">Tümü</option><option value="slip">Fişli (iskontolu)</option><option value="nodisc">İskontosuz</option>
        </select>
      </div>
      {!hasNodisc && <Notice>İskontosuz fişli cari açılmadan “İskontosuz” kuralı kullanılamaz; yukarıdan açın.</Notice>}
      {!rows.length && <p className="text-sm text-muted">Henüz ürün yok. Ekstre aktarımı ya da kalemli fiş girildikçe dolar.</p>}
      {!!rows.length && (
        <div className="overflow-x-auto max-h-[560px] overflow-y-auto rounded-[12px] border border-line">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="sticky top-0 bg-[#F7F9FB]"><tr className="text-left text-xs text-muted border-b border-line"><th className="p-2.5">Ürün (firmanın adı)</th><th className="p-2.5">Stok kodu</th><th className="p-2.5">Birim</th><th className="p-2.5">Cari</th><th className="p-2.5 text-right">Son liste fiyatı</th><th className="p-2.5">Fiyat tarihi</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const e = edit[r.id] ?? {};
                const route = e.route ?? r.route;
                return (
                  <tr key={r.id} className={`border-b border-[#EEF2F6] ${edit[r.id] ? "bg-[#FFFBEB]" : ""}`}>
                    <td className="p-2.5 font-semibold">{r.supplier_name}</td>
                    <td className="p-2.5 text-xs text-muted">{r.code ?? "—"}</td>
                    <td className="p-2.5 text-xs">{r.unit ?? ""}</td>
                    <td className="p-2.5">
                      <select disabled={!canEdit} value={route} onChange={(ev) => setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], route: ev.target.value as "slip" | "nodisc" } }))}
                        className={`h-9 rounded-[8px] border px-2 text-xs font-semibold ${route === "nodisc" ? "border-[#F59E0B] text-[#B45309]" : "border-[#D5DEE8]"}`}>
                        <option value="slip">Fişli (iskontolu)</option>
                        <option value="nodisc" disabled={!hasNodisc}>İskontosuz</option>
                      </select>
                    </td>
                    <td className="p-2.5 text-right">
                      <input disabled={!canEdit} inputMode="decimal" value={e.price ?? f2(r.price)} onChange={(ev) => setEdit((x) => ({ ...x, [r.id]: { ...x[r.id], price: ev.target.value } }))}
                        className="h-9 w-28 rounded-[8px] border border-[#D5DEE8] px-2 text-right num text-sm" /> <span className="text-xs text-muted">{r.currency}</span>
                    </td>
                    <td className="p-2.5 text-xs text-muted">{r.price_date ? r.price_date.split("-").reverse().join(".") : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {msg && <Notice tone={msg.ok ? "ok" : "bad"}>{msg.text}</Notice>}
      {canEdit && !!rows.length && <div><button onClick={save} disabled={busy || !changed} className={btnPrimary}>{busy ? "…" : `Değişiklikleri kaydet${changed ? ` (${changed})` : ""}`}</button></div>}
    </section>
  );
}
