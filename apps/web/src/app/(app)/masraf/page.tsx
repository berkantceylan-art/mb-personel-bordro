import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Chip, EmptyRow, KPI, Money, Notice, Table, Tabs, btnPrimary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { fmt, today } from "@/lib/fin";
import { loadCategories } from "@/lib/fin-data";
import { decideClaim, deleteClaim, reopenClaim } from "@/lib/expense-actions";
import { ClaimForm } from "./_parts/ClaimForm";

export const dynamic = "force-dynamic";

const STATUS: Record<string, [string, "amber" | "green" | "red"]> = { submitted: ["Onay bekliyor", "amber"], posted: ["Onaylandı", "green"], rejected: ["Reddedildi", "red"] };
const METHOD: Record<string, string> = { account: "Kasa / banka / kart", advance: "Personel avansından", payable: "Cariye borç (sonra ödenecek)" };

type C = { id: string; no: number; employee_id: string | null; submitted_by: string | null; expense_date: string; amount: number; currency: string; vat_rate: number; category_id: string | null; vendor: string | null; doc_no: string | null; description: string | null; receipt_path: string | null; status: string; pay_method: string | null; account_id: string | null; party_id: string | null; reject_reason: string | null; recurring_id: string | null; employees: { first_name: string; last_name: string } | null; fin_categories: { name: string } | null };

