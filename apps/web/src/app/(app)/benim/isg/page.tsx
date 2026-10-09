import { Card } from "@/components/ui";
import { formatDate, periodLabel } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

export default async function Page() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İş güvenliği" />;
  const { data: trainings } = await supabase.from("training_records").select("id, done_on, hours, trainer, provider, expires_on, certificate_path, compliance_types(name)").eq("employee_id", e.id).order("done_on", { ascending: false });
  const paths = (trainings ?? []).map((t) => t.certificate_path).filter((p): p is string => !!p);
  const link = new Map<string, string>();
  if (paths.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(paths, 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && link.set(paths[i]!, u.signedUrl));
  }
  const today = new Date().toISOString().slice(0, 10);
  const tname = (x: unknown) => (x as { name: string } | null)?.name ?? "—";
  const A = ({ p, label = "Belgeyi aç" }: { p: string | null; label?: string }) => (p && link.has(p) ? <a href={link.get(p)} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700 whitespace-nowrap">{label} →</a> : null);
  const exp = (d: string | null) => (d ? <span className={`text-xs ${d < today ? "text-bad font-semibold" : "text-muted"}`}>{d < today ? "süresi doldu" : "geçerli"} · {formatDate(d)}</span> : null);

  return (
    <>
      <MyHeader title="İş güvenliği" subtitle="Eğitimlerim ve sertifikalarım" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card title="Eğitimlerim">
          {(trainings ?? []).length === 0 ? <p className="text-sm text-muted">Kayıtlı eğitim yok.</p> : (trainings ?? []).map((t) => (
            <div key={t.id} className="text-sm border-b border-[#EEF2F6] last:border-0 pb-2 flex flex-col gap-0.5">
              <div className="flex justify-between gap-2"><b>{tname(t.compliance_types)}</b><A p={t.certificate_path} label="Sertifika" /></div>
              <div className="text-xs text-muted">{formatDate(t.done_on)}{t.hours ? ` · ${t.hours} saat` : ""}{t.trainer ? ` · ${t.trainer}` : ""}{t.provider ? ` · ${t.provider}` : ""}</div>
              {exp(t.expires_on)}
            </div>
          ))}
        </Card>

      </div>
    </>
  );
}
