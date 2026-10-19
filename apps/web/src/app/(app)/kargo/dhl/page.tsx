import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { getSession } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import { dhlApiReady, dhlImportReady, dhlTrackingReady } from "@/lib/dhl";
import { loadDhlSettings, saveDhlSettings } from "@/lib/dhl-actions";
import { fmtDateTime } from "@/lib/shipments";

export const dynamic = "force-dynamic";
export const metadata = { title: "DHL entegrasyonu" };

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white w-full";
const label = "flex flex-col gap-1.5 text-sm text-muted";

function Check({ ok, title, envs, note }: { ok: boolean; title: string; envs: string; note: string }) {
  return (
    <div className={`rounded-[14px] p-4 border ${ok ? "border-[#BFE5CC] bg-ok-bg" : "border-[#F2D58A] bg-warn-bg"}`}>
      <b className={ok ? "text-ok" : "text-warn"}>{ok ? "✓" : "…"} {title}</b>
      <p className="text-xs text-[#33414F] mt-1">{ok ? note : <>Bekleniyor — Vercel&apos;e ekleyin: <code className="font-mono">{envs}</code></>}</p>
    </div>
  );
}

/** DHL entegrasyonu: bağlantı durumu, laboratuvar (gönderici) adresi, varsayılanlar, takip özeti */
export default async function DhlPage() {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const st = await loadDhlSettings();
  const sb = await createClient();
  const { data: open } = await sb
    .from("shipments")
    .select("id, no, direction, tracking_no, status, party_name, dhl_last_event, dhl_checked_at, dhl_eta")
    .eq("carrier", "dhl")
    .not("status", "in", "(opened,job_created,delivered,returned,cancelled)")
    .order("created_at", { ascending: false })
    .limit(50);
  const rows = (open ?? []) as { id: string; no: number; direction: string; tracking_no: string | null; status: string; party_name: string | null; dhl_last_event: string | null; dhl_checked_at: string | null; dhl_eta: string | null }[];

  return (
    <>
      <PageHeader title="DHL entegrasyonu" subtitle="Otomatik takip, gönderi açma, etiket ve ticari fatura, kurye çağırma" actions={<Link href="/kargo" className="text-sm font-semibold text-brand-700">← Kargo</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1200px]">
        <section className="grid gap-3 md:grid-cols-3">
          <Check ok={dhlTrackingReady()} title="Otomatik takip" envs="DHL_TRACKING_KEY" note="Açık DHL gönderileri her saat (07:00–22:00) DHL'den sorgulanır; gümrük ve teslimde bildirim gider." />
          <Check ok={dhlApiReady()} title="Gönderi açma / etiket" envs="DHL_API_USER, DHL_API_PASS, DHL_ACCOUNT_NO" note={st.test_mode ? "Bağlı — TEST modunda (aşağıdan canlıya alın)." : "Bağlı — CANLI mod."} />
          <Check ok={dhlImportReady()} title="Hekimden alım (ithalat)" envs="DHL_IMPORT_ACCOUNT_NO" note="Gelen paketler için DHL kuryesi hekimden alır, ücret ithalat hesabınızdan." />
        </section>

        <form action={saveDhlSettings} className="bg-white border border-line rounded-2xl p-5 grid gap-4 md:grid-cols-3">
          <h2 className="md:col-span-3 font-display font-semibold text-brand-800">Laboratuvar (gönderici) bilgileri</h2>
          <label className={label}>Firma adı *<input name="shipper_company" required defaultValue={st.shipper_company} className={input} /></label>
          <label className={label}>Yetkili ad soyad<input name="shipper_name" defaultValue={st.shipper_name ?? ""} className={input} /></label>
          <label className={label}>Telefon *<input name="phone" defaultValue={st.phone ?? ""} placeholder="+90…" className={input} /></label>
          <label className={`${label} md:col-span-2`}>Adres (en çok 45 karakter) *<input name="address1" maxLength={45} defaultValue={st.address1 ?? ""} className={input} /></label>
          <label className={label}>Adres 2<input name="address2" maxLength={45} defaultValue={st.address2 ?? ""} className={input} /></label>
          <label className={label}>İlçe<input name="county" defaultValue={st.county ?? ""} className={input} /></label>
          <label className={label}>Şehir *<input name="city" defaultValue={st.city ?? ""} className={input} /></label>
          <label className={label}>Posta kodu *<input name="postal_code" defaultValue={st.postal_code ?? ""} className={`${input} num`} /></label>
          <label className={label}>Ülke kodu<input name="country_code" defaultValue={st.country_code} maxLength={2} className={`${input} uppercase`} /></label>
          <label className={`${label} md:col-span-2`}>E-posta<input name="email" type="email" defaultValue={st.email ?? ""} className={input} /></label>

          <h2 className="md:col-span-3 font-display font-semibold text-brand-800 mt-2">Varsayılanlar</h2>
          <label className={label}>DHL ürünü
            <select name="product_code" defaultValue={st.product_code} className={input}>
              <option value="P">P · Express Worldwide (paket)</option><option value="U">U · Express Worldwide (AB)</option><option value="K">K · Express 9:00</option><option value="T">T · Express 12:00</option><option value="D">D · Express Worldwide (doküman)</option>
            </select>
          </label>
          <label className={label}>GTİP / HS kodu<input name="hs_code" defaultValue={st.hs_code} className={`${input} num`} /></label>
          <label className={label}>Teslim şekli (incoterm)
            <select name="incoterm" defaultValue={st.incoterm} className={input}><option value="DAP">DAP · vergi alıcıda</option><option value="DDP">DDP · vergi bizde</option></select>
          </label>
          <label className={`${label} md:col-span-2`}>Gümrük açıklaması<input name="item_desc" defaultValue={st.item_desc} className={input} /></label>
          <label className={label}>Para birimi<select name="currency" defaultValue={st.currency} className={input}><option>EUR</option><option>USD</option><option>CHF</option><option>GBP</option><option>TRY</option></select></label>
          <label className={label}>Varsayılan beyan değeri<input name="default_value" defaultValue={st.default_value} inputMode="decimal" className={`${input} num`} /></label>
          <label className={label}>Varsayılan ağırlık (kg)<input name="default_weight" defaultValue={st.default_weight} inputMode="decimal" className={`${input} num`} /></label>
          <div className="grid grid-cols-3 gap-2">
            <label className={label}>Boy<input name="length_cm" defaultValue={st.length_cm} className={`${input} num`} /></label>
            <label className={label}>En<input name="width_cm" defaultValue={st.width_cm} className={`${input} num`} /></label>
            <label className={label}>Yük.<input name="height_cm" defaultValue={st.height_cm} className={`${input} num`} /></label>
          </div>
          <label className={label}>Kurye kapanış saati<input name="pickup_close" type="time" defaultValue={st.pickup_close} className={input} /></label>
          <label className={label}>Kurye alım yeri<input name="pickup_location" defaultValue={st.pickup_location} className={input} /></label>
          <label className={label}>Mod
            <select name="test_mode" defaultValue={st.test_mode ? "test" : "live"} className={input}><option value="test">TEST (deneme, gerçek gönderi yok)</option><option value="live">CANLI (gerçek gönderi ve ücret)</option></select>
          </label>
          <div className="md:col-span-3 flex items-center gap-3">
            <PendingSubmit className="h-11 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
            <span className="text-xs text-muted">Diş protezi için GTİP 9021.29 (ısmarlama dental cihaz) kullanılır; gümrük müşavirinizle teyit edin.</span>
          </div>
        </form>

        <section className="bg-white border border-line rounded-2xl overflow-x-auto">
          <h2 className="font-display font-semibold text-brand-800 px-5 pt-4 pb-2">Açık DHL gönderileri <span className="text-sm text-muted num">{rows.length}</span></h2>
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-5 font-semibold border-b border-line">No</th><th className="py-2 px-2 font-semibold border-b border-line">Yön</th><th className="py-2 px-2 font-semibold border-b border-line">Kim</th><th className="py-2 px-2 font-semibold border-b border-line">Takip</th><th className="py-2 px-2 font-semibold border-b border-line">Son DHL hareketi</th><th className="py-2 px-2 font-semibold border-b border-line">Son sorgu</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-2 px-5 border-b border-[#EEF2F6]"><Link href={`/kargo/${r.id}`} className="font-semibold text-brand-700">G{r.no}</Link></td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6]">{r.direction === "in" ? "Gelen" : "Giden"}</td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6]">{r.party_name ?? "—"}</td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6] font-mono text-xs">{r.tracking_no ?? <span className="text-warn font-sans font-semibold">DHL&apos;de açılmadı</span>}</td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6] text-xs">{r.dhl_last_event ?? "—"}{r.dhl_eta ? <span className="block text-muted">tahmini {r.dhl_eta.split("-").reverse().join(".")}</span> : null}</td>
                  <td className="py-2 px-2 border-b border-[#EEF2F6] text-xs text-muted">{fmtDateTime(r.dhl_checked_at)}</td>
                </tr>
              ))}
              {!rows.length && <tr><td colSpan={6} className="px-5 py-6 text-muted">Açık DHL gönderisi yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
