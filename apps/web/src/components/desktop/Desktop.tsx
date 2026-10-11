import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { visibleNav } from "@/lib/nav";
import type { Shortcut } from "@/lib/desktop-actions";
import { iconFor } from "@/lib/desktop-icons";
import { DesktopClient, type Note, type Pickable, type Reminder, type Todo } from "./DesktopClient";

/** Kişisel masaüstü (sunucu): kişinin simgeleri, notları, hatırlatmaları ve kendisini bekleyen işler */
export async function Desktop({ selfOnly = false }: { selfOnly?: boolean }) {
  const s = await getSession();
  const supabase = await createClient();
  const stock = s.modules.stock ?? 0;
  const pur = s.modules.purchases ?? 0;
  const [pref, notes, rems, inbox, unread, myEmp] = await Promise.all([
    supabase.from("user_dashboard").select("shortcuts").eq("user_id", s.userId).maybeSingle(),
    supabase.from("user_notes").select("id, body, color, pinned, updated_at").order("pinned", { ascending: false }).order("updated_at", { ascending: false }).limit(30),
    supabase.from("user_reminders").select("id, title, note, remind_at, repeat, link, notified_at").is("done_at", null).order("remind_at").limit(30),
    supabase.rpc("apr_inbox"),
    supabase.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", s.userId).is("read_at", null),
    supabase.from("employees").select("id").eq("user_id", s.userId).maybeSingle(),
  ]);
  const needSql = !!(notes.error || rems.error);

  // Bugün senin için: kişinin kendisini bekleyenler
  const todos: Todo[] = [];
  const nApr = Array.isArray(inbox.data) ? inbox.data.length : 0;
  if (nApr) todos.push({ label: `${nApr} onay seni bekliyor`, href: "/onaylar", tone: "amber" });
  const nowIso = new Date().toISOString();
  const endToday = new Date(`${new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10)}T23:59:59+03:00`).toISOString();
  const remList = ((rems.data ?? []) as Reminder[]).filter((r) => r.repeat !== "none" || !r.notified_at || r.remind_at > nowIso);
  const dueToday = remList.filter((r) => r.remind_at <= endToday).length;
  if (dueToday) todos.push({ label: `${dueToday} hatırlatma bugün`, href: "#hatirlatma", tone: "blue" });
  if (unread.count) todos.push({ label: `${unread.count} okunmamış bildirim`, href: "/bildirimler", tone: "blue" });
  // Yapay zekânın önemli bulduğu e-postalar (Posta modülü)
  const { data: mails } = await supabase.from("mail_ai").select("account_id, thread_id, summary, urgency").eq("done", false).gte("urgency", 2).gte("created_at", new Date(Date.now() - 4 * 86400000).toISOString()).order("urgency", { ascending: false }).order("created_at", { ascending: false }).limit(4);
  for (const m of (mails ?? []) as { account_id: string; thread_id: string; summary: string | null; urgency: number }[]) {
    todos.push({ label: `📧 ${(m.summary ?? "Önemli e-posta").slice(0, 90)}`, href: `/posta?a=${m.account_id}&t=${m.thread_id}`, tone: m.urgency >= 3 ? "red" : "amber" });
  }
  if (myEmp.data) {
    const { count } = await supabase.from("stk_requests").select("id", { count: "exact", head: true }).eq("employee_id", myEmp.data.id).eq("status", "delivered");
    if (count) todos.push({ label: `${count} malzeme teslimini imzala`, href: "/benim/malzeme", tone: "red" });
    const { count: ready } = await supabase.from("stk_requests").select("id", { count: "exact", head: true }).eq("employee_id", myEmp.data.id).eq("status", "ready");
    if (ready) todos.push({ label: `${ready} malzemen teslime hazır`, href: "/benim/malzeme", tone: "green" });
  }
  if (stock >= 2) {
    const { count } = await supabase.from("stk_requests").select("id", { count: "exact", head: true }).in("status", ["pending", "ready", "approved"]);
    if (count) todos.push({ label: `${count} malzeme isteği depoda`, href: "/stok/talepler", tone: "amber" });
  }
  if (pur >= 3) {
    const { count } = await supabase.from("stk_requests").select("id", { count: "exact", head: true }).eq("status", "purchase");
    if (count) todos.push({ label: `${count} malzeme isteği satın alma onayında`, href: "/stok/talepler?s=satin", tone: "amber" });
  }

  // Servis / teknik servis / alım listesi (tablolar yoksa sessizce atlanır)
  const fin = s.modules.finance ?? 0;
  const buyer = pur >= 2 || (s.modules.assets ?? 0) >= 3;
  const [myJobs, svcRep, svcCost, svcPay, myLists] = await Promise.all([
    supabase.from("svc_tickets").select("id", { count: "exact", head: true }).eq("technician_user", s.userId).in("status", ["approved", "in_progress"]),
    buyer ? supabase.from("svc_tickets").select("id", { count: "exact", head: true }).eq("status", "reported") : Promise.resolve({ count: 0 }),
    buyer ? supabase.from("svc_tickets").select("id", { count: "exact", head: true }).eq("status", "done") : Promise.resolve({ count: 0 }),
    fin >= 2 ? supabase.from("svc_tickets").select("id", { count: "exact", head: true }).eq("status", "cost_approved") : Promise.resolve({ count: 0 }),
    supabase.rpc("stk_buy_lists_mine"),
  ]);
  if (myJobs.count) todos.push({ label: `${myJobs.count} teknik servis işi sana atandı`, href: "/teknik-servis", tone: "red" });
  if (svcRep.count) todos.push({ label: `${svcRep.count} arıza bildirimi onay bekliyor`, href: "/servis?s=onay", tone: "amber" });
  if (svcCost.count) todos.push({ label: `${svcCost.count} servis ücreti onay bekliyor`, href: "/servis?s=ucret", tone: "amber" });
  if (svcPay.count) todos.push({ label: `${svcPay.count} servis ödemesi bekliyor`, href: "/servis?s=odeme", tone: "amber" });
  for (const l of (Array.isArray(myLists.data) ? myLists.data : []) as { id: string; no: string; total: number; picked: number }[]) {
    todos.push({ label: `🛒 Alım listesi ${l.no}: ${l.picked}/${l.total} alındı`, href: `/alim/${l.id}`, tone: "blue" });
  }

  // Simge seçici: yalnız yetkili olduğu sayfalar
  const groups = visibleNav(s.role, s.siteAccess, s.logistics, s.modules);
  const pickable: Pickable[] = groups
    .filter((g) => !selfOnly || g.items.some((i) => i.href.startsWith("/benim")))
    .map((g) => ({ group: g.group, items: g.items.filter((i) => !i.raw && i.href !== "/").map((i) => ({ href: i.href, label: i.label })) }))
    .filter((g) => g.items.length);
  const allowed = new Set(pickable.flatMap((g) => g.items.map((i) => i.href)));
  let shortcuts = (((pref.data?.shortcuts as Shortcut[] | undefined) ?? []) as Shortcut[]).filter((x) => allowed.has(x.href));
  if (!pref.data?.shortcuts || (pref.data.shortcuts as Shortcut[]).length === 0) {
    // İlk açılış: menüden ilk sayfalarla başla
    shortcuts = pickable.flatMap((g) => g.items).slice(0, 8).map((i) => ({ href: i.href, label: i.label.slice(0, 40), icon: iconFor(i.href) }));
  }

  return <DesktopClient todos={todos} shortcuts={shortcuts} pickable={pickable} notes={(notes.data ?? []) as Note[]} reminders={remList} needSql={needSql} />;
}
