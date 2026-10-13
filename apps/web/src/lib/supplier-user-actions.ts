"use server";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { done, fail } from "@/lib/flash";
import { orderError } from "@/lib/orders";
import { erpUrl, sendSupplierInvite } from "@/lib/po-send";
import { waLink } from "@/lib/wa";

export interface SupUserResult { ok: boolean; message: string; link?: string; wa?: string | null }

/** Tedarikçiye kullanıcı tanımla: davet bağlantısı üretilir, istenirse e-postayla gönderilir */
export async function supUserAdd(_: SupUserResult | null, f: FormData): Promise<SupUserResult> {
  const s = await getSession();
  if ((s.modules.purchases ?? 0) < 2) return { ok: false, message: "Yetkiniz yok." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_user_save", { p: { party_id: String(f.get("party_id") ?? ""), name: String(f.get("name") ?? "").trim(), email: String(f.get("email") ?? "").trim(), phone: String(f.get("phone") ?? "").trim() } });
  if (error) return { ok: false, message: orderError(error.message) };
  const r = data as { code: string; email: string; name: string; phone: string | null };
  const link = `${erpUrl()}/tedarikci/davet/${r.code}`;
  let note = "";
  if (f.get("send_mail") === "1") {
    const e = await sendSupplierInvite(s.companyId, r.email, r.name, link);
    note = e ? ` E-posta gönderilemedi (${e}); bağlantıyı kopyalayıp iletin.` : ` Davet ${r.email} adresine gönderildi.`;
  }
  revalidatePath("/alis/tedarikci-kullanicilari");
  return { ok: true, message: `${r.name} için davet oluşturuldu.${note}`, link, wa: waLink(r.phone, `${s.companyName} tedarikçi ekranı davetiniz: ${link} (14 gün geçerli)`) };
}

export async function supUserCmd(f: FormData): Promise<void> {
  const action = String(f.get("action") ?? "");
  if (!["reinvite", "toggle", "delete"].includes(action)) return;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("sup_user_save", { p: { id: String(f.get("id") ?? ""), action } });
  if (error) await fail(orderError(error.message));
  if (action === "reinvite" && f.get("send_mail") === "1") {
    const s = await getSession();
    const r = data as { code: string; email: string; name: string };
    await sendSupplierInvite(s.companyId, r.email, r.name, `${erpUrl()}/tedarikci/davet/${r.code}`);
  }
  revalidatePath("/alis/tedarikci-kullanicilari");
  await done(action === "reinvite" ? "Yeni davet bağlantısı oluşturuldu." : action === "toggle" ? "Erişim güncellendi." : "Kullanıcı silindi.");
}
