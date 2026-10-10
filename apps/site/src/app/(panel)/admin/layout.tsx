import { signOut } from "../giris/actions";
import { AdminNav } from "@/components/admin/AdminNav";
import { requireSiteEditor } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requireSiteEditor();
  const supabase = await createClient();
  const [{ data: unread }, { data: pendingAcc }, { data: chats }, { data: priceReq }] = await Promise.all([
    supabase.rpc("cms_unread_messages"),
    supabase.rpc("portal_pending_count"),
    supabase.rpc("cms_unread_chats"),
    supabase.rpc("portal_price_requests_count"),
  ]);
  const unreadCount = typeof unread === "number" ? unread : 0;
  const pendingCount = (typeof pendingAcc === "number" ? pendingAcc : 0) + (typeof priceReq === "number" ? priceReq : 0);
  const badge: Record<string, number> = {
    "/admin/gelen-kutusu": unreadCount,
    "/admin/portal": pendingCount,
    "/admin/canli-destek": typeof chats === "number" ? chats : 0,
  };
  return (
    <div className="min-h-dvh lg:flex">
      <AdminNav badges={badge} email={user.email ?? ""} showErp={user.erpRoles.length > 0 && !!process.env.NEXT_PUBLIC_ERP_URL} signOut={signOut} />
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-8 lg:py-10">{children}</main>
    </div>
  );
}
