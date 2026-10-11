import Link from "next/link";
import { Card } from "@/components/ui";
import { Field, Notice, btnPrimary, inputCls, selectCls } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { loadAccounts, loadCategories } from "@/lib/fin-data";
import { advanceOp } from "@/lib/fin2-actions";
import { AccountsView } from "../_parts/AccountsView";

export const dynamic = "force-dynamic";

/** Personel iş avansları: ver, masrafla kapat, iade al */
export default async function AdvancesPage() {
  const s = await getSession();
  const supabase = await createClient();
  const [{ rows: advs }, { rows: cash }, cats, { data: emps }] = await Promise.all([
    loadAccounts(["advance"]),
    loadAccounts(["cash", "bank"]),
    loadCategories(["expense"]),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
  ]);
  const open = advs.filter((a) => a.is_active);
  const lvl = s.modules.finance ?? 0;
  const cashOpts = cash.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.currency}) · {fmt(c.balance, c.currency)}</option>);
  const advOpts = open.map((a) => <option key={a.id} value={a.id}>{a.holder_name ?? a.name} · açık {fmt(a.balance, a.currency)}</option>);
  return (
    <AccountsView kinds={["advance"]} newKind="advance" hideNew title="Avans hesapları" subtitle="Personele verilen iş avansları (alım, yol, kargo…): masraf fişiyle kapatılır, artanı iade alınır">
      <Notice tone="info">Maaştan düşülecek avanslar bordroda izlenir: <Link href="/talepler" className="font-semibold underline">Talepler &gt; Avans</Link>. Bu sayfa iş avansı içindir; bakiye “personelin elindeki şirket parası”dır.</Notice>
      {lvl >= 2 && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card title="Avans ver">
            <form action={advanceOp} className="flex flex-col gap-3">
              <input type="hidden" name="op" value="give" />
              <Field label="Personel"><select name="employee_id" required className={selectCls}><option value="">Seçin</option>{(emps ?? []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></Field>
              <Field label="Kasa / banka"><select name="account_id" required className={selectCls}>{cashOpts}</select></Field>
              <Field label="Tutar"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
              <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
              <Field label="Açıklama"><input name="description" maxLength={300} placeholder="ör. Fuar masrafları" className={inputCls} /></Field>
              <PendingSubmit className={btnPrimary}>Avansı ver</PendingSubmit>
            </form>
          </Card>
          <Card title="Masrafla kapat">
            <form action={advanceOp} className="flex flex-col gap-3">
              <input type="hidden" name="op" value="close" />
              <Field label="Avans"><select name="advance_id" required className={selectCls}><option value="">Seçin</option>{advOpts}</select></Field>
              <Field label="Gider hesabı"><select name="category_id" required className={selectCls}><option value="">Seçin</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <div className="grid grid-cols-[1fr_90px] gap-2">
                <Field label="Fiş tutarı (KDV dahil)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                <Field label="KDV"><select name="vat_rate" className={selectCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
              </div>
              <Field label="Fiş / fatura no"><input name="doc_no" maxLength={60} className={inputCls} /></Field>
              <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
              <PendingSubmit className={btnPrimary}>Masrafı işle</PendingSubmit>
            </form>
          </Card>
          <Card title="Artanı iade al">
            <form action={advanceOp} className="flex flex-col gap-3">
              <input type="hidden" name="op" value="return" />
              <Field label="Avans"><select name="advance_id" required className={selectCls}><option value="">Seçin</option>{advOpts}</select></Field>
              <Field label="Kasa / banka"><select name="account_id" required className={selectCls}>{cashOpts}</select></Field>
              <Field label="Tutar"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
              <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
              <PendingSubmit className={btnPrimary}>İadeyi kaydet</PendingSubmit>
            </form>
          </Card>
        </div>
      )}
    </AccountsView>
  );
}
