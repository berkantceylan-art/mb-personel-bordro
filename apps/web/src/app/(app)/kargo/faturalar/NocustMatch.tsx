"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { assignCarrierCustomer } from "@/lib/carrier-actions";

type G = { key: string; names: string[]; country: string; n: number; total: number; inReport: number; awbs: string[]; sugg: { id: string; name: string; s: number }[] };
const tl = (k: number) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

/** Hekim bulunamadı: alıcı adı grupları, öneriler ve elle atama */
export function NocustMatch({ groups, customers }: { groups: G[]; customers: { id: string; name: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<Record<string, string>>(() => Object.fromEntries(groups.map((g) => [g.key, g.sugg[0] && g.sugg[0].s >= 0.6 ? g.sugg[0].id : ""])));
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [q, setQ] = useState("");
  if (!groups.length) return <p className="text-sm text-ok font-semibold">Hekimi bulunamayan gönderi yok.</p>;
  const shown = groups.filter((g) => !q || g.names.join(" ").toLocaleUpperCase("tr").includes(q.toLocaleUpperCase("tr")));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <p className="text-muted">{groups.length} farklı alıcı adı · {groups.reduce((a, g) => a + g.n, 0)} fatura satırı · {groups.reduce((a, g) => a + g.inReport, 0)} konşimento. Öneriyi kontrol edip <b>Ata</b>&apos;ya basın; aynı ad sonraki faturalarda otomatik eşleşir.</p>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Alıcı ara" className="ml-auto h-9 rounded-[10px] border border-[#D5DEE8] px-3" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Alıcı (faturada / listede)</th><th className="py-2 px-2">Ülke</th><th className="py-2 px-2 text-right">Fatura satırı</th><th className="py-2 px-2 text-right">Tutar</th><th className="py-2 px-2 text-right">Konşimento</th><th className="py-2 px-2">Öneri</th><th className="py-2 px-2">Hekim</th><th /></tr></thead>
          <tbody>
            {shown.map((g) => (
              <tr key={g.key} className="border-t border-[#EEF2F6] align-top">
                <td className="py-2 px-2"><b>{g.names[0]}</b>{g.names.length > 1 && <span className="block text-xs text-muted">{g.names.slice(1).join(" · ")}</span>}<span className="block text-[11px] text-muted font-mono">{g.awbs.slice(0, 3).join(" ")}{g.awbs.length > 3 ? " …" : ""}</span></td>
                <td className="py-2 px-2">{g.country}</td>
                <td className="py-2 px-2 text-right num">{g.n || "—"}</td>
                <td className="py-2 px-2 text-right num">{g.total ? tl(g.total) : "—"}</td>
                <td className="py-2 px-2 text-right num">{g.inReport || "—"}</td>
                <td className="py-2 px-2 text-xs">{g.sugg.length ? g.sugg.map((s) => (
                  <button key={s.id} type="button" onClick={() => setSel({ ...sel, [g.key]: s.id })} className={`block text-left ${sel[g.key] === s.id ? "font-bold text-brand-700" : "text-[#33414F]"}`}>{s.name} <span className="text-muted">%{Math.round(s.s * 100)}</span></button>
                )) : <span className="text-muted">öneri yok</span>}</td>
                <td className="py-2 px-2">
                  <select value={sel[g.key] ?? ""} onChange={(e) => setSel({ ...sel, [g.key]: e.target.value })} className="h-9 max-w-[240px] rounded-[10px] border border-[#D5DEE8] px-2">
                    <option value="">— hekim seçin —</option>
                    {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  {msg[g.key] && <p className={`text-xs mt-1 ${msg[g.key]!.ok ? "text-ok" : "text-bad"}`}>{msg[g.key]!.message}</p>}
                </td>
                <td className="py-2 px-2"><button type="button" disabled={!sel[g.key] || !!busy} onClick={async () => { setBusy(g.key); const r = await assignCarrierCustomer(g.names, sel[g.key]!); setMsg({ ...msg, [g.key]: r }); setBusy(null); if (r.ok) router.refresh(); }}
                  className="h-9 px-4 rounded-[10px] bg-brand-700 text-white font-bold disabled:opacity-40">{busy === g.key ? "…" : "Ata"}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
