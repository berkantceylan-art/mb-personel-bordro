import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { money } from "@/lib/jobs";
import { SignOutForm } from "@/components/SignOut";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { approved: "Yeni sipariş", sent: "Açık", partial: "Kısmen teslim alındı", received: "Teslim alındı", invoiced: "Faturalandı" };
const d = (s: string | null) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");

/** Tedarikçi portalı: bize ait verilen siparişler */
export default async function SupplierHome() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/giris");
  const { data: me } = await supabase.from("sup_portal_users").select("id, name, party_id, fin_parties(name)").eq("user_id", user.id).eq("is_active", true);
  if (!me?.length) {
    return (
      <main className="mx-auto max-w-[640px] p-6">
        <div className="rounded-[16px] bg-white border border-line p-6 flex flex-col gap-3">
          <h1 className="font-display text-xl font-bold text-brand-800">Tedarikçi ekranı</h1>
          <p className="text-sm text-muted">Bu hesap bir tedarikçiye bağlı değil ya da erişimi kapatılmış. Size gönderilen davet bağlantısını açın veya firmayla iletişime geçin.</p>
          <SignOutForm buttonClassName="h-10 px-4 rounded-[10px] border border-[#D5DEE8] font-semibold" />
        </div>
      </main>
    );
  }
  await supabase.rpc("sup_touch").then(() => undefined, () => undefined);
  const { data: orders } = await supabase.from("pur_orders")
    .select("id, year, no, order_date, expected_date, status, currency, total, supplier_token, sup_ack_at, sup_promised_date, sup_shipped_at, fin_parties(name)")
    .order("created_at", { ascending: false }).limit(300);
  const list = (orders ?? []) as unknown as Array<{ id: string; year: number; no: number; order_date: string; expected_date: string | null; status: string; currency: string; total: number; supplier_token: string; sup_ack_at: string | null; sup_promised_date: string | null; sup_shipped_at: string | null; fin_parties: { name: string } | null }>;
  const waiting = list.filter((o) => ["approved", "sent"].includes(o.status) && !o.sup_ack_at).length;
  const parties = [...new Set(me.map((m) => (m.fin_parties as unknown as { name: string } | null)?.name).filter(Boolean))].join(", ");

  return (
    <main className="mx-auto max-w-[1000px] p-4 md:p-8 flex flex-col gap-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[220px]">
          <p className="text-xs font-semibold text-muted">TEDARİKÇİ EKRANI</p>
          <h1 className="font-display text-2xl font-bold text-brand-800">{parties}</h1>
          <p className="text-sm text-muted">Hoş geldiniz {me[0]!.name}. {waiting ? <b className="text-warn">{waiting} sipariş onayınızı bekliyor.</b> : "Bekleyen yeni sipariş yok."}</p>
        </div>
        <SignOutForm buttonClassName="h-10 px-4 rounded-[10px] border border-[#D5DEE8] bg-white font-semibold" />
      </header>
      <section className="rounded-[16px] bg-white border border-line overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Sipariş</th><th className="p-3">Tarih</th><th className="p-3">İstenen teslim</th><th className="p-3">Durum</th><th className="p-3 text-right">Tutar</th></tr></thead>
          <tbody>
            {list.map((o) => {
              const label = o.sup_shipped_at && ["approved", "sent"].includes(o.status) ? "Sevk ettiniz" : o.sup_ack_at && ["approved", "sent"].includes(o.status) ? `Onayladınız${o.sup_promised_date ? ` · termin ${d(o.sup_promised_date)}` : ""}` : ST[o.status] ?? o.status;
              const fresh = ["approved", "sent"].includes(o.status) && !o.sup_ack_at;
              return (
                <tr key={o.id} className={`border-t border-[#EEF2F6] ${fresh ? "bg-[#FFF9EE]" : ""}`}>
                  <td className="p-3"><Link href={`/tedarikci/siparis/${o.supplier_token}`} className="font-mono font-semibold text-brand-700">SA-{o.year}-{String(o.no).padStart(4, "0")}</Link>{me.length > 1 && <span className="block text-xs text-muted">{o.fin_parties?.name}</span>}</td>
                  <td className="p-3">{d(o.order_date)}</td>
                  <td className="p-3">{d(o.expected_date)}</td>
                  <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${fresh ? "bg-warn-bg text-warn" : "bg-[#EEF2F6] text-[#33414F]"}`}>{label}</span></td>
                  <td className="p-3 text-right num font-semibold">{money(o.total, o.currency)}</td>
                </tr>
              );
            })}
            {!list.length && <tr><td colSpan={5} className="p-8 text-center text-muted">Henüz sipariş yok.</td></tr>}
          </tbody>
        </table>
      </section>
    </main>
  );
}
