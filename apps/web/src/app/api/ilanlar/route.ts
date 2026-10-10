import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Web sitesinin kariyer sayfası için açık ilanlar (yalnız ilan bilgisi; aday verisi yok).
 * Site önce veritabanı fonksiyonunu dener; o yoksa bu uç noktayı kullanır.
 */
export async function GET() {
  try {
    const admin = createAdminClient();
    const companyId = process.env.PUBLIC_COMPANY_ID || (await admin.from("companies").select("id").order("created_at").limit(1).maybeSingle()).data?.id;
    if (!companyId) return NextResponse.json([]);
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await admin
      .from("job_postings")
      .select("slug, title, description, requirements, employment_type, experience, location, closes_on, departments(name)")
      .eq("company_id", companyId)
      .eq("status", "open")
      .or(`closes_on.is.null,closes_on.gte.${today}`)
      .order("created_at", { ascending: false })
      .limit(50);
    const rows = (data ?? []).map((p) => {
      const { departments, ...rest } = p;
      const d = departments as unknown as { name: string } | { name: string }[] | null;
      return { ...rest, department: (Array.isArray(d) ? d[0]?.name : d?.name) ?? null };
    });
    return NextResponse.json(rows, { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } });
  } catch {
    return NextResponse.json([]);
  }
}
