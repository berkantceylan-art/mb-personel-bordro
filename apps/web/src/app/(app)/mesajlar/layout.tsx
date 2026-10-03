import { PageHeader } from "@/components/ui";
import { MessagesShell } from "@/components/Chat";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

type Dir = { user_id: string; display_name: string; role: string; employee_id: string | null; department: string | null };

export default async function MessagesLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  const supabase = await createClient();
  const [{ data: mine }, { data: dirRaw }, { data: depts }] = await Promise.all([
    supabase.from("conversation_members").select("conversation_id, last_read_at, conversations(id, kind, title, last_message_at)").eq("user_id", s.userId),
    supabase.rpc("company_directory"),
    !["owner", "hr", "branch_manager"].includes(s.role) ? Promise.resolve({ data: [] }) : supabase.from("departments").select("id, name").order("name"),
  ]);
  const dir = (dirRaw ?? []) as Dir[];
  const names = new Map(dir.map((d) => [d.user_id, d.display_name]));
  const convIds = (mine ?? []).map((m) => m.conversation_id as string);
  const [{ data: members }, { data: lastMsgs }] = convIds.length
    ? await Promise.all([
        supabase.from("conversation_members").select("conversation_id, user_id").in("conversation_id", convIds),
        supabase.from("messages").select("conversation_id, body, sender_id, created_at").in("conversation_id", convIds).order("created_at", { ascending: false }).limit(400),
      ])
    : [{ data: [] }, { data: [] }];
  const last = new Map<string, { body: string; sender_id: string }>();
  for (const m of lastMsgs ?? []) if (!last.has(m.conversation_id)) last.set(m.conversation_id, m);

  const convs = (mine ?? [])
    .map((m) => {
      const c = m.conversations as unknown as { id: string; kind: string; title: string | null; last_message_at: string };
      const others = (members ?? []).filter((x) => x.conversation_id === c.id && x.user_id !== s.userId).map((x) => names.get(x.user_id) ?? "Kullanıcı");
      return {
        id: c.id,
        title: c.kind === "GROUP" ? (c.title ?? "Grup") : (others[0] ?? "Ben"),
        sub: c.kind === "GROUP" ? `${others.length + 1} kişi` : "",
        at: c.last_message_at,
        unread: c.last_message_at > m.last_read_at,
        last: last.get(c.id),
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));

  return (
    <>
      <PageHeader title="Mesajlar" subtitle="Ekip içi yazışma · mesajlar anında iletilir" />
      <div className="p-0 md:p-6 flex-1 min-h-0">
        <MessagesShell
          me={s.userId}
          convs={convs}
          people={dir.filter((d) => d.user_id !== s.userId).map((d) => ({ id: d.user_id, name: d.display_name, sub: d.department ?? "" }))}
          departments={depts ?? []}
        >
          {children}
        </MessagesShell>
      </div>
    </>
  );
}
