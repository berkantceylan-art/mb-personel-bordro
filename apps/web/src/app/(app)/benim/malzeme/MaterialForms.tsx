"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, textareaCls } from "@/components/erp";
import { createMaterialRequest, signMaterialReceipt } from "@/lib/material-actions";

export type CatalogItem = { id: string; code: string; name: string; unit: string; category: string | null; available: boolean };
type Line = { key: number; item_id: string | null; name: string; unit: string; qty: string; note: string; available?: boolean };

/** Yeni malzeme isteği: stok kartından seç ya da listede yoksa yaz */
const TEXT: Record<string, { search: string; ph: string; why: string; empty: string }> = {
  material: { search: "Malzeme ara", ph: "ör. zirkon blok, frez ucu, eldiven", why: "ör. Frez makinesi için, haftalık sarf", empty: "malzeme" },
  asset: { search: "Demirbaş", ph: "ör. dizüstü bilgisayar, sandalye, mikromotor", why: "ör. Yeni başlayan personel için / eskisi bozuldu", empty: "demirbaş" },
  supply: { search: "Ürün", ph: "ör. HP 305 kartuş, A4 kağıt, çamaşır suyu, kalem", why: "ör. Ön büro yazıcısı için", empty: "ürün" },
};

export function NewRequestForm({ catalog, kind = "material" }: { catalog: CatalogItem[]; kind?: "material" | "asset" | "supply" }) {
  const T = TEXT[kind]!;
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([]);
  const [q, setQ] = useState("");
  const seq = useRef(1);
  const { state, pending, formProps } = useActionForm(createMaterialRequest, {
    prepare: (fd) => { fd.set("kind", kind); fd.set("lines", JSON.stringify(lines.map((l) => ({ item_id: l.item_id, name: l.name, unit: l.unit, qty: Number(l.qty.replace(",", ".")), note: l.note })))); },
    onSuccess: () => { setLines([]); router.refresh(); },
  });
  const hits = useMemo(() => {
    const k = q.trim().toLocaleLowerCase("tr");
    if (k.length < 1) return [];
    return catalog.filter((c) => `${c.name} ${c.code} ${c.category ?? ""}`.toLocaleLowerCase("tr").includes(k)).slice(0, 8);
  }, [q, catalog]);
  const add = (l: Omit<Line, "key">) => { setLines((x) => [...x, { ...l, key: seq.current++ }]); setQ(""); };
  const set = (key: number, patch: Partial<Line>) => setLines((x) => x.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <form {...formProps} className="flex flex-col gap-4">
      <div className="relative">
        <Field label={T.search} hint={catalog.length ? "ad ya da kod yazın; listede yoksa yazdığınızı ekleyin" : "yazıp Enter'a basın"}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={T.ph} className={inputCls}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (hits[0]) add({ item_id: hits[0].id, name: hits[0].name, unit: hits[0].unit, qty: "1", note: "", available: hits[0].available }); else if (q.trim()) add({ item_id: null, name: q.trim(), unit: "adet", qty: "1", note: "" }); } }} />
        </Field>
        {q.trim() && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-[12px] border border-line bg-white shadow-lg">
            {hits.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => add({ item_id: c.id, name: c.name, unit: c.unit, qty: "1", note: "", available: c.available })} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-[#F2F6FA]">
                  <span className="flex-1"><b>{c.name}</b> <span className="text-muted">· {c.code}{c.category ? ` · ${c.category}` : ""}</span></span>
                  <span className={`text-xs font-semibold ${c.available ? "text-ok" : "text-warn"}`}>{c.available ? "depoda var" : "depoda yok"}</span>
                </button>
              </li>
            ))}
            <li>
              <button type="button" onClick={() => add({ item_id: null, name: q.trim(), unit: "adet", qty: "1", note: "" })} className="w-full px-3 py-2.5 text-left text-sm font-semibold text-brand-700 hover:bg-[#F2F6FA]">+ “{q.trim()}” listede yok, böyle ekle</button>
            </li>
          </ul>
        )}
      </div>

      {lines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {lines.map((l) => (
            <li key={l.key} className="grid grid-cols-[1fr_90px_90px_auto] items-end gap-2 rounded-[12px] border border-line bg-[#FAFBFD] p-2.5 md:grid-cols-[1fr_100px_100px_1fr_auto]">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{l.name}</div>
                <div className={`text-xs ${l.item_id ? (l.available ? "text-ok" : "text-warn") : "text-muted"}`}>{l.item_id ? (l.available ? "Depoda var" : "Depoda yok, satın alınabilir") : "Stok kartı yok (serbest)"}</div>
              </div>
              <input aria-label="Miktar" inputMode="decimal" value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value })} className={`${inputCls} num`} />
              <input aria-label="Birim" value={l.unit} disabled={!!l.item_id} onChange={(e) => set(l.key, { unit: e.target.value })} className={inputCls} />
              <input aria-label="Not" placeholder="Not (renk, ölçü…)" value={l.note} onChange={(e) => set(l.key, { note: e.target.value })} className={`${inputCls} hidden md:block`} />
              <button type="button" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} className="h-11 px-2 text-sm font-semibold text-bad">Sil</button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <Field label="Ne için?" hint="isteğe bağlı"><textarea name="reason" rows={2} maxLength={500} placeholder={T.why} className={textareaCls} /></Field>
        <Field label="Ne zamana lazım?" hint="isteğe bağlı"><input type="date" name="needed_by" className={inputCls} /></Field>
      </div>
      {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
      <div><button disabled={pending || lines.length === 0} className={btnPrimary}>{pending ? "Gönderiliyor…" : `${kind === "supply" ? "Siparişi" : "İsteği"} gönder${lines.length ? ` (${lines.length} kalem)` : ""}`}</button></div>
    </form>
  );
}

/** Personel: teslim aldım imzası */
export function SignReceiptForm({ id, summary }: { id: string; summary: string }) {
  const router = useRouter();
  const pad = useRef<SignaturePadHandle>(null);
  const [sig, setSig] = useState("");
  const { state, pending, formProps } = useActionForm(signMaterialReceipt, { prepare: (fd) => fd.set("signature", pad.current?.toDataURL() ?? sig), onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-2 rounded-[12px] border-2 border-[#F59E0B] bg-[#FFFBEB] p-3">
      <input type="hidden" name="id" value={id} />
      <p className="text-sm"><b>Teslim aldığınızı imzalayın:</b> {summary}</p>
      <SignaturePad ref={pad} onChange={setSig} />
      {state && <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice>}
      <div className="flex gap-2">
        <button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Teslim aldım, imzala"}</button>
        <button type="button" onClick={() => { pad.current?.clear(); setSig(""); }} className={btnSecondary}>İmzayı sil</button>
      </div>
    </form>
  );
}
