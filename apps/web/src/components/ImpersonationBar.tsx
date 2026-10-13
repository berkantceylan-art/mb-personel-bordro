import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

/** Kullanıcı olarak görüntüleme modundayken her sayfanın üstünde kırmızı şerit */
export async function ImpersonationBar() {
  if (!(await cookies()).get("mb_imp")) return null;
  const supabase = await createClient();
  const { data } = await supabase.rpc("imp_status");
  const st = data as { target: string; admin: string; expires: string | null } | null;
  if (!st) return null;
  const left = st.expires ? Math.max(0, Math.round((new Date(st.expires).getTime() - Date.now()) / 60000)) : null;
  return (
    <div role="status" className="sticky top-0 z-50 bg-[#B42318] text-white px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="font-bold">👁 {st.target} olarak görüntülüyorsunuz</span>
      <span className="opacity-90">Yalnız görüntüleme: kaydetme, silme, gönderme yapılamaz.{left !== null ? ` Oturum ${left} dk içinde kapanır.` : ""}</span>
      <form action="/auth/goruntule/bitir" method="post" className="ml-auto">
        <button className="h-9 px-4 rounded-lg bg-white text-[#B42318] font-bold">Görüntülemeyi bitir</button>
      </form>
    </div>
  );
}
