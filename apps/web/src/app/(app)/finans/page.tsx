import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, Money, Notice, page } from "@/components/erp";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { latestRates, loadAccounts, loadParties } from "@/lib/fin-data";
import { ACCOUNT_KIND, TXN_KIND, fmt } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Finans özeti: nakit durumu, alacak / borç, kurlar, son işlemler */
export default async function FinanceHome() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const [{ rows: accounts, error }, { rows: parties }, { rates, date }] = await Promise.all([loadAccounts(), loadParties(), latestRates()]);
  const supabase = await createClient();
  const { data: recent } = await supabase.from("fin_txns").select("id, no, txn_date, kind, description, amount, currency").is("voided_at", null).order("created_at", { ascending: false }).limit(10);
  const act = accounts.filter((a) => a.is_active);
  const sumTry = (kinds: string[]) => act.filter((a) => kinds.includes(a.kind)).reduce((x, a) => x + a.balance * (rates[a.currency] ?? 1), 0);
  const cash = sumTry(["cash"]);
  const bank = sumTry(["bank", "pos"]);
  const card = -sumTry(["credit_card"]);
  const loan = -sumTry(["loan"]);
  const toTry = (v: number, c: string) => v * (rates[c] ?? 1);
  const recv = parties.filter((p) => p.balance > 0).sort((a, b) => toTry(b.balance, b.currency) - toTry(a.balance, a.currency));
  const pay = parties.filter((p) => p.balance < 0).sort((a, b) => toTry(a.balance, a.currency) - toTry(b.balance, b.currency));
  const recvTotal = recv.reduce((x, p) => x + toTry(p.balance, p.currency), 0);
  const payTotal = -pay.reduce((x, p) => x + toTry(p.balance, p.currency), 0);
  const net = cash + bank + recvTotal - payTotal - card - loan;
  const r = (v: number) => fmt(Math.round(v));
  return (
    <>
      <PageHeader title="Finans özeti" subtitle={date ? `Kurlar: ${formatDate(date)} TCMB` : "Kur girilmemiş: tutarlar yalnız TL hesaplar için doğrudur"} actions={(s.modules.finance ?? 0) >= 2 ? <Link href="/finans/islem" className="text-sm font-semibold text-brand-700">+ İşlem gir</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Kasalar" value={r(cash)} href="/finans/kasa" />
          <KPI label="Bankalar" value={r(bank)} href="/finans/banka" />
          <KPI label="Alacaklar" value={r(recvTotal)} sub={`${recv.length} cari`} href="/finans/cariler?bakiye=alacak" />
          <KPI label="Borçlar" value={r(payTotal)} sub={`${pay.length} cari`} tone="bad" href="/finans/cariler?bakiye=borc" />
          <KPI label="Kredi kartı borcu" value={r(card)} tone={card > 0 ? "bad" : undefined} />
          <KPI label="Kredi borcu" value={r(loan)} tone={loan > 0 ? "bad" : undefined} />
          <KPI label="Net durum" value={r(net)} sub="nakit + alacak − borç" tone={net < 0 ? "bad" : "ok"} />
          <KPI label="Kurlar" value={["EUR", "USD"].map((c) => (rates[c] ? `${c} ${rates[c]!.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}` : null)).filter(Boolean).join(" · ") || "—"} href="/finans/kurlar" />
        </div>
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Hesaplar" action={<Link href="/finans/banka" className="text-sm font-semibold text-brand-700">Tümü</Link>}>
            <ul className="divide-y divide-[#EEF2F6]">
              {act.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <Link href={`/finans/hesap/${a.id}`} className="min-w-0 truncate"><span className="font-semibold text-brand-700">{a.name}</span> <span className="text-xs text-muted">{ACCOUNT_KIND[a.kind]?.label}</span></Link>
                  <Money v={a.balance} cur={a.currency} strong />
                </li>
              ))}
              {act.length === 0 && <li className="py-4 text-sm text-muted">Henüz hesap yok: <Link href="/finans/kasa" className="text-brand-700">kasa</Link> ya da <Link href="/finans/banka" className="text-brand-700">banka</Link> açın.</li>}
            </ul>
          </Card>
          <Card title="Son işlemler" action={<Link href="/finans/islemler" className="text-sm font-semibold text-brand-700">Defter</Link>}>
            <ul className="divide-y divide-[#EEF2F6]">
              {(recent ?? []).map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate"><span className="text-xs text-muted">{formatDate(t.txn_date)} · {TXN_KIND[t.kind]}</span> {t.description}</span>
                  <span className="num whitespace-nowrap">{fmt(t.amount, t.currency)}</span>
                </li>
              ))}
              {(recent ?? []).length === 0 && <li className="py-4 text-sm text-muted">Kayıt yok.</li>}
            </ul>
          </Card>
          <Card title="En yüksek alacaklar">
            <ul className="divide-y divide-[#EEF2F6]">
              {recv.slice(0, 8).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2 text-sm"><Link href={`/finans/cariler/${p.id}`} className="truncate text-brand-700">{p.name}</Link><Money v={p.balance} cur={p.currency} /></li>
              ))}
              {recv.length === 0 && <li className="py-4 text-sm text-muted">Alacak yok.</li>}
            </ul>
          </Card>
          <Card title="En yüksek borçlar">
            <ul className="divide-y divide-[#EEF2F6]">
              {pay.slice(0, 8).map((p) => (
                <li key={p.id} className="flex justify-between gap-3 py-2 text-sm"><Link href={`/finans/cariler/${p.id}`} className="truncate text-brand-700">{p.name}</Link><Money v={-p.balance} cur={p.currency} /></li>
              ))}
              {pay.length === 0 && <li className="py-4 text-sm text-muted">Borç yok.</li>}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
