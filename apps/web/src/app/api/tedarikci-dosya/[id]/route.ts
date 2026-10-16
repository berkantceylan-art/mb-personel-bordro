import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Tedarikçi belgesi: erişim RLS ile denetlenir (tedarikçinin kendisi ya da satın alma / finans), kısa ömürlü imzalı bağlantıya yönlendirir */
export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new NextResponse("Bulunamadı", { status: 404 });
  const sb = await createClient();
  const { data: d } = await sb.from("sup_documents").select("file_path, file_name").eq("id", id).maybeSingle();
  if (!d) return new NextResponse("Belge bulunamadı ya da yetkiniz yok", { status: 404 });
  const { data, error } = await createAdminClient().storage.from("supplier-files").createSignedUrl(d.file_path as string, 120, { download: false });
  if (error || !data) return new NextResponse("Dosya açılamadı", { status: 500 });
  return NextResponse.redirect(data.signedUrl);
}
