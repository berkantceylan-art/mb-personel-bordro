import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Chip, Money, btnPrimary, btnSecondary, inputCls, page, selectCls } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession, formatDate } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { today } from "@/lib/fin";
import { chequeAction, chequeUndo } from "@/lib/fin2-actions";
import { CHEQUE_ACTION, CHEQUE_STATUS } from "@/lib/fin2";

export const dynamic = "force-dynamic";

/** Çek / senet kartı: durum işlemleri ve geçmiş */
export default async function ChequePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const lvl = s.modules.finance ?? 0;
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase.from("fin_cheques").select("*, party:fin_parties!fin_cheques_party_id_fkey(id, name), endorsed:fin_parties!fin_cheques_endorsed_party_id_fkey(id, name), bank:fin_accounts!fin_cheques_bank_account_id_fkey(name)").eq("id", id).maybeSingle();
  if (!data) notFound();
  const c = data as { id: string; direction: string; doc_type: string; serial_no: string | null; bank_name: string | null; branch: string | null; account_no: string | null; drawer: string | null; drawer_tax_no: string | null; amount: number; currency: string; issue_date: string | null; due_date: string; status: string; note: string | null; party: { id: string; name: string } | null; endorsed: { id: string; name: string } | null; bank: { name: string } | null };
  const [{ data: events }, { data: banks }, { data: parties }] = await Promise.all([
    supabase.from("fin_cheque_events").select("id, event_date, action, new_status, note, txn_id, fin_parties(name), fin_accounts(name)").eq("cheque_id", id).order("id"),
    supabase.from("fin_accounts").select("id, name, currency, kind").in("kind", ["bank", "pos", "cash"]).eq("is_active", true).order("name"),
    supabase.from("fin_parties").select("id, name, currency").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
  ]);
  const ev = (events ?? []) as unknown as { id: number; event_date: string; action: string; new_status: string; note: string | null; fin_parties: { name: string } | null; fin_accounts: { name: string } | null }[];
  const bankOpts = (banks ?? []) as { id: string; name: string; currency: string; kind: string }[];
  const can = lvl >= 2;
  const form = (action: string, label: string, opts: { bank?: boolean; party?: boolean; primary?: boolean; confirm?: string } = {}) => (
    <form action={chequeAction} className="bg-white border border-line rounded-[14px] p-3 flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={c.id} /><input type="hidden" name="action" value={action} />
      {opts.bank && <select name="account_id" defaultValue="" required={action !== "collect" || !c.bank} className={`${selectCls} h-10 w-56`} aria-label="Hesap"><option value="">{action === "collect" && c.bank ? `Tahsil bankası: ${c.bank.name}` : "Hesap seçin"}</option>{bankOpts.filter((b) => action === "pay" ? b.kind !== "pos" : true).map((b) => <option key={b.id} value={b.id}>{b.name} ({b.currency})</option>)}</select>}
      {opts.party && <select name="party_id" required className={`${selectCls} h-10 w-56`} aria-label="Ciro edilen"><option value="">Ciro edilecek firma</option>{(parties ?? []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.currency})</option>)}</select>}
      <input type="date" name="date" defaultValue={today()} className={`${inputCls} h-10 w-40`} aria-label="Tarih" />
      <input name="note" placeholder="Not" maxLength={300} className={`${inputCls} h-10 w-48`} />
      {opts.confirm ? <span className={btnSecondary}><ConfirmSubmit label={label} question={opts.confirm} className="font-semibold text-bad" /></span> : <PendingSubmit className={opts.primary ? btnPrimary : btnSecondary}>{label}</PendingSubmit>}
    </form>
  );

  return (
    <>
      <PageHeader title={`${c.direction === "in" ? "Alınan" : "Verilen"} ${c.doc_type === "note" ? "senet" : "çek"} ${c.serial_no ? `#${c.serial_no}` : ""}`} subtitle={`${c.party?.name ?? ""} · vade ${formatDate(c.due_date)}`} actions={<Link href="/finans/cek-senet" className="text-sm font-semibold text-brand-700">← Çek ve senet</Link>} />
      <div className={page}>
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <section className="bg-white border border-line rounded-[14px] p-4 grid gap-2 sm:grid-cols-2 text-sm">
            <Info k="Cari" v={c.party ? <Link href={`/finans/cariler/${c.party.id}`} className="text-brand-700 font-semibold">{c.party.name}</Link> : "—"} />
            <Info k="Keşideci" v={`${c.drawer ?? "—"}${c.drawer_tax_no ? ` · ${c.drawer_tax_no}` : ""}`} />
            <Info k="Banka / şube" v={[c.bank_name, c.branch].filter(Boolean).join(" · ") || "—"} />
            <Info k="Hesap no" v={c.account_no ?? "—"} />
            <Info k="Keşide tarihi" v={c.issue_date ? formatDate(c.issue_date) : "—"} />
            <Info k="Vade" v={formatDate(c.due_date)} />
            {c.endorsed && <Info k="Ciro edilen" v={<Link href={`/finans/cariler/${c.endorsed.id}`} className="text-brand-700">{c.endorsed.name}</Link>} />}
            {c.bank && <Info k={c.direction === "in" ? "Tahsil bankası" : "Ödeme bankası"} v={c.bank.name} />}
            {c.note && <Info k="Not" v={c.note} />}
          </section>
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 items-start">
            <span className="text-xs text-muted">Tutar</span>
            <span className="font-display text-3xl font-bold"><Money v={c.amount} cur={c.currency} /></span>
            <Chip tone={CHEQUE_STATUS[c.status]?.[1]}>{CHEQUE_STATUS[c.status]?.[0]}</Chip>
          </section>
        </div>

        {can && (
          <div className="grid gap-2">
            {c.direction === "in" && c.status === "portfolio" && <>{form("deposit", "Tahsile ver", { bank: true })}{form("collect", "Tahsil edildi", { bank: true, primary: true })}{form("endorse", "Ciro et", { party: true })}{form("return", "Müşteriye iade et", { confirm: "Çek iade edilsin mi? Tutar müşterinin borcuna geri yazılır." })}{form("bounce", "Karşılıksız", { confirm: "Karşılıksız olarak işlensin mi?" })}</>}
            {c.direction === "in" && c.status === "deposited" && <>{form("collect", "Tahsil edildi", { bank: true, primary: true })}{form("bounce", "Karşılıksız", { confirm: "Karşılıksız olarak işlensin mi?" })}</>}
            {c.direction === "in" && c.status === "endorsed" && form("bounce", "Karşılıksız döndü", { confirm: "Ciro edilen firma çeki geri getirdi mi? Firmaya borç ve müşteriden alacak yeniden yazılır." })}
            {c.direction === "out" && c.status === "issued" && <>{form("pay", "Ödendi", { bank: true, primary: true })}{form("cancel", "Geri alındı / iptal", { confirm: "Çek geri alındı mı? Firmaya borç yeniden yazılır." })}</>}
          </div>
        )}

        <section className="bg-white border border-line rounded-[14px] p-4">
          <h2 className="font-semibold mb-2">Geçmiş</h2>
          <ol className="flex flex-col gap-2 text-sm">
            {ev.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3 gap-y-0.5 border-l-2 border-brand-600 pl-3">
                <span className="text-muted num">{formatDate(e.event_date)}</span>
                <b>{CHEQUE_ACTION[e.action] ?? e.action}</b>
                {e.fin_parties && <span>{e.fin_parties.name}</span>}
                {e.fin_accounts && <span>{e.fin_accounts.name}</span>}
                {e.note && <span className="text-muted">{e.note}</span>}
              </li>
            ))}
          </ol>
          {lvl >= 3 && ev.length > 0 && (
            <form action={chequeUndo} className="mt-3">
              <input type="hidden" name="id" value={c.id} />
              <ConfirmSubmit label={ev.length === 1 ? "Kaydı sil (geri al)" : `Son işlemi geri al (${CHEQUE_ACTION[ev[ev.length - 1].action]})`} question="Son işlem ve finans kaydı geri alınsın mı?" />
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><span className="block text-xs text-muted">{k}</span><span>{v}</span></div>;
}
