import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { ApplyForm } from "./ApplyForm";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Kariyer · İş başvurusu", description: "Açık pozisyonlar ve iş başvuru formu" };

type Posting = { id: string; slug: string; title: string; description: string | null; requirements: string | null; employment_type: string; experience: string | null; location: string | null; departments: unknown };

/**
 * Herkese açık kariyer sayfası. Web sitesine bağlantı ya da iframe olarak eklenir:
 *   /kariyer            → ilanlar + form
 *   /kariyer?ilan=slug  → ilan seçili form
 *   /kariyer?gom=1      → üst/alt bölümsüz (iframe için)
 */
export default async function CareerPage({ searchParams }: { searchParams: Promise<{ ilan?: string; gom?: string }> }) {
  const sp = await searchParams;
  const embed = sp.gom === "1";
  let postings: Posting[] = [];
  let company = "";
  try {
    const admin = createAdminClient();
    const companyId = process.env.PUBLIC_COMPANY_ID || (await admin.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id;
    const [{ data }, { data: co }] = await Promise.all([
      admin.from("job_postings").select("id, slug, title, description, requirements, employment_type, experience, location, departments(name)").eq("company_id", companyId!).eq("status", "open").order("created_at", { ascending: false }),
      admin.from("companies").select("name").eq("id", companyId!).maybeSingle(),
    ]);
    postings = (data ?? []) as Posting[];
    company = co?.name ?? "";
  } catch {
    postings = [];
  }
  const selected = postings.find((p) => p.slug === sp.ilan)?.id ?? "";
  const dept = (p: Posting) => (p.departments as { name: string } | null)?.name;

  return (
    <div className="min-h-dvh bg-[#F5F7FA] text-ink">
      {!embed && (
        <header className="bg-brand-900 text-white">
          <div className="max-w-[1080px] mx-auto px-4 md:px-6 py-10 md:py-14 flex flex-col gap-3">
            <div className="text-xs font-bold uppercase tracking-[.12em] text-[#9FC1E6]">Kariyer · {company}</div>
            <h1 className="font-display text-3xl md:text-[40px] font-bold leading-tight max-w-[680px]">Gülüşleri birlikte üretelim</h1>
            <p className="text-[#D6E4F2] text-base md:text-lg max-w-[620px]">Başvurunuz birkaç dakika sürer. Gönderdikten sonra size özel bağlantıdan başvurunuzun hangi aşamada olduğunu takip edebilirsiniz.</p>
          </div>
        </header>
      )}
      <main className="max-w-[1080px] mx-auto px-4 md:px-6 py-8 flex flex-col gap-8">
        <section aria-labelledby="acik" className="flex flex-col gap-4">
          <h2 id="acik" className="font-display text-2xl font-bold text-brand-900">Açık pozisyonlar</h2>
          {postings.length === 0 && <p className="text-muted">Şu an açık ilan yok. Aşağıdan genel başvuru bırakabilirsiniz; uygun pozisyon açıldığında size ulaşırız.</p>}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {postings.map((p) => (
              <article key={p.id} className="bg-white border border-line rounded-[14px] p-5 flex flex-col gap-2.5">
                {dept(p) && <div className="text-xs font-bold uppercase tracking-wide text-brand-600">{dept(p)}</div>}
                <h3 className="text-lg font-semibold text-ink">{p.title}</h3>
                {p.description && <p className="text-sm text-muted leading-relaxed whitespace-pre-line">{p.description}</p>}
                {p.requirements && <details className="text-sm"><summary className="cursor-pointer font-semibold text-brand-700">Aranan nitelikler</summary><p className="mt-1 text-muted whitespace-pre-line">{p.requirements}</p></details>}
                <div className="flex flex-wrap gap-2 text-xs">
                  {[p.employment_type, p.experience, p.location].filter(Boolean).map((t) => <span key={t} className="bg-[#EEF3F9] rounded-full px-2.5 py-1">{t}</span>)}
                </div>
                <a href={`/kariyer?ilan=${p.slug}${embed ? "&gom=1" : ""}#basvuru`} className="mt-auto h-11 rounded-[10px] bg-brand-700 text-white font-semibold grid place-items-center">Bu pozisyona başvur</a>
              </article>
            ))}
          </div>
        </section>
        <ApplyForm postings={postings.map((p) => ({ id: p.id, title: p.title }))} selected={selected} />
      </main>
      {!embed && <footer className="text-center text-xs text-muted py-6">{company} · Kişisel verileriniz yalnız işe alım için kullanılır.</footer>}
    </div>
  );
}
