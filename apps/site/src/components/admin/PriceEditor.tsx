"use client";

import { useState, useTransition } from "react";
import { savePriceList } from "@/lib/admin-actions";
import type { I18nText } from "@/lib/i18n";
import type { PriceItem } from "@/lib/prices";

type Row = {
  key: string;
  id?: string;
  section: I18nText;
  name: I18nText;
  unit: I18nText;
  note: I18nText;
  price_try: string;
  price_eur: string;
  is_active: boolean;
};

const toRow = (p: PriceItem): Row => ({
  key: p.id,
  id: p.id,
  section: p.section ?? {},
  name: p.name ?? {},
  unit: p.unit ?? {},
  note: p.note ?? {},
  price_try: p.price_try === null ? "" : String(p.price_try).replace(".", ","),
  price_eur: p.price_eur === null ? "" : String(p.price_eur).replace(".", ","),
  is_active: p.is_active,
});
let seq = 0;
const blank = (section: I18nText = {}): Row => ({ key: `n${++seq}`, section: { ...section }, name: {}, unit: {}, note: {}, price_try: "", price_eur: "", is_active: true });

const cell = "w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm hover:border-gypsum focus:border-smile focus:bg-white focus:outline-none";

/** Excel tarzı fiyat listesi düzenleyici: satır ekle/sil/taşı, Excel'den yapıştır, toplu kaydet */
export function PriceEditor({ initial }: { initial: PriceItem[] }) {
  const [rows, setRows] = useState<Row[]>(() => initial.map(toRow));
  const [open, setOpen] = useState<string | null>(null);
  const [paste, setPaste] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [dirty, setDirty] = useState(false);
  const [pending, start] = useTransition();

  const set = (key: string, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };
  const setI = (key: string, field: "section" | "name" | "unit" | "note", lang: "tr" | "en" | "fr", v: string) =>
    setRows((rs) => {
      setDirty(true);
      return rs.map((r) => (r.key === key ? { ...r, [field]: { ...r[field], [lang]: v } } : r));
    });
  const move = (i: number, d: -1 | 1) =>
    setRows((rs) => {
      const j = i + d;
      if (j < 0 || j >= rs.length) return rs;
      const c = [...rs];
      [c[i], c[j]] = [c[j], c[i]];
      setDirty(true);
      return c;
    });

  function importPaste() {
    // Sütunlar: Bölüm | Ürün | Birim | TL | EUR  (sekme ya da ; ile ayrılmış)
    const added = paste
      .split(/\r?\n/)
      .map((l) => l.split(/\t|;/).map((x) => x.trim()))
      .filter((c) => c.some(Boolean) && c[1])
      .map((c) => ({ ...blank({ tr: c[0] }), name: { tr: c[1] }, unit: c[2] ? { tr: c[2] } : {}, price_try: c[3] ?? "", price_eur: c[4] ?? "" }));
    if (added.length) {
      setRows((rs) => [...rs, ...added]);
      setDirty(true);
      setPaste("");
      setMsg({ ok: `${added.length} satır eklendi. Kaydetmeyi unutmayın.` });
    } else setMsg({ error: "Yapıştırılan metinde satır bulunamadı. Sütunlar: Bölüm, Ürün, Birim, TL, EUR." });
  }

  function save() {
    setMsg({});
    start(async () => {
      const res = await savePriceList(
        rows.map((r) => ({ id: r.id, section: r.section, name: r.name, unit: r.unit, note: r.note, price_try: r.price_try, price_eur: r.price_eur, is_active: r.is_active })),
      );
      setMsg(res);
      if (res.ok) setDirty(false);
    });
  }

  let lastSection = "";
  return (
    <div className="grid gap-5">
      <div className="overflow-x-auto rounded-2xl border border-gypsum bg-white">
        <table className="w-full min-w-[56rem] text-left">
          <thead className="border-b border-gypsum bg-porcelain text-xs uppercase tracking-wide text-slate">
            <tr>
              <th className="w-16 px-3 py-2">Sıra</th>
              <th className="px-3 py-2">Bölüm</th>
              <th className="px-3 py-2">Ürün / hizmet</th>
              <th className="w-32 px-3 py-2">Birim</th>
              <th className="w-28 px-3 py-2 text-right">TL</th>
              <th className="w-28 px-3 py-2 text-right">EUR</th>
              <th className="w-20 px-3 py-2">Yayında</th>
              <th className="w-36 px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-slate">
                  Liste boş. “Satır ekle” ya da aşağıdan Excel'den yapıştırın.
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const newSection = (r.section.tr ?? "") !== lastSection;
              lastSection = r.section.tr ?? "";
              return (
                <FragmentRow key={r.key}>
                  <tr className={`border-t ${newSection && i > 0 ? "border-navy/20" : "border-gypsum"} ${r.is_active ? "" : "opacity-55"}`}>
                    <td className="px-2 py-1">
                      <div className="flex gap-1">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Yukarı" className="grid h-7 w-7 place-items-center rounded-full border border-gypsum text-xs text-slate hover:border-navy disabled:opacity-30">
                          ▲
                        </button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === rows.length - 1} aria-label="Aşağı" className="grid h-7 w-7 place-items-center rounded-full border border-gypsum text-xs text-slate hover:border-navy disabled:opacity-30">
                          ▼
                        </button>
                      </div>
                    </td>
                    <td className="px-1">
                      <input aria-label="Bölüm" value={r.section.tr ?? ""} onChange={(e) => setI(r.key, "section", "tr", e.target.value)} placeholder="ör. Zirkonyum" className={`${cell} font-semibold text-navy`} />
                    </td>
                    <td className="px-1">
                      <input aria-label="Ürün" value={r.name.tr ?? ""} onChange={(e) => setI(r.key, "name", "tr", e.target.value)} placeholder="ör. Monolitik zirkonyum kron" className={cell} />
                    </td>
                    <td className="px-1">
                      <input aria-label="Birim" value={r.unit.tr ?? ""} onChange={(e) => setI(r.key, "unit", "tr", e.target.value)} placeholder="diş başı" className={cell} />
                    </td>
                    <td className="px-1">
                      <input aria-label="TL fiyat" inputMode="decimal" value={r.price_try} onChange={(e) => set(r.key, { price_try: e.target.value })} className={`${cell} text-right tabular-nums`} />
                    </td>
                    <td className="px-1">
                      <input aria-label="EUR fiyat" inputMode="decimal" value={r.price_eur} onChange={(e) => set(r.key, { price_eur: e.target.value })} className={`${cell} text-right tabular-nums`} />
                    </td>
                    <td className="px-3">
                      <input type="checkbox" aria-label="Yayında" checked={r.is_active} onChange={(e) => set(r.key, { is_active: e.target.checked })} className="h-5 w-5 accent-navy" />
                    </td>
                    <td className="px-2 text-right text-xs">
                      <button type="button" onClick={() => setOpen(open === r.key ? null : r.key)} className="rounded-full px-2 py-1 font-semibold text-navy hover:bg-porcelain">
                        Çeviri / not
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setRows((rs) => rs.filter((x) => x.key !== r.key));
                          setDirty(true);
                        }}
                        aria-label="Satırı sil"
                        className="rounded-full px-2 py-1 font-semibold text-bad hover:bg-bad-bg"
                      >
                        Sil
                      </button>
                    </td>
                  </tr>
                  {open === r.key && (
                    <tr className="bg-porcelain/60">
                      <td />
                      <td colSpan={7} className="px-2 pb-4 pt-2">
                        <div className="grid gap-3 md:grid-cols-2">
                          {(["en", "fr"] as const).map((l) => (
                            <fieldset key={l} className="grid gap-2 rounded-xl border border-gypsum bg-white p-3">
                              <legend className="px-1 text-xs font-semibold text-slate">{l === "en" ? "İngilizce" : "Fransızca"}</legend>
                              <input value={r.section[l] ?? ""} onChange={(e) => setI(r.key, "section", l, e.target.value)} placeholder="Bölüm" className="field text-sm" lang={l} />
                              <input value={r.name[l] ?? ""} onChange={(e) => setI(r.key, "name", l, e.target.value)} placeholder="Ürün / hizmet" className="field text-sm" lang={l} />
                              <input value={r.unit[l] ?? ""} onChange={(e) => setI(r.key, "unit", l, e.target.value)} placeholder="Birim" className="field text-sm" lang={l} />
                            </fieldset>
                          ))}
                          {(["tr", "en", "fr"] as const).map((l) => (
                            <label key={l} className="grid gap-1 text-xs font-semibold text-slate">
                              Not ({l.toUpperCase()})
                              <input value={r.note[l] ?? ""} onChange={(e) => setI(r.key, "note", l, e.target.value)} placeholder="ör. Renk farkı için +%10" className="field text-sm font-normal" lang={l} />
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            setRows((rs) => [...rs, blank(rs[rs.length - 1]?.section)]);
            setDirty(true);
          }}
          className="rounded-full border border-gypsum bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
        >
          + Satır ekle
        </button>
        <span className="ml-auto text-sm text-slate">{rows.length} satır{dirty && " · kaydedilmemiş değişiklik var"}</span>
        <button type="button" onClick={save} disabled={pending} className="rounded-full bg-navy px-6 py-3 font-semibold text-white hover:bg-blue disabled:opacity-60">
          {pending ? "Kaydediliyor…" : "Fiyat listesini kaydet"}
        </button>
      </div>
      {(msg.ok || msg.error) && (
        <p role={msg.error ? "alert" : "status"} className={`rounded-lg px-4 py-3 text-sm ${msg.error ? "bg-bad-bg text-bad" : "bg-ok-bg text-ok"}`}>
          {msg.error ?? msg.ok}
        </p>
      )}

      <details className="rounded-2xl border border-gypsum bg-white p-5">
        <summary className="cursor-pointer font-semibold text-navy">Excel'den yapıştır</summary>
        <p className="mt-2 text-sm text-slate">
          Excel'de şu sırayla sütunları seçip kopyalayın ve buraya yapıştırın: <strong>Bölüm · Ürün · Birim · TL · EUR</strong>. Satırlar listenin sonuna eklenir.
        </p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={6} className="field mt-3 font-mono text-sm" placeholder={"Zirkonyum\tMonolitik kron\tdiş başı\t1500\t45"} />
        <button type="button" onClick={importPaste} className="mt-3 rounded-full border border-gypsum px-4 py-2 text-sm font-semibold text-navy hover:border-navy">
          Satırları ekle
        </button>
      </details>
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
