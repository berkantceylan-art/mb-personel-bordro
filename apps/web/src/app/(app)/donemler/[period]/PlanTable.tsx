"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatTL, parseTL } from "@mb/core";
import { useActionForm } from "@/lib/use-action-form";
import { payPlan } from "@/lib/salary-plan-actions";
import type { PayAccount, PlanRow } from "@/lib/salary-plan";

const num = new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const show = (k: number) => (k > 0 ? num.format(k / 100) : "");
const safe = (v: string) => { try { return v.trim() ? Math.max(0, parseTL(v)) : 0; } catch { return NaN; } };

export function PlanTable({ period, rows, accounts, defaultDate, closed }: { period: string; rows: PlanRow[]; accounts: PayAccount[]; defaultDate: string; closed: boolean }) {
  const banks = accounts.filter((a) => a.kind === "bank");
  const cashes = accounts.filter((a) => a.kind === "cash");
  const [q, setQ] = useState("");
  const [dept, setDept] = useState("");
  const [sel, setSel] = useState<Set<string>>(() => new Set(rows.filter((r) => r.leftBank + r.leftCash > 0).map((r) => r.id)));
  const [amt, setAmt] = useState<Record<string, { bank: string; cash: string }>>(() => Object.fromEntries(rows.map((r) => [r.id, { bank: show(r.leftBank), cash: show(r.leftCash) }])));
  const { state, pending, formProps } = useActionForm(payPlan);

  const depts = useMemo(() => [...new Set(rows.map((r) => r.dept))].sort((a, b) => a.localeCompare(b, "tr")), [rows]);
  const nq = q.toLocaleLowerCase("tr").trim();
  const list = rows.filter((r) => (!dept || r.dept === dept) && (!nq || r.name.toLocaleLowerCase("tr").includes(nq)));
  const chosen = rows.filter((r) => sel.has(r.id));
  const totBank = chosen.reduce((a, r) => a + (safe(amt[r.id]?.bank ?? "") || 0), 0);
  const totCash = chosen.reduce((a, r) => a + (safe(amt[r.id]?.cash ?? "") || 0), 0);
  const bad = chosen.some((r) => Number.isNaN(safe(amt[r.id]?.bank ?? "")) || Number.isNaN(safe(amt[r.id]?.cash ?? "")));
  const allOn = list.length > 0 && list.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => { const n = new Set(s); for (const r of list) { if (allOn) n.delete(r.id); else n.add(r.id); } return n; });
  const setV = (id: string, k: "bank" | "cash", v: string) => setAmt((m) => ({ ...m, [id]: { ...(m[id] ?? { bank: "", cash: "" }), [k]: v } }));
  const items = JSON.stringify(chosen.map((r) => ({ id: r.id, bank: amt[r.id]?.bank ?? "", cash: amt[r.id]?.cash ?? "" })));
  const th = "py-2.5 px-2 font-semibold border-b border-line text-right whitespace-nowrap";
  const td = "num py-2 px-2 border-b border-[#EEF2F6] text-right whitespace-nowrap";
  const inp = "num w-28 h-10 rounded-lg border border-[#D5DEE8] px-2 text-right bg-white disabled:bg-[#F3F5F8]";
  const sel2 = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3 text-ink";

  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="period" value={period} />
      <input type="hidden" name="items" value={items} />
      <div className="flex flex-wrap gap-2 items-center">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Personel ara" aria-label="Personel ara" className="h-11 w-full sm:w-64 rounded-[10px] border border-[#D5DEE8] px-3" />
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Bölüm">
          {["", ...depts].map((d) => (
            <button type="button" key={d || "all"} onClick={() => setDept(d)} className={`text-[13px] px-3 py-1.5 rounded-full ${dept === d ? "bg-brand-700 text-white font-semibold" : "bg-[#EEF2F6] text-[#33414F]"}`}>{d || "Tümü"}</button>
          ))}
        </div>
      </div>

      <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-[13px] min-w-[1080px]">
          <thead>
            <tr className="text-xs text-muted">
              <th className={`${th} w-10 text-left`}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Görünenlerin hepsini seç" className="w-5 h-5 accent-[#0A3D73]" disabled={closed} /></th>
              <th className={`${th} text-left`}>Personel</th>
              <th className={th}>Toplam ücret</th>
              <th className={th}>Resmi net</th>
              <th className={th}>BES / icra</th>
              <th className={th}>Bankaya (bordro)</th>
              <th className={th}>Ödenen banka</th>
              <th className={th}>Ödenen elden</th>
              <th className={th}>Kalan → banka</th>
              <th className={th}>Kalan → elden</th>
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const done = r.leftBank + r.leftCash <= 0;
              const on = sel.has(r.id);
              return (
                <tr key={r.id} className={on ? "bg-[#F5F9FD]" : undefined}>
                  <td className="py-2 px-2 border-b border-[#EEF2F6]"><input type="checkbox" checked={on} onChange={() => toggle(r.id)} aria-label={`${r.name} seç`} className="w-5 h-5 accent-[#0A3D73]" disabled={closed} /></td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6]">
                    <Link href={`/personel/${r.id}?donem=${period}`} className="font-semibold text-brand-700">{r.name}</Link>
                    <span className="block text-xs text-muted">{r.dept} · {r.days} gün{!r.saved ? " · bordro taslak" : ""}</span>
                  </td>
                  <td className={td}>{formatTL(r.totalNet)}</td>
                  <td className={td}>{formatTL(r.officialNet)}</td>
                  <td className={`${td} text-muted`}>{r.bes || r.icra ? <>{r.bes ? formatTL(r.bes) : "—"}<span className="block text-xs">{r.icra ? `icra ${formatTL(r.icra)}` : ""}</span></> : "—"}</td>
                  <td className={td}>{formatTL(r.netToBank)}</td>
                  <td className={td}>{r.paidBank ? formatTL(r.paidBank) : "—"}</td>
                  <td className={td}>{r.paidCash ? formatTL(r.paidCash) : "—"}</td>
                  {done ? (
                    <td colSpan={2} className="py-2 px-2 border-b border-[#EEF2F6] text-right"><span className="text-xs font-semibold text-ok">Ödendi ✓{r.balance < 0 ? ` · fazla ${formatTL(-r.balance)}` : ""}</span></td>
                  ) : (
                    <>
                      <td className={td}><input value={amt[r.id]?.bank ?? ""} onChange={(e) => setV(r.id, "bank", e.target.value)} inputMode="decimal" aria-label={`${r.name} banka tutarı`} className={inp} disabled={closed || !on} /></td>
                      <td className={td}><input value={amt[r.id]?.cash ?? ""} onChange={(e) => setV(r.id, "cash", e.target.value)} inputMode="decimal" aria-label={`${r.name} elden tutarı`} className={inp} disabled={closed || !on} /></td>
                    </>
                  )}
                </tr>
              );
            })}
            {list.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-muted">Personel yok.</td></tr>}
          </tbody>
        </table>
      </section>

      {!closed && (
        <section className="sticky bottom-0 z-10 bg-white border border-brand-700 rounded-[14px] p-4 flex flex-col gap-3 shadow-lg">
          <div className="flex flex-wrap gap-x-6 gap-y-1 items-baseline">
            <span className="font-semibold text-brand-800">{chosen.length} personel seçili</span>
            <span className="text-sm">Banka: <b className="num">{formatTL(totBank)}</b></span>
            <span className="text-sm">Elden: <b className="num">{formatTL(totCash)}</b></span>
            {bad && <span className="text-sm text-bad">Okunamayan tutar var · örnek: 12.500,50</span>}
          </div>
          {accounts.length === 0 ? (
            <p className="text-sm text-warn">Ödemenin düşeceği kasa / banka tanımlı değil. <Link href="/finans/kasa" className="font-semibold underline">Finans › Kasa</Link> ve <Link href="/finans/banka" className="font-semibold underline">Banka</Link> sayfalarından TL hesap ekleyin.</p>
          ) : (
            <div className="flex flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1 text-xs text-muted">Ödeme tarihi<input type="date" name="date" defaultValue={defaultDate} required className={sel2} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Banka ödemesi hangi hesaptan
                <select name="bank_account" defaultValue={banks[0]?.id ?? ""} className={sel2}>
                  <option value="">— seçin —</option>
                  {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-muted">Elden ödeme hangi kasadan
                <select name="cash_account" defaultValue={cashes[0]?.id ?? ""} className={sel2}>
                  <option value="">— seçin —</option>
                  {cashes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <div className="flex gap-2 flex-wrap ml-auto">
                <button name="mode" value="bank" disabled={pending || bad || !totBank} className="h-12 px-4 rounded-xl border border-brand-700 text-brand-700 font-semibold disabled:opacity-40">Bankayı öde</button>
                <button name="mode" value="cash" disabled={pending || bad || !totCash} className="h-12 px-4 rounded-xl border border-brand-700 text-brand-700 font-semibold disabled:opacity-40">Eldeni öde</button>
                <button name="mode" value="both" disabled={pending || bad || !(totBank + totCash)} className="h-12 px-5 rounded-xl bg-brand-700 text-white font-bold disabled:opacity-40">{pending ? "İşleniyor…" : `İkisini öde (${formatTL(totBank + totCash)})`}</button>
              </div>
            </div>
          )}
          {state && <p role="status" className={`text-sm rounded-lg px-3 py-2 ${state.ok ? "bg-ok-bg text-ok" : "bg-bad-bg text-bad"}`}>{state.message}</p>}
        </section>
      )}
    </form>
  );
}
