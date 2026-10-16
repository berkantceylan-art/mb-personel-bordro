import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** Tedarikçi portalı — sunucu yardımcıları ve tipler */

export type PortalCtx = {
  sb: Awaited<ReturnType<typeof createClient>>;
  mode: "supplier" | "preview";
  party: { id: string; name: string };
  parties: { id: string; name: string }[];
  me: string;
  q: string; // bağlantılarda taşınan ?cari=…
};

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Portal sayfası bağlamı:
 *  - tedarikçi kullanıcısı → kendi carileri (birden çoksa ?cari= ile seçilir)
 *  - satın alma / finans yetkilisi → ?cari= ile "tedarikçi gözüyle" önizleme
 * Bağlı değilse null döner (sayfa açıklama gösterir).
 */
export async function portalCtx(sp: { cari?: string }, next = "/tedarikci"): Promise<PortalCtx | null> {
  const sb = await createClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) redirect(`/giris?sonra=${encodeURIComponent(next)}`);
  const { data: me } = await sb.from("sup_portal_users").select("name, party_id, fin_parties(name)").eq("user_id", user.id).eq("is_active", true);
  const rows = (me ?? []) as unknown as { name: string; party_id: string; fin_parties: { name: string } | null }[];
  if (rows.length) {
    const parties = rows.map((r) => ({ id: r.party_id, name: r.fin_parties?.name ?? "" }));
    const party = parties.find((p) => p.id === sp.cari) ?? parties[0];
    await sb.rpc("sup_touch").then(() => undefined, () => undefined);
    return { sb, mode: "supplier", party, parties, me: rows[0].name, q: parties.length > 1 ? `?cari=${party.id}` : "" };
  }
  if (sp.cari && UUID.test(sp.cari)) {
    const { data: ok } = await sb.rpc("sup_can", { p_party: sp.cari });
    if (ok) {
      const { data: p } = await sb.from("fin_parties").select("id, name").eq("id", sp.cari).maybeSingle();
      if (p) return { sb, mode: "preview", party: { id: p.id as string, name: p.name as string }, parties: [], me: "", q: `?cari=${p.id}` };
    }
  }
  return null;
}

export const withQ = (href: string, q: string) => (q ? `${href}${href.includes("?") ? "&" : "?"}${q.slice(1)}` : href);

export type Msg = { id: string; side: "supplier" | "lab"; sender_name: string | null; body: string; created_at: string; read_at: string | null; po_id: string | null; via: string[]; doc_id: string | null };
export type Doc = { id: string; side: "supplier" | "lab"; kind: string; title: string; file_name: string | null; mime: string | null; size_bytes: number | null; note: string | null; valid_until: string | null; created_at: string; seen_at: string | null; sender_name: string | null; po_id: string | null };
export type Product = { key: string; item_id: string | null; code: string | null; name: string; unit: string; last_price: number | null; currency: string | null; last_date: string | null; qty_12m: number; times: number; current_price: number | null; current_currency: string | null };
export type LedgerRow = { at: string | null; kind: string; doc: string | null; description: string; owed: number; paid: number; balance: number; currency: string };
export type PayItem = { kind: string; ref: string; party_id: string; party: string; due_date: string; amount: number; currency: string; doc: string | null; note: string | null; method: string | null; overdue: boolean };
export type PriceList = { id: string; title: string; currency: string; valid_from: string; status: string; note: string | null; submitted_at: string; sender_name: string | null; decision_note: string | null; doc_id: string | null };
export type Home = {
  name: string; show_ledger: boolean; show_slip: boolean; has_slip: boolean; orders_new: number; orders_open: number; orders_late: number; unread: number; docs_new: number; prices_pending: number; year_total: number;
  balances: { invoice: number; slip?: number | null; currency: string } | null; next_pay: { kind: string; due_date: string; amount: number; currency: string; doc: string | null }[]; monthly: { m: string; t: number }[];
};

export const DOC_KINDS: Record<string, string> = {
  invoice: "Fatura", waybill: "İrsaliye", price_list: "Fiyat listesi", certificate: "Sertifika / belge", catalog: "Katalog", quote: "Teklif", payment: "Ödeme / dekont", contract: "Sözleşme", other: "Diğer",
};
export const PAY_KINDS: Record<string, [string, string, string]> = {
  invoice: ["Fatura vadesi", "🧾", "bg-[#EEF4FB] text-brand-700"],
  cheque: ["Çek", "🏦", "bg-warn-bg text-warn"],
  note: ["Senet", "📜", "bg-warn-bg text-warn"],
  plan: ["Planlı ödeme", "📅", "bg-ok-bg text-ok"],
};
export const PAY_METHODS: Record<string, string> = { transfer: "Havale / EFT", cash: "Nakit", cheque: "Çek", note: "Senet", card: "Kredi kartı", other: "Diğer" };
export const PRICE_STATUS: Record<string, [string, string]> = {
  submitted: ["İnceleniyor", "bg-warn-bg text-warn"], approved: ["Onaylandı", "bg-ok-bg text-ok"], partial: ["Kısmen onaylandı", "bg-[#EEF4FB] text-brand-700"], rejected: ["Onaylanmadı", "bg-bad-bg text-bad"],
};

export function portalError(m: string): string {
  if (/sup_message|sup_doc|sup_price|sup_products|sup_home|sup_center|sup_portal_ledger|pay_calendar|pay_plan|fin_payment_plans|sup_can|schema cache|does not exist/.test(m)) return "Supabase'de mbdental-tedarikci-portali.sql çalıştırılmalı.";
  if (/ledger_hidden/.test(m)) return "Cari bilgileri bu hesap için kapalı.";
  if (/body_required/.test(m)) return "Mesaj yazın.";
  if (/lines_required/.test(m)) return "En az bir ürüne yeni fiyat girin.";
  if (/already_decided/.test(m)) return "Bu fiyat listesi için karar verilmiş.";
  if (/amount_required/.test(m)) return "Tutar girin.";
  if (/not_allowed/.test(m)) return "Bu işlem için yetkiniz yok.";
  return m;
}

export const dmy = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join(".") : "—");
export const daysTo = (iso: string) => Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10))) / 864e5);
export const fileSize = (n: number | null) => (!n ? "" : n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);

/** Sekme rozetleri + özet */
export async function portalHome(ctx: PortalCtx): Promise<{ home: Home | null; badges: Record<string, number>; error: string | null }> {
  const { data, error } = await ctx.sb.rpc("sup_home", { p_party: ctx.party.id });
  const home = (data ?? null) as Home | null;
  return {
    home, error: error ? portalError(error.message) : null,
    badges: home ? { "/tedarikci/siparisler": home.orders_new, "/tedarikci/mesajlar": home.unread, "/tedarikci/belgeler": home.docs_new } : {},
  };
}
