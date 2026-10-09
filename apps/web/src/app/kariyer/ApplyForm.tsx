"use client";
import { useActionState, useRef, useState } from "react";
import { EDUCATION_OPTIONS, EXPERIENCE_OPTIONS, HEARD_OPTIONS, SKILL_OPTIONS } from "@/lib/recruiting";
import { submitApplication, type ApplyResult } from "./actions";

const inp = "h-12 w-full rounded-[10px] border border-[#C9D4E0] bg-white px-3.5 text-base text-ink focus:outline-2 focus:outline-brand-600";
const lbl = "flex flex-col gap-1.5 text-sm font-semibold text-[#33475B]";
const STEPS = ["Kişisel bilgiler", "Deneyim", "Belgeler ve onay"];

export function ApplyForm({ postings, selected }: { postings: Array<{ id: string; title: string }>; selected: string }) {
  const [state, action, pending] = useActionState<ApplyResult | null, FormData>(submitApplication, null);
  const [step, setStep] = useState(0);
  const sets = useRef<Array<HTMLFieldSetElement | null>>([]);
  const go = (to: number) => {
    if (to > step) {
      const fs = sets.current[step];
      const bad = fs ? [...fs.querySelectorAll<HTMLInputElement>("input, select, textarea")].find((el) => !el.checkValidity()) : null;
      if (bad) { bad.reportValidity(); return; }
    }
    setStep(to);
    document.getElementById("basvuru")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  if (state?.ok) {
    const link = state.token ? `/basvuru/${state.token}` : null;
    return (
      <section id="basvuru" className="bg-white border border-line rounded-2xl p-6 md:p-8 flex flex-col items-center text-center gap-3">
        <div className="w-16 h-16 rounded-full bg-[#E6F4EC] grid place-items-center" aria-hidden>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#1A7F52" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
        </div>
        <h2 className="font-display text-2xl font-bold text-brand-900">Başvurunuz alındı</h2>
        <p className="text-muted max-w-[520px]">Başvuru numaranız <b className="text-ink">{state.code}</b>. Aşağıdaki bağlantıyı kaydedin; başvurunuzun hangi aşamada olduğunu ve mülakat davetini buradan görürsünüz.</p>
        {link && <a href={link} className="h-12 px-5 rounded-[10px] bg-brand-700 text-white font-semibold inline-flex items-center">Başvurumu takip et</a>}
      </section>
    );
  }

  return (
    <section id="basvuru" aria-labelledby="bf" className="bg-white border border-line rounded-2xl p-5 md:p-7 flex flex-col gap-5 scroll-mt-4">
      <h2 id="bf" className="font-display text-2xl font-bold text-brand-900">Başvuru formu</h2>
      <ol className="grid grid-cols-3 gap-2" aria-label="Adımlar">
        {STEPS.map((n, i) => (
          <li key={n} className="flex flex-col gap-1.5" aria-current={i === step ? "step" : undefined}>
            <span className={`h-1.5 rounded-full ${i <= step ? "bg-brand-700" : "bg-[#E1E8F0]"}`} />
            <span className={`text-xs md:text-sm ${i === step ? "font-bold text-ink" : i < step ? "text-ink" : "text-muted"}`}>{i + 1}. {n}</span>
          </li>
        ))}
      </ol>
      <form action={action} className="flex flex-col gap-5" noValidate={false}>
        <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        <fieldset ref={(el) => { sets.current[0] = el; }} className={step === 0 ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
          <legend className="sr-only">Kişisel bilgiler</legend>
          <label className={`${lbl} sm:col-span-2`}>Başvurduğunuz pozisyon
            <select name="posting_id" defaultValue={selected} className={inp}>
              <option value="">Genel başvuru (uygun pozisyon açılınca)</option>
              {postings.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          <label className={lbl}>Ad<input name="first_name" required autoComplete="given-name" className={inp} /></label>
          <label className={lbl}>Soyad<input name="last_name" required autoComplete="family-name" className={inp} /></label>
          <label className={lbl}>Cep telefonu<input name="phone" type="tel" inputMode="tel" required pattern="[0-9 +()-]{10,16}" placeholder="05xx xxx xx xx" autoComplete="tel" className={inp} /></label>
          <label className={lbl}>E-posta (isteğe bağlı)<input name="email" type="email" autoComplete="email" className={inp} /></label>
          <label className={lbl}>Doğum tarihi<input name="birth_date" type="date" className={inp} /></label>
          <label className={lbl}>Oturduğunuz ilçe<input name="district" placeholder="Örn. Karabağlar" className={inp} /></label>
          <label className={lbl}>Askerlik durumu<select name="military" className={inp} defaultValue=""><option value="">Seçiniz</option><option>Yapıldı</option><option>Muaf</option><option>Tecilli</option><option>Kadın aday</option></select></label>
          <label className={lbl}>Ne zaman başlayabilirsiniz?<select name="start_when" className={inp}><option>Hemen</option><option>2 hafta içinde</option><option>1 ay içinde</option></select></label>
        </fieldset>

        <fieldset ref={(el) => { sets.current[1] = el; }} className={step === 1 ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
          <legend className="sr-only">Deneyim</legend>
          <label className={lbl}>Öğrenim<select name="education" className={inp}>{EDUCATION_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className={lbl}>Sektör deneyimi<select name="experience" className={inp}>{EXPERIENCE_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className={lbl}>Son çalıştığınız yer<input name="last_employer" className={inp} /></label>
          <label className={lbl}>Beklediğiniz aylık net ücret (TL)<input name="expected_wage" inputMode="numeric" className={inp} /></label>
          <fieldset className="sm:col-span-2 border border-line rounded-xl px-4 py-3 flex flex-wrap gap-x-5 gap-y-3">
            <legend className="px-1 text-sm font-semibold text-[#33475B]">Bildiğiniz işler</legend>
            {SKILL_OPTIONS.map((o) => <label key={o} className="flex items-center gap-2 text-[15px] min-h-[32px]"><input type="checkbox" name="skills" value={o} className="w-5 h-5" />{o}</label>)}
          </fieldset>
          <label className={`${lbl} sm:col-span-2`}>Kısaca kendinizden bahsedin<textarea name="about" rows={4} maxLength={2000} className={`${inp} h-auto py-3`} /></label>
        </fieldset>

        <fieldset ref={(el) => { sets.current[2] = el; }} className={step === 2 ? "grid gap-4 sm:grid-cols-2" : "hidden"}>
          <legend className="sr-only">Belgeler ve onay</legend>
          <label className={lbl}>Özgeçmiş (PDF, Word veya fotoğraf)<input name="cv" type="file" accept=".pdf,.doc,.docx,image/*" className={`${inp} pt-2.5`} /></label>
          <label className={lbl}>İş örnekleri (en çok 3 dosya, isteğe bağlı)<input name="portfolio" type="file" multiple accept=".pdf,image/*" className={`${inp} pt-2.5`} /></label>
          <label className={lbl}>Bizi nereden duydunuz?<select name="heard_from" className={inp}>{HEARD_OPTIONS.map((o) => <option key={o}>{o}</option>)}</select></label>
          <label className={lbl}>Sizi öneren çalışanımız (varsa)<input name="referrer_name" className={inp} /></label>
          <div className="sm:col-span-2 rounded-xl bg-[#F5F7FA] p-4 flex flex-col gap-3 text-sm leading-relaxed text-[#33475B]">
            <label className="flex gap-3 items-start"><input type="checkbox" name="kvkk" required className="w-5 h-5 mt-0.5 shrink-0" /><span><b>KVKK aydınlatma:</b> Başvurumda verdiğim bilgilerin yalnız işe alım değerlendirmesi için işlenmesini ve değerlendirme bitince en geç 6 ay sonra silinmesini kabul ediyorum. (Zorunlu)</span></label>
            <label className="flex gap-3 items-start"><input type="checkbox" name="keep_in_pool" className="w-5 h-5 mt-0.5 shrink-0" /><span>Başvurum 1 yıl aday havuzunda tutulsun; uygun başka pozisyonlar için de aranabilirim.</span></label>
          </div>
        </fieldset>

        {state && !state.ok && <p role="alert" className="rounded-lg bg-[#FDECEA] text-[#9B1C1C] px-3 py-2 text-sm font-semibold">{state.message}</p>}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
          <button type="button" onClick={() => go(step - 1)} disabled={step === 0} className="h-12 px-5 rounded-[10px] border border-[#C9D4E0] bg-white font-semibold text-brand-700 disabled:opacity-40">Geri</button>
          <span className="hidden sm:inline text-sm text-muted">Adım {step + 1} / 3</span>
          {step < 2
            ? <button type="button" onClick={() => go(step + 1)} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">Devam</button>
            : <button type="submit" disabled={pending} className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold disabled:opacity-60">{pending ? "Gönderiliyor…" : "Başvuruyu gönder"}</button>}
        </div>
      </form>
    </section>
  );
}
