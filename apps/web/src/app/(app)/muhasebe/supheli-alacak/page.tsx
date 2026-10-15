import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice, btnSecondary, inputCls, page, selectCls, td, tdNum, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glDoubtfulAdd, glDoubtfulCollect } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Cand = { party_id: string; party: string; code: string; balance: number; last_collection: string | null; open: boolean };
type Row = { id: string; party_id: string; party: string; doubt_date: string; amount: number; reason: string; note: string | null; collected: number; status: string };
const REASON: Record<string, string> = { dava: "Dava açıldı", icra: "İcra takibi", protesto: "Protesto", diger: "Diğer" };

/** Şüpheli ticari alacaklar: aday cariler, karşılık fişi, tahsilatta karşılık iptali */
export default async function Doubtful() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const today = todayIso();
  const supabase = await createClient();
  const [c, l] = await Promise.all([supabase.rpc("gl_doubtful_candidates", { p_date: today }), supabase.rpc("gl_doubtful_list")]);
  const err = c.error ?? l.error;
  const cands = (c.data ?? []) as Cand[];
  const rows = (l.data ?? []) as Row[];
  const canEdit = (s.modules.ledger ?? 0) >= 2;
  return (
    <>
      <PageHeader title="Şüpheli alacaklar" subtitle="Dava veya icra safhasındaki alacaklar için karşılık (VUK 323)" actions={<Link href="/muhasebe/donem-sonu" className="text-sm font-semibold text-brand-700">Dönem sonu işlemleri</Link>} />
      <div className={page}>
        {err && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(err.message) ? "Supabase'de 20270216000000_provisions.sql çalıştırılmalı." : glError(err.message)}</Notice>}
        <Notice tone="info">Vergi açısından karşılık ayrılabilmesi için alacağın dava veya icra safhasında olması (ya da yargıya intikali değmeyecek kadar küçük ve takip edilmesine rağmen tahsil edilememesi) gerekir. Kayıt: 128 Şüpheli alacak / 120 ve 654 Karşılık gideri / 129. Tahsil edilince karşılık 644 ile iptal edilir.</Notice>
        <Card title={`Şüpheli alacak kayıtları · ${rows.length}`}>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Cari</th><th className={th}>Tarih</th><th className={th}>Neden</th><th className={`${th} text-right`}>Tutar</th><th className={`${th} text-right`}>Tahsil edilen</th><th className={th}>Durum</th>{canEdit && <th className={th}>Tahsilat</th>}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td}><Link href={`/finans/cariler/${r.party_id}`} className="text-brand-700">{r.party}</Link>{r.note ? <div className="text-xs text-muted">{r.note}</div> : null}</td>
                  <td className={td}>{formatDate(r.doubt_date)}</td><td className={td}>{REASON[r.reason] ?? r.reason}</td>
                  <td className={tdNum}>{fmt(r.amount)}</td><td className={tdNum}>{fmt(r.collected)}</td><td className={td}>{r.status === "open" ? "Açık" : "Kapandı"}</td>
                  {canEdit && <td className={td}>{r.status === "open" && <form action={glDoubtfulCollect} className="flex gap-1"><input type="hidden" name="id" value={r.id} /><input name="amount" inputMode="decimal" placeholder="tutar" className={`${inputCls} h-9 w-28`} /><input type="date" name="date" defaultValue={today} className={`${inputCls} h-9 w-36`} /><PendingSubmit className={`${btnSecondary} h-9`}>İşle</PendingSubmit></form>}</td>}
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={7} className="py-6 text-center text-muted">Kayıt yok.</td></tr>}
            </tbody>
          </table></div>
        </Card>
        <Card title="Adaylar · son 6 ayda tahsilat yapılmayan borçlu müşteriler">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-xs text-muted"><th className={th}>Cari</th><th className={th}>Hesap</th><th className={th}>Son tahsilat</th><th className={`${th} text-right`}>Bakiye</th>{canEdit && <th className={th}>Şüpheliye aktar</th>}</tr></thead>
            <tbody>
              {cands.map((x) => (
                <tr key={x.party_id}>
                  <td className={td}><Link href={`/finans/cariler/${x.party_id}`} className="text-brand-700">{x.party}</Link>{x.open ? <span className="text-xs text-muted"> · kaydı var</span> : null}</td>
                  <td className={`${td} num`}>{x.code}</td><td className={td}>{x.last_collection ? formatDate(x.last_collection) : "hiç"}</td><td className={tdNum}>{fmt(x.balance)}</td>
                  {canEdit && <td className={td}><form action={glDoubtfulAdd} className="flex flex-wrap gap-1"><input type="hidden" name="party_id" value={x.party_id} />
                    <input name="amount" inputMode="decimal" defaultValue={(x.balance / 100).toFixed(2).replace(".", ",")} className={`${inputCls} h-9 w-28`} />
                    <select name="reason" className={`${selectCls} h-9 w-32`}>{Object.entries(REASON).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input type="date" name="date" defaultValue={today} className={`${inputCls} h-9 w-36`} />
                    <PendingSubmit className={`${btnSecondary} h-9`}>Aktar</PendingSubmit></form></td>}
                </tr>
              ))}
              {!cands.length && <tr><td colSpan={5} className="py-6 text-center text-muted">Aday yok.</td></tr>}
            </tbody>
          </table></div>
        </Card>
      </div>
    </>
  );
}
