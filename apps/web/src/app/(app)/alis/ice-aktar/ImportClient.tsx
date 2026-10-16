"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { commitImport, matchImports, type ImportMatch } from "@/lib/invoice-actions";
import { parseUbl, type ParsedInvoice } from "@/lib/ubl";
import { calcTotals } from "@/lib/invoice";
import { fmt } from "@/lib/fin";
import { qty } from "@/lib/stock";
import { Chip, Notice, btnPrimary, selectCls } from "@/components/erp";
import { CategorySelect } from "@/components/CategorySelect";

type Mode = { mode: "item" | "new" | "none"; item_id?: string | null; category_id?: string | null; new_kind?: string };
type Card = { key: string; file: string; xml: string; inv: ParsedInvoice; match?: ImportMatch; modes: Mode[]; result?: { ok: boolean; id?: string; message: string }; busy?: boolean };

const KINDS: [string, string][] = [["material", "Malzeme"], ["raw", "Hammadde"], ["consumable", "Sarf"], ["goods", "Ticari mal"], ["packaging", "Ambalaj"], ["service", "Hizmet"]];

export function ImportClient({ items, categories, warehouses, preload }: {
  items: { id: string; code: string; name: string; unit: string }[]; categories: { id: string; name: string; kind: string }[]; warehouses: { id: string; name: string }[];
  /** Gelen kutusundan açılan e-fatura(lar) */
  preload?: { file: string; xml: string }[];
}) {
  const [cards, setCards] = useState<Card[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [post, setPost] = useState(true);
  const [wh, setWh] = useState(warehouses[0]?.id ?? "");
  const itemName = new Map(items.map((i) => [i.id, i]));

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setLoading(true);
    const errs: string[] = [];
    const found: { file: string; xml: string }[] = [];
    for (const f of Array.from(files)) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const { default: JSZip } = await import("jszip");
          const zip = await JSZip.loadAsync(await f.arrayBuffer());
          for (const e of Object.values(zip.files)) if (!e.dir && /\.xml$/i.test(e.name)) found.push({ file: `${f.name} › ${e.name}`, xml: await e.async("string") });
        } else found.push({ file: f.name, xml: await f.text() });
      } catch (e) { errs.push(`${f.name}: ${(e as Error).message}`); }
    }
    await processFound(found, errs);
  }

  async function processFound(found: { file: string; xml: string }[], errs: string[]) {
    setLoading(true);
    const parsed: Card[] = [];
    for (const x of found.slice(0, 100)) {
      try {
        const inv = parseUbl(x.xml);
        parsed.push({ key: `${x.file}#${inv.doc_no}`, file: x.file, xml: x.xml, inv, modes: inv.lines.map(() => ({ mode: "none" as const })) });
      } catch (e) { errs.push(`${x.file}: ${(e as Error).message}`); }
    }
    if (parsed.length) {
      const res = await matchImports(parsed.map((c) => ({ key: c.key, inv: c.inv })));
      if (!res.ok) errs.push(res.message ?? "Eşleştirme yapılamadı.");
      for (const c of parsed) {
        const m = res.matches?.find((x) => x.key === c.key);
        c.match = m;
        c.modes = c.inv.lines.map((_, i) => (m?.lines[i]?.item_id ? { mode: "item" as const, item_id: m.lines[i].item_id } : { mode: "none" as const }));
      }
    }
    setCards((cs) => [...cs, ...parsed.filter((p) => !cs.some((c) => c.key === p.key))]);
    setErrors(errs);
    setLoading(false);
  }

  const pre = useRef(false);
  useEffect(() => {
    if (pre.current || !preload?.length) return;
    pre.current = true;
    void processFound(preload, []);
  }, [preload]);

  const setMode = (key: string, i: number, m: Mode) => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, modes: c.modes.map((x, j) => (j === i ? m : x)) } : c)));
  const bulk = (key: string, mode: "new" | "none") => setCards((cs) => cs.map((c) => (c.key === key ? { ...c, modes: c.modes.map((x) => (x.mode === "item" && x.item_id ? x : mode === "new" ? { mode: "new", new_kind: "material" } : { mode: "none" })) } : c)));

  async function commit(c: Card) {
    setCards((cs) => cs.map((x) => (x.key === c.key ? { ...x, busy: true } : x)));
    const res = await commitImport({ inv: c.inv, direction: c.match?.direction ?? "purchase", xml: c.xml, post, warehouse_id: wh || null, lines: c.modes });
    setCards((cs) => cs.map((x) => (x.key === c.key ? { ...x, busy: false, result: res } : x)));
  }
  async function commitAll() {
    for (const c of cards.filter((x) => !x.result?.id && !x.match?.duplicate)) await commit(c);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex flex-col items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-[#B9CDE3] bg-white px-6 py-10 text-center cursor-pointer hover:border-brand-600"
        onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); void onFiles(e.dataTransfer.files); }}>
        <span className="text-3xl" aria-hidden="true">📥</span>
        <span className="font-semibold">e-Fatura XML ya da ZIP dosyalarını buraya bırakın veya seçin</span>
        <span className="text-xs text-muted">Entegratör / GİB portalından indirilen UBL-TR XML. Birden çok dosya ve ZIP (içinde çok sayıda XML) olabilir. Dosyalar tarayıcıda okunur.</span>
        <input type="file" accept=".xml,.zip,application/xml,text/xml,application/zip" multiple className="sr-only" onChange={(e) => { void onFiles(e.target.files); e.target.value = ""; }} />
        {loading && <span className="text-sm text-brand-700">Okunuyor…</span>}
      </label>
      {errors.map((e, i) => <Notice key={i} tone="bad">{e}</Notice>)}

      {cards.length > 0 && (
        <div className="flex flex-wrap items-center gap-4 bg-white border border-line rounded-[14px] px-4 py-3 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} /> Kaydederken işle (cari, KDV, stok)</label>
          <label className="flex items-center gap-2">Stok girişi deposu <select value={wh} onChange={(e) => setWh(e.target.value)} className={`${selectCls} h-9 w-48`}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
          <button type="button" onClick={commitAll} className={`${btnPrimary} h-9 ml-auto`}>Tümünü aktar ({cards.filter((x) => !x.result?.id && !x.match?.duplicate).length})</button>
        </div>
      )}

      {cards.map((c) => {
        const t = calcTotals(c.inv.lines);
        const diff = t.total - c.inv.payable;
        const party = c.match?.direction === "sale" ? c.inv.customer : c.inv.supplier;
        return (
          <section key={c.key} className={`bg-white border rounded-[14px] overflow-hidden ${c.result?.ok ? "border-ok" : "border-line"}`}>
            <header className="px-4 py-3 border-b border-line flex flex-wrap items-center gap-2">
              <b className="num">{c.inv.doc_no}</b>
              <span className="text-sm text-muted">{c.inv.date} · {c.inv.profile} · {c.inv.type_code}</span>
              <Chip tone={c.match?.direction === "sale" ? "blue" : "green"}>{c.match?.direction === "sale" ? "Satış faturası" : "Alış faturası"}</Chip>
              {c.match?.duplicate && <Link href={`/fatura/${c.match.duplicate}`}><Chip tone="red">Daha önce aktarılmış</Chip></Link>}
              <span className="ml-auto text-xs text-muted truncate max-w-[40%]">{c.file}</span>
            </header>
            <div className="px-4 py-3 grid gap-3 md:grid-cols-[1fr_auto] text-sm">
              <div>
                <b>{party.name}</b> <span className="text-muted num">{party.tax_no ?? "VKN yok"}</span>
                <span className="block text-xs">{c.match?.party ? <>Kayıtlı cari: <Link href={`/finans/cariler/${c.match.party.id}`} className="text-brand-700 font-semibold">{c.match.party.name}</Link></> : <span className="text-warn font-semibold">Sistemde yok → otomatik cari açılacak ({[party.tax_office, party.city].filter(Boolean).join(", ")})</span>}</span>
              </div>
              <div className="text-right">
                <span className="block text-lg font-bold num">{fmt(c.inv.payable, c.inv.currency)}</span>
                <span className="text-xs text-muted">KDV {fmt(c.inv.vat_total, c.inv.currency)}{c.inv.withholding_total ? ` · tevkifat ${fmt(c.inv.withholding_total, c.inv.currency)}` : ""}</span>
                {Math.abs(diff) > 1 && <span className="block text-xs text-warn">Satırlardan hesaplanan {fmt(t.total, c.inv.currency)} (fark {fmt(diff, c.inv.currency)}); belge genel iskontosu olabilir.</span>}
              </div>
            </div>
            <div className="overflow-x-auto border-t border-line">
              <table className="w-full text-sm min-w-[900px]">
                <thead><tr className="text-xs text-muted text-left"><th className="px-3 py-2">Kalem</th><th className="px-2 py-2 text-right">Miktar</th><th className="px-2 py-2 text-right">Birim fiyat</th><th className="px-2 py-2 text-right">KDV</th><th className="px-3 py-2 w-[42%]">Sistemde</th></tr></thead>
                <tbody>
                  {c.inv.lines.map((l, i) => {
                    const m = c.modes[i];
                    const how = c.match?.lines[i]?.how;
                    return (
                      <tr key={i} className="border-t border-[#EEF2F6] align-top">
                        <td className="px-3 py-2">{l.name}{l.seller_code && <span className="block text-xs text-muted num">Kod {l.seller_code}</span>}</td>
                        <td className="px-2 py-2 text-right num whitespace-nowrap">{qty(l.qty)} {l.unit}</td>
                        <td className="px-2 py-2 text-right num">{l.unit_price.toLocaleString("tr-TR", { maximumFractionDigits: 4 })}{l.discount_pct ? <span className="block text-xs text-muted">isk. %{l.discount_pct.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}</span> : null}</td>
                        <td className="px-2 py-2 text-right">%{l.vat_rate}</td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            <select value={m.mode} onChange={(e) => setMode(c.key, i, { mode: e.target.value as Mode["mode"], item_id: m.item_id, new_kind: "material" })} className={`${selectCls} h-9 w-40`}>
                              <option value="item">Stok kartına bağla</option><option value="new">Yeni stok kartı aç</option><option value="none">Stoksuz (gider)</option>
                            </select>
                            {m.mode === "item" && (
                              <select value={m.item_id ?? ""} onChange={(e) => setMode(c.key, i, { mode: "item", item_id: e.target.value || null })} className={`${selectCls} h-9 flex-1 min-w-48`}>
                                <option value="">Kart seçin</option>
                                {items.map((it) => <option key={it.id} value={it.id}>{it.name} · {it.code}</option>)}
                              </select>
                            )}
                            {m.mode === "new" && <select value={m.new_kind ?? "material"} onChange={(e) => setMode(c.key, i, { mode: "new", new_kind: e.target.value })} className={`${selectCls} h-9 w-40`}>{KINDS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>}
                            {m.mode === "none" && (
                              <CategorySelect value={m.category_id ?? null} onChange={(id) => setMode(c.key, i, { mode: "none", category_id: id })} categories={categories} emptyLabel="Otomatik (malzeme gideri)" className={`${selectCls} h-9 flex-1 min-w-48`} />
                            )}
                          </div>
                          {m.mode === "item" && m.item_id && how && <span className="text-[11px] text-ok">{how === "learned" ? "Önceki faturalardan öğrenildi" : how === "barcode" ? "Barkodla eşleşti" : how === "code" ? "Stok koduyla eşleşti" : "Adla eşleşti"}: {itemName.get(m.item_id)?.name}</span>}
                          {m.mode === "item" && !m.item_id && <span className="text-[11px] text-bad">Kart seçilmezse stoksuz kaydedilir.</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <footer className="px-4 py-3 border-t border-line flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => bulk(c.key, "new")} className="text-xs font-semibold text-brand-700">Eşleşmeyenleri yeni kart yap</button>
              <button type="button" onClick={() => bulk(c.key, "none")} className="text-xs font-semibold text-brand-700">Eşleşmeyenleri stoksuz yap</button>
              <span className="ml-auto flex items-center gap-3">
                {c.result && <span className={`text-sm ${c.result.ok ? "text-ok" : "text-bad"}`}>{c.result.message}{c.result.id && <> · <Link href={`/fatura/${c.result.id}`} className="font-semibold underline">Faturayı aç</Link></>}</span>}
                {!c.result?.id && !c.match?.duplicate && <button type="button" disabled={c.busy} onClick={() => commit(c)} className={`${btnPrimary} h-9`}>{c.busy ? "Aktarılıyor…" : "Aktar"}</button>}
                <button type="button" onClick={() => setCards((cs) => cs.filter((x) => x.key !== c.key))} className="text-xs text-muted">Listeden çıkar</button>
              </span>
            </footer>
          </section>
        );
      })}
    </div>
  );
}
