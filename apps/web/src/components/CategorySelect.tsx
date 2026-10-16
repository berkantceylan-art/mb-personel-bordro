"use client";
import { useState, useSyncExternalStore } from "react";
import { quickAddExpenseCategory } from "@/lib/category-actions";

type Cat = { id: string; name: string; kind?: string; code?: string };

// Sayfadaki tüm satırlar aynı listeyi görsün: yeni açılan gider türü hepsine eklenir
let added: Cat[] = [];
const subs = new Set<() => void>();
const store = {
  get: () => added,
  sub: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  push: (c: Cat) => { if (!added.some((x) => x.id === c.id)) { added = [...added, c]; subs.forEach((f) => f()); } },
};
const NEW = "__new__";

/** Gider türü seçimi + "Yeni gider türü" (yerinde açılır, tüm satırlarda görünür) */
export function CategorySelect({ value, onChange, categories, emptyLabel, className }: {
  value: string | null; onChange: (id: string | null) => void; categories: Cat[]; emptyLabel: string; className?: string;
}) {
  const extra = useSyncExternalStore(store.sub, store.get, store.get);
  const list = [...categories, ...extra.filter((e) => !categories.some((c) => c.id === e.id))];
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function add() {
    setBusy(true); setErr(null);
    const r = await quickAddExpenseCategory(name).catch(() => ({ ok: false, message: "Sunucuya ulaşılamadı" }) as const);
    setBusy(false);
    if (!r.ok || !("cat" in r) || !r.cat) { setErr(r.message ?? "Açılamadı"); return; }
    store.push(r.cat);
    onChange(r.cat.id);
    setAdding(false); setName("");
  }

  if (adding) {
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } if (e.key === "Escape") setAdding(false); }}
          placeholder="Yeni gider türü (ör. Kira, Elektrik)" maxLength={120} className="h-9 rounded-[10px] border border-[#D5DEE8] px-2 text-sm w-56" />
        <button type="button" disabled={busy || name.trim().length < 2} onClick={add} className="h-9 px-3 rounded-[10px] bg-brand-700 text-white text-xs font-semibold disabled:opacity-50">{busy ? "…" : "Ekle"}</button>
        <button type="button" onClick={() => { setAdding(false); setErr(null); }} className="text-xs text-muted">Vazgeç</button>
        {err && <span className="text-xs text-bad">{err}</span>}
      </span>
    );
  }
  return (
    <select value={value ?? ""} onChange={(e) => { if (e.target.value === NEW) { setAdding(true); return; } onChange(e.target.value || null); }} className={className}>
      <option value="">{emptyLabel}</option>
      {list.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
      <option value={NEW}>＋ Yeni gider türü aç…</option>
    </select>
  );
}
