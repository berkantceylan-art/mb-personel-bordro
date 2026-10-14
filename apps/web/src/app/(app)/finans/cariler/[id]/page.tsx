import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { KPI, page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { partyLedger } from "@/lib/fin-data";
import { PARTY_KIND, dateOk, fmt, type Party } from "@/lib/fin";
import { PartyForm } from "../../_parts/PartyForm";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { deleteParty, setPartyActive } from "@/lib/fin-actions";
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
  const canEdit = ["finance", "sales", "purchases"].some((m) => (s.modules[m] ?? 0) >= 2);
  const { data: usage, error: usageErr } = canEdit ? await supabase.rpc("fin_party_usage", { p_id: p.id }) : { data: null, error: null };
  const uses = Object.entries((usage ?? {}) as Record<string, number>);
  const deletable = !usageErr && !uses.length && !p.lab_customer_id;
  const { data: twinRow } = await supabase.from("fin_parties").select("id, name").eq(p.slip_of ? "id" : "slip_of", p.slip_of ?? p.id).maybeSingle();
  const pairMain = p.slip_of ?? (twinRow ? p.id : null);
  const overLimit = p.credit_limit && led.balance > Number(p.credit_limit);
  return (
    <>
      <PageHeader title={p.name} subtitle={`${PARTY_KIND[p.kind]} · ${p.currency}${p.tax_no ? ` · ${p.tax_no}` : ""}`} actions={<span className="flex gap-4 text-sm font-semibold">{canEdit && <a href="#duzenle" className="text-brand-700">✎ Düzenle</a>}{canEdit && <a href="#sil" className="text-bad">Sil</a>}<Link href="/finans/cariler" className="text-brand-700">← Cariler</Link></span>} />
      <div className={page}>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <KPI label="Bakiye" value={fmt(Math.abs(led.balance), p.currency)} sub={led.balance > 0 ? "bize borçlu" : led.balance < 0 ? "biz borçluyuz" : "kapalı"} tone={led.balance < 0 ? "bad" : undefined} />
          <KPI label="Dönem borç" value={fmt(led.debit, p.currency)} />
          <KPI label="Dönem alacak" value={fmt(led.credit, p.currency)} />
          <KPI label="Risk limiti" value={p.credit_limit ? fmt(p.credit_limit, p.currency) : "—"} sub={overLimit ? "limit aşıldı" : p.payment_term_days ? `${p.payment_term_days} gün vade` : undefined} tone={overLimit ? "bad" : undefined} />
        </div>
        {twinRow && (
          <Link href={`/finans/fis-cari/${pairMain}`} className={`rounded-[14px] border px-4 py-3 text-sm flex flex-wrap items-center gap-2 ${p.slip_of ? "border-[#FCD34D] bg-[#FFFBEB]" : "border-line bg-white"}`}>
            <span>{p.slip_of ? "📄 Bu, fişli (faturasız) alım carisidir." : "🧾 Bu firmanın ayrıca fişli carisi var."} {p.slip_of ? "Faturalı cari" : "Fişli cari"}: <b>{twinRow.name as string}</b>. Ödeme ve çekler iki cariye de aynı tutarla düşer.</span>
            <span className="ml-auto font-semibold text-brand-700">İki cariyi yan yana gör →</span>
          </Link>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          {canPost && [["collection", "Tahsilat"], ["payment", "Ödeme"]].map(([k, l]) => (
            <Link key={k} href={`/finans/islem?tur=${k}&cari=${p.id}&geri=/finans/cariler/${p.id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700 hover:border-brand-600">+ {l}</Link>
          ))}
          {(s.modules.sales ?? 0) >= 2 && p.kind !== "supplier" && <Link href={`/satis/yeni?cari=${p.id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700 hover:border-brand-600">+ Satış faturası</Link>}
          {(s.modules.purchases ?? 0) >= 2 && p.kind !== "customer" && <Link href={`/alis/yeni?cari=${p.id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700 hover:border-brand-600">+ Alış faturası</Link>}
          {p.lab_customer_id && <Link href={`/isler/hekimler/${p.lab_customer_id}`} className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-brand-700">Hekim kartı →</Link>}
          {p.phone && <a href={`https://wa.me/${p.phone.replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" rel="noreferrer" className="rounded-full border border-line bg-white px-3.5 py-1.5 font-semibold text-ok">WhatsApp</a>}
        </div>
        <DateFilter from={from ?? undefined} to={to ?? undefined} />
        <LedgerTable rows={led.rows} currency={p.currency} canVoid={canPost} total={led} />
        {!p.is_active && <p className="text-sm rounded-[12px] px-4 py-3 bg-[#F1F5F9] text-muted">Bu cari kart pasif: yeni işlemlerde önerilmez, geçmiş kayıtları korunur.</p>}
        {canEdit && (
          <div id="duzenle" className="scroll-mt-20"><Card title="Cari bilgilerini düzenle"><PartyForm party={p} /></Card></div>
        )}
        {canEdit && (
          <div id="sil" className="scroll-mt-20">
            <Card title="Kartı sil / pasife al">
              <div className="flex flex-col gap-3 text-sm">
                {deletable ? (
                  <>
                    <p className="text-muted">Bu cariye bağlı fatura, finans işlemi, çek, sipariş ya da stok kaydı yok; kart kalıcı olarak silinebilir.</p>
                    <form action={deleteParty}><input type="hidden" name="id" value={p.id} /><ConfirmSubmit label="🗑 Cari kartı sil" question={`"${p.name}" kalıcı olarak silinsin mi?`} yes="Evet, sil" className="h-9 px-4 rounded-lg border border-bad text-bad font-semibold" /></form>
                  </>
                ) : (
                  <p className="text-muted">
                    {p.lab_customer_id ? "Bu cari bir hekim / klinik kartına bağlı; silme hekim kartından yapılır." : usageErr ? "Silme kontrolü için Supabase'de 20270128000000_party_delete.sql çalıştırılmalı." : <>Bu cari silinemez, bağlı kayıtları var: <b className="text-ink">{uses.map(([k, n]) => `${k} (${n})`).join(", ")}</b>. Kayıtlar bozulmasın diye kartı pasife alın.</>}
                  </p>
                )}
                <form action={setPartyActive} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={p.id} /><input type="hidden" name="on" value={p.is_active ? "0" : "1"} />
                  <PendingSubmit className="h-9 px-4 rounded-lg border border-[#D5DEE8] font-semibold">{p.is_active ? "⏸ Pasife al" : "▶ Yeniden aktifleştir"}</PendingSubmit>
                  <span className="text-xs text-muted">{p.is_active ? "Kart gizlenir, geçmiş ekstresi ve faturaları korunur." : ""}</span>
                </form>
              </div>
            </Card>
          </div>
        )}
      </div>
    </>
  );
}
