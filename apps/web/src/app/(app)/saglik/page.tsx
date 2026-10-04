import { Card, PageHeader } from "@/components/ui";
import { ComplianceMatrix, ComplianceSummary, Tabs } from "@/components/Compliance";
import { RecordForm, SickReportForm } from "@/components/ComplianceForms";
import { HAZARD_LABEL, loadCompliance } from "@/lib/compliance";
import { deleteComplianceRecord } from "@/lib/compliance-actions";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { ConfirmSubmit } from "@/components/ConfirmSubmit";

const RESULT: Record<string, [string, string]> = {
  UYGUN: ["Uygun", "bg-ok-bg text-ok"],
  SARTLI: ["Şartlı uygun", "bg-warn-bg text-warn"],
  UYGUN_DEGIL: ["Uygun değil", "bg-bad-bg text-bad"],
};

export default async function HealthPage({ searchParams }: { searchParams: Promise<{ sekme?: string; personel?: string; tur?: string }> }) {
  await getSession();
  const sp = await searchParams;
  const tab = ["ozet", "matris", "kayit", "rapor"].includes(sp.sekme ?? "") ? sp.sekme! : "ozet";
  const supabase = await createClient();
  const data = await loadCompliance(supabase, "HEALTH");
  const name = new Map(data.employees.map((e) => [e.id, e.name]));
  const typeName = new Map(data.types.map((t) => [t.id, t.name]));
  const [recent, reports] = await Promise.all([
    tab === "kayit" ? supabase.from("health_exams").select("id, employee_id, type_id, exam_date, expires_on, result, restrictions, doctor, institution, report_path").order("exam_date", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
    tab === "rapor" ? supabase.from("leave_requests").select("id, employee_id, start_date, end_date, days, note, document_path, status, leave_types!inner(code)").eq("leave_types.code", "RAPOR").order("start_date", { ascending: false }).limit(100) : Promise.resolve({ data: [] }),
  ]);
  const paths = [...(recent.data ?? []).map((r) => r.report_path), ...(reports.data ?? []).map((r) => r.document_path)].filter(Boolean) as string[];
  const signed = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(paths, 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && signed.set(paths[i]!, u.signedUrl));
  }
  const types = sp.tur ? [...data.types].sort((a) => (a.id === sp.tur ? -1 : 0)) : data.types;
  const th = "py-3 px-3 font-semibold border-b border-line";
  const td = "py-2.5 px-3 border-b border-[#EEF2F6]";

  return (
    <>
      <PageHeader title="Sağlık" subtitle={`${HAZARD_LABEL[data.hazard]} sınıf · ${data.counts.expired + data.counts.d7} acil, ${data.counts.d15 + data.counts.d30} yaklaşan, ${data.counts.missing} eksik muayene`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1320px]">
        <Tabs base="/saglik" active={tab} tabs={[["ozet", "Uyarılar"], ["matris", "Muayene matrisi"], ["kayit", "Muayene kaydı"], ["rapor", "İstirahat raporları"]]} />
        <p className="text-xs text-muted">Sağlık verileri özel nitelikli kişisel veridir; bu sayfayı yalnızca şirket sahibi, İK ve İSG uzmanı görebilir.</p>

        {tab === "ozet" && <ComplianceSummary data={data} base="/saglik" />}
        {tab === "matris" && <ComplianceMatrix data={data} base="/saglik" />}

        {tab === "kayit" && (
          <>
            <Card title="Muayene / tetkik kaydı (toplu)">
              <p className="text-sm text-muted">Bitiş boşsa otomatik: çok tehlikeli sınıfta periyodik muayene her yıl; akciğer grafisi, SFT, odyometri yıllık.</p>
              <RecordForm key={sp.personel ?? "x"} category="HEALTH" types={types} employees={data.employees} preselect={sp.personel ? [sp.personel] : undefined} />
            </Card>
            <Card title="Son kayıtlar">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={th}>Tarih</th><th className={th}>Personel</th><th className={th}>Muayene</th><th className={th}>Sonuç</th><th className={th}>Hekim / kurum</th><th className={th}>Bitiş</th><th className={th}>Rapor</th><th className={th}><span className="sr-only">Sil</span></th></tr></thead>
                  <tbody>
                    {(recent.data ?? []).map((r) => {
                      const [l, cls] = RESULT[r.result ?? "UYGUN"] ?? ["", ""];
                      return (
                        <tr key={r.id}>
                          <td className={`num ${td}`}>{formatDate(r.exam_date)}</td>
                          <td className={`${td} font-semibold`}>{name.get(r.employee_id) ?? "—"}</td>
                          <td className={td}>{typeName.get(r.type_id)}</td>
                          <td className={td}><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span>{r.restrictions ? <span className="block text-xs text-muted">{r.restrictions}</span> : null}</td>
                          <td className={td}>{[r.doctor, r.institution].filter(Boolean).join(" · ") || "—"}</td>
                          <td className={`num ${td}`}>{r.expires_on ? formatDate(r.expires_on) : "süresiz"}</td>
                          <td className={td}>{r.report_path && signed.get(r.report_path) ? <a href={signed.get(r.report_path)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700">Aç</a> : "—"}</td>
                          <td className={`${td} text-right`}><form action={deleteComplianceRecord}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="category" value="HEALTH" /><ConfirmSubmit label="Sil" /></form></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {tab === "rapor" && (
          <>
            <Card title="İstirahat raporu işle">
              <p className="text-sm text-muted">Rapor, onaylı &quot;Sağlık raporu&quot; izni olarak kaydedilir; puantajda R görünür, izin sayfasında listelenir ve &quot;Eksik günleri hakedişe yansıt&quot; ile resmi/elden kesintiye dönüşebilir.</p>
              <SickReportForm employees={data.employees} />
            </Card>
            <Card title="Raporlar">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead><tr className="text-left text-xs text-muted"><th className={th}>Personel</th><th className={th}>Tarih</th><th className={`${th} text-right`}>Gün</th><th className={th}>Not</th><th className={th}>Belge</th><th className={th}>Durum</th></tr></thead>
                  <tbody>
                    {(reports.data ?? []).map((r) => (
                      <tr key={r.id}>
                        <td className={`${td} font-semibold`}>{name.get(r.employee_id) ?? "—"}</td>
                        <td className={`num ${td}`}>{formatDate(r.start_date)}{r.end_date !== r.start_date ? ` – ${formatDate(r.end_date)}` : ""}</td>
                        <td className={`num ${td} text-right`}>{Number(r.days)}</td>
                        <td className={`${td} text-muted`}>{r.note ?? ""}</td>
                        <td className={td}>{r.document_path && signed.get(r.document_path) ? <a href={signed.get(r.document_path)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700">Aç</a> : <span className="text-xs text-warn">Belge yok</span>}</td>
                        <td className={td}>{r.status === "approved" ? "İşlendi" : r.status}</td>
                      </tr>
                    ))}
                    {(reports.data ?? []).length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted">Rapor yok.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </>
  );
}