/** Masraflar: beyan, onay kuyruğu, finansa işleme */
export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const s = await getSession();
  const lvl = s.modules.expenses ?? 0;
  if (lvl < 1) redirect("/benim/masraf");
  const { g = "bekleyen" } = await searchParams;
  const supabase = await createClient();
  if (lvl >= 2) await supabase.rpc("exp_recurring_run", { p_date: today() });
  const monthStart = today().slice(0, 8) + "01";
  const [{ data, error }, cats, { data: accs }, { data: emps }, { data: parties }, { data: monthRows }] = await Promise.all([
    supabase.from("exp_claims").select("*, employees(first_name, last_name), fin_categories(name)")
      .eq("status", g === "onaylanan" ? "posted" : g === "reddedilen" ? "rejected" : "submitted").order("expense_date", { ascending: false }).limit(300),
    loadCategories(["expense"]),
    supabase.from("fin_accounts").select("id, name, kind, currency").in("kind", ["cash", "bank", "credit_card", "partner"]).eq("is_active", true).order("kind").order("name"),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
    supabase.from("fin_parties").select("id, name").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
    supabase.from("exp_claims").select("amount, currency, category_id, fin_categories(name), status").gte("expense_date", monthStart).limit(5000),
  ]);
  const rows = (data ?? []) as unknown as C[];
  const paths = rows.map((r) => r.receipt_path).filter(Boolean) as string[];
  const { data: urls } = paths.length ? await supabase.storage.from("receipts").createSignedUrls(paths, 900) : { data: [] };
  const url = new Map((urls ?? []).map((u) => [u.path ?? "", u.signedUrl]));
  const ids = rows.filter((r) => r.status === "submitted").map((r) => r.id);
  const [{ data: aprs }, { data: dups }] = ids.length ? await Promise.all([
    supabase.from("apr_requests").select("entity_id, status, step, steps").eq("entity", "expense_claim").in("entity_id", ids).in("status", ["pending", "approved"]),
    supabase.rpc("exp_claim_dups", { p_ids: ids }),
  ]) : [{ data: [] }, { data: [] }];
  const apr = new Map(((aprs ?? []) as { entity_id: string; status: string; step: number; steps: number }[]).map((a) => [a.entity_id, a]));
  const dup = new Map(((dups ?? []) as { id: string; dup_no: number }[]).map((d) => [d.id, d.dup_no]));
  const mr = (monthRows ?? []) as unknown as { amount: number; currency: string; category_id: string | null; fin_categories: { name: string } | null; status: string }[];
  const posted = mr.filter((r) => r.status === "posted" && r.currency === "TRY");
  const byCat = new Map<string, number>();
  for (const r of posted) byCat.set(r.fin_categories?.name ?? "Diğer", (byCat.get(r.fin_categories?.name ?? "Diğer") ?? 0) + Number(r.amount));
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topMax = Math.max(1, ...top.map(([, v]) => v));
  const waiting = mr.filter((r) => r.status === "submitted");
  const accOpts = (accs ?? []).map((a) => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>);
  const empName = (r: C) => (r.employees ? `${r.employees.first_name} ${r.employees.last_name}` : r.recurring_id ? "Tekrarlayan" : "Şirket");

  return (
    <>
      <PageHeader title="Masraflar" subtitle="Personel ve şirket masrafları: fiş fotoğrafıyla beyan, onay, tek tuşla finansa işleme" actions={lvl >= 2 ? <Link href="/masraf/tekrarlayan" className="text-sm font-semibold text-brand-700">Tekrarlayan masraflar</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Masraf tabloları yok: Supabase&apos;de 20261206000000_expenses_assets.sql çalıştırın.</Notice>}
        <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
          <KPI label="Onay bekleyen (bu ay)" value={waiting.length} sub={fmt(waiting.filter((r) => r.currency === "TRY").reduce((x, r) => x + Number(r.amount), 0))} href="/masraf?g=bekleyen" tone={waiting.length ? "bad" : undefined} />
          <KPI label="Bu ay işlenen" value={fmt(posted.reduce((x, r) => x + Number(r.amount), 0))} href="/masraf?g=onaylanan" />
          <KPI label="En büyük kalem" value={top[0]?.[0] ?? "—"} sub={top[0] ? fmt(top[0][1]) : undefined} />
          <KPI label="Beyan sayısı (bu ay)" value={mr.length} />
        </div>
        {top.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4">
            <h2 className="font-semibold mb-3">Bu ay masraf dağılımı</h2>
            <ul className="grid gap-2 sm:grid-cols-2 text-sm">
              {top.map(([n, v]) => (
                <li key={n}><div className="flex justify-between"><span>{n}</span><Money v={v} /></div><div className="h-1.5 rounded-full bg-[#EEF2F6] mt-1"><div className="h-full rounded-full bg-brand-600" style={{ width: `${(v / topMax) * 100}%` }} /></div></li>
              ))}
            </ul>
          </section>
        )}
        <Tabs active={`/masraf?g=${g}`} items={[["/masraf?g=bekleyen", "Onay bekleyen"], ["/masraf?g=onaylanan", "Onaylanan"], ["/masraf?g=reddedilen", "Reddedilen"]]} />
        <Table head={["Tarih", "Fiş", "Kim", "Satıcı / açıklama", "Tür", "Tutar", g === "bekleyen" ? "Onay" : "Durum"]} min={1100}>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className={td}>{formatDate(r.expense_date)}<span className="block text-xs text-muted">#{r.no}</span></td>
              <td className={td}>{r.receipt_path && url.get(r.receipt_path) ? <a href={url.get(r.receipt_path) ?? undefined} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold text-xs">Fişi aç</a> : <span className="text-xs text-muted">yok</span>}</td>
              <td className={td}>{empName(r)}</td>
              <td className={td}>{r.vendor ?? ""}{r.doc_no && <span className="text-xs text-muted"> · {r.doc_no}</span>}{r.description && <span className="block text-xs text-muted">{r.description}</span>}{r.reject_reason && <span className="block text-xs text-bad">Red: {r.reject_reason}</span>}{dup.has(r.id) && <span className="block text-xs font-semibold text-bad">⚠ #{dup.get(r.id)} ile aynı fiş olabilir</span>}{apr.get(r.id) && <span className={`block text-xs font-semibold ${apr.get(r.id)!.status === "approved" ? "text-ok" : "text-warn"}`}>{apr.get(r.id)!.status === "approved" ? "✓ Onay akışı tamam" : `Onay akışında: adım ${apr.get(r.id)!.step}/${apr.get(r.id)!.steps}`}</span>}</td>
              <td className={td}>{r.fin_categories?.name ?? "—"} <span className="text-xs text-muted">%{Number(r.vat_rate)}</span></td>
              <td className={tdNum}><Money v={r.amount} cur={r.currency} strong /></td>
              <td className={td}>
                {r.status === "submitted" && lvl >= 2 ? (
                  <div className="flex flex-col gap-1.5 min-w-[340px]">
                    <form action={decideClaim} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" />
                      <select name="method" defaultValue={r.pay_method ?? (r.employee_id ? "advance" : "account")} className={`${selectCls} h-9 w-44`} aria-label="Ödeme şekli">{Object.entries(METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                      <select name="account_id" defaultValue={r.account_id ?? ""} className={`${selectCls} h-9 w-40`} aria-label="Hesap"><option value="">Hesap</option>{accOpts}</select>
                      <select name="party_id" defaultValue={r.party_id ?? ""} className={`${selectCls} h-9 w-40`} aria-label="Cari"><option value="">Cari (borç için)</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                      <select name="category_id" defaultValue={r.category_id ?? ""} className={`${selectCls} h-9 w-40`} aria-label="Gider"><option value="">Diğer giderler</option>{cats.filter((c) => c.is_active).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
                      <PendingSubmit className={`${btnPrimary} h-9`}>Onayla</PendingSubmit>
                    </form>
                    <form action={decideClaim} className="flex gap-1.5">
                      <input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" />
                      <input name="reason" placeholder="Red nedeni" maxLength={300} className={`${inputCls} h-8 flex-1`} />
                      <PendingSubmit className="text-xs font-semibold text-bad">Reddet</PendingSubmit>
                    </form>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Chip tone={STATUS[r.status]?.[1]}>{STATUS[r.status]?.[0]}</Chip>
                    {r.status === "posted" && <span className="text-xs text-muted">{METHOD[r.pay_method ?? "account"]}</span>}
                    {r.status === "posted" && lvl >= 3 && <form action={reopenClaim}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Geri al" question="Finans kaydı iptal edilip beyan kuyruğa dönsün mü?" /></form>}
                    {r.status === "rejected" && <form action={deleteClaim}><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="Sil" /></form>}
                  </div>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={7} text={g === "bekleyen" ? "Onay bekleyen masraf yok." : "Kayıt yok."} />}
        </Table>
        <Card title="Yeni masraf">
          <ClaimForm userId={s.userId} today={today()} categories={cats.filter((c) => c.is_active).map((c) => ({ id: c.id, name: c.name }))}
            employees={lvl >= 2 ? (emps ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` })) : undefined}
            accounts={lvl >= 2 ? (accs ?? []).map((a) => ({ id: a.id, name: `${a.name} (${a.currency})` })) : undefined} />
        </Card>
        <p className="text-xs text-muted">Personel beyanları telefondan <b>Benim sayfam &gt; Masraf beyanı</b> ile gelir. “Personel avansından” seçilirse personelin avans hesabından düşülür; avansı yoksa hesap eksiye düşer (şirket personele borçlu) ve <Link href="/finans/avans" className="underline">Avans hesapları</Link>ndan ödenir.</p>
      </div>
    </>
  );
}
