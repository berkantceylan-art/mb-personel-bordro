import Link from "next/link";
import { redirect } from "next/navigation";
import { formatTL, nextPeriod, periodBounds, previousPeriod } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, getSession, periodLabel } from "@/lib/session";
import { loadPlan } from "@/lib/salary-plan";
import { bankConfirm, bankUnpost } from "@/lib/salary-plan-actions";
import { BankUpload } from "../../../finans/banka-aktar/BankUpload";
import { MatchRow, type Cand } from "./MatchRow";

const dt = (d: string) => d.split("-").reverse().join(".");
const btn = "h-11 px-3 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700";

export default async function BankMatchPage({ params }: { params: Promise<{ period: string }> }) {
  const { period } = await params;
  const s = await getSession();
  if (!canManagePay(s.role) || !/^\d{4}-\d{2}$/.test(period)) redirect("/donemler");
  const supabase = await createClient();
  const { start, end } = periodBounds(period);
  const until = new Date(Date.parse(end) + 25 * 86_400_000).toISOString().slice(0, 10);
  const [{ plan, closed }, { data: accRows }] = await Promise.all([
    loadPlan(supabase, period),
    supabase.from("fin_accounts").select("id, name, currency").eq("kind", "bank").eq("is_active", true).order("sort").order("name"),
  ]);
  const banks = (accRows ?? []).map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const ids = banks.map((b) => b.id);
  const { data: lineRows, error: lineErr } = ids.length
    ? await supabase.from("fin_bank_lines").select("id, account_id, txn_date, description, amount, status, suggested_employee_id, suggest_reason, txn_id").in("account_id", ids).lt("amount", 0).gte("txn_date", start).lte("txn_date", until).in("status", ["new", "matched", "posted"]).order("txn_date")
    : { data: [], error: null };
  const lines = lineRows ?? [];
  const txnIds = lines.map((l) => l.txn_id).filter(Boolean) as string[];
  const { data: linked } = txnIds.length ? await supabase.from("ledger_entries").select("employee_id, amount, type, fin_txn_id").in("fin_txn_id", txnIds).is("voided_at", null) : { data: [] };
  const name = new Map(plan.map((r) => [r.id, r.name]));
  const byTxn = new Map<string, Array<{ name: string; amount: number }>>();
  for (const e of linked ?? []) byTxn.set(e.fin_txn_id as string, [...(byTxn.get(e.fin_txn_id as string) ?? []), { name: name.get(e.employee_id) ?? "—", amount: Number(e.amount) }]);
  const accName = new Map(banks.map((b) => [b.id, b.name]));

  const owed = plan.filter((r) => r.leftBank > 0);
  const owedTotal = owed.reduce((a, r) => a + r.leftBank, 0);
  const people = plan.map((r) => ({ id: r.id, name: r.name, dept: r.dept, leftBank: r.leftBank }));
  const candidates = (l: (typeof lines)[number]): Cand[] => {
    const amt = -Number(l.amount);
    const out: Cand[] = [];
    if (owed.length > 1 && amt === owedTotal) out.push({ label: `Toplu maaş · bankaya kalan ${owed.length} kişinin tamamı`, items: owed.map((r) => ({ id: r.id, amount: r.leftBank, type: "SALARY" })) });
    if (l.suggested_employee_id && name.has(l.suggested_employee_id)) {
      const r = plan.find((x) => x.id === l.suggested_employee_id)!;
      out.push({ label: `${r.name} · ${amt === r.leftBank ? "maaşı (tutar tutuyor)" : amt < r.leftBank ? "avans / kısmi ödeme" : "ödeme"}`, items: [{ id: r.id, amount: amt, type: amt < r.leftBank * 0.9 ? "ADVANCE" : "SALARY" }] });
    }
    const same = owed.filter((r) => r.leftBank === amt && r.id !== l.suggested_employee_id);
    if (same.length === 1) out.push({ label: `${same[0]!.name} · bankaya kalan tutarla aynı`, items: [{ id: same[0]!.id, amount: amt, type: "SALARY" }] });
    return out;
  };
  const pending = lines.filter((l) => l.status === "new");
  const done = lines.filter((l) => l.status !== "new");

  return (
    <>
      <PageHeader
        title={`${periodLabel(period)} · banka ekstresi eşleştirme`}
        subtitle={`Bankaya kalan ${formatTL(owedTotal)} (${owed.length} kişi) · ekstrede ${pending.length} bekleyen çıkış`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Link href={`/donemler/${previousPeriod(period)}/banka`} className={btn} aria-label="Önceki ay">←</Link>
            <Link href={`/donemler/${nextPeriod(period)}/banka`} className={btn} aria-label="Sonraki ay">→</Link>
            <Link href={`/donemler/${period}`} className={btn}>← Maaş planı</Link>
          </div>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1200px]">
        {lineErr && <p className="text-sm rounded-[12px] px-4 py-2.5 bg-bad-bg text-bad">Ekstre satırları okunamadı ({lineErr.message}). Finans yetkisi ve Supabase güncellemeleri gerekli.</p>}
        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
          <h2 className="font-display font-bold text-brand-800">1. Ekstreyi yükleyin</h2>
          <p className="text-xs text-muted">Garanti internet şubesinden hesap hareketlerini Excel / CSV / MT940 olarak indirip buraya bırakın. Aynı satır iki kez eklenmez. {periodLabel(period)} ve sonraki 25 günün çıkışları aşağıda eşleştirilir.</p>
          {banks.length ? <BankUpload accounts={banks} defaultAccount={banks[0]!.id} /> : <p className="text-sm text-warn">Finans › Banka&apos;dan TL banka hesabı tanımlayın.</p>}
        </section>

        <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
          <h2 className="font-display font-bold text-brand-800">2. Bekleyen çıkışları personelle eşleştirin ({pending.length})</h2>
          <p className="text-xs text-muted">Sistem öneri getirir: toplu maaş dosyası (tek satırda tüm personel), açıklamada adı / IBAN&apos;ı geçen personel, ya da tutarı birebir tutan kişi. Öneriyi seçin ya da kişileri ve tutarları kendiniz dağıtın; toplam banka tutarına eşit olunca kaydedilir. Kaydedilince personel carisine ve kasa / banka defterine işlenir.</p>
          {pending.length ? (
            <ul className="flex flex-col gap-3">
              {pending.map((l) => (
                <MatchRow key={l.id} period={period} closed={closed} line={{ id: l.id, date: dt(l.txn_date), description: l.description, amount: -Number(l.amount), account: accName.get(l.account_id) ?? "", reason: l.suggest_reason }} candidates={candidates(l)} people={people} />
              ))}
            </ul>
          ) : <p className="text-sm text-muted">Bekleyen çıkış yok. Ekstre yükleyince burada listelenir.</p>}
        </section>

        {done.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
            <h2 className="font-display font-bold text-brand-800">Eşleşenler ({done.length})</h2>
            <ul className="flex flex-col">
              {done.map((l) => {
                const who = l.txn_id ? byTxn.get(l.txn_id) ?? [] : [];
                return (
                  <li key={l.id} className="flex flex-wrap items-center gap-3 py-2 border-b border-[#EEF2F6] text-sm">
                    <span className="num text-muted w-20">{dt(l.txn_date)}</span>
                    <span className="flex-1 min-w-[200px]">
                      <span className="block truncate">{l.description}</span>
                      <span className="block text-xs text-muted">{who.length ? who.slice(0, 4).map((w) => `${w.name} ${formatTL(w.amount)}`).join(" · ") + (who.length > 4 ? ` +${who.length - 4} kişi` : "") : l.suggest_reason ?? "Finans kaydıyla eşleşti"}</span>
                    </span>
                    <span className="num font-semibold">{formatTL(-Number(l.amount))}</span>
                    {l.status === "matched" && (
                      <form action={bankConfirm}><input type="hidden" name="line" value={l.id} /><input type="hidden" name="period" value={period} /><button className="h-8 px-3 rounded-lg bg-ok text-white text-xs font-semibold">Onayla</button></form>
                    )}
                    {l.status === "posted" && who.length > 0 && !closed && (
                      <form action={bankUnpost}><input type="hidden" name="line" value={l.id} /><input type="hidden" name="period" value={period} /><button className="h-8 px-3 rounded-lg border border-[#D5DEE8] text-xs font-semibold text-[#33414F]">Geri al</button></form>
                    )}
                    <span className={`text-xs font-semibold ${l.status === "posted" ? "text-ok" : "text-brand-700"}`}>{l.status === "posted" ? "işlendi ✓" : "otomatik bulundu"}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
