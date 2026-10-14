"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { glSaveVoucher, type VoucherState } from "@/lib/gl-actions";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { DOC_TYPE, VOUCHER_KIND } from "@/lib/gl";

type L = { code: string; debit: string; credit: string; description: string };
const num = (s: string) => { const t = s.trim(); if (!t) return 0; const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
const show = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Elle muhasebe fişi: satır ekle, borç / alacak dengesi canlı görünür */
export function VoucherEditor({ accounts, initial }: { accounts: Array<{ code: string; name: string }>; initial?: { id: string; date: string; kind: string; description: string; doc_type: string; doc_no: string; doc_date: string; lines: L[] } }) {
  const router = useRouter();
  const blank = (): L => ({ code: "", debit: "", credit: "", description: "" });
  const [lines, setLines] = useState<L[]>(initial?.lines?.length ? initial.lines : [blank(), blank()]);
  const names = useMemo(() => new Map(accounts.map((a) => [a.code, a.name])), [accounts]);
  const { state, pending, formProps } = useActionForm<VoucherState>(glSaveVoucher, {
    prepare: (fd) => fd.set("lines", JSON.stringify(lines)),
    onSuccess: (s) => { if (s?.id) router.push(`/muhasebe/fisler/${s.id}?tamam=${encodeURIComponent("Fiş kaydedildi.")}`); },
  });
  const d = lines.reduce((x, l) => x + num(l.debit), 0);
  const c = lines.reduce((x, l) => x + num(l.credit), 0);
  const set = (i: number, p: Partial<L>) => setLines((x) => x.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const cell = "h-10 rounded-lg border border-line bg-white px-2 text-sm w-full";
  return (
    <form {...formProps} className="flex flex-col gap-4">
      {initial && <input type="hidden" name="id" value={initial.id} />}
      <datalist id="gl-acc">{accounts.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      <div className="grid gap-3 md:grid-cols-6">
        <Field label="Tarih"><input type="date" name="date" required defaultValue={initial?.date ?? new Date().toISOString().slice(0, 10)} className={inputCls} /></Field>
        <Field label="Fiş türü"><select name="kind" defaultValue={initial?.kind ?? "mahsup"} className={selectCls}>{Object.entries(VOUCHER_KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Açıklama" className="md:col-span-2"><input name="description" maxLength={500} defaultValue={initial?.description ?? ""} className={inputCls} /></Field>
        <Field label="Belge türü"><select name="doc_type" defaultValue={initial?.doc_type ?? "other"} className={selectCls}>{Object.entries(DOC_TYPE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
        <Field label="Belge no / tarih"><div className="flex gap-1"><input name="doc_no" maxLength={60} defaultValue={initial?.doc_no ?? ""} className={inputCls} /><input type="date" name="doc_date" defaultValue={initial?.doc_date ?? ""} className={`${inputCls} w-36`} /></div></Field>
      </div>
      <div className="overflow-x-auto rounded-[14px] border border-line bg-white">
        <table className="w-full text-sm min-w-[820px]">
          <thead><tr className="text-left text-xs text-muted"><th className="p-2 w-40">Hesap kodu</th><th className="p-2">Hesap adı</th><th className="p-2">Açıklama</th><th className="p-2 w-36 text-right">Borç</th><th className="p-2 w-36 text-right">Alacak</th><th className="p-2 w-10"></th></tr></thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i} className="border-t border-[#EEF2F6]">
                <td className="p-1.5"><input list="gl-acc" value={l.code} onChange={(e) => set(i, { code: e.target.value.trim() })} className={`${cell} num`} placeholder="770.01" /></td>
                <td className="p-1.5 text-xs">{l.code ? names.get(l.code) ?? <span className="text-bad">hesap yok</span> : ""}</td>
                <td className="p-1.5"><input value={l.description} onChange={(e) => set(i, { description: e.target.value })} className={cell} /></td>
                <td className="p-1.5"><input inputMode="decimal" value={l.debit} onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={`${cell} num text-right`} /></td>
                <td className="p-1.5"><input inputMode="decimal" value={l.credit} onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={`${cell} num text-right`} /></td>
                <td className="p-1.5"><button type="button" onClick={() => setLines((x) => x.length > 2 ? x.filter((_, j) => j !== i) : x)} className="text-bad text-lg" aria-label="Satırı sil">×</button></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-line font-semibold">
              <td className="p-2" colSpan={3}><button type="button" onClick={() => setLines((x) => [...x, blank()])} className="text-sm font-semibold text-brand-700">+ Satır ekle</button>
                {d !== c && <button type="button" onClick={() => setLines((x) => [...x, { ...blank(), debit: c > d ? show(c - d) : "", credit: d > c ? show(d - c) : "" }])} className="ml-4 text-sm font-semibold text-warn">Farkı yeni satıra yaz</button>}</td>
              <td className="p-2 text-right num">{show(d)}</td><td className="p-2 text-right num">{show(c)}</td><td />
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={`text-sm font-semibold ${d === c && d > 0 ? "text-ok" : "text-bad"}`}>{d === c && d > 0 ? "✓ Borç ve alacak eşit" : `Fark: ${show(Math.abs(d - c))}`}</p>
      {state && !state.ok && <Notice tone="bad">{state.message}</Notice>}
      <div><button disabled={pending || d !== c || d === 0} className={btnPrimary}>{pending ? "Kaydediliyor…" : "Fişi kaydet"}</button></div>
    </form>
  );
}
