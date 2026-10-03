import Link from "next/link";
import { notFound } from "next/navigation";
import { ChatThread } from "@/components/Chat";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  const { id } = await params;
  const supabase = await createClient();
  const [{ data: conv }, { data: members }, { data: msgs }, { data: dir }] = await Promise.all([
    supabase.from("conversations").select("id, kind, title").eq("id", id).maybeSingle(),
    supabase.from("conversation_members").select("user_id").eq("conversation_id", id),
    supabase.from("messages").select("id, sender_id, body, created_at").eq("conversation_id", id).order("created_at", { ascending: false }).limit(200),
    supabase.rpc("company_directory"),
  ]);
  if (!conv) notFound();
  const names = Object.fromEntries(((dir ?? []) as Array<{ user_id: string; display_name: string }>).map((d) => [d.user_id, d.display_name]));
  const others = (members ?? []).filter((m) => m.user_id !== s.userId).map((m) => names[m.user_id] ?? "Kullanıcı");
  const title = conv.kind === "GROUP" ? (conv.title ?? "Grup") : (others[0] ?? "Ben");
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 border-b border-line">
        <Link href="/mesajlar" className="md:hidden text-brand-700 font-semibold" aria-label="Konuşmalara dön">←</Link>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-brand-800 truncate">{title}</div>
          {conv.kind === "GROUP" && <div className="text-xs text-muted truncate">{others.join(", ")}</div>}
        </div>
      </div>
      <ChatThread conversationId={id} me={s.userId} names={names} isGroup={conv.kind === "GROUP"} initial={(msgs ?? []).reverse()} />
    </>
  );
}
