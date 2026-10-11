import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { partyLedger } from "@/lib/fin-data";
import { PARTY_KIND, dateOk, fmt, type Party } from "@/lib/fin";
import { PartyForm } from "../../_parts/PartyForm";
import { DateFilter } from "../../_parts/DateFilter";
import { LedgerTable } from "../../_parts/LedgerTable";

export const dynamic = "force-dynamic";

/** Cari kart ve ekstre */
export default async function PartyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ bas?: string; bit?: string }> }) {
  const s = await getSession();
  if (!["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 1)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.from("fin_parties").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const p = data as Party;
  const from = dateOk(sp.bas);
  const to = dateOk(sp.bit);
  const led = await partyLedger(p, from, to);
  const canPost = (s.modules.finance ?? 0) >= 2;
  const overLimit = p.credit_limit && led.balance > Number(p.credit_limit);
  return (
    <>
      <PageHeader title={p.name} subtitle={`${PARTY_KIND[p.kind]} · ${p.currency}${p.tax_no ? ` · ${p.tax_no}` : ""}`} actions={<Link href="/finans/cariler" className="text-sm font-semibold text-brand-700">← Cariler</Link>} />
      <div className={page}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Bakiye" value={fmt(Math.abs(led.balance), p.currency)} sub={led.balance > 0 ? "bize borçlu" : led.balance < 0 ? "biz borçluyuz" : "kapalı"} tone={led.balance < 0 ? "bad" : undefined} />
          <KPI label="Dönem borç" value={fmt(led.debit, p.currency)} />
          <KPI label="Dönem alacak" value={fmt(led.credit, p.currency)} />
          <KPI label="Risk limiti" value={p.credit_limit ? fmt(p.credit_limit, p.currency) : "—"} sub={overLimit ? "limit aşıldı" : p.payment_term_days ? `${p.payment_term_days} gün vade` : undefined} tone={overLimit ? "bad" : undefined} />
        </div>
        <div className="flex flex-wrap gap-2 text-sm">
          {canPost && [["collection", "Tahsilat"], ["payment", "Ödeme"]].map(([k, l]) => (
            <Link key={k} href={`/finans/islem?tur=${k}&cari=${p.id}&geri=/finans/cariler/${p.id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700 hover:border-brand-600">+ {l}</Link>
          ))}
          {p.lab_customer_id && <Link href={`/isler/hekimler/${p.lab_customer_id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700">Hekim kartı →</Link>}
          {p.phone && <a href={`https://wa.me/${p.phone.replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-ok">WhatsApp</a>}
        </div>
        <DateFilter from={from ?? undefined} to={to ?? undefined} />
        <LedgerTable rows={led.rows} currency={p.currency} canVoid={canPost} total={led} />
        {["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 2) && (
          <Card title="Cari bilgileri"><PartyForm party={p} /></Card>
        )}
      </div>
    </>
  );
}
