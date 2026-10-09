import type { Metadata } from "next";
import { candidateNotice } from "@/lib/kvkk";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "KVKK aydınlatma metni" };

/** Herkese açık aday aydınlatma metni (kariyer sayfasından bağlantı) */
export default async function PublicNoticePage() {
  let title = "Çalışan adayı aydınlatma metni";
  let body = "";
  try {
    const admin = createAdminClient();
    const companyId = process.env.PUBLIC_COMPANY_ID || (await admin.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id;
    const [{ data: n }, { data: c }] = await Promise.all([
      admin.from("kvkk_notices").select("title, body").eq("company_id", companyId!).eq("audience", "candidate").eq("kind", "aydinlatma").eq("active", true).maybeSingle(),
      admin.from("companies").select("name").eq("id", companyId!).maybeSingle(),
    ]);
    title = n?.title ?? title;
    body = n?.body ?? candidateNotice({ name: c?.name ?? "Şirketimiz" });
  } catch {
    body = candidateNotice({ name: "Şirketimiz" });
  }
  return (
    <main className="min-h-dvh bg-[#F5F7FA] p-4 md:p-8">
      <article className="max-w-[760px] mx-auto bg-white border border-line rounded-2xl p-6 flex flex-col gap-4">
        <h1 className="font-display text-2xl font-bold text-brand-900">{title}</h1>
        <p className="whitespace-pre-line leading-relaxed text-[15px]">{body}</p>
        <p className="text-sm"><a href="/kvkk-basvuru" className="font-semibold text-brand-700">KVKK kapsamındaki haklarınız için başvuru yapın →</a></p>
      </article>
    </main>
  );
}
