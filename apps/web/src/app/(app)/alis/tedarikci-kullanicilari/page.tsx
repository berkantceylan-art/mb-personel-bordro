import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { CopyText } from "@/components/CopyText";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { supUserCmd } from "@/lib/supplier-user-actions";
import { erpUrl } from "@/lib/po-send";
import { AddSupplierUser } from "./AddSupplierUser";

export const dynamic = "force-dynamic";

type U = { id: string; party_id: string; name: string; email: string; phone: string | null; user_id: string | null; invite_code: string | null; invite_expires: string | null; is_active: boolean; last_seen_at: string | null; fin_parties: { name: string } | null };

/** Tedarikçi kullanıcıları: tedarikçiye hesap tanımla, siparişleri kendi ekranından görsün */
export default async function SupplierUsersPage() {
  const s = await getSession();
  const lvl = s.modules.purchases ?? 0;
  if (lvl < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: ud, error }, { data: parties }] = await Promise.all([
    supabase.from("sup_portal_users").select("id, party_id, name, email, phone, user_id, invite_code, invite_expires, is_active, last_seen_at, fin_parties(name)").order("created_at", { ascending: false }),
    supabase.from("fin_parties").select("id, name, email, phone").eq("is_active", true).in("kind", ["supplier", "both", "other"]).order("name").limit(3000),
  ]);
  const users = (ud ?? []) as unknown as U[];
  const base = erpUrl();
  return (
    <>
      <PageHeader title="Tedarikçi kullanıcıları" subtitle="Tedarikçiye kullanıcı tanımlayın: verdiğiniz siparişleri kendi ekranından görür, onaylar, termin ve sevkiyat bildirir." />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1100px]">
        {error && <p className="text-sm rounded-[12px] px-4 py-3 bg-warn-bg text-warn">Supabase&apos;de 20270119000000_supplier_orders.sql çalıştırılmalı.</p>}
        {lvl >= 2 && <AddSupplierUser parties={(parties ?? []) as { id: string; name: string; email: string | null; phone: string | null }[]} />}
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Kişi</th><th className="p-3">Tedarikçi</th><th className="p-3">Durum</th><th className="p-3">Son giriş</th><th className="p-3" /></tr></thead>
            <tbody>
              {users.map((u) => {
                const pending = !u.user_id;
                const expired = pending && (!u.invite_expires || Date.parse(u.invite_expires) < Date.now());
                return (
                  <tr key={u.id} className="border-t border-[#EEF2F6] align-top">
                    <td className="p-3"><b>{u.name}</b><span className="block text-xs text-muted">{[u.email, u.phone].filter(Boolean).join(" · ")}</span></td>
                    <td className="p-3">{u.fin_parties?.name}</td>
                    <td className="p-3">
                      <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${!u.is_active ? "bg-[#EEF2F6] text-muted" : pending ? (expired ? "bg-bad-bg text-bad" : "bg-warn-bg text-warn") : "bg-ok-bg text-ok"}`}>{!u.is_active ? "Erişim kapalı" : pending ? (expired ? "Davet süresi doldu" : "Davet bekliyor") : "Aktif"}</span>
                      {pending && u.invite_code && !expired && <div className="mt-2"><CopyText text={`${base}/tedarikci/davet/${u.invite_code}`} label="Davet bağlantısını kopyala" className="h-8 px-2 rounded-lg border border-[#D5DEE8] text-xs font-semibold" /></div>}
                    </td>
                    <td className="p-3 text-muted">{u.last_seen_at ? formatDate(u.last_seen_at) : "—"}</td>
                    <td className="p-3">
                      {lvl >= 2 && (
                        <div className="flex flex-wrap gap-2 justify-end">
                          {pending && <form action={supUserCmd}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="action" value="reinvite" /><input type="hidden" name="send_mail" value="1" /><PendingSubmit className="h-8 px-2 rounded-lg border border-[#D5DEE8] text-xs font-semibold">Yeni davet gönder</PendingSubmit></form>}
                          <form action={supUserCmd}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="action" value="toggle" /><PendingSubmit className="h-8 px-2 rounded-lg border border-[#D5DEE8] text-xs font-semibold">{u.is_active ? "Erişimi kapat" : "Erişimi aç"}</PendingSubmit></form>
                          <form action={supUserCmd}><input type="hidden" name="id" value={u.id} /><input type="hidden" name="action" value="delete" /><ConfirmSubmit label="Sil" question={`${u.name} silinsin mi?`} className="h-8 px-2 text-xs font-semibold text-bad" /></form>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!users.length && <tr><td colSpan={5} className="p-8 text-center text-muted">Henüz tedarikçi kullanıcısı yok. Kullanıcı tanımlamadan da siparişler tedarikçiye e-posta / WhatsApp bağlantısıyla gider.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
    </>
  );
}
