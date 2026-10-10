import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { JOB_STATUS, money, type Customer, type JobStatus } from "@/lib/jobs";
import { CustomerForm } from "../CustomerForm";
import { deleteCustomer, deleteCustomerPrice, deleteDoctor, deletePayment, saveCustomerPrice, savePayment } from "../../actions";
import { PAY_METHOD, buildLedger, type LedgerPayment } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Hekim / hastane kartı: bilgiler, doktorlar, işler ve dönem toplamları */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("lab_customers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Customer;
  const [{ data: docs }, { data: jobs }, { data: accs }, { data: links }, { data: pays }, { data: prods }, { data: specials }] = await Promise.all([
    supabase.from("lab_customer_doctors").select("id, name").eq("customer_id", id).order("name"),
    supabase.from("jobs").select("id, no, patient, in_date, due_date, status, total, currency").eq("customer_id", id).order("no", { ascending: false }).limit(5000),
    supabase.from("portal_accounts").select("id, name, company").eq("status", "active").order("name"),
    supabase.from("lab_customers").select("portal_account_id").not("portal_account_id", "is", null),
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref, note").eq("customer_id", id).order("paid_on"),
    supabase.from("lab_products").select("id, name, price_try, price_eur").eq("is_active", true).order("sort").order("name"),
    supabase.from("lab_customer_prices").select("product_id, price_try, price_eur").eq("customer_id", id),
  ]);
  const prodName = new Map((prods ?? []).map((p) => [p.id as string, p as { id: string; name: string; price_try: number | null; price_eur: number | null }]));
  const linked = new Set((links ?? []).map((l) => l.portal_account_id as string));
  const list = (jobs ?? []) as { id: string; no: number; patient: string | null; in_date: string; due_date: string | null; status: JobStatus; total: number; currency: string }[];
  const billable = list.filter((j) => j.status !== "cancelled");
  const month = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  const sumMonth = billable.filter((j) => j.in_date.startsWith(month)).reduce((a, j) => a + j.total, 0);
  const sumAll = billable.reduce((a, j) => a + j.total, 0);
  const ledger = buildLedger(list.map((j) => ({ ...j, patient: j.patient })), (pays ?? []) as LedgerPayment[]);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.city ?? ""}${c.country ? ` · ${c.country}` : ""} · ${c.currency}`} actions={<div className="flex gap-3 text-sm font-semibold"><Link href={`/isler/yeni?musteri=${c.id}`} className="text-brand-700">+ Bu hekime iş</Link><Link href="/isler/hekimler" className="text-brand-700">Liste</Link></div>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Açık iş" value={String(list.filter((j) => ["open", "tryin", "ready"].includes(j.status)).length)} />
          <Stat label="Bu ay iş tutarı" value={money(sumMonth, c.currency)} />
          <Stat label="Toplam iş tutarı" value={money(sumAll, c.currency)} sub={`${billable.length} iş`} />
          <Stat label="Bakiye (borç)" value={money(ledger.balance, c.currency)} sub={`${money(ledger.credit, c.currency)} tahsil edildi`} />
        </section>
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <Card title="Bilgiler">
            <CustomerForm c={c} accounts={(accs ?? []).map((a) => ({ id: a.id, name: a.company ? `${a.company} (${a.name})` : a.name, linked: linked.has(a.id) }))} />
          </Card>
          <Card title="Doktorlar">
            <ul className="flex flex-col gap-2">
              {(docs ?? []).map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{d.name}</span>
                  <form action={deleteDoctor}><input type="hidden" name="id" value={d.id} /><ConfirmSubmit label="Sil" question="Doktor silinsin mi?" className="text-xs text-bad font-semibold" /></form>
                </li>
              ))}
              {(docs ?? []).length === 0 && <li className="text-sm text-muted">Doktor yok; bilgilerdeki &quot;Doktor ekle&quot; alanından ekleyin.</li>}
            </ul>
          </Card>
        </div>
        <Card title="Cari hesap" action={<Link href={`/yazdir/ekstre/${c.id}`} className="text-sm font-semibold text-brand-700">Ekstre yazdır</Link>}>
          <form action={savePayment} className="grid gap-2 md:grid-cols-6 items-end rounded-xl bg-[#F3F6F9] p-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tarih<input type="date" name="paid_on" defaultValue={today} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tutar ({c.currency})<input name="amount" inputMode="decimal" required placeholder="0,00" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Yöntem<select name="method" defaultValue="bank" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white">{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Belge / dekont no<input name="ref" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Not<input name="note" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <button className="h-10 rounded-lg bg-ok text-white font-semibold">Tahsilat ekle</button>
          </form>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-xs text-muted text-left"><th className="py-2">Tarih</th><th className="py-2">Açıklama</th><th className="py-2 text-right">Borç</th><th className="py-2 text-right">Alacak</th><th className="py-2 text-right">Bakiye</th><th /></tr></thead>
              <tbody>
                {ledger.rows.slice(-40).map((r) => (
                  <tr key={r.key} className="border-t border-line">
                    <td className="py-2 num">{r.date ? formatDate(r.date) : ""}</td>
                    <td className="py-2">{r.href ? <Link href={r.href} className="text-brand-700">{r.label}</Link> : r.label}</td>
                    <td className="py-2 num text-right">{r.debit ? money(r.debit, c.currency) : ""}</td>
                    <td className="py-2 num text-right text-ok">{r.credit ? money(r.credit, c.currency) : ""}</td>
                    <td className="py-2 num text-right font-semibold">{money(r.balance, c.currency)}</td>
                    <td className="py-2 text-right">{r.kind === "payment" && ["owner", "accountant"].includes(s.role) && <form action={deletePayment}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Sil" question="Tahsilat silinsin mi?" className="text-xs text-bad font-semibold" /></form>}</td>
                  </tr>
                ))}
                {ledger.rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Hareket yok.</td></tr>}
              </tbody>
            </table>
          </div>
          {ledger.rows.length > 40 && <p className="text-xs text-muted">Son 40 hareket gösteriliyor; tamamı için ekstreyi yazdırın.</p>}
        </Card>
        <Card title="Özel fiyatlar">
          <p className="text-xs text-muted">Bu hekime / kuruma özel ürün fiyatı. İş kayıtta liste fiyatı ve iskonto yerine bu fiyat gelir.</p>
          <form action={saveCustomerPrice} className="grid gap-2 md:grid-cols-5 items-end">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted md:col-span-2">Ürün<select name="product_id" required className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white"><option value="">Seçin</option>{(prods ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Fiyat TL<input name="price_try" inputMode="decimal" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Fiyat €<input name="price_eur" inputMode="decimal" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <button className="h-10 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</button>
          </form>
          {(specials ?? []).length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {(specials ?? []).map((sp) => (
                <li key={sp.product_id as string} className="flex flex-wrap items-center gap-3 text-sm border-t border-line pt-1.5">
                  <span className="font-semibold">{prodName.get(sp.product_id as string)?.name ?? "—"}</span>
                  <span className="num">{sp.price_try != null ? money(sp.price_try as number, "TRY") : ""} {sp.price_eur != null ? `· ${money(sp.price_eur as number, "EUR")}` : ""}</span>
                  <span className="text-xs text-muted">liste: {prodName.get(sp.product_id as string)?.price_try != null ? money(prodName.get(sp.product_id as string)!.price_try, "TRY") : "—"}</span>
                  <form action={deleteCustomerPrice} className="ml-auto"><input type="hidden" name="customer_id" value={c.id} /><input type="hidden" name="product_id" value={sp.product_id as string} /><button className="text-xs text-bad font-semibold">Sil</button></form>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={`İşler (${list.length})`}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead><tr className="text-xs text-muted text-left"><th className="py-2">No</th><th className="py-2">Hasta</th><th className="py-2">Giriş</th><th className="py-2">Çıkış</th><th className="py-2 text-right">Tutar</th><th className="py-2">Durum</th></tr></thead>
              <tbody>
                {list.map((j) => (
                  <tr key={j.id} className="border-t border-line">
                    <td className="py-2"><Link href={`/isler/${j.id}`} className="font-semibold text-brand-700">#{j.no}</Link></td>
                    <td className="py-2">{j.patient ?? "—"}</td>
                    <td className="py-2 num">{formatDate(j.in_date)}</td>
                    <td className="py-2 num">{j.due_date ? formatDate(j.due_date) : "—"}</td>
                    <td className="py-2 num text-right">{money(j.total, j.currency)}</td>
                    <td className="py-2"><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${JOB_STATUS[j.status][1]}`}>{JOB_STATUS[j.status][0]}</span></td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Henüz iş yok.</td></tr>}
              </tbody>
            </table>
          </div>
        </Card>
        <form action={deleteCustomer} className="text-right">
          <input type="hidden" name="id" value={c.id} />
          <ConfirmSubmit label="Kartı sil" question="Hekim / hastane kartı silinsin mi? (İşi varsa silinmez; pasif yapın.)" className="text-sm text-bad font-semibold" />
        </form>
      </div>
    </>
  );
}
