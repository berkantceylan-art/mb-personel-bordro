"use client";
import { useMemo, useState } from "react";
import type { CmRow } from "@/lib/customer-margin";

const tl = (k: number | null) => (k == null ? "—" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " ₺");
const cur = (k: number | null, c: string) => (k == null ? "—" : (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (c === "EUR" ? " €" : " ₺"));
const norm = (v: string) => v.toLocaleLowerCase("tr").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i");
type Sort = "margin" | "profit" | "qty" | "name" | "price";

/** Seçilen ürün için müşteri müşteri satış fiyatı ve kâr / zarar */
export function CustomerTable({ rows, showProduct }: { rows: CmRow[]; showProduct: boolean }) {
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"" | "loss" | "sold">("");
  const [sort, setSort] = useState<Sort>("margin");
  const shown = useMemo(() => {
    const t = norm(q.trim());
    const f = rows.filter((r) => (!t || norm(`${r.customer} ${r.city ?? ""} ${r.product}`).includes(t)) && (only !== "loss" || (r.unitMargin ?? 0) < 0) && (only !== "sold" || r.qty > 0));
    const key: Record<Sort, (r: CmRow) => number | string> = {
      margin: (r) => r.unitMargin ?? 1e15, profit: (r) => r.profit ?? 1e15, qty: (r) => -r.qty, name: (r) => r.customer, price: (r) => r.effTry ?? 1e15,
    };
    return [...f].sort((a, b) => { const x = key[sort](a), y = key[sort](b); return typeof x === "string" ? x.localeCompare(y as string, "tr") : (x as number) - (y as number); });
  }, [rows, q, only, sort]);
  const th = (k: Sort, label: string, right = true) => (
    <th className={`py-2.5 px-2 font-semibold border-b border-line ${right ? "text-right" : ""}`}>
      <button type="button" onClick={() => setSort(k)} className={sort === k ? "text-brand-700" : ""}>{label}{sort === k ? " ↓" : ""}</button>
    </th>
  );
  const chip = (v: typeof only, label: string) => (
    <button type="button" onClick={() => setOnly(v)} className={`h-9 px-3 rounded-full text-sm font-semibold border ${only === v ? "bg-brand-700 text-white border-brand-700" : "bg-white text-[#33414F] border-[#D5DEE8]"}`}>{label}</button>
  );
  const totQ = shown.reduce((t, r) => t + r.qty, 0);
  const totR = shown.reduce((t, r) => t + r.revTry, 0);
  const totP = shown.reduce((t, r) => t + (r.profit ?? 0), 0);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {chip("", `Tümü (${rows.length})`)}
        {chip("loss", `Zararda (${rows.filter((r) => (r.unitMargin ?? 0) < 0).length})`)}
        {chip("sold", `Bu dönem iş gönderen (${rows.filter((r) => r.qty > 0).length})`)}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri / şehir ara…" className="h-9 ml-auto w-64 rounded-full border border-[#D5DEE8] bg-white px-3.5 text-sm" />
      </div>
      <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[980px]">
          <thead>
            <tr className="text-left text-xs text-muted">
              {th("name", "Müşteri", false)}
              {showProduct && <th className="py-2.5 px-2 font-semibold border-b border-line">Ürün</th>}
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Fiyat listesi</th>
              {th("qty", "Adet")}
              {th("price", "Fiilî ort. satış")}
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Tam maliyet</th>
              {th("margin", "Üye başı kâr")}
              <th className="py-2.5 px-2 font-semibold border-b border-line text-right">Marj</th>
              {th("profit", "Dönem kâr / zarar")}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const loss = (r.unitMargin ?? 0) < 0;
              return (
                <tr key={`${r.customerId}|${r.productId}`} className={loss ? "bg-[#FFF6F5]" : ""}>
                  <td className="py-2 px-2 border-b border-[#EEF2F6]">
                    <a href={`/isler/hekimler/${r.customerId}`} className="font-semibold text-brand-800">{r.customer}</a>
                    <span className="block text-[11px] text-muted">{[r.city, r.cur !== "TRY" ? r.cur : null, r.last ? `son iş ${r.last.split("-").reverse().join(".")}` : null].filter(Boolean).join(" · ")}</span>
                  </td>
                  {showProduct && <td className="py-2 px-2 border-b border-[#EEF2F6] text-xs">{r.product}</td>}
                  <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right">
                    {cur(r.price, r.cur === "USD" ? "TRY" : r.cur)}
                    <span className={`block text-[10px] font-bold ${r.source === "özel" ? "text-[#5B3A9A]" : "text-muted"}`}>{r.source === "özel" ? "ÖZEL FİYAT" : r.source === "liste" ? "LİSTE" : "FİYAT YOK"}{r.cur === "EUR" && r.priceTry != null ? ` · ${tl(r.priceTry)}` : ""}</span>
                  </td>
                  <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right">{r.qty ? r.qty.toLocaleString("tr-TR") : <span className="text-muted">—</span>}</td>
                  <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right font-semibold">{tl(r.avgTry)}</td>
                  <td className="num py-2 px-2 border-b border-[#EEF2F6] text-right text-muted">{r.cost == null ? <span className="text-warn text-xs">reçete yok</span> : tl(r.cost)}</td>
                  <td className={`num py-2 px-2 border-b border-[#EEF2F6] text-right font-semibold ${r.unitMargin == null ? "text-muted" : loss ? "text-bad" : "text-ok"}`}>{r.unitMargin == null ? "—" : `${loss ? "" : "+"}${tl(r.unitMargin)}`}</td>
                  <td className={`num py-2 px-2 border-b border-[#EEF2F6] text-right ${r.marginPct == null ? "text-muted" : r.marginPct < 0 ? "text-bad" : r.marginPct < 15 ? "text-warn" : "text-ok"}`}>{r.marginPct == null ? "—" : `%${r.marginPct.toLocaleString("tr-TR")}`}</td>
                  <td className={`num py-2 px-2 border-b border-[#EEF2F6] text-right font-bold ${r.profit == null ? "text-muted" : r.profit < 0 ? "text-bad" : "text-ok"}`}>{r.profit == null ? "—" : `${r.profit < 0 ? "▼ " : "▲ +"}${tl(Math.abs(r.profit))}`}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={9} className="p-8 text-center text-muted">Kayıt yok.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2.5 px-2 text-muted" colSpan={showProduct ? 3 : 2}>{shown.length} satır · ciro {tl(totR)}</td>
                <td className="num py-2.5 px-2 text-right">{totQ.toLocaleString("tr-TR")}</td>
                <td className="num py-2.5 px-2 text-right">{tl(totQ ? Math.round(totR / totQ) : null)}</td>
                <td colSpan={3} />
                <td className={`num py-2.5 px-2 text-right font-bold ${totP < 0 ? "text-bad" : "text-ok"}`}>{totP < 0 ? "▼ " : "▲ +"}{tl(Math.abs(totP))}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
