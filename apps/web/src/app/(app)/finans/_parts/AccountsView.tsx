import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { EmptyRow, KPI, Money, Notice, Table, page, td, tdNum } from "@/components/erp";
import { getSession } from "@/lib/session";
import { loadAccounts } from "@/lib/fin-data";
import { ACCOUNT_KIND, fmt } from "@/lib/fin";
import { createClient } from "@/lib/supabase/server";
import { AccountForm } from "./AccountForm";

/** Hesap listesi (kasa, banka, kart, kredi, ortak, avans): bakiyeler + yeni hesap */
export async function AccountsView({ kinds, title, subtitle, newKind }: { kinds: string[]; title: string; subtitle: string; newKind: string }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const { rows, error } = await loadAccounts(kinds);
  const active = rows.filter((a) => a.is_active);
  const byCur = new Map<string, number>();
  for (const a of active) byCur.set(a.currency, (byCur.get(a.currency) ?? 0) + a.balance);
  const totalTry = active.reduce((x, a) => x + a.balance_try, 0);
  let employees: { id: string; name: string }[] = [];
  if (newKind === "advance") {
    const supabase = await createClient();
    const { data } = await supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name");
    employees = (data ?? []).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }));
  }
  const canEdit = (s.modules.finance ?? 0) >= 3;
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={(s.modules.finance ?? 0) >= 2 ? <Link href="/finans/islem" className="text-sm font-semibold text-brand-700">İşlem gir</Link> : undefined} />
      <div className={page}>
        {error && <Notice tone="bad">Finans tabloları yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[...byCur.entries()].map(([c, v]) => <KPI key={c} label={`Toplam (${c})`} value={fmt(v, c)} tone={v < 0 ? "bad" : undefined} />)}
          {byCur.size > 1 && <KPI label="TL karşılığı" value={fmt(totalTry, "TRY")} sub="güncel kurla" />}
          {byCur.size === 0 && <KPI label="Toplam" value={fmt(0)} />}
        </div>
        <Table head={["Hesap", "Tür", "Banka / kişi", "Para", "Bakiye", ""]} min={760}>
          {rows.map((a) => (
            <tr key={a.id} className={a.is_active ? "" : "opacity-60"}>
              <td className={td}><Link href={`/finans/hesap/${a.id}`} className="font-semibold text-brand-700">{a.name}</Link>{!a.is_active && <span className="ml-2 text-[11px] text-muted">kapalı</span>}{a.iban && <span className="block text-xs text-muted num">{a.iban}</span>}</td>
              <td className={td}>{ACCOUNT_KIND[a.kind]?.label}</td>
              <td className={td}>{a.bank_name ?? a.holder_name ?? "—"}{a.card_last4 && <span className="text-muted"> · **** {a.card_last4}</span>}</td>
              <td className={td}>{a.currency}</td>
              <td className={tdNum}><Money v={a.balance} cur={a.currency} strong /></td>
              <td className={`${td} text-right whitespace-nowrap`}>
                {(s.modules.finance ?? 0) >= 2 && <Link href={`/finans/islem?hesap=${a.id}&tur=${a.kind === "credit_card" ? "expense" : "collection"}&geri=/finans/hesap/${a.id}`} className="text-xs font-semibold text-brand-700">İşlem</Link>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && <EmptyRow cols={6} text="Henüz hesap yok. Aşağıdan açın." />}
        </Table>
        {canEdit && (
          <Card title={`Yeni ${ACCOUNT_KIND[newKind]?.label.toLocaleLowerCase("tr")}`}>
            <AccountForm kind={newKind} employees={employees} />
          </Card>
        )}
      </div>
    </>
  );
}
