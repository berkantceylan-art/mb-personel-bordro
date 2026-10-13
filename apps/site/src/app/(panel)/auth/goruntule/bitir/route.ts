import { NextResponse } from "next/server";
import { ERP_URL } from "@/lib/handoff";
import { createClient } from "@/lib/supabase/server";

/** Portal görüntülemesini bitir: oturum kapatılır, yönetici ERP'deki görüntüleme ekranına döner. */
async function end(req: Request) {
  const origin = new URL(req.url).origin;
  const supabase = await createClient();
  const { data } = await supabase.rpc("imp_end_self");
  if (data) await supabase.auth.signOut({ scope: "local" });
  const res = NextResponse.redirect(data ? (ERP_URL ? `${ERP_URL}/yonetim/goruntule?bitti=1` : `${origin}/giris`) : `${origin}/portal`, 303);
  res.cookies.delete("mb_imp");
  return res;
}

export const POST = end;
export const GET = end;
