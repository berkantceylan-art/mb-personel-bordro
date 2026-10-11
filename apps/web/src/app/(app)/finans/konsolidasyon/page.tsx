import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { saveEntity, saveEntry, setGroupParty } from "@/lib/group-actions";

export const dynamic = "force-dynamic";

type R = { period: string; entity: string; revenue: number; expense: number; profit: number; cash: number; receivable: number; payable: number; ic_revenue: number; ic_expense: number; ic_receivable: number; ic_payable: number; missing: boolean };
type E = { id: string; name: string; country: string | null; currency: string; party_id: string | null };
const COLS: [keyof R, string][] = [["revenue", "Gelir"], ["expense", "Gider"], ["profit", "Kâr"], ["cash", "Nakit"], ["receivable", "Alacak"], ["payable", "Borç"]];

/** Grup konsolidasyonu: bu şirket + ERP dışındaki grup şirketleri, tek para biriminde, grup içi işlemler elenmiş */
export default async function GroupPage({ searchParams }: { searchParams: Promise<{ bas?: string; bit?: string; para?: string; donem?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 2) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const to = /^\d{4}-\d{2}$/.test(sp.bit ?? "") ? sp.bit! : ym(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const from = /^\d{4}-\d{2}$/.test(sp.bas ?? "") ? sp.bas! : ym(new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5)) - 3, 1)));
  const cur = ["TRY", "EUR", "USD"].includes(sp.para ?? "") ? sp.para! : "EUR";
  const entryPeriod = /^\d{4}-\d{2}$/.test(sp.donem ?? "") ? sp.donem! : to;
  const supabase = await createClient();
  const [{ data, error }, { data: ents }, { data: parties }, { data: entries }] = await Promise.all([
    supabase.rpc("cns_report", { p_from: from, p_to: to, p_currency: cur }),
    supabase.from("cns_entities").select("id, name, country, currency, party_id").order("name"),
    supabase.from("fin_parties").select("id, name, group_company").eq("is_active", true).order("name").limit(3000),
    supabase.from("cns_entries").select("*").eq("period", entryPeriod),
  ]);
  const rows = (data ?? []) as R[];
  const entities = (ents ?? []) as E[];
  const months = [...new Set(rows.map((r) => r.period))];
  const groupParties = (parties ?? []).filter((p) => p.group_company);
  const canSet = (s.modules.finance ?? 0) >= 3;
  const f = (v: number) => (v / 100).toLocaleString("tr-TR", { maximumFractionDigits: 0 });
  const elim = (list: R[]): Record<string, number> => ({ revenue: -list.reduce((a, r) => a + r.ic_revenue, 0), expense: -list.reduce((a, r) => a + r.ic_expense, 0), profit: -list.reduce((a, r) => a + r.ic_revenue - r.ic_expense, 0), cash: 0, receivable: -list.reduce((a, r) => a + r.ic_receivable, 0), payable: -list.reduce((a, r) => a + r.ic_payable, 0) });
  const inp = "h-9 rounded-[8px] border border-line bg-white px-2 text-sm";

  return (
    <>
      <PageHeader title="Grup konsolidasyonu" subtitle="Bu şirketin finans kayıtları ile diğer grup şirketlerinin aylık rakamları tek para biriminde; grup içi satış, alış, alacak ve borç elenir" actions={<Link href="/finans" className="text-sm font-semibold text-brand-700">Finans</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">{/not_allowed/.test(error.message) ? "Finans yetkiniz yok." : "Supabase'de 20261229000000_reports_group.sql çalıştırılmalı."}</Notice>}
        <form className="flex flex-wrap gap-2 items-end text-sm">
          <label className="text-xs font-semibold text-muted flex flex-col gap-1">Başlangıç<input type="month" name="bas" defaultValue={from} className={inp} /></label>
          <label className="text-xs font-semibold text-muted flex flex-col gap-1">Bitiş<input type="month" name="bit" defaultValue={to} className={inp} /></label>
          <label className="text-xs font-semibold text-muted flex flex-col gap-1">Para birimi<select name="para" defaultValue={cur} className={inp}>{["EUR", "TRY", "USD"].map((x) => <option key={x}>{x}</option>)}</select></label>
          <button className="h-9 px-3 rounded-[8px] bg-brand-700 text-white font-semibold">Göster</button>
        </form>
        {months.map((m) => {
          const list = rows.filter((r) => r.period === m);
          const e = elim(list);
          const sum = (k: keyof R) => list.reduce((a, r) => a + Number(r[k]), 0) + (e[k as string] ?? 0);
          return (
            <section key={m} className="rounded-[18px] border border-line bg-white overflow-x-auto">
              <table className="w-full text-sm min-w-[820px]">
                <thead><tr className="text-left text-xs text-muted"><th className="p-3">{m} · {cur}</th>{COLS.map(([, l]) => <th key={l} className="p-3 text-right">{l}</th>)}</tr></thead>
                <tbody>
                  {list.map((r) => <tr key={r.entity} className="border-t border-[#EEF2F6]"><td className="p-3 font-semibold">{r.entity}{r.missing && <span className="ml-2 text-xs text-warn">rakam girilmemiş</span>}</td>{COLS.map(([k]) => <td key={k} className={`p-3 text-right num ${k === "profit" && Number(r[k]) < 0 ? "text-bad" : ""}`}>{f(Number(r[k]))}</td>)}</tr>)}
                  <tr className="border-t border-[#EEF2F6] text-muted"><td className="p-3">Grup içi eleme</td>{COLS.map(([k]) => <td key={k} className="p-3 text-right num">{e[k as string] ? f(e[k as string]!) : ""}</td>)}</tr>
                  <tr className="border-t-2 border-line font-bold"><td className="p-3">Konsolide</td>{COLS.map(([k]) => <td key={k} className={`p-3 text-right num ${k === "profit" && sum(k) < 0 ? "text-bad" : ""}`}>{f(sum(k))}</td>)}</tr>
                </tbody>
              </table>
            </section>
          );
        })}
        <p className="text-xs text-muted">Bu şirketin gelir / gideri finans kategorilerinden, nakit kasa + banka bakiyelerinden, alacak / borç cari bakiyelerinden gelir; ay sonu kuruyla çevrilir. Grup şirketi işaretli carilerle yapılan işlemler ve bakiyeler elenir.</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Grup şirketleri (ERP dışında)">
            <ul className="divide-y divide-[#EEF2F6] text-sm">{entities.map((en) => <li key={en.id} className="py-1.5 flex gap-2"><b className="flex-1">{en.name}</b><span className="text-muted">{en.country ?? ""} · {en.currency}</span></li>)}{entities.length === 0 && <li className="py-2 text-muted">Henüz yok. Örn. Fransa&apos;daki şirket.</li>}</ul>
            {canSet && (
              <form action={saveEntity} className="flex flex-wrap gap-2 items-end">
                <input name="name" required placeholder="Şirket adı" className={`${inp} flex-1 min-w-[160px]`} />
                <input name="country" placeholder="Ülke" className={`${inp} w-24`} />
                <select name="currency" defaultValue="EUR" className={inp}>{["EUR", "TRY", "USD", "GBP", "CHF"].map((x) => <option key={x}>{x}</option>)}</select>
                <select name="party_id" className={`${inp} w-48`}><option value="">Bizdeki cari kartı</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
                <PendingSubmit className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold">Ekle</PendingSubmit>
              </form>
            )}
            <h3 className="font-semibold text-sm mt-2">Grup şirketi olarak işaretli cariler (elenir)</h3>
            <ul className="text-sm flex flex-wrap gap-2">{groupParties.map((p) => <li key={p.id} className="flex items-center gap-1 rounded-full bg-[#EAF2FB] px-3 py-1">{p.name}{canSet && <form action={setGroupParty}><input type="hidden" name="party_id" value={p.id} /><input type="hidden" name="on" value="0" /><button className="text-bad font-bold ml-1">×</button></form>}</li>)}</ul>
            {canSet && <form action={setGroupParty} className="flex gap-2"><select name="party_id" className={`${inp} flex-1`}>{(parties ?? []).filter((p) => !p.group_company).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select><input type="hidden" name="on" value="1" /><PendingSubmit className="h-9 px-3 rounded-[8px] border border-line text-sm font-semibold">İşaretle</PendingSubmit></form>}
          </Card>
          <Card title={`Aylık rakamlar · ${entryPeriod}`} action={<form className="flex gap-1"><input type="month" name="donem" defaultValue={entryPeriod} className={inp} /><input type="hidden" name="bas" value={from} /><input type="hidden" name="bit" value={to} /><input type="hidden" name="para" value={cur} /><button className="h-9 px-2 rounded-[8px] border border-line text-xs font-semibold">Aç</button></form>}>
            {entities.map((en) => {
              const x = (entries ?? []).find((r) => r.entity_id === en.id) as Record<string, number | string | null> | undefined;
              const v = (k: string) => (x && x[k] ? String(Number(x[k]) / 100).replace(".", ",") : "");
              return (
                <form key={en.id} action={saveEntry} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end border-t border-line pt-3 first:border-0 first:pt-0">
                  <input type="hidden" name="entity_id" value={en.id} /><input type="hidden" name="period" value={entryPeriod} />
                  <b className="col-span-2 sm:col-span-5 text-sm">{en.name} ({en.currency})</b>
                  {[["revenue", "Gelir"], ["expense", "Gider"], ["cash", "Nakit"], ["receivable", "Alacak"], ["payable", "Borç"], ["ic_revenue", "Grup içi satış"], ["ic_expense", "Grup içi alış"], ["ic_receivable", "Grup içi alacak"], ["ic_payable", "Grup içi borç"]].map(([k, l]) => (
                    <label key={k} className="text-[11px] font-semibold text-muted flex flex-col gap-1">{l}<input name={k} defaultValue={v(k)} inputMode="decimal" disabled={!canSet} className={inp} /></label>
                  ))}
                  {canSet && <PendingSubmit className="h-9 px-3 rounded-[8px] bg-brand-700 text-white text-sm font-semibold">Kaydet</PendingSubmit>}
                </form>
              );
            })}
            {entities.length === 0 && <p className="text-sm text-muted">Önce grup şirketi ekleyin.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
