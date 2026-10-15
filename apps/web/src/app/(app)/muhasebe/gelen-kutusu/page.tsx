import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice, btnPrimary, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { VOUCHER_SOURCE, amt, glError } from "@/lib/gl";
import { glApprove, glApproveGreen, glInboxExclude, glInboxMapCategory, glLineSetAccount, glSetApprovalMode } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Line = { id: string; code: string | null; name: string; debit: number; credit: number; description: string | null; category_id: string | null; category: string | null; ruled: boolean };
type Item = {
  id: string; no: number; year: number; date: string; kind: string; source: string; status: string; conf: "green" | "yellow" | "red" | "manual";
  description: string | null; doc_no: string | null; issues: string | null; total: number;
  txn: { id: string; kind: string; ref_type: string | null; ref_id: string | null; party: string | null } | null; lines: Line[];
};
type Inbox = { counts: { green: number; yellow: number; red: number; manual: number; total: number }; items: Item[] };

const CONF: Record<string, [string, string, string]> = {
  green: ["Kurala uygun", "bg-[#E6F4EC] text-[#1A7F52]", "border-l-[#1A7F52]"],
  yellow: ["Tahmin: kontrol edin", "bg-[#FFF4E0] text-[#7A4F00]", "border-l-[#E0A100]"],
  red: ["Hesap bulunamadı", "bg-[#FDECEC] text-bad", "border-l-[#C62828]"],
  manual: ["Elle / dönem fişi", "bg-[#EEF3F9] text-brand-700", "border-l-brand-600"],
};
const SRC_LINK = (t: Item["txn"]) => (t?.ref_type === "invoice" && t.ref_id ? `/fatura/${t.ref_id}` : t?.ref_type === "loan" ? "/finans/krediler" : t?.ref_type === "depreciation" ? "/demirbas/amortisman" : null);

