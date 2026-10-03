import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { markNotificationsRead } from "@/lib/comms-actions";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export default async function NotificationsPage() {
  const s = await getSession();
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("*").eq("user_id", s.userId).order("created_at", { ascending: false }).limit(200);
  const unread = (data ?? []).filter((n) => !n.read_at).length;
  return (
    <>
      <PageHeader
        title="Bildirimler"
        subtitle={unread ? `${unread} okunmamış` : "Hepsi okundu"}
        actions={unread > 0 && (
          <form action={markNotificationsRead}><button className="h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Tümünü okundu say</button></form>
        )}
      />
      <div className="p-4 md:p-6 max-w-[900px]">
        <ul className="bg-white border border-line rounded-[14px] divide-y divide-[#EEF2F6]">
          {(data ?? []).map((n) => {
            const inner = (
              <div className="flex gap-3 px-5 py-3.5">
                <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${n.read_at ? "bg-transparent" : "bg-accent"}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <div className={`${n.read_at ? "font-medium" : "font-bold"} text-ink`}>{n.title}</div>
                  {n.body && <div className="text-sm text-muted truncate">{n.body}</div>}
                </div>
                <span className="text-xs text-muted whitespace-nowrap">{new Date(n.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            );
            return <li key={n.id}>{n.link ? <Link href={n.link} className="block hover:bg-[#F6F8FA]">{inner}</Link> : inner}</li>;
          })}
          {(data ?? []).length === 0 && <li className="p-8 text-center text-muted">Bildirim yok.</li>}
        </ul>
      </div>
    </>
  );
}
