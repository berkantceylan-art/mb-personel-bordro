import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { DEFAULT_MAIL_QUERY } from "@/lib/einv";
import { einvElogoSettings, einvElogoSync, einvElogoTest, einvScanMail, einvSetStatus, einvSettings, einvToReceipt } from "@/lib/einv-actions";
import { elogoConfigured } from "@/lib/elogo";
import { UploadBox } from "./_parts/UploadBox";

export const dynamic = "force-dynamic";

type Row = {
  id: string; ettn: string; doc_kind: "efatura" | "earsiv" | "eirsaliye"; doc_no: string | null; issue_date: string | null; profile: string | null; type_code: string | null;
  sender_vkn: string | null; sender_name: string | null; currency: string; payable: number | null; vat_total: number | null; line_count: number | null; source: string;
  direction?: "in" | "out"; received_at: string; note: string | null; status: "new" | "imported" | "ignored" | "rejected"; invoice_id: string | null; receipt_id: string | null; receipt_status: string | null;
  party_id: string | null; response_due: string | null;
};
type Counts = { new: number; imported: number; ignored: number; due_soon: number; new_efatura: number; new_earsiv: number; new_eirsaliye: number; out_total: number; out_new: number };

const KIND: Record<string, [string, string]> = { efatura: ["e-Fatura", "bg-[#EEF3F9] text-brand-700"], earsiv: ["e-Arşiv", "bg-[#F3EEF9] text-[#5B3A8C]"], eirsaliye: ["e-İrsaliye", "bg-[#EEF7F1] text-[#1A7F52]"] };
const TABS: Array<[string, string]> = [["new", "Bekleyen"], ["imported", "Aktarılan"], ["ignored", "Yok sayılan / reddedilen"], ["all", "Tümü"]];
const SRC: Record<string, string> = { upload: "Yükleme", email: "E-posta", api: "eLogo" };

