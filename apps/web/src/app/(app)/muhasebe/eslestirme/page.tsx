import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice, page, td, th } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { ACCOUNT_KIND } from "@/lib/fin";
import type { GlAccount } from "@/lib/gl";
import { glRepost, glSaveMap } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Map = { source: string; key: string; account_id: string };
const PARTY_KIND: Record<string, string> = { customer: "Müşteri", supplier: "Tedarikçi", both: "Müşteri + tedarikçi", other: "Diğer" };
const CAT_KIND: Record<string, string> = { income: "Gelir", expense: "Gider", vat_in: "İndirilecek KDV", vat_out: "Hesaplanan KDV", stock: "Stok / varlık", equity: "Özkaynak", other: "Diğer" };
const REF: Array<[string, string]> = [
  ["payroll:exp_salary", "Maaş ödemesi (elden / kasadan)"], ["payroll_bank:exp_salary", "Maaş ödemesi (banka dosyası)"],
  ["payroll_remit:sgk", "SGK prim ödemesi"], ["payroll_remit:vergi", "Muhtasar vergi ödemesi"], ["payroll_remit:bes", "BES kesinti ödemesi"], ["payroll_remit:icra", "İcra / nafaka ödemesi"],
  ["depreciation:fixed_assets", "Amortisman karşılığı (birikmiş amortisman)"], ["export_sales", "Yurt dışı müşteriye satış (600 yerine)"],
];

/** Eşleştirme: ERP kaydı → hesap kodu */
export default async function MapPage() {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: maps, error }, { data: accs }, { data: fa }, { data: cats }] = await Promise.all([
    supabase.from("gl_maps").select("source, key, account_id"),
    supabase.from("gl_accounts").select("id, code, name, link_type, link_id, postable, is_active").order("code").limit(5000),
    supabase.from("fin_accounts").select("id, kind, name, currency, is_active").order("kind").order("name"),
    supabase.from("fin_categories").select("id, code, name, kind, is_active").order("kind").order("sort"),
  ]);
  const A = new Map(((accs ?? []) as GlAccount[]).map((a) => [a.id, a]));
  const M = new Map(((maps ?? []) as Map[]).map((m) => [`${m.source}|${m.key}`, A.get(m.account_id)]));
  const linked = new Map(((accs ?? []) as GlAccount[]).filter((a) => a.link_type === "fin_account").map((a) => [a.link_id!, a]));
  const admin = (s.modules.ledger ?? 0) >= 3;
  const Row = ({ source, k, label, sub, fallback }: { source: string; k: string; label: React.ReactNode; sub?: React.ReactNode; fallback?: GlAccount | null }) => {
    const cur = M.get(`${source}|${k}`);
    const show = cur ?? fallback ?? null;
    return (
      <tr>
        <td className={td}>{label}{sub && <span className="block text-xs text-muted">{sub}</span>}</td>
        <td className={`${td} num`}>{show ? <span className={cur ? "font-semibold" : "text-muted"}>{show.code} · {show.name}{!cur && " (varsayılan)"}</span> : <span className="text-bad text-xs font-semibold">eşleşme yok</span>}</td>
        <td className={td}>
          {admin && (
            <form action={glSaveMap} className="flex gap-2">
              <input type="hidden" name="source" value={source} /><input type="hidden" name="key" value={k} />
              <input name="code" list="gl-codes" defaultValue={cur?.code ?? ""} placeholder="hesap kodu" className="h-9 w-32 rounded-lg border border-line px-2 num text-sm" />
              <PendingSubmit className="h-9 rounded-lg bg-brand-700 px-3 text-xs font-semibold text-white">Kaydet</PendingSubmit>
            </form>
          )}
        </td>
      </tr>
    );
  };
  const head = <thead><tr className="text-xs text-muted"><th className={th}>ERP kaydı</th><th className={th}>Muhasebe hesabı</th><th className={th}>Değiştir</th></tr></thead>;
  return (
    <>
      <PageHeader title="Eşleştirme" subtitle="Her ERP kaydının hangi hesaba gideceği. Kasa, banka ve cariler seçilen ana hesabın altına kendi alt hesabıyla açılır." actions={<Link href="/muhasebe" className="text-sm font-semibold text-brand-700">Genel muhasebe</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">Supabase&apos;de 20270206000000_gl_core.sql çalıştırılmalı.</Notice>}
        <datalist id="gl-codes">{((accs ?? []) as GlAccount[]).filter((a) => a.is_active).map((a) => <option key={a.id} value={a.code}>{a.name}</option>)}</datalist>
        <Notice tone="info">Kod boş bırakılıp kaydedilirse eşleştirme kaldırılır ve varsayılana döner. Değişiklik yeni kayıtlara uygulanır; bekleyenler için aşağıdan yeniden deneyin.</Notice>
        <form action={glRepost}><PendingSubmit className="text-sm font-semibold text-brand-700">Eşleştirme bekleyen kayıtları yeniden dene</PendingSubmit></form>

        <Card title="Kasa, banka, POS, kredi kartı, kredi, çek hesapları">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {((fa ?? []) as Array<{ id: string; kind: string; name: string; currency: string; is_active: boolean }>).map((a) => (
              <Row key={a.id} source="fin_account" k={a.id} label={a.name} sub={`${ACCOUNT_KIND[a.kind]?.label ?? a.kind} · ${a.currency}${a.is_active ? "" : " · pasif"}`} fallback={linked.get(a.id) ?? M.get(`account_kind|${a.kind}`) ?? null} />
            ))}
          </tbody></table></div>
        </Card>

        <Card title="Hesap türlerinin ana hesabı">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {Object.entries(ACCOUNT_KIND).map(([k, l]) => <Row key={k} source="account_kind" k={k} label={l.label} />)}
          </tbody></table></div>
        </Card>

        <Card title="Cari türlerinin ana hesabı">
          <p className="text-sm text-muted">Her cari bu hesabın altında kendi alt hesabıyla izlenir (ör. 120.0001 Dr. Ali). Tek bir cariyi farklı hesaba bağlamak için cari kartından ya da buraya cari kimliğiyle eşleştirme eklenebilir.</p>
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {Object.entries(PARTY_KIND).map(([k, l]) => <Row key={k} source="party_kind" k={k} label={l} />)}
          </tbody></table></div>
        </Card>

        <Card title="Gelir, gider, KDV ve diğer kategoriler">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {((cats ?? []) as Array<{ id: string; code: string; name: string; kind: string; is_active: boolean }>).map((c) => (
              <Row key={c.id} source="category_code" k={c.code} label={c.name} sub={`${CAT_KIND[c.kind] ?? c.kind} · ${c.code}`} fallback={M.get(`category_kind|${c.kind}`) ?? null} />
            ))}
          </tbody></table></div>
        </Card>

        <Card title="Kategori türlerinin varsayılan hesabı">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {Object.entries(CAT_KIND).filter(([k]) => !["equity", "other"].includes(k)).map(([k, l]) => <Row key={k} source="category_kind" k={k} label={l} />)}
          </tbody></table></div>
        </Card>

        <Card title="Özel kayıtlar">
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[680px]">{head}<tbody>
            {REF.map(([k, l]) => <Row key={k} source="ref" k={k} label={l} />)}
          </tbody></table></div>
        </Card>
      </div>
    </>
  );
}
