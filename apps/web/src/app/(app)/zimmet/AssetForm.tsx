"use client";
import { useState } from "react";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { saveAsset } from "./actions";

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
type Asset = { id: string; code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null; purchase_date: string | null; value: number | null; status: string; note: string | null };

export function AssetForm({ asset, categories, employees, defaultEmployee }: { asset?: Asset; categories: Record<string, string>; employees: Array<{ id: string; name: string }>; defaultEmployee?: string }) {
  const [open, setOpen] = useState(!!defaultEmployee);
  const [assign, setAssign] = useState(!!defaultEmployee);
  if (!asset && !open) return <button type="button" onClick={() => setOpen(true)} className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">+ Yeni demirbaş</button>;
  const v = (k: keyof Asset) => (asset?.[k] === null || asset?.[k] === undefined ? "" : String(asset[k]));
  return (
    <form action={saveAsset} className="grid gap-3 md:grid-cols-4 bg-[#F7F9FB] rounded-xl p-3">
      {asset && <input type="hidden" name="id" value={asset.id} />}
      <label className="flex flex-col gap-1 text-sm text-muted">Demirbaş no<input name="code" defaultValue={v("code")} placeholder="ör. DB-0012" className={input} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted md:col-span-2">Adı *<input name="name" required defaultValue={v("name")} placeholder="ör. Dizüstü bilgisayar" className={input} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted">Tür
        <select name="category" defaultValue={asset?.category ?? "DIGER"} className={input}>{Object.entries(categories).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </label>
      <label className="flex flex-col gap-1 text-sm text-muted">Marka / model<input name="brand_model" defaultValue={v("brand_model")} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted">Seri no<input name="serial_no" defaultValue={v("serial_no")} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted">Alış tarihi<input type="date" name="purchase_date" defaultValue={v("purchase_date")} className={input} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted">Değer (TL)<input name="value" inputMode="decimal" defaultValue={asset?.value ? (asset.value / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : ""} className={`${input} num`} /></label>
      <label className="flex flex-col gap-1 text-sm text-muted md:col-span-3">Not<input name="note" defaultValue={v("note")} className={input} /></label>
      {asset && (
        <label className="flex flex-col gap-1 text-sm text-muted">Durum
          <select name="status" defaultValue={asset.status} disabled={asset.status === "ASSIGNED"} className={input}>
            {asset.status === "ASSIGNED" && <option value="ASSIGNED">Zimmetli (iade alınca değişir)</option>}
            <option value="AVAILABLE">Boşta</option><option value="MAINTENANCE">Arızalı / bakımda</option><option value="LOST">Kayıp</option><option value="RETIRED">Hurda</option>
          </select>
        </label>
      )}
      {!asset && (
        <div className="md:col-span-4 flex flex-col gap-2">
          <label className="flex gap-2 items-center text-sm"><input type="checkbox" checked={assign} onChange={(e) => setAssign(e.target.checked)} className="w-5 h-5" />Hemen bir personele zimmetle</label>
          {assign && (
            <div className="grid gap-3 md:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm text-muted md:col-span-2">Personel *
                <select name="employee_id" required defaultValue={defaultEmployee ?? ""} className={input}><option value="">Seçin</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
              </label>
              <label className="flex flex-col gap-1 text-sm text-muted">Teslim tarihi<input type="date" name="assigned_on" defaultValue={new Date().toISOString().slice(0, 10)} className={input} /></label>
              <label className="flex flex-col gap-1 text-sm text-muted">Teslimde durumu<input name="condition_out" defaultValue="Sağlam" className={input} /></label>
            </div>
          )}
        </div>
      )}
      <div className="md:col-span-4 flex gap-2 flex-wrap">
        <PendingSubmit className="h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold">{asset ? "Kaydet" : "Ekle"}</PendingSubmit>
        {!asset && <button type="button" onClick={() => setOpen(false)} className="h-11 px-3 text-sm font-semibold text-muted">Vazgeç</button>}
      </div>
    </form>
  );
}
