"use client";
import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { bhCariHide, bhCariImport, bhCariRows, bhCariUndo, bhPartyMoves, type BhListItem, type BhMode, type BhParty, type BhRow } from "@/lib/bh-cari-actions";

const money = (k: number, c: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${c === "TRY" ? "₺" : c === "EUR" ? "€" : c}`;
const d = (s: string | null) => (s ? s.split("-").reverse().join(".") : "—");
const MODE: Record<BhMode, string> = { rows: "Kart + tüm hareketler", balance: "Kart + yalnız bakiye (devir)", card: "Yalnız kart" };
type View = "wait" | "done" | "hidden";
const VIEW: Record<View, string> = { wait: "Aktarılacaklar", done: "ERP'ye aktarılanlar", hidden: "Listeden çıkarılanlar" };
const viewOf = (it: BhListItem): View => (it.imported ? "done" : it.hidden ? "hidden" : "wait");
const KIND: Record<string, string> = { customer: "Müşteri", supplier: "Tedarikçi", both: "Müşteri + tedarikçi", other: "Diğer" };
const norm = (s: string) => s.toLocaleLowerCase("tr-TR").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
// Bizim Hesap adlarındaki alt hesap ekleri (MB, UPS, EURO…) aramaya katılmaz
const seed = (name: string) => norm(name).split(" ").filter((w) => w.length > 1 && !["mb", "ups", "euro", "eur", "tl", "hesap", "hesabi", "hesabı", "cari", "kdv"].includes(w)).slice(0, 2).join(" ");

/** Bizim Hesap carileri: seç, ekstreyi incele, ERP'deki hedef cariyi seç, aktar */
export function BhCariClient({ items, parties }: { items: BhListItem[]; parties: BhParty[] }) {
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
  const [picking, setPicking] = useState<string | null>(null);
  const [pq, setPq] = useState("");
  const [tMoves, setTMoves] = useState<Record<string, number>>({});
  const [view, setView] = useState<View>("wait");

  const partyById = useMemo(() => new Map(parties.map((p) => [p.id, p])), [parties]);
  const tgt = (it: BhListItem) => target[it.guid] ?? it.match?.id ?? "new";
  // Hedef caride ERP'nin kendi hareketi varsa çift kayıt olmasın diye varsayılan "yalnız bakiye"
  const defMode = (it: BhListItem): BhMode => {
    const t = tgt(it);
    if (t === "new") return "rows";
    const n = t === it.match?.id ? it.match.moves : tMoves[t];
    return (n ?? 0) > 0 ? "balance" : "rows";
  };
  const curOk = (it: BhListItem) => { const t = tgt(it); return t === "new" || (mode[it.guid] ?? defMode(it)) === "card" || partyById.get(t)?.currency === it.currency; };
  const found = useMemo(() => {
    const n = norm(pq);
    if (!n) return [];
    const ws = n.split(" ");
    return parties.filter((p) => { const h = `${norm(p.name)} ${p.tax_no ?? ""}`; return ws.every((w) => h.includes(w)); }).slice(0, 40);
  }, [pq, parties]);
  async function choose(it: BhListItem, id: string) {
    setTarget((x) => ({ ...x, [it.guid]: id }));
    setMode((x) => { const y = { ...x }; delete y[it.guid]; return y; });
    setPicking(null);
    if (id !== "new" && id !== it.match?.id && tMoves[id] === undefined) {
      const r = await bhPartyMoves(id);
      setTMoves((x) => ({ ...x, [id]: r.moves }));
    }
  }
  const shown = useMemo(() => {
    const n = q.toLocaleLowerCase("tr-TR").trim();
    return items.filter((it) => it.kind === tab && viewOf(it) === view && (!onlyBal || it.erp_balance !== 0) && (!n || `${it.name} ${it.info.tax_no ?? ""} ${it.group ?? ""}`.toLocaleLowerCase("tr-TR").includes(n)));
  }, [items, tab, q, onlyBal, view]);
  const allShown = shown.length > 0 && shown.every((it) => sel.has(it.guid));
  const counts = { c: items.filter((i) => i.kind === "c" && viewOf(i) === view).length, s: items.filter((i) => i.kind === "s" && viewOf(i) === view).length };
  const vCount = (v: View) => items.filter((i) => i.kind === tab && viewOf(i) === v).length;
  function switchView(v: View) { setView(v); setSel(new Set()); setPicking(null); setOpen(null); setMsg(null); }
  async function hide(h: boolean) {
    const g = [...sel];
    if (!g.length) return;
    setBusy(true);
    const r = await bhCariHide(g, h);
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setSel(new Set());
    setBusy(false); router.refresh();
  }

  async function toggleRows(guid: string) {
    if (open === guid) { setOpen(null); return; }
    setOpen(guid);
    if (!rows[guid]) { const r = await bhCariRows(guid); if (r.rows) setRows((x) => ({ ...x, [guid]: r.rows! })); }
  }
  async function run() {
    setBusy(true); setMsg(null);
    const chosen = items.filter((it) => sel.has(it.guid));
    const bad = chosen.filter((it) => !curOk(it));
    if (bad.length) { setMsg({ ok: false, text: `Para birimi tutmayan ${bad.length} cari seçili: ${bad.slice(0, 5).map((i) => i.name).join(", ")}` }); setBusy(false); return; }
    const picks = chosen.map((it) => ({ guid: it.guid, target: tgt(it), mode: mode[it.guid] ?? defMode(it) }));
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
      <div className="flex flex-wrap items-center gap-1 text-sm">
        {(Object.keys(VIEW) as View[]).map((v) => (
          <button key={v} type="button" onClick={() => switchView(v)} className={`px-3 py-1.5 rounded-lg border ${view === v ? "border-brand-700 text-brand-700 font-semibold bg-[#F3F8FD]" : "border-transparent text-muted"}`}>
            {VIEW[v]} ({vCount(v)})
          </button>
        ))}
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
                  <td className="py-2 pl-3 text-xs max-w-[280px]">
                    {(() => {
                      const t = tgt(it);
                      const tp = t !== "new" ? partyById.get(t) : undefined;
                      const auto = t !== "new" && t === it.match?.id;
                      return (
                        <>
                          <button type="button" onClick={() => { setPicking(picking === it.guid ? null : it.guid); setPq(seed(it.name)); }}
                            className={`h-9 w-full rounded-lg border px-2 bg-white text-sm text-left truncate ${tp && !curOk(it) ? "border-bad" : "border-[#D5DEE8]"}`}>
                            {t === "new" ? "➕ Yeni cari aç" : `${auto ? "Eşleşti" : "Seçildi"}: ${tp?.name ?? it.match?.name ?? "?"}`}
                          </button>
                          {tp && <span className="block text-muted mt-1">{KIND[tp.kind] ?? tp.kind} · {tp.currency}{tp.tax_no ? ` · VKN ${tp.tax_no}` : ""}</span>}
                          {tp && !curOk(it) && <span className="block text-bad mt-1">Para birimi farklı ({it.currency} → {tp.currency}): yalnız kart aktarılabilir</span>}
                          {auto && it.match && <span className="block text-muted mt-1">{it.match.via} · ERP&apos;de {it.match.moves} hareket{it.match.moves > 0 && <> · <button type="button" onClick={() => void undo(it.match!.id, it.name)} className="underline">aktarımı geri al</button></>}</span>}
                          {t !== "new" && !auto && tMoves[t] !== undefined && <span className="block text-muted mt-1">ERP&apos;de {tMoves[t]} hareket</span>}
                        </>
                      );
                    })()}
                  </td>
                  <td className="py-2 pl-3">
                    <select value={mode[it.guid] ?? defMode(it)} onChange={(e) => setMode({ ...mode, [it.guid]: e.target.value as BhMode })} className="h-9 rounded-lg border border-[#D5DEE8] px-2 bg-white text-sm">
                      {(Object.keys(MODE) as BhMode[]).map((m) => <option key={m} value={m}>{MODE[m]}</option>)}
                    </select>
                  </td>
                </tr>
                {picking === it.guid && (
                  <tr className="bg-[#F7FAFD]"><td colSpan={6} className="p-3">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="text-sm font-semibold">{it.name} → ERP&apos;de hangi cari?</span>
                      <input autoFocus value={pq} onChange={(e) => setPq(e.target.value)} placeholder="ERP carisi ara: ad veya VKN" className={`${input} w-72`} />
                      <button type="button" onClick={() => void choose(it, "new")} className="h-10 px-3 rounded-lg border border-line bg-white text-sm font-semibold">➕ Yeni cari aç</button>
                      {it.match && <button type="button" onClick={() => void choose(it, it.match!.id)} className="h-10 px-3 rounded-lg border border-line bg-white text-sm">Otomatik eşleşme: {it.match.name}</button>}
                      <button type="button" onClick={() => setPicking(null)} className="h-10 px-3 text-sm text-muted underline">Kapat</button>
                    </div>
                    {!pq.trim() ? <span className="text-xs text-muted">Aramak için yazın.</span> : !found.length ? <span className="text-xs text-muted">Eşleşen ERP carisi yok.</span> : (
                      <div className="flex flex-col max-h-72 overflow-y-auto border border-[#EEF2F6] rounded-lg bg-white">
                        {found.map((p) => (
                          <button key={p.id} type="button" onClick={() => void choose(it, p.id)} className={`text-left px-3 py-2 text-sm border-b border-[#EEF2F6] hover:bg-[#F3F8FD] ${tgt(it) === p.id ? "bg-[#F3F8FD] font-semibold" : ""}`}>
                            {p.name}
                            <span className={`ml-2 text-xs ${p.currency === it.currency ? "text-muted" : "text-bad"}`}>{KIND[p.kind] ?? p.kind} · {p.currency}{p.tax_no ? ` · VKN ${p.tax_no}` : ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </td></tr>
                )}
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
        {view !== "hidden" && <button type="button" disabled={busy || sel.size === 0} onClick={run} className="h-12 px-5 rounded-[12px] bg-brand-700 text-white font-bold disabled:opacity-50">{busy ? "Aktarılıyor…" : `Seçilen ${sel.size} cariyi aktar`}</button>}
        {view === "wait" && <button type="button" disabled={busy || sel.size === 0} onClick={() => void hide(true)} className="h-12 px-4 rounded-[12px] border border-line bg-white font-semibold disabled:opacity-50">Seçilen {sel.size} cariyi listeden çıkar</button>}
        {view === "hidden" && <button type="button" disabled={busy || sel.size === 0} onClick={() => void hide(false)} className="h-12 px-4 rounded-[12px] border border-line bg-white font-semibold disabled:opacity-50">Seçilen {sel.size} cariyi listeye geri al</button>}
        <span className="text-xs text-muted">
          {view === "wait" && <>Aktarılan cariler bu listeden &quot;ERP&apos;ye aktarılanlar&quot;a geçer; aktarmak istemediklerinizi &quot;listeden çıkar&quot; ile kaldırın (silinmez, geri alınabilir). </>}
          {view === "done" && <>Bu cariler ERP&apos;ye aktarıldı. Yanlış aktarımı &quot;aktarımı geri al&quot; ile kaldırabilirsiniz; tekrar aktarmada aynı hareket ikinci kez yazılmaz. </>}
          {view === "hidden" && <>Bu cariler aktarılmayacak olarak işaretlendi; ERP&apos;ye hiçbir şey yazılmadı. </>}
          {view !== "hidden" && <>ERP&apos;de zaten hareketi olan carilerde çift kayıt olmasın diye varsayılan &quot;yalnız bakiye&quot;dir. Hedef cariyi değiştirmek için &quot;ERP&apos;de&quot; sütunundaki kutuya tıklayın.</>}
        </span>
      </div>
      {msg && (
        <div className={`text-sm ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}
          {msg.errors?.length ? <ul className="list-disc pl-5 mt-1">{msg.errors.map((e) => <li key={e.name}>{e.name}: {e.error}</li>)}</ul> : null}
        </div>
      )}
    </section>
  );
}
