"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bhCariImport, bhCariRows, bhCariUndo, type BhListItem, type BhMode, type BhRow } from "@/lib/bh-cari-actions";

const money = (k: number, c: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === "TRY" ? "₺" : c === "EUR" ? "€" : c}`;
const d = (s: string | null) => (s ? s.split("-").reverse().join(".") : "—");
const MODE: Record<BhMode, string> = { rows: "Kart + tüm hareketler", balance: "Kart + yalnız bakiye (devir)", card: "Yalnız kart" };

/** Bizim Hesap carileri: seç, ekstreyi incele, aktar */
export function BhCariClient({ items }: { items: BhListItem[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<"c" | "s">("s");
  const [q, setQ] = useState("");
  const [onlyBal, setOnlyBal] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<Record<string, BhMode>>({});
  const [target, setTarget] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [rows, setRows] = useState<Record<string, BhRow[]>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string; errors?: { name: string; error: string }[] } | null>(null);

  const defMode = (it: BhListItem): BhMode => (it.match && it.match.moves > 0 ? "balance" : "rows");
  const shown = useMemo(() => {
    const n = q.toLocaleLowerCase("tr-TR").trim();
    return items.filter((it) => it.kind === tab && (!onlyBal || it.erp_balance !== 0) && (!n || `${it.name} ${it.info.tax_no ?? ""} ${it.group ?? ""}`.toLocaleLowerCase("tr-TR").includes(n)));
  }, [items, tab, q, onlyBal]);
  const allShown = shown.length > 0 && shown.every((it) => sel.has(it.guid));
  const counts = { c: items.filter((i) => i.kind === "c").length, s: items.filter((i) => i.kind === "s").length };

  async function toggleRows(guid: string) {
    if (open === guid) { setOpen(null); return; }
    setOpen(guid);
    if (!rows[guid]) { const r = await bhCariRows(guid); if (r.rows) setRows((x) => ({ ...x, [guid]: r.rows! })); }
  }
  async function run() {
    setBusy(true); setMsg(null);
    const picks = items.filter((it) => sel.has(it.guid)).map((it) => ({ guid: it.guid, target: target[it.guid] ?? it.match?.id ?? "new", mode: mode[it.guid] ?? defMode(it) }));
    const r = await bhCariImport(picks);
    setMsg({ ok: r.ok, text: r.message, errors: r.errors });
    if (r.ok) setSel(new Set());
    setBusy(false); router.refresh();
  }
  async function undo(id: string, name: string) {
    if (!confirm(`${name}: Bizim Hesap'tan aktarılan hareketler geri alınsın mı?`)) return;
    setBusy(true); const r = await bhCariUndo(id); setMsg({ ok: r.ok, text: r.message }); setBusy(false); router.refresh();
  }

  const input = "h-10 rounded-lg border border-[#D5DEE8] px-3 bg-white text-sm";
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(["s", "c"] as const).map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`rounded-full px-4 py-2 text-sm font-semibold border ${tab === k ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>
            {k === "s" ? "Tedarikçiler" : "Müşteriler"} ({counts[k]})
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara: ad, VKN, grup…" className={`${input} w-64 ml-2`} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyBal} onChange={(e) => setOnlyBal(e.target.checked)} /> Yalnız bakiyesi olanlar</label>
        <span className="text-sm text-muted ml-auto">{sel.size} seçili</span>
      </div>
      <div className="overflow-x-auto max-h-[65vh] overflow-y-auto border border-[#EEF2F6] rounded-lg">
        <table className="w-full text-sm min-w-[980px]">
          <thead className="sticky top-0 bg-white z-10"><tr className="text-left text-xs text-muted">
            <th className="py-2 px-2"><input type="checkbox" checked={allShown} aria-label="Görünenlerin hepsini seç" onChange={() => { const s = new Set(sel); if (allShown) shown.forEach((i) => s.delete(i.guid)); else shown.forEach((i) => s.add(i.guid)); setSel(s); }} /></th>
            <th className="py-2 font-semibold">Bizim Hesap carisi</th><th className="py-2 font-semibold">Ekstre</th><th className="py-2 font-semibold text-right">Bakiye</th>
            <th className="py-2 font-semibold pl-3">ERP&apos;de</th><th className="py-2 font-semibold pl-3">Ne aktarılsın?</th>
          </tr></thead>
          <tbody>
            {shown.map((it) => (
              <Fragment key={it.guid}>
                <tr className={`border-t border-[#EEF2F6] align-top ${sel.has(it.guid) ? "bg-[#F3F8FD]" : ""}`}>
                  <td className="py-2 px-2"><input type="checkbox" checked={sel.has(it.guid)} onChange={() => { const s = new Set(sel); if (s.has(it.guid)) s.delete(it.guid); else s.add(it.guid); setSel(s); }} /></td>
                  <td className="py-2 pr-2"><b>{it.name}</b>
                    <span className="block text-xs text-muted">{[it.info.tax_no && `VKN ${it.info.tax_no}`, it.group, it.info.phone, it.info.email].filter(Boolean).join(" · ") || "—"}</span></td>
                  <td className="py-2 pr-2 text-xs whitespace-nowrap">
                    <button type="button" onClick={() => void toggleRows(it.guid)} className="font-semibold text-brand-700 underline">{it.n} hareket</button>
                    <span className="block text-muted">{d(it.from)} – {d(it.to)}</span>
                  </td>
                  <td className="py-2 pr-2 text-right num whitespace-nowrap">{money(it.erp_balance, it.currency)}
                    <span className="block text-xs text-muted">{it.erp_balance > 0 ? "bize borçlu" : it.erp_balance < 0 ? "biz borçluyuz" : ""}</span>
                    {Math.abs(it.sum - it.erp_balance) > 1 && <span className="block text-xs text-warn">hareket toplamı {money(it.sum, it.currency)}</span>}</td>
                  <td className="py-2 pl-3 text-xs max-w-[260px]">
                    <select value={target[it.guid] ?? it.match?.id ?? "new"} onChange={(e) => setTarget({ ...target, [it.guid]: e.target.value })} className="h-9 w-full rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm">
                      <option value="new">➕ Yeni cari aç</option>
                      {it.match && <option value={it.match.id}>Eşleşti: {it.match.name}</option>}
                    </select>
                    {it.match && <span className="block text-muted mt-1">{it.match.via} · ERP&apos;de {it.match.moves} hareket{it.match.moves > 0 && <> · <button type="button" onClick={() => void undo(it.match!.id, it.name)} className="underline">aktarımı geri al</button></>}</span>}
                  </td>
                  <td className="py-2 pl-3">
                    <select value={mode[it.guid] ?? defMode(it)} onChange={(e) => setMode({ ...mode, [it.guid]: e.target.value as BhMode })} className="h-9 rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm">
                      {(Object.keys(MODE) as BhMode[]).map((m) => <option key={m} value={m}>{MODE[m]}</option>)}
                    </select>
                  </td>
                </tr>
                {open === it.guid && (
                  <tr className="bg-[#FAFBFD]"><td colSpan={6} className="p-3">
                    {!rows[it.guid] ? <span className="text-sm text-muted">Yükleniyor…</span> : (
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-muted"><th className="py-1">Tarih</th><th>Hareket</th><th>Açıklama</th><th>Şekli</th><th className="text-right">Borç</th><th className="text-right">Alacak</th></tr></thead>
                        <tbody>{rows[it.guid]!.map((r, i) => (
                          <tr key={i} className="border-t border-[#EEF2F6]"><td className="py-1 whitespace-nowrap">{d(r.date)}</td><td className="whitespace-nowrap pr-2">{r.type}</td><td className="pr-2">{r.desc}</td><td>{r.method ?? ""}</td>
                            <td className="text-right num">{r.debit ? money(r.debit, it.currency) : ""}</td><td className="text-right num">{r.credit ? money(r.credit, it.currency) : ""}</td></tr>
                        ))}</tbody>
                      </table>
                    )}
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || sel.size === 0} onClick={run} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Aktarılıyor…" : `Seçilen ${sel.size} cariyi aktar`}</button>
        <span className="text-xs text-muted">Aynı hareket ikinci kez aktarılmaz. ERP&apos;de zaten hareketi olan carilerde çift kayıt olmasın diye varsayılan &quot;yalnız bakiye&quot;dir.</span>
      </div>
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}
          {msg.errors?.length ? <ul className="list-disc pl-5 mt-1">{msg.errors.map((e) => <li key={e.name}>{e.name}: {e.error}</li>)}</ul> : null}
        </div>
      )}
    </section>
  );
}