/** Gelen e-belgeler: eLogo üzerinden gelen e-fatura, e-arşiv fatura ve e-irsaliye; alış faturasına / mal kabule aktarma */
export default async function Inbox({ searchParams }: { searchParams: Promise<{ durum?: string; tur?: string; yon?: string }> }) {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 1 && (s.modules.ledger ?? 0) < 1) redirect("/");
  const can = (s.modules.purchases ?? 0) >= 2;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.durum) ? sp.durum! : "new";
  const kind = ["efatura", "earsiv", "eirsaliye"].includes(sp.tur ?? "") ? sp.tur! : null;
  const dir = sp.yon === "out" ? "out" : "in";
  const supabase = await createClient();
  const [{ data, error }, { data: cnt }, { data: set }, { data: accs }] = await Promise.all([
    supabase.rpc("einv_inbox_list", { p_status: tab, p_kind: kind, p_limit: 300, p_dir: dir }),
    supabase.rpc("einv_inbox_counts"),
    supabase.from("einv_settings").select("mail_account_id, mail_query, last_scan_at, last_scan, elogo_enabled, elogo_from, elogo_last_sync, elogo_log").maybeSingle(),
    supabase.from("mail_accounts").select("id, email").order("email"),
  ]);
  const rows = (data ?? []) as Row[];
  const c = (cnt ?? null) as Counts | null;
  const q = (o: Record<string, string | null>) => { const u = new URLSearchParams(); const v = { yon: dir === "out" ? "out" : null, durum: tab, tur: kind, ...o }; for (const [k, x] of Object.entries(v)) if (x) u.set(k, x); return `/alis/gelen-efatura?${u}`; };
  const invoiceIds = rows.filter((r) => r.doc_kind !== "eirsaliye" && r.status === "new").map((r) => r.id);
  const elogo = elogoConfigured();
  const elog = (set?.elogo_log ?? null) as { added?: number; fetched?: number; errors?: number; error?: string; ops?: string[]; types?: Record<string, Record<string, unknown>> } | null;
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="e-Belgeler (eLogo)" subtitle="Gelen ve giden e-fatura, e-arşiv fatura ve e-irsaliyeler: alış / satış faturasına ya da mal kabule tek tıkla" actions={<Link href="/alis/ice-aktar" className="text-sm font-semibold text-brand-700">e-Fatura içe aktar</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270225000000_einv_inbox.sql çalıştırılmalı." : error.message}</Notice>}
        {c && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="Bekleyen e-fatura" value={String(c.new_efatura)} tone={c.new_efatura ? "bad" : "ok"} href={q({ durum: "new", tur: "efatura" })} />
            <KPI label="Bekleyen e-arşiv" value={String(c.new_earsiv)} tone={c.new_earsiv ? "bad" : undefined} href={q({ durum: "new", tur: "earsiv" })} />
            <KPI label="Bekleyen e-irsaliye" value={String(c.new_eirsaliye)} tone={c.new_eirsaliye ? "bad" : undefined} href={q({ durum: "new", tur: "eirsaliye" })} sub="mal kabul bekliyor" />
            <KPI label="Kabul / red süresi doluyor" value={String(c.due_soon)} tone={c.due_soon ? "bad" : "ok"} sub="ticari fatura · 8 gün" />
          </div>
        )}

        {can && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2"><b>eLogo otomatik eşitleme</b>
              <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${elogo ? "bg-[#E6F4EC] text-[#1A7F52]" : "bg-[#FFF4E0] text-[#7A4F00]"}`}>{elogo ? "kullanıcı tanımlı" : "kullanıcı tanımlı değil"}</span>
              {set?.elogo_last_sync && <span className="text-xs text-muted">Son eşitleme {new Date(set.elogo_last_sync).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}{elog?.error ? ` · hata: ${elog.error}` : elog?.fetched != null ? ` · ${elog.fetched} belge, ${elog.added ?? 0} yeni` : ""}</span>}
            </div>
            {!elogo && <p className="text-xs text-muted">Gelen ve giden e-fatura, e-arşiv ve e-irsaliyeler her saat eLogo&apos;dan kendiliğinden çekilir. Bunun için eLogo&apos;dan bir web servis kullanıcısı alıp Vercel&apos;e <b>ELOGO_USER</b> ve <b>ELOGO_PASS</b> olarak ekleyin (demo hesabı için ayrıca ELOGO_TEST=1).</p>}
            {elogo && (
              <form action={einvElogoSettings} className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2"><input type="checkbox" name="enabled" defaultChecked={!!set?.elogo_enabled} />Saatlik eşitleme açık</label>
                <label className="flex items-center gap-2 text-xs">Geçmiş başlangıcı<input type="date" name="from" defaultValue={set?.elogo_from ?? ""} className={`${inputCls} h-9 w-40`} /></label>
                <PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit>
                <button formAction={einvElogoTest} className={btnSecondary}>Bağlantıyı test et</button>
                <button formAction={einvElogoSync} className={btnSecondary}>Son 7 günü çek</button>
                {set?.elogo_from && <button formAction={einvElogoSync} name="all" value="1" className={btnSecondary}>Başlangıçtan bugüne çek</button>}
              </form>
            )}
            {elog?.types && <details className="text-xs text-muted"><summary className="cursor-pointer">Son eşitleme ayrıntısı</summary><pre className="whitespace-pre-wrap">{JSON.stringify({ metotlar: elog.ops, turler: elog.types }, null, 1)}</pre></details>}
          </section>
        )}

        {can && (
          <div className="grid gap-3 lg:grid-cols-2">
            <UploadBox />
            <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2 text-sm">
              <b>E-postadan otomatik al</b>
              <p className="text-muted text-xs">eLogo bildirim e-postalarındaki XML / ZIP ekleri her sabah taranır. İsterseniz şimdi de tarayabilirsiniz.</p>
              <form action={einvSettings} className="flex flex-col gap-2">
                <select name="account" defaultValue={set?.mail_account_id ?? ""} className={inputCls}>
                  <option value="">— Taranacak Gmail hesabı —</option>
                  {((accs ?? []) as Array<{ id: string; email: string }>).map((a) => <option key={a.id} value={a.id}>{a.email}</option>)}
                  {set?.mail_account_id && !(accs ?? []).some((a) => a.id === set.mail_account_id) && <option value={set.mail_account_id}>Başka kullanıcının hesabı (kayıtlı)</option>}
                </select>
                <input name="query" defaultValue={set?.mail_query ?? ""} placeholder={DEFAULT_MAIL_QUERY} className={`${inputCls} text-xs`} />
                <div className="flex flex-wrap gap-2 items-center"><PendingSubmit className={btnSecondary}>Kaydet</PendingSubmit>
                  {set?.mail_account_id && <button formAction={einvScanMail} className={btnSecondary}>Şimdi tara</button>}
                  {set?.last_scan_at && <span className="text-xs text-muted">Son tarama {new Date(set.last_scan_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</span>}
                </div>
              </form>
            </section>
          </div>
        )}

        <div className="flex flex-wrap gap-2 text-sm">
          {([["in", "Gelen belgeler"], ["out", "Giden belgeler"]] as const).map(([k, l]) => <Link key={k} href={`/alis/gelen-efatura${k === "out" ? "?yon=out" : ""}`} className={`rounded-[10px] border px-4 py-2 font-semibold ${dir === k ? "border-brand-700 bg-[#EEF4FB] text-brand-700" : "border-line bg-white"}`}>{l}{k === "out" && c?.out_new ? ` · ${c.out_new} ERP'de yok` : ""}</Link>)}
        </div>
        <div className="flex flex-wrap gap-2 text-sm items-center">
          {TABS.map(([k, l]) => <Link key={k} href={q({ durum: k })} className={`rounded-full px-3 py-1.5 font-semibold ${k === tab ? "bg-brand-700 text-white" : "bg-[#F2F4F7]"}`}>{l}{k === "new" && c ? ` · ${c.new}` : ""}</Link>)}
          <span className="mx-1 text-muted">|</span>
          {[[null, "Hepsi"], ["efatura", "e-Fatura"], ["earsiv", "e-Arşiv"], ["eirsaliye", "e-İrsaliye"]].map(([k, l]) => <Link key={l} href={q({ tur: k })} className={`rounded-full px-3 py-1.5 font-semibold ${k === kind ? "bg-ink text-white" : "bg-[#F2F4F7]"}`}>{l}</Link>)}
          {can && tab === "new" && invoiceIds.length > 1 && <Link href={`/alis/ice-aktar?gelen=${invoiceIds.slice(0, 50).join(",")}`} className="ml-auto text-sm font-semibold text-brand-700">Bekleyen faturaların hepsini aktar ({Math.min(invoiceIds.length, 50)}) →</Link>}
        </div>

        <div className="bg-white border border-line rounded-[14px] overflow-x-auto">
          {!rows.length && <p className="p-4 text-sm text-muted">{tab === "new" ? (dir === "out" ? "ERP'de olmayan giden belge yok." : "Bekleyen e-belge yok.") : "Kayıt yok."}</p>}
          {rows.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr><th className={th}>Tür</th><th className={th}>{dir === "out" ? "Alıcı" : "Gönderen"}</th><th className={th}>Belge no</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Tutar</th><th className={th}>Durum</th><th className={th}></th></tr></thead>
              <tbody>
                {rows.map((r) => {
                  const late = r.response_due && r.status === "new" && r.response_due <= today;
                  return (
                    <tr key={r.id}>
                      <td className={td}><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND[r.doc_kind]![1]}`}>{KIND[r.doc_kind]![0]}</span><div className="text-[11px] text-muted mt-1">{r.profile}{r.type_code && r.type_code !== "SATIS" && r.type_code !== "SEVK" ? ` · ${r.type_code}` : ""}</div></td>
                      <td className={td}>{r.party_id ? <Link href={`/finans/cariler/${r.party_id}`} className="hover:text-brand-700">{r.sender_name}</Link> : r.sender_name}<div className="text-[11px] text-muted num">{r.sender_vkn ?? ""}{!r.party_id && " · yeni cari"}</div></td>
                      <td className={`${td} num`}>{r.doc_no}<div className="text-[11px] text-muted">{SRC[r.source] ?? r.source}{r.line_count ? ` · ${r.line_count} kalem` : ""}</div></td>
                      <td className={`${td} whitespace-nowrap`}>{r.issue_date ? formatDate(r.issue_date) : "—"}{r.response_due && r.status === "new" && <div className={`text-[11px] ${late ? "text-bad font-semibold" : "text-muted"}`}>kabul/red: {formatDate(r.response_due)}</div>}</td>
                      <td className={tdNum}>{r.doc_kind === "eirsaliye" ? "—" : fmt(r.payable ?? 0, r.currency)}</td>
                      <td className={td}>
                        {r.status === "imported" ? (r.invoice_id ? <Link href={`/fatura/${r.invoice_id}`} className="text-[#1A7F52] font-semibold">{dir === "out" ? "Satışta kayıtlı" : "Alışa aktarıldı"}</Link> : <Link href={`/stok/mal-kabul/${r.receipt_id}`} className="text-[#1A7F52] font-semibold">Mal kabul {r.receipt_status === "confirmed" ? "onaylandı" : "açık"}</Link>)
                          : r.status === "new" ? <span className="text-[#7A4F00]">Bekliyor</span> : <span className="text-muted">{r.status === "rejected" ? "Reddedildi" : "Yok sayıldı"}{r.note ? ` · ${r.note}` : ""}</span>}
                      </td>
                      <td className={`${td} whitespace-nowrap`}>
                        <div className="flex flex-wrap gap-3 items-center text-xs font-semibold">
                          {can && r.status === "new" && r.doc_kind !== "eirsaliye" && <Link href={`/alis/ice-aktar?gelen=${r.id}`} className="text-brand-700">{dir === "out" ? "Satışa aktar →" : "Alışa aktar →"}</Link>}
                          {r.status === "new" && r.doc_kind === "eirsaliye" && dir === "in" && (s.modules.stock ?? 0) >= 2 && <form action={einvToReceipt}><input type="hidden" name="id" value={r.id} /><PendingSubmit className="text-brand-700">Mal kabul aç →</PendingSubmit></form>}
                          <a href={`/alis/gelen-efatura/xml?id=${r.id}`} className="text-muted">XML</a>
                          {can && r.status === "new" && <form action={einvSetStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="ignored" /><PendingSubmit className="text-muted">Yok say</PendingSubmit></form>}
                          {can && r.status === "new" && r.response_due && dir === "in" && <form action={einvSetStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="rejected" /><PendingSubmit className="text-bad">Reddettim</PendingSubmit></form>}
                          {can && (r.status === "ignored" || r.status === "rejected") && <form action={einvSetStatus}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="status" value="new" /><PendingSubmit className="text-brand-700">Geri al</PendingSubmit></form>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-xs text-muted">Ticari faturada (TICARIFATURA) 8 gün içinde eLogo portalından kabul ya da red yanıtı verilmezse fatura kabul edilmiş sayılır. Red ederseniz burada da &quot;Reddettim&quot; deyin. Temel fatura ve e-arşiv faturada yanıt gerekmez.</p>
      </div>
    </>
  );
}
