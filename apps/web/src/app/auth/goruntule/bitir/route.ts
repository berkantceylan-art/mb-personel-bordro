import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/** Görüntülemeyi bitir: görüntüleme oturumu kapatılır ve yöneticinin kendi oturumu geri açılır. */
async function end(req: Request) {
  const origin = new URL(req.url).origin;
  const supabase = await createClient();
  const { data } = await supabase.rpc("imp_end_self");
  const info = data as { admin_email?: string } | null;
  if (!info) {
    const res = NextResponse.redirect(`${origin}/`, 303);
    res.cookies.delete("mb_imp");
    return res;
  }
  await supabase.auth.signOut({ scope: "local" });
  let to = "/giris";
  if (info.admin_email) {
    try {
      const admin = createAdminClient();
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email: info.admin_email });
      const hash = link?.properties?.hashed_token;
      if (hash && !(await supabase.auth.verifyOtp({ type: "magiclink", token_hash: hash })).error) to = "/yonetim/goruntule?bitti=1";
    } catch (e) {
      console.error("[goruntule] restore:", (e as Error).message);
    }
  }
  const res = NextResponse.redirect(`${origin}${to}`, 303);
  res.cookies.delete("mb_imp");
  return res;
}

export const POST = end;
export const GET = end;