/** Fiş gelen kutusu: ERP işlemlerinden oluşan taslak fişler, onay, hesap kuralı */
export default async function Inbox({ searchParams }: { searchParams: Promise<{ ay?: string; f?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const month = sp.ay === "tum" ? "tum" : sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : "tum";
  const from = month === "tum" ? "2000-01-01" : `${month}-01`;
  const to = month === "tum" ? "2100-12-31" : new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const filter = ["green", "yellow", "red", "manual"].includes(sp.f ?? "") ? sp.f! : null;
  const supabase = await createClient();
  const [{ data, error }, { data: set }, { data: accs }] = await Promise.all([
    supabase.rpc("gl_inbox", { p_from: from, p_to: to, p_filter: filter, p_limit: 200 }),
    supabase.from("gl_settings").select("approval_mode").maybeSingle(),
    supabase.from("gl_accounts").select("code, name").eq("postable", true).eq("is_active", true).order("code").limit(3000),
  ]);
  const box = (data ?? null) as Inbox | null;
  const approver = (s.modules.ledger ?? 0) >= 3;
  const mode = Boolean((set as { approval_mode?: boolean } | null)?.approval_mode);
  const link = (p: Record<string, string | null>) => { const u = new URLSearchParams(); Object.entries({ ay: month === "tum" ? null : month, f: filter, ...p }).forEach(([k, v]) => v && u.set(k, v)); return `/muhasebe/gelen-kutusu${u.size ? `?${u}` : ""}`; };
  const chip = (on: boolean) => `rounded-full px-3 py-1.5 border text-sm ${on ? "bg-[#EEF3F9] border-brand-600 font-semibold" : "border-line bg-white"}`;
  const thisMonth = now.toISOString().slice(0, 7);
  return (
    <>
      <PageHeader title="Fiş onayı" subtitle="ERP'ye girilen işlemlerden oluşan muhasebe fişleri onayınızı bekliyor; onaylanmadan raporlara ve beyannamelere girmez" actions={<Link href="/muhasebe/eslestirme" className="text-sm font-semibold text-brand-700">Hesap eşleştirme kuralları</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache/.test(error.message) ? "Supabase'de 20270217000000_gl_inbox.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-line bg-white p-3 text-sm">
          <span>Onaylı çalışma: <b className={mode ? "text-ok" : "text-muted"}>{mode ? "açık — tüm fişler onaya düşer" : "kapalı — fişler doğrudan kaydedilir"}</b></span>
          {approver && <form action={glSetApprovalMode} className="ml-auto"><input type="hidden" name="on" value={mode ? "0" : "1"} /><PendingSubmit className="text-sm font-semibold text-brand-700">{mode ? "Kapat" : "Aç"}</PendingSubmit></form>}
          {!approver && <span className="ml-auto text-xs text-muted">Onaylama yetkisi yalnız yönetici ve mali müşavirde.</span>}
        </div>
        {box && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={link({ f: null })} className={chip(!filter)}>Tümü · {box.counts.total}</Link>
              <Link href={link({ f: "green" })} className={chip(filter === "green")}>Kurala uygun · {box.counts.green}</Link>
              <Link href={link({ f: "yellow" })} className={chip(filter === "yellow")}>Kontrol edin · {box.counts.yellow}</Link>
              <Link href={link({ f: "red" })} className={chip(filter === "red")}>Hesap bulunamadı · {box.counts.red}</Link>
              <Link href={link({ f: "manual" })} className={chip(filter === "manual")}>Elle / dönem · {box.counts.manual}</Link>
              <form className="ml-auto flex gap-2"><input type="hidden" name="f" value={filter ?? ""} /><input type="month" name="ay" defaultValue={month === "tum" ? thisMonth : month} className={`${inputCls} w-40 h-10`} /><button className={`${btnSecondary} h-10`}>Ay</button>{month !== "tum" && <Link href={link({ ay: null })} className={`${btnSecondary} h-10`}>Tüm aylar</Link>}</form>
            </div>
            {approver && box.counts.total > 0 && (
              <div className="flex flex-wrap gap-2">
                {box.counts.green + box.counts.manual > 0 && <form action={glApproveGreen}><input type="hidden" name="from" value={from} /><input type="hidden" name="to" value={to} /><PendingSubmit className={btnPrimary}>Kurala uygun ve elle fişlerin hepsini onayla ({box.counts.green + box.counts.manual})</PendingSubmit></form>}
                <form id="approve-sel" action={glApprove}><PendingSubmit className={btnSecondary}>Seçilenleri onayla</PendingSubmit></form>
              </div>
            )}
            <datalist id="gl-accounts">{((accs ?? []) as Array<{ code: string; name: string }>).map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
            <ol className="flex flex-col gap-3">
              {box.items.map((it) => {
                const [cl, ccls, border] = CONF[it.conf] ?? CONF.manual!;
                const src = SRC_LINK(it.txn);
                const cats = [...new Map(it.lines.filter((l) => l.category_id).map((l) => [l.category_id!, l])).values()];
                return (
                  <li key={it.id} className={`bg-white border border-line border-l-4 ${border} rounded-[14px] p-4 flex flex-col gap-3`}>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      {approver && it.status === "draft" && <input type="checkbox" name="ids" value={it.id} form="approve-sel" aria-label="Seç" className="h-4 w-4" />}
                      <span className={`rounded-full px-2 py-0.5 font-semibold ${ccls}`}>{cl}</span>
                      <span className="font-semibold text-brand-700">{formatDate(it.date)}</span>
                      <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5">{VOUCHER_SOURCE[it.source] ?? it.source}</span>
                      <Link href={`/muhasebe/fisler/${it.id}`} className="text-brand-700">Fiş {it.year}/{it.no}</Link>
                      {src && <Link href={src} className="text-brand-700">Kaynağı aç ↗</Link>}
                      {it.txn?.party && <span className="text-muted">· {it.txn.party}</span>}
                    </div>
                    <div className="font-semibold">{it.description ?? "—"}{it.doc_no ? <span className="text-sm font-normal text-muted"> · {it.doc_no}</span> : null}</div>
                    {it.issues && <p className="text-sm text-bad">{it.issues}</p>}
                    <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
                      <thead><tr className="text-xs text-muted"><th className={th}>Hesap</th><th className={th}>Açıklama</th><th className={`${th} text-right`}>Borç</th><th className={`${th} text-right`}>Alacak</th>{approver && it.status === "draft" && <th className={th}>Bu fişte değiştir</th>}</tr></thead>
                      <tbody>{it.lines.map((l) => (
                        <tr key={l.id} className={!l.ruled && it.conf !== "manual" ? "bg-[#FFF8EB]" : ""}>
                          <td className={td}>{l.code ? <span className="num font-semibold">{l.code}</span> : <span className="text-bad font-semibold">?</span>} {l.name}{l.category ? <div className="text-xs text-muted">kategori: {l.category}{!l.ruled ? " · özel kuralı yok" : ""}</div> : null}</td>
                          <td className={`${td} text-xs`}>{l.description}</td>
                          <td className={tdNum}>{l.debit ? amt(l.debit) : ""}</td><td className={tdNum}>{l.credit ? amt(l.credit) : ""}</td>
                          {approver && it.status === "draft" && <td className={td}><form action={glLineSetAccount} className="flex gap-1"><input type="hidden" name="line_id" value={l.id} /><input name="code" list="gl-accounts" placeholder="kod" className={`${inputCls} h-8 w-28`} /><PendingSubmit className="text-xs font-semibold text-brand-700">Değiştir</PendingSubmit></form></td>}
                        </tr>
                      ))}</tbody>
                    </table></div>
                    {approver && cats.some((l) => !l.ruled || it.conf === "red") && (
                      <div className="rounded-[10px] bg-[#F5F7FA] p-3 flex flex-col gap-2 text-sm">
                        <b>Kural olarak kaydet</b>
                        {cats.filter((l) => !l.ruled || it.conf === "red").map((l) => (
                          <form key={l.category_id} action={glInboxMapCategory} className="flex flex-wrap items-center gap-2">
                            <input type="hidden" name="category_id" value={l.category_id!} />
                            <span>&quot;{l.category}&quot; kategorisi bundan sonra hep</span>
                            <input name="code" list="gl-accounts" defaultValue={l.code ?? ""} placeholder="hesap kodu" className={`${inputCls} h-9 w-32`} />
                            <span>hesabına işlensin</span>
                            <PendingSubmit className={`${btnSecondary} h-9`}>Kaydet ve yenile</PendingSubmit>
                          </form>
                        ))}
                        <p className="text-xs text-muted">Kural kaydedilince bekleyen tüm fişler yeniden oluşturulur.</p>
                      </div>
                    )}
                    {it.conf === "red" && !cats.length && <p className="text-sm"><Link href="/muhasebe/eslestirme" className="font-semibold text-brand-700">Eşleştirme ekranında</Link> kasa / banka / cari için hesap tanımlayın.</p>}
                    {approver && (
                      <div className="flex flex-wrap gap-3">
                        {it.status === "draft" && <form action={glApprove}><input type="hidden" name="ids" value={it.id} /><PendingSubmit className={btnPrimary}>Onayla</PendingSubmit></form>}
                        {it.source === "auto" && <form action={glInboxExclude} className="flex items-center gap-2"><input type="hidden" name="id" value={it.id} /><input name="note" placeholder="neden (isteğe bağlı)" className={`${inputCls} h-11 w-52`} /><PendingSubmit className={btnSecondary}>Muhasebe dışı say</PendingSubmit></form>}
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
            {!box.items.length && <Notice tone="ok">Onay bekleyen fiş yok.</Notice>}
            {box.items.length >= 200 && <p className="text-xs text-muted">İlk 200 fiş gösteriliyor; ay seçerek daraltın.</p>}
          </>
        )}
      </div>
    </>
  );
}
