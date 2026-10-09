import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { PageHeader } from "@/components/ui";
import { docData, TEMPLATES } from "@/lib/ozluk-docs";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { deleteDocument, uploadDocument } from "../document-actions";
import { finishOnboarding } from "./actions";

const STEPS: Array<{ n: number; title: string; short: string; hint: string }> = [
  { n: 1, title: "Personel bilgileri", short: "Bilgiler", hint: "Kimlik, iletişim, adres ve ücret bilgileri. Sözleşmelere bu bilgiler yazılır." },
  { n: 2, title: "e-Devlet belgeleri", short: "e-Devlet", hint: "Her belgenin yanındaki bağlantı e-Devlet'te ilgili hizmeti açar; personel kendi hesabıyla girip PDF'i indirir, siz buraya yüklersiniz. Kimlik fotokopisi ve fotoğraf da burada." },
  { n: 3, title: "Sözleşmeler", short: "Sözleşmeler", hint: "Belgeler personel bilgileriyle doldurulmuş olarak indirilir. Çıktı alıp imzalatın, sonra taranmış halini yükleyin." },
  { n: 4, title: "İş güvenliği evrakları", short: "İSG", hint: "İSG talimatı, koruyucu malzeme belgesi, eğitim katılım formları ve sınav. Eğitim tarihi ve sonucu eğitmen tarafından elle yazılır." },
  { n: 5, title: "Sağlık bilgileri", short: "Sağlık", hint: "Muayene formu işyeri hekimine verilir; sağlık raporu ve aşı kartı yüklenir." },
  { n: 6, title: "İşe giriş formları", short: "Formlar", hint: "İş başvuru ve bilgi formu ile zimmet tutanağı. Sonra kaydı tamamlayın." },
];

/** e-Devlet'te belgenin alındığı hizmet sayfası (personel kendi hesabıyla girip PDF indirir) */
const EDEVLET: Record<string, string> = {
  "Nüfus kayıt örneği": "https://www.turkiye.gov.tr/nvi-nufus-kayit-ornegi-belge-sorgulama",
  "İkametgah belgesi": "https://www.turkiye.gov.tr/nvi-yerlesim-yeri-ve-diger-adres-belgesi-sorgulama",
  "Adli sicil kaydı": "https://www.turkiye.gov.tr/adli-sicil-kaydi",
  "Askerlik durum belgesi": "https://www.turkiye.gov.tr/msb-askerlik-durum-belgesi",
  "SGK hizmet dökümü": "https://www.turkiye.gov.tr/sgk-tescil-ve-hizmet-dokumu",
  "Diploma": "https://www.turkiye.gov.tr/yok-mezun-belgesi-sorgulama",
};

type DocType = { id: string; name: string; required: boolean; has_expiry: boolean; onboarding_step: number | null; template_key: string | null; description: string | null; sort_order: number };

