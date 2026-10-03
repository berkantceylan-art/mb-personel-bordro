import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Personel rolünün web'de girebildiği bölümler */
const EMPLOYEE_PATHS = ["/benim", "/duyurular", "/mesajlar", "/bildirimler"];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const path = (await headers()).get("x-pathname") ?? "/";
  if (s.role === "employee" && !EMPLOYEE_PATHS.some((p) => path.startsWith(p))) redirect("/benim");

  const supabase = await createClient();
  const [{ count: unreadNotif }, { data: convs }] = await Promise.all([
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", s.userId).is("read_at", null),
    supabase.from("conversation_members").select("last_read_at, conversations(last_message_at)").eq("user_id", s.userId),
  ]);
  const unreadMsg = (convs ?? []).filter((c) => {
    const last = (c.conversations as unknown as { last_message_at: string } | null)?.last_message_at;
    return last && last > c.last_read_at;
  }).length;

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      <Sidebar companyName={s.companyName} role={s.role} badges={{ "/bildirimler": unreadNotif ?? 0, "/mesajlar": unreadMsg }} />
      <main className="flex-1 min-w-0 flex flex-col">{children}</main>
    </div>
  );
}
