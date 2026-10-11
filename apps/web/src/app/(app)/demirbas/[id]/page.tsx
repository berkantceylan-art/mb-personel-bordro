import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { Card, PageHeader } from "@/components/ui";
import { Field, KPI, Money, Table, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum, textareaCls } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { addMaintenance, disposeAsset, saveAssetFinance } from "@/lib/asset-actions";
import { ASSET_CATEGORY, ASSET_STATUS } from "@/lib/ozluk-docs";

export const dynamic = "force-dynamic";

const MKIND: Record<string, string> = { maintenance: "Periyodik bakım", repair: "Arıza / onarım", calibration: "Kalibrasyon", inspection: "Kontrol / muayene" };
const money = (v: number | null | undefined) => (v ? (Number(v) / 100).toFixed(2).replace(".", ",") : "");

/** Demirbaş kartı: değer ve amortisman planı, bakım geçmişi, zimmet geçmişi, elden çıkarma */
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.modules.assets ?? 0;
  if (lvl < 1 && !["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("assets").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Record<string, unknown> & { id: string; code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null; purchase_date: string | null; value: number | null; status: string; note: string | null; location: string | null; supplier_party_id: string | null; invoice_id: string | null; useful_life_months: number | null; salvage_value: number; depreciation_start: string | null; depreciation_method: string; warranty_until: string | null; maintenance_interval_months: number | null; next_maintenance: string | null; disposed_on: string | null; disposal_amount: number | null; disposal_note: string | null; opening_txn_id: string | null };
  const [{ data: dep }, { data: maint }, { data: assigns }, { data: parties }, { data: accs }, { data: invs }] = await Promise.all([
    supabase.from("asset_depreciation").select("period, amount").eq("asset_id", id).order("period"),
    supabase.from("asset_maintenance").select("id, done_on, kind, description, cost, next_due, fin_parties(name)").eq("asset_id", id).order("done_on", { ascending: false }),
    supabase.from("asset_assignments").select("id, assigned_on, returned_on, employees(first_name, last_name)").eq("asset_id", id).order("assigned_on", { ascending: false }),
    supabase.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
    supabase.from("fin_accounts").select("id, name, currency, kind").in("kind", ["cash", "bank", "credit_card"]).eq("is_active", true).order("name"),
    supabase.from("inv_invoices").select("id, doc_no, party_name, invoice_date").eq("direction", "purchase").eq("status", "posted").order("invoice_date", { ascending: false }).limit(300),
  ]);
  const deps = (dep ?? []) as { period: string; amount: number }[];
  const accum = deps.reduce((x, d) => x + Number(d.amount), 0);
  const value = Number(a.value ?? 0);
  const posted = new Set(deps.map((d) => d.period));
  // amortisman planı (kalan aylar)
  const plan: { period: string; amount: number; done: boolean }[] = [];
  const start = a.depreciation_start ?? a.purchase_date;
  if (value > 0 && a.useful_life_months && start && a.depreciation_method !== "none") {
    const monthly = Math.round((value - Number(a.salvage_value)) / a.useful_life_months);
    let left = value - Number(a.salvage_value);
    const d0 = new Date(start.slice(0, 7) + "-01T00:00:00Z");
    for (let i = 0; i < a.useful_life_months && left > 0; i++) {
      const p = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + i, 1)).toISOString().slice(0, 10);
      const done = deps.find((x) => x.period === p);
      const amt = done ? Number(done.amount) : Math.min(monthly, left);
      left -= amt;
      plan.push({ period: p, amount: amt, done: posted.has(p) });
    }
  }
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host") ?? ""}`;
  const qr = await QRCode.toString(`${origin}/demirbas/${a.id}`, { type: "svg", margin: 0 });
  const can = lvl >= 2 || ["owner", "accountant"].includes(s.role);
  const t = today();
  const as = (assigns ?? []) as unknown as { id: string; assigned_on: string; returned_on: string | null; employees: { first_name: string; last_name: string } | null }[];
  const ms = (maint ?? []) as unknown as { id: string; done_on: string; kind: string; description: string | null; cost: number; next_due: string | null; fin_parties: { name: string } | null }[];

  return (
    <>
      <PageHeader title={a.name} subtitle={`${a.code ?? ""} · ${ASSET_CATEGORY[a.category] ?? ""}${a.brand_model ? ` · ${a.brand_model}` : ""}${a.serial_no ? ` · SN ${a.serial_no}` : ""}`} actions={<Link href="/demirbas" className="text-sm font-semibold text-brand-700">← Demirbaş</Link>} />
      <div className={page}>
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
          <KPI label="Maliyet" value={value ? fmt(value) : "—"} />
          <KPI label="Birikmiş amortisman" value={fmt(accum)} sub={a.useful_life_months ? `${deps.length} / ${a.useful_life_months} ay` : "ömür girilmemiş"} />
          <KPI label="Net defter değeri" value={fmt(value - accum)} />
          <KPI label="Sonraki bakım" value={a.next_maintenance ? formatDate(a.next_maintenance) : "—"} tone={a.next_maintenance && a.next_maintenance < t ? "bad" : undefined} />
          <div className="bg-white border border-line rounded-[14px] p-2 flex items-center gap-2">
            <div className="w-16 h-16 shrink-0 [&_svg]:w-full [&_svg]:h-full" dangerouslySetInnerHTML={{ __html: qr }} />
            <div className="text-xs"><span className={`font-semibold px-2 py-0.5 rounded-md ${ASSET_STATUS[a.status]?.[1] ?? ""}`}>{ASSET_STATUS[a.status]?.[0]}</span><Link href={`/yazdir/demirbas-etiket?ids=${a.id}`} className="block mt-1 text-brand-700 font-semibold">QR etiket</Link></div>
          </div>
        </div>

        {can && (
          <Card title="Değer ve amortisman">
            <form action={saveAssetFinance} className="grid gap-3 md:grid-cols-4">
              <input type="hidden" name="id" value={a.id} />
              <Field label="Maliyet (KDV hariç)"><input name="value" defaultValue={money(a.value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="Alış tarihi"><input type="date" name="purchase_date" defaultValue={a.purchase_date ?? ""} className={inputCls} /></Field>
              <Field label="Faydalı ömür (yıl)" hint="VUK listesine göre"><input name="useful_life_years" defaultValue={a.useful_life_months ? String(a.useful_life_months / 12).replace(".", ",") : ""} inputMode="decimal" placeholder="ör. 5" className={inputCls} /></Field>
              <Field label="Hurda değeri"><input name="salvage_value" defaultValue={money(a.salvage_value)} inputMode="decimal" className={inputCls} /></Field>
              <Field label="Amortisman"><select name="depreciation_method" defaultValue={a.depreciation_method} className={selectCls}><option value="straight">Normal (doğrusal)</option><option value="none">Ayrılmaz</option></select></Field>
              <Field label="Amortisman başlangıcı" hint="boş = alış"><input type="date" name="depreciation_start" defaultValue={a.depreciation_start ?? ""} className={inputCls} /></Field>
              <Field label="Bulunduğu yer"><input name="location" defaultValue={a.location ?? ""} maxLength={120} placeholder="ör. Seramik odası" className={inputCls} /></Field>
              <Field label="Garanti bitişi"><input type="date" name="warranty_until" defaultValue={a.warranty_until ?? ""} className={inputCls} /></Field>
              <Field label="Tedarikçi"><select name="supplier_party_id" defaultValue={a.supplier_party_id ?? ""} className={selectCls}><option value="">—</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
              <Field label="Alış faturası"><select name="invoice_id" defaultValue={a.invoice_id ?? ""} className={selectCls}><option value="">—</option>{(invs ?? []).map((i) => <option key={i.id} value={i.id}>{i.doc_no ?? "—"} · {i.party_name} · {formatDate(i.invoice_date)}</option>)}</select></Field>
              <Field label="Bakım aralığı (ay)"><input name="maintenance_interval_months" type="number" min={1} max={120} defaultValue={a.maintenance_interval_months ?? ""} className={inputCls} /></Field>
              <Field label="Sonraki bakım"><input type="date" name="next_maintenance" defaultValue={a.next_maintenance ?? ""} className={inputCls} /></Field>
              {!a.opening_txn_id && !a.invoice_id && <label className="md:col-span-4 flex items-center gap-2 text-sm"><input type="checkbox" name="post_opening" /> Bu demirbaş daha önce alındı: değerini finansa açılış olarak işle (alış faturası sistemde yoksa)</label>}
              <div className="md:col-span-4"><PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit></div>
            </form>
          </Card>
        )}

        {plan.length > 0 && (
          <details className="bg-white border border-line rounded-[14px] p-4">
            <summary className="font-semibold cursor-pointer">Amortisman planı ({plan.filter((p) => p.done).length} / {plan.length} ay işlendi)</summary>
            <div className="mt-3 grid gap-1 grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 text-xs">
              {plan.map((p) => <div key={p.period} className={`rounded-md px-2 py-1 border ${p.done ? "bg-ok-bg border-transparent" : "border-line"}`}><span className="text-muted">{formatDate(p.period).slice(3)}</span> <b className="num">{fmt(p.amount)}</b></div>)}
            </div>
          </details>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Bakım / onarım geçmişi">
            <Table head={["Tarih", "Tür", "Açıklama", "Maliyet"]} min={420}>
              {ms.map((m) => (
                <tr key={m.id}>
                  <td className={td}>{formatDate(m.done_on)}</td>
                  <td className={td}>{MKIND[m.kind] ?? m.kind}</td>
                  <td className={td}>{m.description ?? ""}{m.fin_parties && <span className="block text-xs text-muted">{m.fin_parties.name}</span>}{m.next_due && <span className="block text-xs text-muted">sonraki: {formatDate(m.next_due)}</span>}</td>
                  <td className={tdNum}>{m.cost ? <Money v={m.cost} /> : ""}</td>
                </tr>
              ))}
              {ms.length === 0 && <tr><td colSpan={4} className="py-4 text-center text-muted">Kayıt yok.</td></tr>}
            </Table>
            {can && (
              <form action={addMaintenance} className="grid gap-2 sm:grid-cols-2 mt-3">
                <input type="hidden" name="asset_id" value={a.id} />
                <select name="kind" className={selectCls}>{Object.entries(MKIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <input type="date" name="done_on" defaultValue={t} className={inputCls} />
                <textarea name="description" rows={2} maxLength={500} placeholder="Yapılan iş" className={`${textareaCls} sm:col-span-2`} />
                <input name="cost" inputMode="decimal" placeholder="Maliyet (KDV dahil)" className={inputCls} />
                <select name="vat_rate" className={selectCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>KDV %{v}</option>)}</select>
                <select name="pay" className={selectCls}><option value="account">Kasadan / bankadan ödendi</option><option value="party">Servise borç (sonra ödenecek)</option></select>
                <select name="account_id" className={selectCls}><option value="">Hesap</option>{(accs ?? []).map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select>
                <select name="party_id" className={selectCls}><option value="">Servis / firma</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <input type="date" name="next_due" aria-label="Sonraki bakım" className={inputCls} />
                <div className="sm:col-span-2"><PendingSubmit className={btnSecondary}>Bakımı kaydet</PendingSubmit> <span className="text-xs text-muted">Sonraki tarih boşsa bakım aralığından hesaplanır.</span></div>
              </form>
            )}
          </Card>
          <Card title="Zimmet geçmişi">
            <ul className="text-sm divide-y divide-[#EEF2F6]">
              {as.map((x) => <li key={x.id} className="py-2 flex justify-between"><span>{x.employees ? `${x.employees.first_name} ${x.employees.last_name}` : "—"}</span><span className="text-muted">{formatDate(x.assigned_on)} – {x.returned_on ? formatDate(x.returned_on) : "halen"}</span></li>)}
              {as.length === 0 && <li className="py-4 text-center text-muted">Zimmet yok.</li>}
            </ul>
            <Link href="/zimmet" className="text-sm font-semibold text-brand-700 mt-2 inline-block">Zimmet ver / iade al →</Link>
          </Card>
        </div>

        {a.disposed_on ? (
          <p className="text-sm text-muted">Elden çıkarıldı: {formatDate(a.disposed_on)}{a.disposal_amount ? ` · satış ${fmt(a.disposal_amount)}` : ""}{a.disposal_note ? ` · ${a.disposal_note}` : ""}</p>
        ) : (lvl >= 3 || s.role === "owner") && (
          <form action={disposeAsset} className="bg-white border border-line rounded-[14px] p-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="id" value={a.id} />
            <b className="w-full">Hurdaya ayır / sat</b>
            <label className="flex flex-col gap-1 text-sm">Tarih<input type="date" name="date" defaultValue={t} className={inputCls} /></label>
            <label className="flex flex-col gap-1 text-sm">Satış bedeli<input name="amount" inputMode="decimal" placeholder="0 = hurda" className={`${inputCls} w-36`} /></label>
            <label className="flex flex-col gap-1 text-sm">Tahsil hesabı<select name="account_id" className={`${selectCls} w-56`}><option value="">—</option>{(accs ?? []).filter((x) => x.kind !== "credit_card").map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
            <label className="flex flex-col gap-1 text-sm flex-1 min-w-48">Not<input name="note" maxLength={300} className={inputCls} /></label>
            <span className={btnSecondary}><ConfirmSubmit label="Elden çıkar" question="Demirbaş hurda / satıldı olarak işaretlensin mi? Amortisman durur." /></span>
          </form>
        )}
      </div>
    </>
  );
}