export default async function OnboardingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ adim?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const step = Math.min(6, Math.max(1, Number(sp.adim) || 1));
  const supabase = await createClient();

  const [{ data: e }, { data: typesRaw, error: typesErr }, { data: docs }, d] = await Promise.all([
    supabase.from("employees").select("id, first_name, last_name, hire_date, status, position_title, card_no, departments(name)").eq("id", id).maybeSingle(),
    supabase.from("document_types").select("id, name, required, has_expiry, onboarding_step, template_key, description, sort_order").order("sort_order"),
    supabase.from("employee_documents").select("id, document_type_id, file_name, file_path, expires_on, uploaded_at").eq("employee_id", id).order("uploaded_at"),
    docData(supabase, id, s.companyId),
  ]);
  if (!e || !d) notFound();
  const types = ((typesRaw ?? []) as DocType[]).filter((t) => t.onboarding_step !== undefined);
  const migrationMissing = !!typesErr || types.every((t) => t.onboarding_step === null || t.onboarding_step === undefined);
  const name = `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim();
  const dept = (e.departments as unknown as { name: string } | null)?.name;

  const byType = new Map<string, NonNullable<typeof docs>>();
  for (const x of docs ?? []) byType.set(x.document_type_id, [...(byType.get(x.document_type_id) ?? []), x]);
  const signed = new Map<string, string>();
  if (docs?.length) {
    const { data: urls } = await supabase.storage.from("documents").createSignedUrls(docs.map((x) => x.file_path), 600);
    (urls ?? []).forEach((u, i) => u.signedUrl && signed.set(docs[i]!.id, u.signedUrl));
  }
  const stepTypes = types.filter((t) => t.onboarding_step === step);
  const stepDone = (n: number) => {
    const req = types.filter((t) => t.onboarding_step === n && t.required);
    return req.length > 0 && req.every((t) => byType.has(t.id));
  };
  const progress = (n: number) => {
    const all = types.filter((t) => t.onboarding_step === n);
    return `${all.filter((t) => byType.has(t.id)).length}/${all.length}`;
  };
  const templatesInStep = stepTypes.filter((t) => t.template_key && TEMPLATES[t.template_key]);
  const cur = STEPS[step - 1]!;
  const btn = "h-11 px-4 inline-flex items-center justify-center rounded-[10px] font-semibold";

  return (
    <>
      <PageHeader
        title={`Personel kaydı · ${name}`}
        subtitle={`${[dept, e.position_title, e.card_no ? `PDKS ${e.card_no}` : ""].filter(Boolean).join(" · ")} · Adım ${step}/6: ${cur.title}`}
        actions={<Link href={`/personel/${id}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Personel sayfası</Link>}
      />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1040px]">
        {/* Adımlar */}
        <ol className="grid grid-cols-3 md:grid-cols-6 gap-2" aria-label="Kayıt adımları">
          {STEPS.map((st) => {
            const active = st.n === step;
            const ok = st.n === 1 ? d.missing.length === 0 : stepDone(st.n);
            return (
              <li key={st.n}>
                <Link
                  href={`/personel/${id}/kayit?adim=${st.n}`}
                  aria-current={active ? "step" : undefined}
                  className={`flex flex-col gap-1 rounded-xl border p-3 h-full ${active ? "border-brand-700 bg-brand-700 text-white" : "border-[#D5DEE8] bg-white text-ink"}`}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold">
                    <span className={`w-6 h-6 rounded-full grid place-items-center text-[11px] ${active ? "bg-white text-brand-700" : ok ? "bg-[#1E7A4C] text-white" : "bg-[#EEF2F6] text-[#33414F]"}`}>{ok && !active ? "✓" : st.n}</span>
                    {st.short}
                  </span>
                  <span className={`text-[11px] ${active ? "text-white/80" : "text-muted"}`}>{st.n === 1 ? (d.missing.length ? `${d.missing.length} eksik bilgi` : "tamam") : progress(st.n)}</span>
                </Link>
              </li>
            );
          })}
        </ol>

        <section className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-4">
          <div className="flex flex-wrap justify-between items-start gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-brand-800">{step}. {cur.title}</h2>
              <p className="text-sm text-muted mt-1 max-w-[720px]">{cur.hint}</p>
            </div>
            {templatesInStep.length > 1 && (
              <a href={`/personel/${id}/belge/hepsi?adim=${step}`} className={`${btn} bg-brand-700 text-white`}>Bu adımın belgelerini indir ({templatesInStep.length} dosya, zip)</a>
            )}
          </div>

          {migrationMissing && (
            <p className="text-sm text-bad bg-[#FDECEA] rounded-lg p-3">
              Belge adımları veritabanında tanımlı değil: Supabase&apos;de <code>20261029000000_onboarding_docs.sql</code> dosyasını çalıştırın. O zamana kadar belgeler personel sayfasındaki özlük dosyasından yüklenebilir.
            </p>
          )}

          {step === 1 && (
            <div className="flex flex-col gap-3">
              <dl className="grid gap-x-6 gap-y-2 md:grid-cols-2 text-sm">
                {[
                  ["Ad soyad", d.data.ad_soyad], ["TC kimlik no", d.data.tc], ["Doğum", d.data.dogum], ["Telefon / e-posta", d.data.tel_eposta],
                  ["Adres", d.data.adres], ["Görev / bölüm", `${d.data.gorev}${dept && d.data.gorev !== dept ? ` · ${dept}` : ""}`], ["İşe giriş", d.data.ise_baslama], ["SGK sicil no", d.data.sgk_no],
                  ["Kan grubu", d.data.kan_grubu], ["Askerlik", d.data.askerlik], ["Öğrenim", d.data.egitim], ["Medeni durum / çocuk", `${d.data.medeni} · ${d.data.cocuk}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex gap-3 border-b border-[#EEF2F6] py-1.5">
                    <dt className="text-muted w-40 shrink-0">{k}</dt>
                    <dd className={v.startsWith("…") ? "text-warn" : ""}>{v}</dd>
                  </div>
                ))}
              </dl>
              {d.missing.length > 0 ? (
                <p className="text-sm text-warn bg-[#FFF4E0] rounded-lg p-3">Sözleşmelerde boş kalacak: {d.missing.join(", ")}. Düzenle&apos;den tamamlayın; sonra belgeler bu bilgilerle dolu iner.</p>
              ) : (
                <p className="text-sm text-ok bg-ok-bg rounded-lg p-3">Sözleşmeler için gereken bilgiler tamam.</p>
              )}
              <div className="flex gap-2 flex-wrap">
                <Link href={`/personel/${id}/duzenle?sonra=kayit`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Bilgileri düzenle</Link>
                <Link href={`/personel/${id}/zam`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>Ücret kaydı</Link>
              </div>
            </div>
          )}

          {step > 1 && (
            <ul className="flex flex-col divide-y divide-[#EEF2F6]">
              {stepTypes.map((t) => {
                const files = byType.get(t.id) ?? [];
                const tpl = t.template_key ? TEMPLATES[t.template_key] : null;
                return (
                  <li key={t.id} className="py-3.5 flex flex-col gap-2">
                    <div className="flex gap-3 items-start">
                      <span aria-hidden className={`mt-1.5 w-3 h-3 rounded-full shrink-0 ${files.length ? "bg-[#1E7A4C]" : t.required ? "bg-[#B42318]" : "bg-[#C5D0DC]"}`} />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold">{t.name}{!t.required && <span className="text-muted font-normal"> · isteğe bağlı</span>}</div>
                        {t.description && <div className="text-xs text-muted">{t.description}</div>}
                        {EDEVLET[t.name] && (
                          <a href={EDEVLET[t.name]} target="_blank" rel="noreferrer" className="text-xs font-semibold text-brand-700">e-Devlet&apos;te aç → belgeyi PDF indirip buraya yükleyin</a>
                        )}
                        {files.map((f) => (
                          <div key={f.id} className="flex gap-2 items-center text-xs mt-1">
                            <a href={signed.get(f.id) ?? "#"} target="_blank" rel="noreferrer" className="text-brand-700 font-semibold truncate">{f.file_name ?? "Dosya"}</a>
                            <span className="text-muted num">{formatDate(f.uploaded_at.slice(0, 10))}{f.expires_on ? ` · bitiş ${formatDate(f.expires_on)}` : ""}</span>
                            <form action={deleteDocument}>
                              <input type="hidden" name="id" value={f.id} />
                              <input type="hidden" name="employeeId" value={id} />
                              <ConfirmSubmit label="Sil" question="Dosya silinsin mi?" className="text-bad font-semibold" />
                            </form>
                          </div>
                        ))}
                      </div>
                      {tpl && (
                        <a href={`/personel/${id}/belge/${t.template_key}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700 text-sm whitespace-nowrap`}>
                          {tpl.pdf ? "Çıktı al (PDF)" : "Dolu belgeyi indir"}
                        </a>
                      )}
                    </div>
                    <form action={uploadDocument} className="flex flex-wrap gap-2 items-center pl-6">
                      <input type="hidden" name="employeeId" value={id} />
                      <input type="hidden" name="typeId" value={t.id} />
                      <input type="hidden" name="next" value={`/personel/${id}/kayit?adim=${step}`} />
                      <input type="file" name="file" required accept=".pdf,.jpg,.jpeg,.png,.heic" aria-label={`${t.name} yükle`} className="text-sm max-w-64" />
                      {t.has_expiry && <input type="date" name="expires_on" aria-label="Geçerlilik bitişi" className="h-10 rounded-lg border border-[#D5DEE8] px-2 text-sm" />}
                      <button className="h-10 px-3.5 rounded-lg border border-[#D5DEE8] text-sm font-semibold text-brand-700">{files.length ? "Bir dosya daha yükle" : "İmzalı belgeyi yükle"}</button>
                    </form>
                  </li>
                );
              })}
              {stepTypes.length === 0 && <li className="py-6 text-center text-muted">Bu adımda belge türü yok.</li>}
            </ul>
          )}
        </section>

        <div className="flex flex-wrap justify-between gap-2">
          {step > 1 ? <Link href={`/personel/${id}/kayit?adim=${step - 1}`} className={`${btn} border border-[#D5DEE8] bg-white text-brand-700`}>← {STEPS[step - 2]!.title}</Link> : <span />}
          {step < 6 ? (
            <Link href={`/personel/${id}/kayit?adim=${step + 1}`} className={`${btn} bg-brand-700 text-white`}>{STEPS[step]!.title} →</Link>
          ) : (
            <form action={finishOnboarding}>
              <input type="hidden" name="employeeId" value={id} />
              <PendingSubmit className={`${btn} bg-[#1E7A4C] text-white`}>Kaydı tamamla ✓</PendingSubmit>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
