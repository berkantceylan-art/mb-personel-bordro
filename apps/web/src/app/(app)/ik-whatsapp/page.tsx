import { redirect } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { waConfigured } from "@/lib/whatsapp";
import { WaInbox, type Msg, type Thread } from "./WaInbox";

export const dynamic = "force-dynamic";
export const metadata = { title: "WhatsApp İK" };

/** Şirket WhatsApp'ına personelin yazdıkları: İK görev listesi gibi; yanıt WhatsApp'tan gider */
export default async function WaPage({ searchParams }: { searchParams: Promise<{ t?: string; s?: string }> }) {
  const s = await getSession();
  if ((s.modules.hr ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const supabase = await createClient();
  const st = sp.s === "hepsi" ? null : sp.s === "kapali" ? "done" : "open";
  let q = supabase.from("wa_threads").select("id, wa_id, name, employee_id, status, last_in_at, last_out_at, last_text, unread, employees(first_name, last_name)").order("last_in_at", { ascending: false, nullsFirst: false }).limit(200);
  if (st) q = q.eq("status", st);
  const [{ data, error }, { count: openN }, { data: emps }, { data: dir }] = await Promise.all([
    q,
    supabase.from("wa_threads").select("id", { count: "exact", head: true }).eq("status", "open"),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name").limit(2000),
    supabase.rpc("company_directory"),
  ]);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const threads: Thread[] = ((data ?? []) as unknown as (Omit<Thread, "employee"> & { employees: { first_name: string; last_name: string } | null })[]).map((t) => ({ ...t, employee: t.employees ? `${t.employees.first_name} ${t.employees.last_name}` : null }));
  let active = threads.find((t) => t.id === sp.t) ?? null;
  if (!active && sp.t && /^[0-9a-f-]{36}$/.test(sp.t)) {
    const { data: one } = await supabase.from("wa_threads").select("id, wa_id, name, employee_id, status, last_in_at, last_out_at, last_text, unread, employees(first_name, last_name)").eq("id", sp.t).maybeSingle();
    if (one) { const o = one as unknown as Omit<Thread, "employee"> & { employees: { first_name: string; last_name: string } | null }; active = { ...o, employee: o.employees ? `${o.employees.first_name} ${o.employees.last_name}` : null }; }
  }
  const { data: ms } = active ? await supabase.from("wa_messages").select("id, direction, type, body, media_id, media_mime, filename, status, error, at, sent_by").eq("thread_id", active.id).order("at").limit(500) : { data: [] };
  const messages: Msg[] = ((ms ?? []) as (Omit<Msg, "by"> & { sent_by: string | null })[]).map((m) => ({ ...m, by: m.sent_by ? names.get(m.sent_by) ?? null : null }));
  const tab = (k: string, l: string) => <Link href={`/ik-whatsapp${k ? `?s=${k}` : ""}`} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${(sp.s ?? "") === k ? "bg-brand-700 text-white" : "border border-line bg-white"}`}>{l}</Link>;
  return (
    <>
      <PageHeader title="WhatsApp İK" subtitle="Personelin şirket WhatsApp'ına yazdıkları · yanıt bekleyenler görev olarak durur, yanıtlayınca kapanır"
        actions={<nav className="flex gap-1.5">{tab("", `Yanıt bekleyen ${openN ?? 0}`)}{tab("kapali", "Kapanan")}{tab("hepsi", "Tümü")}</nav>} />
      {(error || !waConfigured()) && (
        <div className="px-4 pt-3 md:px-6">
          {error ? <Notice tone="bad">Supabase&apos;de 20270112000000_whatsapp.sql çalıştırılmalı.</Notice>
            : <Notice tone="warn">WhatsApp bağlantısı henüz kurulmadı. Meta WhatsApp Business Platform kurulumundan sonra Vercel&apos;e WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_VERIFY_TOKEN eklenmeli; webhook adresi: /api/whatsapp/webhook</Notice>}
        </div>
      )}
      <div className="flex min-h-0 flex-1 p-0 md:p-6">
        <div className="flex min-h-0 flex-1 overflow-hidden md:rounded-[16px] md:border md:border-line">
          <WaInbox threads={threads} active={active} messages={messages} employees={((emps ?? []) as { id: string; first_name: string; last_name: string }[]).map((e) => ({ id: e.id, name: `${e.first_name} ${e.last_name}` }))} canReply={(s.modules.hr ?? 0) >= 2} configured={waConfigured()} />
        </div>
      </div>
    </>
  );
}
