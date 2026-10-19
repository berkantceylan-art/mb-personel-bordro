"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { parseBhSales, type BhInvoice } from "@/lib/bh-invoice";
import { bhImport, bhSuggest, type PartyOpt } from "@/lib/bh-invoice-actions";

const money = (v: number, c: string) => `${v.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === "EUR" ? "€" : c === "USD" ? "$" : c === "TRY" ? "₺" : c}`;

/** Bizim Hesap satış raporu → cari kartlara fatura */
export function BhImport() {
  const router = useRouter();
  const [inv, setInv] = useState<BhInvoice[]>([]);
  const [info, setInfo] = useState<string>("");
  const [parties, setParties] = useState<PartyOpt[]>([]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: { doc_no: string; error: string }[] } | null>(null);

  const groups = useMemo(() => {
    const m = new Map<string, { name: string; tax: string | null; n: number; totals: Record<string, number>; from: string; to: string }>();
    for (const i of inv) {
      const g = m.get(i.customer) ?? { name: i.customer, tax: i.tax_no, n: 0, totals: {}, from: i.date, to: i.date };
      g.n++; g.totals[i.currency] = (g.totals[i.currency] ?? 0) + i.total;
      if (i.date < g.from) g.from = i.date; if (i.date > g.to) g.to = i.date;
      m.set(i.customer, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [inv]);

  async function read(f: File) {
    setMsg(null); setInv([]); setInfo("");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true });
      const t = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1, raw: true, defval: "" });
      const r = parseBhSales(t);
      if (r.error) { setMsg({ ok: false, text: r.error }); return; }
      setInv(r.invoices);
      setInfo(`${r.invoices.length} fatura okundu${r.cancelled ? ` · iptal satırlar atlandı (${r.cancelled})` : ""}.`);
      const names = [...new Map(r.invoices.map((i) => [i.customer, { name: i.customer, tax_no: i.tax_no }])).values()];
      const s = await bhSuggest(names);
      if (!s.ok) { setMsg({ ok: false, text: s.message ?? "Hata" }); return; }
      setParties(s.parties ?? []);
      setChoice(Object.fromEntries(names.map((n) => [n.name, s.match?.[n.name] ?? "new"])));
    } catch (e) {
      setMsg({ ok: false, text: `Dosya okunamadı: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  async function run() {
    setBusy(true); setMsg(null);
    const r = await bhImport(inv, choice);
    setMsg({ ok: r.ok, text: r.message, errors: r.errors });
    setBusy(false); router.refresh();
  }

  const count = inv.filter((i) => choice[i.customer] && choice[i.customer] !== "skip").length;
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-semibold">Bizim Hesap › Raporlar › Satış Raporu (Excel)
        <input type="file" accept=".xlsx,.xls" onChange={(e) => { const f = e.target.files?.[0]; if (f) void read(f); }} className="text-sm" />
      </label>
      {info && <p className="text-sm text-muted">{info}</p>}
      {groups.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 font-semibold">Faturadaki müşteri</th><th className="py-2 font-semibold text-right">Fatura</th><th className="py-2 font-semibold text-right">Toplam</th><th className="py-2 font-semibold pl-4">Hangi cari karta?</th></tr></thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.name} className="border-t border-[#EEF2F6] align-top">
                  <td className="py-2 pr-2"><b>{g.name}</b><span className="block text-xs text-muted">{g.tax ? `VKN ${g.tax} · ` : ""}{g.from} – {g.to}</span></td>
                  <td className="py-2 text-right num">{g.n}</td>
                  <td className="py-2 text-right num whitespace-nowrap">{Object.entries(g.totals).map(([c, v]) => <span key={c} className="block">{money(v, c)}</span>)}</td>
                  <td className="py-2 pl-4">
                    <select value={choice[g.name] ?? "new"} onChange={(e) => setChoice({ ...choice, [g.name]: e.target.value })} className={`h-10 w-full max-w-[360px] rounded-lg border px-2 bg-white ${choice[g.name] === "new" ? "border-[#FCD34D]" : choice[g.name] === "skip" ? "border-[#F3C3BE]" : "border-[#D5DEE8]"}`}>
                      <option value="new">➕ Yeni cari kart aç ({g.name.slice(0, 30)})</option>
                      <option value="skip">— Aktarma</option>
                      <optgroup label="Hekime bağlı cari kartlar">{parties.filter((p) => p.hekim).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}</optgroup>
                      <optgroup label="Diğer cari kartlar">{parties.filter((p) => !p.hekim).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}</optgroup>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={busy || !count} onClick={run} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Aktarılıyor…" : `${count} faturayı aktar`}</button>
          <span className="text-xs text-muted">Aynı belge numarası ikinci kez aktarılmaz; dosyayı tekrar yükleyip yalnız yeni faturaları aktarabilirsiniz.</span>
        </div>
      )}
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>
          <p>{msg.text}</p>
          {msg.errors && msg.errors.length > 0 && <ul className="text-xs mt-1 grid gap-0.5">{msg.errors.slice(0, 30).map((e) => <li key={e.doc_no}>{e.doc_no}: {e.error}</li>)}</ul>}
        </div>
      )}
    </section>
  );
}
