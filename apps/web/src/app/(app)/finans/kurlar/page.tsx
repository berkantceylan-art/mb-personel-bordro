import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { EmptyRow, Field, Notice, Table, btnPrimary, btnSecondary, inputCls, page, selectCls, td, tdNum } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { pullTcmb, saveFxRate } from "@/lib/fin-actions";
import { today } from "@/lib/fin";

export const dynamic = "force-dynamic";

/** Döviz kurları: TCMB (her sabah otomatik) ve elle giriş */
export default async function RatesPage() {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.from("fx_rates").select("rate_date, currency, buying, selling, source").order("rate_date", { ascending: false }).order("currency").limit(160);
  const dates = [...new Set((data ?? []).map((r) => r.rate_date as string))].slice(0, 30);
  const curs = ["USD", "EUR", "GBP", "CHF"];
  const cell = (d: string, c: string) => (data ?? []).find((r) => r.rate_date === d && r.currency === c);
  const canEdit = (s.modules.finance ?? 0) >= 2;
  return (
    <>
      <PageHeader title="Döviz kurları" subtitle="TCMB döviz satış kuru · her sabah otomatik alınır" />
      <div className={page}>
        {error && <Notice tone="bad">Tablo yok: Supabase&apos;de 20261202000000_finance_core.sql çalıştırın.</Notice>}
        {canEdit && (
          <div className="grid gap-4 lg:grid-cols-[auto_1fr]">
            <Card title="TCMB">
              <form action={pullTcmb}><PendingSubmit className={btnSecondary}>Bugünün kurlarını al</PendingSubmit></form>
            </Card>
            <Card title="Elle kur gir">
              <form action={saveFxRate} className="grid gap-3 sm:grid-cols-5 items-end">
                <Field label="Tarih"><input type="date" name="date" defaultValue={today()} className={inputCls} /></Field>
                <Field label="Para birimi"><select name="currency" className={selectCls}>{curs.map((c) => <option key={c}>{c}</option>)}</select></Field>
                <Field label="Alış"><input name="buying" inputMode="decimal" className={inputCls} /></Field>
                <Field label="Satış"><input name="selling" required inputMode="decimal" className={inputCls} /></Field>
                <PendingSubmit className={btnPrimary}>Kaydet</PendingSubmit>
              </form>
            </Card>
          </div>
        )}
        <Table head={["Tarih", ...curs]} min={560}>
          {dates.map((d) => (
            <tr key={d}>
              <td className={td}>{formatDate(d)}</td>
              {curs.map((c) => {
                const r = cell(d, c);
                return <td key={c} className={tdNum}>{r ? Number(r.selling).toLocaleString("tr-TR", { minimumFractionDigits: 4 }) : "—"}{r?.source === "manual" && <span className="ml-1 text-[10px] text-muted">elle</span>}</td>;
              })}
            </tr>
          ))}
          {dates.length === 0 && <EmptyRow cols={5} text="Henüz kur yok. 'Bugünün kurlarını al' ile başlayın." />}
        </Table>
      </div>
    </>
  );
}
