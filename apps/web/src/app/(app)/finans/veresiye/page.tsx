import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { EmptyRow, Field, KPI, Money, Notice, Table, Tabs, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { loadCategories } from "@/lib/fin-data";
import { creditSale, setCreditSales } from "@/lib/fin2-actions";
import { aging } from "@/lib/fin2";
import { jobBillDate } from "@/lib/ledger";

export const dynamic = "force-dynamic";

type P = { id: string; name: string; currency: string; phone: string | null; credit_limit: number | null; credit_sales: boolean; opening_balance: number; opening_date: string | null; lab_customer_id: string | null; payment_term_days: number };

/** Veresiye defteri: açık hesap müşterileri, yaşlandırma, limit, WhatsApp hatırlatma */
export default async function CreditBook({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.finance ?? 0, s.modules.sales ?? 0);
  if (lvl < 1) redirect("/");
  const { g = "defter" } = await searchParams;
  const supabase = await createClient();
  const t = today();
  const [{ data: bal, error }, cats, { data: co }] = await Promise.all([
    supabase.from("fin_party_balances").select("party_id, balance").gt("balance", 0).limit(5000),
    loadCategories(["income"]),
    supabase.from("companies").select("name").order("created_at").limit(1).maybeSingle(),
  ]);
  const bmap = new Map((bal ?? []).map((b) => [b.party_id as string, Number(b.balance)]));
  let q = supabase.from("fin_parties").select("id, name, currency, phone, credit_limit, credit_sales, opening_balance, opening_date, lab_customer_id, payment_term_days").eq("is_active", true).order("name").limit(2000);
  q = g === "defter" ? q.eq("credit_sales", true) : q.in("id", [...bmap.keys()].slice(0, 1000).concat("00000000-0000-0000-0000-000000000000"));
  const { data: ps } = await q;
  const parties = (ps ?? []) as P[];
  const ids = parties.map((p) => p.id);
  const labIds = parties.map((p) => p.lab_customer_id).filter(Boolean) as string[];
  const [{ data: moves }, { data: jobs }, { data: pays }, { data: allParties }] = await Promise.all([
    ids.length ? supabase.from("fin_moves").select("party_id, amount, move_date, fin_txns!inner(voided_at)").in("party_id", ids).is("fin_txns.voided_at", null).limit(20000) : Promise.resolve({ data: [] }),
    labIds.length ? supabase.from("jobs").select("customer_id, in_date, total, delivered_at").in("customer_id", labIds).eq("status", "delivered").limit(20000) : Promise.resolve({ data: [] }),
    labIds.length ? supabase.from("lab_payments").select("customer_id, paid_on, amount").in("customer_id", labIds).is("fin_txn_id", null).limit(20000) : Promise.resolve({ data: [] }),
    supabase.from("fin_parties").select("id, name, currency").eq("is_active", true).in("kind", ["customer", "both", "other"]).order("name").limit(5000),
  ]);
  const rows = parties.map((p) => {
    const lines: { date: string; debit: number; credit: number }[] = [];
    const ob = Number(p.opening_balance);
    if (ob) lines.push({ date: p.opening_date ?? "2000-01-01", debit: ob > 0 ? ob : 0, credit: ob < 0 ? -ob : 0 });
    for (const m of (moves ?? []) as { party_id: string; amount: number; move_date: string }[]) if (m.party_id === p.id) lines.push({ date: m.move_date, debit: m.amount > 0 ? Number(m.amount) : 0, credit: m.amount < 0 ? -Number(m.amount) : 0 });
    if (p.lab_customer_id) {
      for (const j of (jobs ?? []) as { customer_id: string; in_date: string; total: number; delivered_at: string | null }[]) if (j.customer_id === p.lab_customer_id) lines.push({ date: jobBillDate(j), debit: Number(j.total), credit: 0 });
      for (const x of (pays ?? []) as { customer_id: string; paid_on: string; amount: number }[]) if (x.customer_id === p.lab_customer_id) lines.push({ date: x.paid_on, debit: 0, credit: Number(x.amount) });
    }
    const balance = bmap.get(p.id) ?? lines.reduce((x, l) => x + l.debit - l.credit, 0);
    return { p, balance, a: aging(lines, t) };
  }).sort((x, y) => y.balance - x.balance);
  const totals = rows.reduce((x, r) => (r.p.currency === "TRY" ? { b: x.b + Math.max(0, r.balance), o: x.o + r.a.d61_90 + r.a.d90 } : x), { b: 0, o: 0 });
  const wa = (r: (typeof rows)[number]) => {
    const phone = (r.p.phone ?? "").replace(/\D/g, "").replace(/^0/, "90");
    if (phone.length < 10) return null;
    const text = `Merhaba ${r.p.name}, ${co?.name ?? "firmamız"} nezdindeki cari hesabınızda ${fmt(r.balance, r.p.currency)} bakiye bulunmaktadır${r.a.oldest ? ` (en eski borç ${formatDate(r.a.oldest)})` : ""}. Ödemeniz için şimdiden teşekkür ederiz.`;
    return `https://wa.me/${phone.length === 10 ? "90" + phone : phone}?text=${encodeURIComponent(text)}`;
  };

  return (
    <>
      <PageHeader title="Veresiye ve alacaklar" subtitle="Açık hesap müşterileri: kim, ne kadar, ne zamandan beri borçlu. Ödemeler en eski borçtan düşülerek yaşlandırılır." />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Toplam alacak (TL cariler)" value={fmt(totals.b)} />
          <KPI label="60 günü geçen" value={fmt(totals.o)} tone={totals.o ? "bad" : undefined} />
          <KPI label="Müşteri" value={rows.filter((r) => r.balance > 0).length} />
          <KPI label="Limit aşan" value={rows.filter((r) => r.p.credit_limit && r.balance > Number(r.p.credit_limit)).length} tone={rows.some((r) => r.p.credit_limit && r.balance > Number(r.p.credit_limit)) ? "bad" : undefined} />
        </div>
        <Tabs active={`/finans/veresiye?g=${g}`} items={[["/finans/veresiye?g=defter", "Veresiye defteri"], ["/finans/veresiye?g=hepsi", "Tüm alacaklı cariler"]]} />
        <Table head={["Cari", "Bakiye", "0–30 gün", "31–60", "61–90", "90+", "Limit", ""]} min={980}>
          {rows.map((r) => {
            const over = r.p.credit_limit && r.balance > Number(r.p.credit_limit);
            const link = wa(r);
            return (
              <tr key={r.p.id}>
                <td className={td}><Link href={`/finans/cariler/${r.p.id}`} className="font-semibold text-brand-700">{r.p.name}</Link>{r.a.oldest && <span className="block text-xs text-muted">en eski: {formatDate(r.a.oldest)}</span>}</td>
                <td className={tdNum}><Money v={r.balance} cur={r.p.currency} strong /></td>
                <td className={tdNum}>{r.a.d0_30 ? <Money v={r.a.d0_30} cur={r.p.currency} /> : ""}</td>
                <td className={tdNum}>{r.a.d31_60 ? <Money v={r.a.d31_60} cur={r.p.currency} /> : ""}</td>
                <td className={`${tdNum} text-warn`}>{r.a.d61_90 ? fmt(r.a.d61_90, r.p.currency) : ""}</td>
                <td className={`${tdNum} text-bad font-semibold`}>{r.a.d90 ? fmt(r.a.d90, r.p.currency) : ""}</td>
                <td className={`${tdNum} ${over ? "text-bad font-semibold" : ""}`}>{r.p.credit_limit ? fmt(r.p.credit_limit, r.p.currency) : "—"}{over ? " · aşıldı" : ""}</td>
                <td className={`${td} text-right whitespace-nowrap`}>
                  {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-ok mr-3">WhatsApp</a>}
                  <Link href={`/finans/islem?tur=collection&cari=${r.p.id}&geri=/finans/veresiye`} className="text-xs font-semibold text-brand-700">Tahsilat</Link>
                </td>
              </tr>
            );
          })}
          {rows.length === 0 && <EmptyRow cols={8} text={g === "defter" ? "Veresiye defterinde cari yok: aşağıdan ekleyin ya da cari kartında “veresiye” işaretleyin." : "Alacaklı cari yok."} />}
        </Table>

        {lvl >= 2 && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Veresiye satış yaz">
              <form action={creditSale} className="grid gap-3 sm:grid-cols-2">
                <Field label="Müşteri" className="sm:col-span-2"><select name="party_id" required className={selectCls}><option value="">Seçin</option>{(allParties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}</select></Field>
                <Field label="Tutar (KDV dahil)"><input name="amount" required inputMode="decimal" className={inputCls} /></Field>
                <Field label="KDV"><select name="vat_rate" className={selectCls}>{[20, 10, 1, 0].map((v) => <option key={v} value={v}>%{v}</option>)}</select></Field>
                <Field label="Gelir hesabı"><select name="category_id" className={selectCls}><option value="">Ticari mal satışları</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
                <Field label="Tarih"><input type="date" name="date" defaultValue={t} className={inputCls} /></Field>
                <Field label="Ne satıldı?" className="sm:col-span-2"><input name="description" maxLength={300} className={inputCls} /></Field>
                <label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" name="mark" defaultChecked /> Cariyi veresiye defterine ekle</label>
                <div className="sm:col-span-2"><PendingSubmit className={btnPrimary}>Yaz</PendingSubmit> <span className="text-xs text-muted ml-2">Faturalı satış için Satış faturası kullanın.</span></div>
              </form>
            </Card>
            <Card title="Deftere cari ekle / limit">
              <form action={setCreditSales} className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="on" value="1" />
                <Field label="Cari" className="sm:col-span-2"><select name="party_id" required className={selectCls}><option value="">Seçin</option>{(allParties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
                <Field label="Risk limiti" hint="boş = limitsiz"><input name="credit_limit" inputMode="decimal" className={inputCls} /></Field>
                <div className="flex items-end"><PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit></div>
              </form>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
