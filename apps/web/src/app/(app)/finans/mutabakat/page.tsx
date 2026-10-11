import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { SITE_URL } from "@/lib/handoff";
import { waLink } from "@/lib/wa";
import { RECON, reconDate, reconLang } from "@/lib/recon-text";
import { cancelReconciliation, createReconciliations } from "@/lib/bank-actions";

export const dynamic = "force-dynamic";

type R = { id: string; party_id: string; book: string; as_of: string; balance: number; currency: string; token: string; status: string; their_balance: number | null; response_note: string | null; responded_name: string | null; responded_at: string | null; created_at: string; fin_parties: { name: string; phone: string | null; email: string | null; lab_customers: { doc_lang: string | null; phone: string | null } | null } | null };
const ST: Record<string, [string, string]> = { sent: ["Yanıt bekleniyor", "bg-warn-bg text-warn"], confirmed: ["Mutabık", "bg-ok-bg text-ok"], disputed: ["İtiraz", "bg-bad-bg text-bad"], cancelled: ["İptal", "bg-[#EEF2F6] text-muted"] };

/** Cari mutabakat: tarih itibarıyla bakiye mektubu, bağlantıyla onay / itiraz */
export default async function ReconPage({ searchParams }: { searchParams: Promise<{ durum?: string; defter?: string }> }) {
  const s = await getSession();
  if ((s.modules.finance ?? 0) < 1 && (s.modules.sales ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const canEdit = (s.modules.finance ?? 0) >= 2 || (s.modules.sales ?? 0) >= 2;
  const book = sp.defter === "internal" ? "internal" : "official";
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const lastMonthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).toISOString().slice(0, 10);
  const supabase = await createClient();
  let q = supabase.from("fin_reconciliations").select("id, party_id, book, as_of, balance, currency, token, status, their_balance, response_note, responded_name, responded_at, created_at, fin_parties(name, phone, email, lab_customers(doc_lang, phone))").order("created_at", { ascending: false }).limit(300);
  if (sp.durum && ST[sp.durum]) q = q.eq("status", sp.durum);
  else q = q.neq("status", "cancelled");
  const [{ data, error }, { data: bal }, { data: ib }] = await Promise.all([
    q,
    supabase.from("fin_party_balances").select("party_id, name, kind, currency, balance").neq("balance", 0).order("name").limit(2000),
    supabase.from("lab_internal_balances").select("customer_id, name, currency, balance").neq("balance", 0).order("name").limit(2000),
  ]);
  const recs = (data ?? []) as unknown as R[];
  let cands: { id: string; name: string; currency: string; balance: number }[] = ((bal ?? []) as { party_id: string; name: string; currency: string; balance: number }[]).map((b) => ({ id: b.party_id, name: b.name, currency: b.currency, balance: Number(b.balance) }));
  if (book === "internal") {
    const ids = ((ib ?? []) as { customer_id: string }[]).map((x) => x.customer_id);
    const { data: pmap } = ids.length ? await supabase.from("fin_parties").select("id, lab_customer_id").in("lab_customer_id", ids) : { data: [] };
    const byCust = new Map((pmap ?? []).map((p) => [p.lab_customer_id as string, p.id as string]));
    cands = ((ib ?? []) as { customer_id: string; name: string; currency: string; balance: number }[]).filter((x) => byCust.has(x.customer_id)).map((x) => ({ id: byCust.get(x.customer_id)!, name: x.name, currency: x.currency, balance: Number(x.balance) }));
  }
  const counts = Object.fromEntries(Object.keys(ST).map((k) => [k, recs.filter((r) => r.status === k).length]));

  return (
    <>
      <PageHeader title="Cari mutabakat" subtitle="Seçtiğiniz tarih itibarıyla bakiye mektubu hazırlanır; cari bağlantıdan ya da portaldan 'mutabıkız / değiliz' der, yanıt bildirim olarak gelir" actions={<Link href="/finans/cariler" className="text-sm font-semibold text-brand-700">Cariler</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261225000000_bank_recon.sql çalıştırılmalı.</Notice>}
        <div className="flex flex-wrap gap-2">
          <Link href="/finans/mutabakat" className={`h-9 px-3 inline-flex items-center rounded-[10px] text-sm font-semibold ${!sp.durum ? "bg-ink text-white" : "border border-line"}`}>Tümü</Link>
          {Object.entries(ST).filter(([k]) => k !== "cancelled").map(([k, [l]]) => <Link key={k} href={`/finans/mutabakat?durum=${k}`} className={`h-9 px-3 inline-flex items-center rounded-[10px] text-sm font-semibold ${sp.durum === k ? "bg-ink text-white" : "border border-line"}`}>{l}{!sp.durum && counts[k] ? ` (${counts[k]})` : ""}</Link>)}
        </div>
        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[980px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Cari</th><th className="p-3">Tarih</th><th className="p-3 text-right">Bakiye</th><th className="p-3">Durum</th><th className="p-3">Yanıt</th><th className="p-3">Gönder</th><th className="p-3"></th></tr></thead>
            <tbody>
              {recs.map((r) => {
                const lang = reconLang(r.fin_parties?.lab_customers?.doc_lang);
                const link = `${SITE_URL}/${lang}/mutabakat/${r.token}`;
                const wa = waLink(r.fin_parties?.phone ?? r.fin_parties?.lab_customers?.phone, RECON[lang].wa(r.fin_parties?.name ?? "", reconDate(r.as_of, lang), link));
                const mail = r.fin_parties?.email ? `mailto:${r.fin_parties.email}?subject=${encodeURIComponent(RECON[lang].title)}&body=${encodeURIComponent(RECON[lang].wa(r.fin_parties.name, reconDate(r.as_of, lang), link))}` : null;
                return (
                  <tr key={r.id} className="border-t border-[#EEF2F6] align-top">
                    <td className="p-3"><Link href={`/finans/cariler/${r.party_id}`} className="font-semibold text-brand-700">{r.fin_parties?.name}</Link>{r.book === "internal" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-[#FFF8E6] text-warn font-semibold">iç cari</span>}</td>
                    <td className="p-3 whitespace-nowrap">{formatDate(r.as_of)}</td>
                    <td className="p-3 text-right num whitespace-nowrap">{fmt(r.balance, r.currency)}</td>
                    <td className="p-3"><span className={`px-2 py-0.5 rounded-md text-xs font-semibold ${ST[r.status]?.[1]}`}>{ST[r.status]?.[0]}</span></td>
                    <td className="p-3 text-xs max-w-[240px]">{r.responded_at ? <>{r.responded_name} · {formatDate(r.responded_at.slice(0, 10))}{r.their_balance !== null && <div>Onların bakiyesi: <b>{fmt(r.their_balance, r.currency)}</b></div>}{r.response_note && <div className="text-muted">{r.response_note}</div>}</> : "—"}</td>
                    <td className="p-3 text-xs whitespace-nowrap">{r.status === "sent" ? <span className="flex flex-col gap-1">{wa && <a href={wa} target="_blank" rel="noreferrer" className="font-semibold text-[#128C7E]">WhatsApp</a>}{mail && <a href={mail} className="font-semibold text-brand-700">E-posta</a>}<a href={link} target="_blank" rel="noreferrer" className="text-brand-700">Bağlantı</a></span> : null}</td>
                    <td className="p-3 text-xs whitespace-nowrap"><Link href={`/yazdir/mutabakat/${r.id}`} className="font-semibold text-brand-700">Yazdır</Link>{canEdit && r.status === "sent" && <form action={cancelReconciliation} className="mt-1"><input type="hidden" name="id" value={r.id} /><ConfirmSubmit label="İptal" question="Mutabakat iptal edilsin mi? Bağlantı çalışmaz." /></form>}</td>
                  </tr>
                );
              })}
              {recs.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-muted">Mutabakat yok.</td></tr>}
            </tbody>
          </table>
        </section>

        {canEdit && (
          <Card title="Yeni mutabakat" action={<span className="flex gap-1 text-sm">{[["official", "Resmi cari"], ["internal", "İç cari (irsaliyeli)"]].map(([k, l]) => <Link key={k} href={`/finans/mutabakat?defter=${k}`} className={`h-8 px-3 inline-flex items-center rounded-[8px] font-semibold ${book === k ? "bg-brand-700 text-white" : "border border-line"}`}>{l}</Link>)}</span>}>
            <form action={createReconciliations} className="flex flex-col gap-3">
              <input type="hidden" name="book" value={book} />
              <label className="text-xs font-semibold text-muted flex items-center gap-2">Tarih itibarıyla<input type="date" name="as_of" defaultValue={lastMonthEnd} max={now.toISOString().slice(0, 10)} required className="h-10 rounded-[10px] border border-line px-3 text-sm" /><span className="font-normal">(bakiyeler bu tarihe göre hesaplanır; aşağıdaki liste bugünkü bakiyedir)</span></label>
              <div className="max-h-80 overflow-y-auto rounded-[12px] border border-line divide-y divide-[#EEF2F6]">
                {cands.map((c) => (
                  <label key={c.id} className="flex items-center gap-3 px-3 py-1.5 text-sm"><input type="checkbox" name="party" value={c.id} defaultChecked /><span className="flex-1">{c.name}</span><span className={`num ${c.balance < 0 ? "text-bad" : ""}`}>{fmt(c.balance, c.currency)}</span></label>
                ))}
                {cands.length === 0 && <p className="p-3 text-sm text-muted">Bakiyesi olan cari yok.</p>}
              </div>
              <div><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Seçilenler için mutabakat hazırla</PendingSubmit></div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
