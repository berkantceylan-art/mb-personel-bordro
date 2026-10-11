"use client";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { countStart } from "@/lib/barcode-actions";
import { ASSET_CATS } from "@/lib/barcode";

export function StartCount({ locations }: { locations: string[] }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(countStart, { onSuccess: (st) => { if (st.id) router.push(`/demirbas/sayim/${st.id}`); } });
  return (
    <form {...formProps} className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr_auto] items-end">
      <Field label="Başlık"><input name="title" maxLength={120} placeholder={`Demirbaş sayımı ${new Date().toLocaleDateString("tr-TR")}`} className={inputCls} /></Field>
      <Field label="Konum" hint="boş = tümü"><input name="location" list="ast-locs" maxLength={120} className={inputCls} /><datalist id="ast-locs">{locations.map((l) => <option key={l} value={l} />)}</datalist></Field>
      <Field label="Kategori"><select name="category" className={selectCls}><option value="">Tümü</option>{Object.entries(ASSET_CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <button disabled={pending} className={btnPrimary}>{pending ? "…" : "Sayımı başlat"}</button>
      {state && !state.ok && <div className="md:col-span-4"><Notice tone="bad">{state.message}</Notice></div>}
    </form>
  );
}
