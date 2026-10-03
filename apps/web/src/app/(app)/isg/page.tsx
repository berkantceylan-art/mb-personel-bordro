import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { ComplianceMatrix, ComplianceSummary, Tabs } from "@/components/Compliance";
import { IncidentForm, PpeForm, RecordForm } from "@/components/ComplianceForms";
import { HAZARD_LABEL, loadCompliance } from "@/lib/compliance";
import { closeIncident, deleteComplianceRecord, returnPpe, setHazardClass } from "@/lib/compliance-actions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";

const KIND: Record<string, string> = { KAZA: "İş kazası", RAMAK_KALA: "Ramak kala", MESLEK_HASTALIGI: "Meslek hastalığı" };

export default async function SafetyPage({ searchParams }: { searchParams: Promise<{ sekme?: string; personel?: string; tur?: string }> }) {
  const s = await getSession();
  const sp = await searchParams;
  const tab = ["ozet", "matris", "kayit", "kkd", "kaza"].includes(sp.sekme ?? "") ? sp.sekme! : "ozet";
  const supabase = await createClient();
  const data = await loadCompliance(supabase, "TRAINING");
  const name = new Map(data.employees.map((e) => [e.id, e.name]));
  const typeName = new Map(data.types.map((t) => [t.id, t.name]));

  const [recent, ppe, incidents] = await Promise.all([
    tab === "kayit" ? supabase.from("training_records").select("id, employee_id, type_id, done_on, expires_on, hours, trainer, provider").order("done_on", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    tab === "kkd" ? supabase.from("ppe_issues").select("*").order("issued_on", { ascending: false }).limit(200) : Promise.resolve({ data: [] }),
    tab === "kaza" ? supabase.from("safety_incidents").select("*").order("occurred_at", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const types = sp.tur ? [...data.types].sort((a) => (a.id === sp.tur ? -1 : 0)) : data.types;
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader
        title="İş sağlığı ve güvenliği"
        subtitle={`Tehlike sınıfı: ${HAZARD_LABEL[data.hazard]} · ${data.counts.expired + data.counts.d7} acil, ${data.counts.d15 + data.counts.d30} yaklaşan, ${data.counts.missing} eksik eğitim`}
        actions={
          s.role === "owner" ? (
            <form action={setHazardClass} className="flex gap-2 items-center">
              <select name="hazard_class" defaultValue={data.hazard} aria-label="Tehlike sınıfı" className="h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3">
                <option value="COK">Çok tehlikeli</option><option value="TEHLIKELI">Tehlikeli</option><option value="AZ">Az tehlikeli</option>
              </select>
              <button className="h-11 px-3 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Kaydet</button>
            </form>
          ) : undefined
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1320px]">
        <Tabs base="/isg" active={tab} tabs={[["ozet", "Uyarılar"], ["matris", "Eğitim matrisi"], ["kayit", "Eğitim kaydı"], ["kkd", "KKD zimmet"], ["kaza", "İş kazası / ramak kala"]]} />

        {tab === "ozet" && <ComplianceSummary data={data} base="/isg" />}
        {tab === "matris" && <ComplianceMatrix data={data} base="/isg" />}

        {tab === "kayit" && (
          <>
            <Card title="Eğitim kaydı (toplu)">
              <p className="text-sm text-muted">Aynı eğitime katılan personeli birlikte seçin. Bitiş tarihi boş bırakılırsa tehlike sınıfına göre otomatik hesaplanır (çok tehlikelide temel İSG eğitimi her yıl, en az 16 saat).</p>
              <RecordForm key={sp.personel ?? "x"} category="TRAINING" types={types} employees={data.employees} preselect={sp.personel ? [sp.personel] : undefined} />
            </Card>
            <Card title="Son kayıtlar">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[760px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Personel</th><th className={th}>Eğitim</th><th className={th}>Süre</th><th className={th}>Eğitimci / kurum</th><th className={th}>Bitiş</th><th className={th}><span className="sr-only">Sil</span></th></tr></thead>
                  <tbody>
                    {(recent.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className={`num ${td}`}>{formatDate(r.done_on)}</td>
                        <td className={`${td} font-semibold`}>{name.get(r.employee_id) ?? "—"}</td>
                        <td className={td}>{typeName.get(r.type_id)}</td>
                        <td className={`num ${td}`}>{r.hours ? `${Number(r.hours)} sa` : "—"}</td>
                        <td className={td}>{[r.trainer, r.provider].filter(Boolean).join(" · ") || "—"}</td>
                        <td className={`num ${td}`}>{r.expires_on ? formatDate(r.expires_on) : "süresiz"}</td>
                        <td className={`${td} text-right`}><form action={deleteComplianceRecord}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="category" value="TRAINING" /><button className="text-xs font-semibold text-bad">Sil</button></form></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "kkd" && (
          <>
            <Card title="KKD zimmetle"><PpeForm employees={data.employees} /></Card>
            <Card title="Zimmetler">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={th}>Veriliş</th><th className={th}>Personel</th><th className={th}>Malzeme</th><th className={th}>Adet / beden</th><th className={th}>Yenileme</th><th className={th}>Durum</th></tr></thead>
                  <tbody>
                    {(ppe.data ?? []).map((p) => (
                      <tr key={p.id}>
                        <td className={`num ${td}`}>{formatDate(p.issued_on)}</td>
                        <td className={`${td} font-semibold`}>{name.get(p.employee_id) ?? "—"}</td>
                        <td className={td}>{p.item}</td>
                        <td className={td}>{p.quantity}{p.size ? ` · ${p.size}` : ""}</td>
                        <td className={td}>{p.renew_months ? `${p.renew_months} ayda bir` : "—"}</td>
                        <td className={td}>{p.returned_on ? `İade ${formatDate(p.returned_on)}` : <form action={returnPpe}><input type="hidden" name="id" value={p.id} /><button className="text-xs font-semibold text-brand-700">İade alındı</button></form>}</td>
                      </tr>
                    ))}
                    {(ppe.data ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Zimmet yok.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "kaza" && (
          <>
            <Card title="Yeni kayıt"><IncidentForm employees={data.employees} /></Card>
            <Card title="Kayıtlar">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Tür</th><th className={th}>Personel</th><th className={th}>Açıklama</th><th className={th}>Kayıp gün</th><th className={th}>SGK bildirimi</th><th className={th}>Durum</th></tr></thead>
                  <tbody>
                    {(incidents.data ?? []).map((i) => (
                      <tr key={i.id}>
                        <td className={`num ${td}`}>{formatDate(i.occurred_at)}</td>
                        <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${i.kind === "KAZA" ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn"}`}>{KIND[i.kind]}</span></td>
                        <td className={`${td} font-semibold`}>{i.employee_id ? name.get(i.employee_id) : "—"}</td>
                        <td className={td}>{i.description}{i.location ? <span className="block text-xs text-muted">{i.location}</span> : null}</td>
                        <td className={`num ${td}`}>{i.lost_days ?? "—"}</td>
                        <td className={td}>{i.sgk_notified_on ? formatDate(i.sgk_notified_on) : i.kind === "KAZA" ? <span className="text-xs font-semibold text-bad">Bildirilmedi</span> : "—"}</td>
                        <td className={td}>{i.status === "closed" ? "Kapalı" : <form action={closeIncident}><input type="hidden" name="id" value={i.id} /><button className="text-xs font-semibold text-brand-700">Kapat</button></form>}</td>
                      </tr>
                    ))}
                    {(incidents.data ?? []).length === 0 && <tr><td colSpan={7} className="py-6 text-center text-muted">Kayıt yok.</td></tr>}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">İş kazası SGK&apos;ya kazadan sonraki 3 iş günü içinde bildirilmelidir.</p>
            </Card>
          </>
        )}
        <p className="text-xs text-muted">Sağlık muayeneleri ve istirahat raporları için <Link href="/saglik" className="font-semibold text-brand-700">Sağlık</Link> sayfası.</p>
      </div>
    </>
  );
}
