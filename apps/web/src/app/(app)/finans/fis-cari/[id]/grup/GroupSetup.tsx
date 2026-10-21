"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { setupGroup, vatBackfill } from "@/lib/supplier-group-actions";

type G = { id: string; name: string; currency: string; balance: number; discount_pct?: number; moves?: number } | null;

export function GroupSetup({ main, mainCurrency, canEdit, slip, nodisc, vat }: { main: string; mainCurrency: string; canEdit: boolean; slip: G; nodisc: G; vat: G }) {
  const router = useRouter();
  const { state, pending, formProps } = useActionForm(setupGroup, { onSuccess: () => router.refresh() });
  const bf = useActionForm(vatBackfill, { onSuccess: () => router.refresh() });
  const locked = !!slip?.moves;
  return (
    <section className="rounded-[16px] border border-line bg-white p-4 md:p-5 flex flex-col gap-4">
      <h2 className="font-display text-lg font-bold">Cariler</h2>
      <ul className="grid gap-2 md:grid-cols-2 text-sm">
        <li className="rounded-[12px] border border-line p-3">🧾 <b>Faturalı cari</b> · {mainCurrency}<span className="block text-xs text-muted">Resmi faturalar ve banka ödemeleri</span></li>
        <li className="rounded-[12px] border border-[#FCD34D] bg-[#FFFBEB] p-3">📄 <b>Fişli cari</b> {slip ? <>· {slip.currency}{slip.discount_pct ? ` · iskonto %${Number(slip.discount_pct)}` : ""} · <Link href={`/finans/cariler/${slip.id}`} className="text-brand-700 font-semibold">kart</Link></> : "· henüz yok"}<span className="block text-xs text-muted">Fişler liste fiyatıyla; iskonto ödemede ayrı satır</span></li>
        <li className="rounded-[12px] border border-line p-3">📄 <b>İskontosuz fişli cari</b> {nodisc ? <>· {nodisc.currency} · <Link href={`/finans/cariler/${nodisc.id}`} className="text-brand-700 font-semibold">kart</Link></> : "· yok"}<span className="block text-xs text-muted">Ürün kuralı “iskontosuz” olan kalemler</span></li>
        <li className="rounded-[12px] border border-[#C4B5FD] p-3">🧾 <b>KDV carisi</b> {vat ? <>· {vat.currency} · <Link href={`/finans/cariler/${vat.id}`} className="text-brand-700 font-semibold">kart</Link></> : "· yok"}<span className="block text-xs text-muted">Fatura KDV&apos;si borç, nakit KDV ödemesi alacak</span></li>
      </ul>
      {canEdit && (
        <form {...formProps} className="grid gap-3 md:grid-cols-4 items-end">
          <input type="hidden" name="main" value={main} />
          <Field label="Fişli cari para birimi" hint={locked ? "hareketi var, değişmez" : undefined}>
            <select name="currency" defaultValue={slip?.currency ?? "EUR"} disabled={locked} className={selectCls}>{["TRY", "EUR", "USD", "GBP", "CHF"].map((c) => <option key={c}>{c}</option>)}</select>
            {locked && <input type="hidden" name="currency" value={slip?.currency ?? "TRY"} />}
          </Field>
          <Field label="Fişli cari iskontosu (%)"><input name="discount" inputMode="decimal" defaultValue={String(slip?.discount_pct ?? 10).replace(".", ",")} className={`${inputCls} num text-right`} /></Field>
          <label className="flex items-center gap-2 text-sm font-semibold h-11"><input type="checkbox" name="nodisc" defaultChecked className="h-4 w-4" /> İskontosuz fişli cari</label>
          <label className="flex items-center gap-2 text-sm font-semibold h-11"><input type="checkbox" name="vat" defaultChecked className="h-4 w-4" /> KDV carisi</label>
          {state && <div className="md:col-span-4"><Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice></div>}
          <div className="md:col-span-4"><button disabled={pending} className={btnPrimary}>{pending ? "…" : slip ? "Grubu güncelle" : "Grubu kur"}</button></div>
        </form>
      )}
      {canEdit && vat && (
        <form {...bf.formProps} className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
          <input type="hidden" name="main" value={main} />
          <Field label="KDV carisi açılmadan önceki faturalar" hint="bu tarihten itibaren"><input type="date" name="from" defaultValue={`${new Date().getFullYear()}-01-01`} className={inputCls} /></Field>
          <button disabled={bf.pending} className={btnSecondary}>{bf.pending ? "…" : "Faturaların KDV'sini KDV carisine yaz"}</button>
          {bf.state && <Notice tone={bf.state.ok ? "ok" : "bad"}>{bf.state.message}</Notice>}
          <p className="w-full text-xs text-muted">Ekstreden KDV carisini aktardıysanız bunu çalıştırmanıza gerek yok; aynı tarih ve tutardaki KDV satırları tekrar yazılmaz.</p>
        </form>
      )}
    </section>
  );
}
