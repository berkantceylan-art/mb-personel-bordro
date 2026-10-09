import { formatTL } from "@mb/core";
import { Card } from "@/components/ui";
import { formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

const CAT: Record<string, string> = { ozluk: "Özlük", isg: "İş güvenliği", saglik: "Sağlık", bordro: "Bordro", cikis: "Çıkış" };
const KIND: Record<string, string> = { ALIMONY: "Nafaka", DEBT: "İcra", nafaka: "Nafaka", icra: "İcra" };

/** Personelin BES, icra/nafaka, İSG eğitimleri, sağlık muayeneleri ve özlük dosyası */
export default async function MyRecordsPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="BES · İcra · İSG · Sağlık" />;
  const [{ data: bes }, { data: besDed }, { data: garn }, { data: garnDed }, { data: trainings }, { data: exams }, { data: docs }] = await Promise.all([
    supabase.from("bes_enrollments").select("enrolled_on, rate, status, status_date, policy_no, note").eq("employee_id", e.id).order("enrolled_on", { ascending: false }),
    supabase.from("ledger_entries").select("period, amount").eq("employee_id", e.id).eq("type", "BES").is("voided_at", null).order("period", { ascending: false }).limit(24),
    supabase.from("garnishment_files").select("id, kind, office, file_no, creditor, served_at, debt_amount, monthly_amount, seizable_ratio, status, closed_at").eq("employee_id", e.id).order("served_at", { ascending: false }),
    supabase.from("garnishment_deductions").select("file_id, period, amount").eq("employee_id", e.id).order("period", { ascending: false }).limit(60),
    supabase.from("training_records").select("id, done_on, hours, trainer, provider, expires_on, certificate_path, compliance_types(name)").eq("employee_id", e.id).order("done_on", { ascending: false }),
    supabase.from("health_exams").select("id, exam_date, result, restrictions, doctor, institution, expires_on, report_path, compliance_types(name)").eq("employee_id", e.id).order("exam_date", { ascending: false }),
    supabase.from("employee_documents").select("id, file_name, file_path, uploaded_at, expires_on, period, document_types(name, category)").eq("employee_id", e.id).order("uploaded_at", { ascending: false }),
  ]);
  // İmzalı bağlantılar
  const paths = [...(trainings ?? []).map((t) => t.certificate_path), ...(exams ?? []).map((x) => x.report_path), ...(docs ?? []).map((d) => d.file_path)].filter((p): p is string => !!p);
  const link = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(paths, 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && link.set(paths[i]!, u.signedUrl));
  }
  const today = new Date().toISOString().slice(0, 10);
  const tname = (x: unknown) => (x as { name: string } | null)?.name ?? "—";
  const paid = (fileId: string) => (garnDed ?? []).filter((d) => d.file_id === fileId).reduce((a, d) => a + Number(d.amount), 0);
  const besTotal = (besDed ?? []).reduce((a, d) => a + Number(d.amount), 0);
  const groups = new Map<string, NonNullable<typeof docs>>();
  for (const d of docs ?? []) { const c = (d.document_types as unknown as { category: string } | null)?.category ?? "ozluk"; groups.set(c, [...(groups.get(c) ?? []), d]); }
  const A = ({ p, label = "Belgeyi aç" }: { p: string | null; label?: string }) => (p && link.has(p) ? <a href={link.get(p)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700 whitespace-nowrap">{label} →</a> : null);
  const exp = (d: string | null) => (d ? <span className={`text-xs ${d < today ? "text-bad font-semibold" : "text-muted"}`}>{d < today ? "süresi doldu" : "geçerli"} · {formatDate(d)}</span> : null);

  return (
    <>
      <MyHeader title="BES · İcra · İSG · Sağlık" subtitle="Kayıtlarınız ve belgeleriniz" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[860px]">
        <Card title="BES (otomatik katılım)">
          {(bes ?? []).length === 0 ? <p className="text-sm text-muted">BES kaydınız yok.</p> : (bes ?? []).map((b, i) => (
            <div key={i} className="text-sm flex flex-col gap-0.5">
              <div><b>%{Math.round(Number(b.rate) * 100)}</b> kesinti · {b.enrolled_on ? `giriş ${formatDate(b.enrolled_on)}` : ""} · durum: {String(b.status ?? "aktif")}{b.status_date ? ` (${formatDate(b.status_date)})` : ""}</div>
              {b.policy_no && <div className="text-xs text-muted">Poliçe no {b.policy_no}</div>}
              {b.note && <div className="text-xs text-muted">{b.note}</div>}
            </div>
          ))}
          {(besDed ?? []).length > 0 && (
            <div className="text-sm">
              <div className="text-xs text-muted mb-1">Kesintiler · toplam {formatTL(besTotal)}</div>
              <ul className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1">{(besDed ?? []).map((d, i) => <li key={i} className="flex justify-between num"><span className="text-muted">{periodLabel(d.period)}</span><span>{formatTL(Number(d.amount))}</span></li>)}</ul>
            </div>
          )}
        </Card>

        <Card title="İcra ve nafaka">
          {(garn ?? []).length === 0 ? <p className="text-sm text-muted">İcra veya nafaka dosyanız yok.</p> : (garn ?? []).map((g) => (
            <div key={g.id} className="text-sm border-b border-[#EEF2F6] last:border-0 pb-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2"><b>{KIND[g.kind] ?? g.kind} · {g.creditor ?? "—"}</b><span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${g.status === "closed" || g.closed_at ? "bg-[#EEF2F6] text-[#33414F]" : "bg-warn-bg text-warn"}`}>{g.status === "closed" || g.closed_at ? "Kapandı" : "Devam ediyor"}</span></div>
              <div className="text-xs text-muted">{g.office ?? ""} {g.file_no ? `· dosya ${g.file_no}` : ""} {g.served_at ? `· tebliğ ${formatDate(g.served_at)}` : ""}</div>
              <div className="grid grid-cols-3 gap-2 num text-xs mt-1">
                <div><div className="text-muted">Borç</div><div>{g.debt_amount ? formatTL(Number(g.debt_amount)) : "—"}</div></div>
                <div><div className="text-muted">Aylık kesinti</div><div>{g.monthly_amount ? formatTL(Number(g.monthly_amount)) : g.seizable_ratio ? `maaşın 1/${Math.round(1 / Number(g.seizable_ratio))}` : "—"}</div></div>
                <div><div className="text-muted">Kesilen toplam</div><div className="font-semibold">{formatTL(paid(g.id))}</div></div>
              </div>
            </div>
          ))}
        </Card>

        <Card title="İş güvenliği eğitimleri">
          {(trainings ?? []).length === 0 ? <p className="text-sm text-muted">Kayıtlı eğitim yok.</p> : (trainings ?? []).map((t) => (
            <div key={t.id} className="text-sm border-b border-[#EEF2F6] last:border-0 pb-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2"><b>{tname(t.compliance_types)}</b><A p={t.certificate_path} label="Sertifika" /></div>
              <div className="text-xs text-muted">{formatDate(t.done_on)}{t.hours ? ` · ${t.hours} saat` : ""}{t.trainer ? ` · ${t.trainer}` : ""}{t.provider ? ` · ${t.provider}` : ""}</div>
              {exp(t.expires_on)}
            </div>
          ))}
        </Card>

        <Card title="Sağlık muayeneleri">
          {(exams ?? []).length === 0 ? <p className="text-sm text-muted">Kayıtlı muayene yok.</p> : (exams ?? []).map((x) => (
            <div key={x.id} className="text-sm border-b border-[#EEF2F6] last:border-0 pb-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2"><b>{tname(x.compliance_types)}</b><A p={x.report_path} label="Rapor" /></div>
              <div className="text-xs text-muted">{formatDate(x.exam_date)}{x.result ? ` · ${x.result}` : ""}{x.doctor ? ` · ${x.doctor}` : ""}{x.institution ? ` · ${x.institution}` : ""}</div>
              {x.restrictions && <div className="text-xs">Kısıt: {x.restrictions}</div>}
              {exp(x.expires_on)}
            </div>
          ))}
        </Card>

        <Card title="Özlük dosyam">
          {(docs ?? []).length === 0 ? <p className="text-sm text-muted">Yüklü belge yok.</p> : [...groups.entries()].map(([c, list]) => (
            <div key={c} className="flex flex-col gap-1">
              <div className="text-xs uppercase tracking-wide text-muted">{CAT[c] ?? c}</div>
              {list.map((d) => (
                <div key={d.id} className="text-sm flex justify-between gap-2 border-b border-[#EEF2F6] last:border-0 py-1">
                  <span>{tname(d.document_types)}{d.period ? ` · ${periodLabel(d.period)}` : ""}<span className="block text-xs text-muted">{formatDate(d.uploaded_at.slice(0, 10))}{d.expires_on ? ` · bitiş ${formatDate(d.expires_on)}` : ""}</span></span>
                  <A p={d.file_path} label="Aç" />
                </div>
              ))}
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
