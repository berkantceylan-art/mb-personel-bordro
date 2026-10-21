"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { saveEmployeeIban } from "@/lib/iban-actions";
import { ibanBank, ibanPretty, ibanValid } from "@/lib/iban";

type Row = { id: string; name: string; card: string | null; dept: string; active: boolean; iban: string; bank: string; phone: string };
const waNum = (p: string) => { let d = p.replace(/\D/g, ""); if (d.startsWith("00")) d = d.slice(2); else if (d.startsWith("0")) d = `90${d.slice(1)}`; else if (d.length === 10 && d.startsWith("5")) d = `90${d}`; return d.length >= 10 ? d : ""; };
const wa = (phone: string, text: string) => `https://wa.me/${waNum(phone)}?text=${encodeURIComponent(text)}`;
const line = (r: Row, bank = true) => `${r.name}\n${ibanPretty(r.iban)}${bank && (r.bank || ibanBank(r.iban)) ? `\n${r.bank || ibanBank(r.iban)}` : ""}`;

export function IbanTable({ rows: initial }: { rows: Row[] }) {
  const [rows, setRows] = useState(initial);
  const [q, setQ] = useState("");
  const [only, setOnly] = useState<"all" | "missing" | "has">("all");
  const [showOld, setShowOld] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [to, setTo] = useState("");
  const [bankLine, setBankLine] = useState(true);
  const [copied, setCopied] = useState(false);

  const shown = useMemo(() => rows.filter((r) => (showOld || r.active) && (only === "all" || (only === "missing" ? !r.iban : !!r.iban))
    && (!q || `${r.name} ${r.dept} ${r.card ?? ""} ${r.iban}`.toLocaleLowerCase("tr").includes(q.toLocaleLowerCase("tr")))), [rows, q, only, showOld]);
  const picked = shown.filter((r) => sel.has(r.id) && r.iban);
  const text = picked.map((r) => line(r, bankLine)).join("\n\n");

  async function save(r: Row) {
    const v = edit[r.id] ?? r.iban;
    const res = await saveEmployeeIban(r.id, v);
    setMsg((m) => ({ ...m, [r.id]: res }));
    if (res.ok) { setRows((x) => x.map((y) => (y.id === r.id ? { ...y, iban: res.iban ?? "", bank: res.bank ?? y.bank } : y))); setEdit((e) => { const n = { ...e }; delete n[r.id]; return n; }); }
  }
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const inp = "h-10 rounded-[10px] border border-[#D5DEE8] px-3 text-sm bg-white";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, bölüm, kart no, IBAN ara" className={`${inp} flex-1 min-w-[220px]`} />
        {(["all", "missing", "has"] as const).map((k) => <button key={k} type="button" onClick={() => setOnly(k)} className={`h-10 px-3 rounded-full border text-sm font-semibold ${only === k ? "bg-brand-700 text-white border-brand-700" : "border-line bg-white"}`}>{k === "all" ? "Hepsi" : k === "missing" ? "IBAN'ı eksik" : "IBAN'ı olan"}</button>)}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Ayrılanlar da</label>
      </div>

      <section className="rounded-[16px] border border-[#BBF7D0] bg-[#F0FDF4] p-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3 text-sm">
          <b className="text-[#166534]">WhatsApp ile gönder</b>
          <label className="flex flex-col gap-1">Alıcı telefon (boşsa WhatsApp&apos;ta kişi seçersiniz)<input value={to} onChange={(e) => setTo(e.target.value)} placeholder="05xx xxx xx xx" className={`${inp} w-[220px]`} /></label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={bankLine} onChange={(e) => setBankLine(e.target.checked)} /> Banka adını da yaz</label>
          <span className="text-muted">{picked.length} kişi seçili</span>
          <a href={picked.length ? wa(to, text) : undefined} target="_blank" rel="noopener" aria-disabled={!picked.length} className={`h-10 px-4 inline-flex items-center rounded-[10px] font-bold text-white ${picked.length ? "bg-[#16A34A]" : "bg-[#86EFAC] pointer-events-none"}`}>Seçilenleri WhatsApp&apos;ta aç</a>
          <button type="button" disabled={!picked.length} onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); }} className="h-10 px-4 rounded-[10px] border border-[#86EFAC] bg-white font-semibold text-[#166534] disabled:opacity-40">{copied ? "Kopyalandı ✓" : "Metni kopyala"}</button>
        </div>
        {picked.length > 0 && <pre className="text-xs whitespace-pre-wrap bg-white rounded-[10px] border border-[#BBF7D0] p-3 max-h-48 overflow-auto">{text}</pre>}
        <p className="text-xs text-muted">Mesaj WhatsApp&apos;ta hazır açılır, siz <b>Gönder</b>&apos;e basarsınız. Satırdaki <b>WhatsApp</b> düğmesi tek kişiyi gönderir; telefon kutusu boşsa ve personelin telefonu kayıtlıysa &quot;kendisine&quot; seçeneği de çıkar.</p>
      </section>

      <div className="overflow-x-auto rounded-[16px] border border-line bg-white">
        <table className="w-full text-sm min-w-[900px]">
          <thead><tr className="text-left text-xs text-muted border-b border-line bg-[#F7F9FB]">
            <th className="p-3 w-8"><input type="checkbox" checked={shown.length > 0 && shown.filter((r) => r.iban).every((r) => sel.has(r.id))} onChange={(e) => setSel(e.target.checked ? new Set(shown.filter((r) => r.iban).map((r) => r.id)) : new Set())} /></th>
            <th className="p-3">Ad soyad</th><th className="p-3">Bölüm</th><th className="p-3">IBAN</th><th className="p-3">Banka</th><th className="p-3" />
          </tr></thead>
          <tbody>
            {shown.map((r) => {
              const v = edit[r.id] ?? ibanPretty(r.iban);
              const dirty = edit[r.id] !== undefined;
              const bad = !!v.trim() && !ibanValid(v);
              return (
                <tr key={r.id} className={`border-b border-[#EEF2F6] ${r.active ? "" : "opacity-60"}`}>
                  <td className="p-3"><input type="checkbox" disabled={!r.iban} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="p-3"><Link href={`/personel/${r.id}`} className="font-semibold text-brand-700">{r.name}</Link>{r.card && <span className="block text-xs text-muted">kart {r.card}</span>}</td>
                  <td className="p-3 text-xs">{r.dept}</td>
                  <td className="p-3">
                    <form onSubmit={(e) => { e.preventDefault(); void save(r); }} className="flex items-center gap-2">
                      <input value={v} onChange={(e) => setEdit((x) => ({ ...x, [r.id]: e.target.value }))} placeholder="TR.. .... .... .... .... .... .." className={`${inp} w-[270px] font-mono ${bad ? "border-bad" : ""} ${!r.iban && !dirty ? "border-dashed" : ""}`} />
                      {dirty && <button className="h-10 px-3 rounded-[10px] bg-brand-700 text-white text-xs font-semibold" disabled={bad}>Kaydet</button>}
                    </form>
                    {bad && <span className="text-xs text-bad">Geçersiz IBAN</span>}
                    {msg[r.id] && <span className={`text-xs ${msg[r.id]!.ok ? "text-ok" : "text-bad"}`}>{msg[r.id]!.message}</span>}
                  </td>
                  <td className="p-3 text-xs">{ibanBank(v) ?? r.bank ?? ""}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {r.iban && <a href={wa(to, line(r, bankLine))} target="_blank" rel="noopener" className="text-xs font-semibold text-[#16A34A]">WhatsApp</a>}
                    {r.iban && !to && r.phone && <a href={wa(r.phone, line(r, bankLine))} target="_blank" rel="noopener" className="ml-3 text-xs font-semibold text-[#16A34A]">kendisine</a>}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-muted">Kayıt yok.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
