import Link from "next/link";
import { Card } from "@/components/ui";
import { Notice, td, tdNum, th } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { fmt } from "@/lib/fin";
import { RpcError, type TabProps } from "./shared";

type Row = { party_id: string; party: string; tax_no: string | null; country: string | null; docs: number; amount: number };
type BaBs = { limit: number; ba: Row[]; bs: Row[] };

/** Cari mutabakat: aylık alış / satış toplamları (eski Form Ba / Bs dökümü) */
export async function ReconTab({ month }: TabProps) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_babs", { p_month: month });
  if (error) return <RpcError message={error.message} file="20270208000000_gl_close.sql" />;
  const b = data as BaBs;
  const T = ({ rows, title }: { rows: Row[]; title: string }) => (
    <Card title={`${title} · ${rows.length} cari`}>
      <div className="overflow-x-auto"><table className="w-full text-sm min-w-[640px]">
        <thead><tr className="text-xs text-muted"><th className={th}>Cari</th><th className={th}>VKN / TCKN</th><th className={th}>Ülke</th><th className={`${th} text-right`}>Belge sayısı</th><th className={`${th} text-right`}>KDV hariç tutar</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.party_id}><td className={td}><Link href={`/finans/cariler/${r.party_id}`} className="text-brand-700">{r.party}</Link></td><td className={`${td} num ${r.tax_no ? "" : "text-bad"}`}>{r.tax_no ?? "eksik"}</td><td className={td}>{r.country}</td><td className={tdNum}>{r.docs}</td><td className={tdNum}>{fmt(r.amount)}</td></tr>)}
          {!rows.length && <tr><td colSpan={5} className="py-6 text-center text-muted">Sınırı aşan cari yok.</td></tr>}</tbody>
      </table></div>
    </Card>
  );
  return (
    <>
      <Notice tone="info">Form Ba ve Form Bs bildirimleri Eylül 2024 döneminden itibaren kaldırıldı (VUK Genel Tebliği Sıra No 565); beyan edilmez. Bu döküm müşteri ve tedarikçilerle aylık mutabakat için tutuluyor. Sınır: {fmt(b.limit)} (KDV hariç, aynı cariyle aylık toplam; Genel muhasebe ayarlarından değiştirilir).</Notice>
      <T rows={b.ba} title="Alışlar (tedarikçiler)" />
      <T rows={b.bs} title="Satışlar (müşteriler)" />
    </>
  );
}
