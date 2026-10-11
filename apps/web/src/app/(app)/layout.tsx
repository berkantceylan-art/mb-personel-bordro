import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { FlashMessage } from "@/components/FlashMessage";
import { MobileNav } from "@/components/MobileNav";
import { InstallHint } from "@/components/Pwa";
import { LiveUpdates } from "@/components/LiveUpdates";
import { Sidebar } from "@/components/Sidebar";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Personel rolünün web'de girebildiği bölümler */
const EMPLOYEE_PATHS = ["/benim", "/duyurular", "/mesajlar", "/bildirimler", "/asistan"];
const EDITOR_PATHS = ["/duyurular", "/mesajlar", "/bildirimler", "/asistan"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const supabaseBig = await createClient();
  const { data: pref } = await supabaseBig.from("notification_prefs").select("big_text").eq("user_id", s.userId).maybeSingle();
  const big = (pref as { big_text?: boolean } | null)?.big_text === true;
  const path = (await headers()).get("x-pathname") ?? "/";
  // Laboratuvar / kargo yetkisi olan personel: kargo, iş kayıt ve modül sayfaları
  const anyModule = Object.values(s.modules).some((v) => v > 0);
  const allowKargo = (s.logistics && ["/kargo", "/isler"].some((p) => path.startsWith(p))) || path.startsWith("/modul/") || (anyModule && ["/finans", "/stok", "/satis", "/alis", "/uretim", "/demirbas", "/masraf"].some((p) => path.startsWith(p)));
  if (s.role === "employee" && !allowKargo && !EMPLOYEE_PATHS.some((p) => path.startsWith(p))) redirect("/benim");
  // Yalnız web sitesi editörü: ERP'de iletişim modülleri ve site yönetimi bağlantısı
  if (s.role === "site_editor" && !allowKargo && !EDITOR_PATHS.some((p) => path.startsWith(p))) redirect("/duyurular");

  const supabase = await createClient();
  const [{ count: unreadNotif }, { data: convs }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", s.userId).eq("silent", false).is("read_at", null),
    supabase.from("conversation_members").select("last_read_at, conversations(last_message_at)").eq("user_id", s.userId),
  ]);
  const unreadMsg = (convs ?? []).filter((c) => {
    const last = (c.conversations as unknown as { last_message_at: string } | null)?.last_message_at;
    return last && last > c.last_read_at;
  }).length;

  const badges = { "/bildirimler": unreadNotif ?? 0, "/mesajlar": unreadMsg };
  return (
    <div className={`min-h-screen flex flex-col md:flex-row ${big ? "big-text" : ""}`}>
      <Sidebar companyName={s.companyName} role={s.role} siteAccess={s.siteAccess} logistics={s.logistics} modules={s.modules} badges={badges} />
      <MobileNav companyName={s.companyName} role={s.role} badges={badges} boss={s.boss || s.role === "owner"} siteAccess={s.siteAccess} logistics={s.logistics} modules={s.modules} />
      <main className="flex-1 min-w-0 flex flex-col pb-[calc(72px+env(safe-area-inset-bottom))] md:pb-0">
        <FlashMessage />
        <LiveUpdates userId={s.userId} />
        <InstallHint />
        {children}
      </main>
    </div>
  );
}
