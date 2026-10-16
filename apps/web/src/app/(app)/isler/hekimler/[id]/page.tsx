import Link from "next/link";
import { addActivity } from "@/lib/crm-actions";
import { ACT_KIND, Q_CATEGORY, Q_STATUS } from "@/lib/quality";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader, Stat } from "@/components/ui";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { JOB_STATUS, money, type Customer, type JobStatus } from "@/lib/jobs";
import { CustomerForm } from "../CustomerForm";
import { deleteCustomer, deleteCustomerPrice, deleteDoctor, deletePayment, saveCustomerPrice } from "../../actions";
import { addLabPayment, saveCustomerBook } from "@/lib/waybill-actions";
import { saveContract } from "@/lib/pricing-actions";
import { LANGS } from "@/lib/waybill";
import { CariCheck, type CariLine } from "./CariCheck";
import { PriceHistoryButton } from "@/components/PriceHistoryButton";
import { BOOK_LABEL, PAY_METHOD, buildLedger, internalPays, type LedgerPayment } from "@/lib/ledger";

export const dynamic = "force-dynamic";

/** Hekim / hastane kartı: bilgiler, doktorlar, işler ve dönem toplamları */
export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("lab_customers").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as Customer & { internal_book?: boolean; pay_book?: string; doc_lang?: string; internal_opening?: number; internal_opening_date?: string | null };
  const ib = c.internal_book === true;
  const [{ data: docs }, { data: jobs }, { data: accs }, { data: links }, { data: pays }, { data: prods0 }, { data: specials }] = await Promise.all([
    supabase.from("lab_customer_doctors").select("id, name").eq("customer_id", id).order("name"),
    supabase.from("jobs").select("id, no, patient, in_date, due_date, status, total, currency, delivered_at").eq("customer_id", id).order("no", { ascending: false }).limit(5000),
    supabase.from("portal_accounts").select("id, name, company").eq("status", "active").order("name"),
    supabase.from("lab_customers").select("portal_account_id").not("portal_account_id", "is", null),
    supabase.from("lab_payments").select("id, paid_on, amount, method, ref, note, book, legacy_ref, currency").eq("customer_id", id).order("paid_on"),
    supabase.from("lab_products").select("id, name, name_tr, price_try, price_eur, is_active").order("sort").order("name"),
    supabase.from("lab_customer_prices").select("product_id, price_try, price_eur").eq("customer_id", id),
  ]);
  // name_tr sütunu yoksa (eski veritabanı) Türkçe adsız listeye dön
  const prods = prods0 ?? (await supabase.from("lab_products").select("id, name, price_try, price_eur, is_active").order("sort").order("name")).data?.map((p) => ({ ...p, name_tr: null as string | null }));
  const [{ data: accRows }, { data: offi }] = await Promise.all([
    supabase.from("fin_accounts").select("id, name, currency, kind").in("kind", ["cash", "bank", "pos"]).eq("is_active", true).order("name"),
    supabase.from("fin_party_balances").select("party_id, balance").eq("lab_customer_id", id).maybeSingle(),
  ]);
  const [{ data: crmActs }, { data: complaints }, { data: surveys }] = await Promise.all([
    supabase.from("crm_activities").select("id, kind, notes, at, due_date, done").eq("customer_id", id).order("at", { ascending: false }).limit(20),
    supabase.from("qms_complaints").select("id, no, category, status, received_at").eq("customer_id", id).order("received_at", { ascending: false }).limit(10),
    supabase.from("srv_responses").select("score").eq("customer_id", id).not("score", "is", null).limit(200),
  ]);
  const svScores = ((surveys ?? []) as { score: number }[]).map((x) => x.score);
  const canCrm = (s.modules.sales ?? 0) >= 2 || (s.modules.lab ?? 0) >= 3;
  const finAccounts = (accRows ?? []) as { id: string; name: string; currency: string; kind: string }[];
  const { data: riskData } = await supabase.rpc("lab_customer_risk", { p_customer: id });
  const risk = riskData as { balance: number; limit: number | null; over: boolean; overdue: number; term: number; contract_expired: boolean } | null;
  const cx = data as { credit_limit?: number | null; payment_term_days?: number; block_over_limit?: boolean; contract_start?: string | null; contract_end?: string | null; contract_note?: string | null };
  const prodName = new Map((prods ?? []).map((p) => [p.id as string, p as { id: string; name: string; name_tr: string | null; price_try: number | null; price_eur: number | null }]));
  const linked = new Set((links ?? []).map((l) => l.portal_account_id as string));
  const list = (jobs ?? []) as { id: string; no: number; patient: string | null; in_date: string; due_date: string | null; status: JobStatus; total: number; currency: string; delivered_at: string | null }[];
  const billable = list.filter((j) => j.status !== "cancelled");
  const month = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 7);
  const sumMonth = billable.filter((j) => j.in_date.startsWith(month)).reduce((a, j) => a + j.total, 0);
  const sumAll = billable.reduce((a, j) => a + j.total, 0);
  const ledger = buildLedger(list.map((j) => ({ ...j, patient: j.patient })), internalPays((pays ?? []) as LedgerPayment[], ib), null, null, ib ? { amount: Number(c.internal_opening ?? 0), date: c.internal_opening_date ?? null } : null);
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  // Cari kontrol dökümü: bakiye nereden geliyor
  const payList = (pays ?? []) as { id: string; amount: number; legacy_ref?: string | null; currency?: string | null }[];
  const delivered = list.filter((j) => j.status === "delivered");
  const devirJobs = delivered.filter((j) => j.patient === "DEVİR BAKİYESİ");
  const adjPays = payList.filter((p) => p.legacy_ref === `dsis-adj:${c.id}`);
  const otherCur = billable.filter((j) => j.currency && j.currency !== c.currency);
  const sum = (a: { total?: number; amount?: number }[], k: "total" | "amount") => a.reduce((t, x) => t + Number(x[k] ?? 0), 0);
  const yearOf = (j: { delivered_at: string | null; due_date: string | null; in_date: string }) => (j.delivered_at ?? j.due_date ?? j.in_date).slice(0, 4);
  const realJobs = delivered.filter((j) => j.patient !== "DEVİR BAKİYESİ");
  const years = [...new Set(realJobs.map(yearOf))].sort();
  const cariLines: CariLine[] = [
    ...(devirJobs.length ? [{ label: "Dentalsis devir kaydı (31.12.2025)", value: money(sum(devirJobs, "total"), c.currency), tone: "warn" as const }] : []),
    ...years.map((y) => { const js = realJobs.filter((j) => yearOf(j) === y); return { label: `Teslim edilen işler ${y} (${js.length} iş)`, value: money(sum(js, "total"), c.currency) }; }),
    { label: `Tahsilatlar (${payList.length - adjPays.length} kayıt)`, value: `−${money(sum(payList.filter((p) => !adjPays.includes(p)), "amount"), c.currency)}` },
    ...(adjPays.length ? [{ label: "Dentalsis bakiye eşitleme mahsubu", value: `−${money(sum(adjPays, "amount"), c.currency)}`, tone: "warn" as const }] : []),
    ...(otherCur.length ? [{ label: `Cari para biriminden (${c.currency}) farklı işler: ${otherCur.length} iş`, value: [...new Set(otherCur.map((j) => j.currency))].map((cur) => money(sum(otherCur.filter((j) => j.currency === cur), "total"), cur)).join(" + "), tone: "bad" as const }] : []),
    { label: "Açık (teslim edilmemiş) işler — bakiyeye girmez", value: `${list.filter((j) => ["open", "tryin", "ready"].includes(j.status)).length} iş`, tone: "muted" },
    { label: "= Bakiye", value: money(ledger.balance, c.currency) },
  ];

  return (
    <>
      <PageHeader title={c.name} subtitle={`${c.city ?? ""}${c.country ? ` · ${c.country}` : ""} · ${c.currency}`} actions={<div className="flex gap-3 text-sm font-semibold"><Link href={`/isler/yeni?musteri=${c.id}`} className="text-brand-700">+ Bu hekime iş</Link><Link href="/isler/hekimler" className="text-brand-700">Liste</Link></div>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        <section className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <Stat label="Açık iş" value={String(list.filter((j) => ["open", "tryin", "ready"].includes(j.status)).length)} />
          <Stat label="Bu ay iş tutarı" value={money(sumMonth, c.currency)} />
          <Stat label="Toplam iş tutarı" value={money(sumAll, c.currency)} sub={`${billable.length} iş`} />
          <Stat label={ib ? "İç cari bakiyesi" : "Bakiye (borç)"} value={money(ledger.balance, c.currency)} sub={ib ? <>Resmi cari: <b>{money(Number(offi?.balance ?? 0), c.currency)}</b>{offi?.party_id && <> · <Link href={`/finans/cariler/${offi.party_id}`} className="text-brand-700">ekstre</Link></>}</> : `${money(ledger.credit, c.currency)} tahsil edildi`} />
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
        <Card title="Sözleşme, kredi limiti ve fiyat listesi" action={<Link href={`/yazdir/fiyat-listesi/${c.id}`} className="text-sm font-semibold text-brand-700">Fiyat listesi yazdır</Link>}>
          {risk && (risk.over || risk.overdue > 0 || risk.contract_expired) && (
            <div className="flex flex-wrap gap-2 text-sm">
              {risk.over && <span className="rounded-lg bg-bad-bg text-bad px-3 py-1 font-semibold">Kredi limiti aşıldı: {money(risk.balance, c.currency)} / {money(risk.limit ?? 0, c.currency)}</span>}
              {risk.overdue > 0 && <span className="rounded-lg bg-warn-bg text-warn px-3 py-1 font-semibold">Vadesi ({risk.term} gün) geçen: {money(risk.overdue, c.currency)}</span>}
              {risk.contract_expired && <span className="rounded-lg bg-[#EEF2F6] px-3 py-1 font-semibold">Sözleşme süresi doldu</span>}
            </div>
          )}
          <form action={saveContract} className="grid gap-3 md:grid-cols-3 lg:grid-cols-6 items-end">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Kredi limiti ({c.currency})<input name="credit_limit" inputMode="decimal" defaultValue={cx.credit_limit ? (Number(cx.credit_limit) / 100).toLocaleString("tr-TR") : ""} placeholder="limitsiz" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Vade (gün)<input name="payment_term_days" type="number" min={0} max={365} defaultValue={cx.payment_term_days ?? 30} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Sözleşme başlangıcı<input type="date" name="contract_start" defaultValue={cx.contract_start ?? ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Sözleşme bitişi<input type="date" name="contract_end" defaultValue={cx.contract_end ?? ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="lg:col-span-2 flex items-center gap-2 text-sm h-10"><input type="checkbox" name="block_over_limit" defaultChecked={cx.block_over_limit} className="w-4 h-4" />Limit aşılınca yeni iş kaydını engelle</label>
            <label className="md:col-span-3 lg:col-span-5 flex flex-col gap-1 text-xs font-semibold text-muted">Sözleşme notu (iskonto, kampanya, özel koşul)<input name="contract_note" defaultValue={cx.contract_note ?? ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <button className="h-10 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</button>
          </form>
          <p className="text-xs text-muted">Özel ürün fiyatları aşağıdaki “Özel fiyatlar” bölümünden girilir; fiyat listesi çıktısı bu fiyatlarla müşterinin dilinde basılır.</p>
        </Card>
        <Card title="İrsaliye, fatura ve cari ayarları">
          <form action={saveCustomerBook} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4 items-end">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="lg:col-span-4 flex items-start gap-3 text-sm"><input type="checkbox" name="internal_book" defaultChecked={ib} className="mt-1 w-5 h-5" />
              <span><b>İç hesap kullanır (günlük irsaliye + ay sonu fatura)</b><span className="block text-muted">Kutu çıkışında iş o günün irsaliyesine eklenir ve iç cariye işlenir. Ay sonunda irsaliyeler tek faturada toplanır. Resmi cariye yalnız resmi fatura (e-fatura / e-ihracat) ve resmi tahsilat girer; gelen ödemeyi iki hesaba birden işleyebilirsiniz.</span></span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tahsilat varsayılanı
              <select name="pay_book" defaultValue={c.pay_book ?? "both"} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white">{Object.entries(BOOK_LABEL).map(([k, v]) => <option key={k} value={k}>{k === "both" ? "Resmi + iç (ikisine)" : `Yalnız ${v.toLocaleLowerCase("tr")}`}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">İrsaliye / fatura dili
              <select name="doc_lang" defaultValue={c.doc_lang ?? "tr"} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white">{Object.entries(LANGS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">İç cari açılış bakiyesi ({c.currency})
              <span className="flex gap-1"><input name="internal_opening" inputMode="decimal" defaultValue={c.internal_opening ? (Math.abs(Number(c.internal_opening)) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : ""} placeholder="0,00" className="h-10 min-w-0 flex-1 rounded-lg border border-[#D5DEE8] px-2 bg-white num" />
                <select name="opening_side" defaultValue={Number(c.internal_opening ?? 0) < 0 ? "credit" : "debit"} className="h-10 rounded-lg border border-[#D5DEE8] px-1 bg-white"><option value="debit">borçlu</option><option value="credit">alacaklı</option></select></span>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Açılış tarihi<input type="date" name="internal_opening_date" defaultValue={c.internal_opening_date ?? ""} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <div className="lg:col-span-4"><button className="h-10 px-5 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</button>{ib && <span className="ml-3 text-xs text-muted">Resmi cari açılış bakiyesi Finans › Cari kartlar’dan girilir.</span>}</div>
          </form>
        </Card>
        <Card title="Cari kontrol — bakiye nereden geliyor?">
          <CariCheck customerId={c.id} lines={cariLines} hasDsis={devirJobs.length > 0 || adjPays.length > 0} />
        </Card>
        <Card title={ib ? "İç cari hesap" : "Cari hesap"} action={<span className="flex gap-4 text-sm font-semibold">{ib && <Link href="/isler/irsaliye" className="text-brand-700">İrsaliyeler</Link>}<Link href={`/yazdir/ekstre/${c.id}`} className="text-brand-700">Ekstre yazdır</Link></span>}>
          <form action={addLabPayment} className="grid gap-2 md:grid-cols-4 lg:grid-cols-8 items-end rounded-xl bg-[#F3F6F9] p-3">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tarih<input type="date" name="paid_on" defaultValue={today} className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Tutar ({c.currency})<input name="amount" inputMode="decimal" required placeholder="0,00" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            {ib && (
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Hangi hesaba
                <select name="book" defaultValue={c.pay_book ?? "both"} className="h-10 rounded-lg border border-brand-600 px-2 bg-white font-semibold text-ink">
                  <option value="both">Resmi + iç (ikisine)</option><option value="official">Yalnız resmi</option><option value="internal">Yalnız iç</option>
                </select>
              </label>
            )}
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Kasa / banka
              <select name="account_id" defaultValue="" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white">
                <option value="">{ib ? "Seçin (iç tahsilatta boş olabilir)" : "Kasaya işleme"}</option>
                {finAccounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Yöntem<select name="method" defaultValue="bank" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white">{Object.entries(PAY_METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Belge / dekont no<input name="ref" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Not<input name="note" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white" /></label>
            <button className="h-10 rounded-lg bg-ok text-white font-semibold">Tahsilat ekle</button>
            {finAccounts.length > 0 && <p className="md:col-span-4 lg:col-span-8 text-[11px] text-muted">Kasa / banka seçerseniz finansa da işlenir. Hesabın para birimi farklıysa hesaba giren tutar güncel kurla hesaplanır.{ib ? " Resmi hesaba giden tahsilatta kasa / banka seçmek zorunludur." : ""}</p>}
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
          <PriceHistoryButton customerId={c.id} label="Geçmiş işlerden fiyat listesini doldur" />
          <p className="text-xs text-muted">Bu hekimin işlerinde (Dentalsis&apos;ten gelenler dahil) her ürün için en son uygulanan birim fiyat yazılır; elle girdiğiniz fiyatlar korunur.</p>
          <form action={saveCustomerPrice} className="grid gap-2 md:grid-cols-5 items-end">
            <input type="hidden" name="customer_id" value={c.id} />
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted md:col-span-2">Ürün<select name="product_id" required className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white"><option value="">Seçin</option>{(prods ?? []).filter((p) => p.is_active !== false).map((p) => <option key={p.id} value={p.id}>{p.name}{p.name_tr && p.name_tr !== p.name ? ` — ${p.name_tr}` : ""}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Fiyat TL<input name="price_try" inputMode="decimal" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Fiyat €<input name="price_eur" inputMode="decimal" className="h-10 rounded-lg border border-[#D5DEE8] px-2 bg-white num" /></label>
            <button className="h-10 rounded-lg bg-brand-700 text-white font-semibold">Kaydet</button>
          </form>
          {(specials ?? []).length > 0 && (
            <ul className="flex flex-col gap-1.5">
              {(specials ?? []).map((sp) => (
                <li key={sp.product_id as string} className="flex flex-wrap items-center gap-3 text-sm border-t border-line pt-1.5">
                  <span className="font-semibold">{prodName.get(sp.product_id as string)?.name ?? "—"}{prodName.get(sp.product_id as string)?.name_tr && prodName.get(sp.product_id as string)?.name_tr !== prodName.get(sp.product_id as string)?.name && <span className="block text-xs font-normal text-muted">🇹🇷 {prodName.get(sp.product_id as string)?.name_tr}</span>}</span>
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
        <Card title="Görüşmeler, şikâyetler, memnuniyet" action={<span className="flex gap-3 text-sm font-semibold"><Link href="/crm" className="text-brand-700">CRM</Link><Link href="/kalite" className="text-brand-700">Kalite</Link></span>}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-2">
              {canCrm && (
                <form action={addActivity} className="flex flex-wrap gap-2">
                  <input type="hidden" name="customer_id" value={c.id} />
                  <select name="kind" className="h-9 rounded-[8px] border border-line px-2 text-sm">{Object.entries(ACT_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  <input name="notes" placeholder="Not / görev" className="h-9 flex-1 min-w-[160px] rounded-[8px] border border-line px-2 text-sm" />
                  <input name="due_date" type="date" className="h-9 rounded-[8px] border border-line px-2 text-sm" title="Görev tarihi" />
                  <button className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold">Ekle</button>
                </form>
              )}
              <ul className="divide-y divide-[#EEF2F6] text-sm">
                {((crmActs ?? []) as { id: string; kind: string; notes: string | null; at: string; due_date: string | null; done: boolean }[]).map((a) => <li key={a.id} className="py-1.5"><b>{ACT_KIND[a.kind]}</b> <span className="text-xs text-muted">{formatDate(a.at.slice(0, 10))}{!a.done && a.due_date ? ` · görev ${formatDate(a.due_date)}` : ""}</span>{a.notes && <span className="block">{a.notes}</span>}</li>)}
                {(crmActs ?? []).length === 0 && <li className="py-1.5 text-muted">Görüşme kaydı yok.</li>}
              </ul>
            </div>
            <div className="flex flex-col gap-2 text-sm">
              <div>Memnuniyet: <b>{svScores.length ? `${(svScores.reduce((x, y) => x + y, 0) / svScores.length).toFixed(1)} / 5 (${svScores.length} yanıt)` : "—"}</b></div>
              <ul className="divide-y divide-[#EEF2F6]">
                {((complaints ?? []) as { id: string; no: number; category: string; status: string; received_at: string }[]).map((q) => <li key={q.id} className="py-1.5 flex gap-2"><Link href={`/kalite?sikayet=${q.id}`} className="font-semibold text-brand-700">Şikâyet #{q.no}</Link><span>{Q_CATEGORY[q.category]}</span><span className={`ml-auto text-xs font-semibold ${Q_STATUS[q.status]?.[1]}`}>{Q_STATUS[q.status]?.[0]}</span><span className="text-xs text-muted">{formatDate(q.received_at.slice(0, 10))}</span></li>)}
                {(complaints ?? []).length === 0 && <li className="py-1.5 text-muted">Şikâyet yok.</li>}
              </ul>
            </div>
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
