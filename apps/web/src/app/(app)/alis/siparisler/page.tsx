import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, orderError, poNo, supStatus } from "@/lib/orders";
import { draftFromSuggestions, savePOSettings } from "@/lib/order-actions";

export const dynamic = "force-dynamic";

type P = { id: string; year: number; no: number; party_id: string; order_date: string; expected_date: string | null; status: string; currency: string; total: number; fin_parties: { name: string } | null; send_state?: string; sent_via?: string[]; sup_seen_at?: string | null; sup_ack_at?: string | null; sup_promised_date?: string | null; sup_shipped_at?: string | null; sup_declined_at?: string | null };
type S = { item_id: string; code: string; name: string; unit: string; qty: number; min_qty: number; suggest: number; supplier_id: string | null; supplier: string | null; unit_price: number; currency: string; on_order: number };

/** Satın alma siparişleri: liste, onay bekleyenler, stok önerisi, onay limiti */
export default async function PurchaseOrders({ searchParams }: { searchParams: Promise<{ durum?: string }> }) {
  const s = await getSession();
  const lvl = s.modules.purchases ?? 0;
  if (lvl < 1 && (s.modules.stock ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const tab = sp.durum ?? "acik";
  const supabase = await createClient();
  const canDraft = lvl >= 2 || (s.modules.stock ?? 0) >= 2;
  const statuses = tab === "acik" ? ["draft", "pending", "approved", "sent", "partial", "received"] : tab === "kapali" ? ["invoiced", "cancelled"] : [tab];
  const base = "id, year, no, party_id, order_date, expected_date, status, currency, total, fin_parties(name)";
  let q = await supabase.from("pur_orders").select(`${base}, send_state, sent_via, sup_seen_at, sup_ack_at, sup_promised_date, sup_shipped_at, sup_declined_at`).in("status", statuses).order("created_at", { ascending: false }).limit(300);
  if (q.error && /send_state|sup_/.test(q.error.message)) q = await supabase.from("pur_orders").select(base).in("status", statuses).order("created_at", { ascending: false }).limit(300) as typeof q;
  const { data: pd, error } = q;
  const [{ data: sg }, { data: setFull, error: setErr }, { data: mails }] = await Promise.all([
    supabase.rpc("pur_suggestions"),
    supabase.from("pur_settings").select("approval_limit, auto_send, send_whatsapp, mail_account_id, cc_email").maybeSingle(),
    supabase.from("mail_accounts").select("id, email").eq("user_id", s.userId).order("email"),
  ]);
  const set = (setErr ? (await supabase.from("pur_settings").select("approval_limit").maybeSingle()).data : setFull) as { approval_limit: number; auto_send?: boolean; send_whatsapp?: boolean; mail_account_id?: string | null; cc_email?: string | null } | null;
  const pos = (pd ?? []) as unknown as P[];
  const sugg = (sg ?? []) as S[];
  const bySupplier = new Map<string, S[]>();
  for (const r of sugg) bySupplier.set(r.supplier_id ?? "", [...(bySupplier.get(r.supplier_id ?? "") ?? []), r]);
  const pending = pos.filter((p) => p.status === "pending").length;
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);

  return (
    <>
      <PageHeader title="Verilen siparişler (tedarikçi)" subtitle="Depo hazırlar → satın alma onaylar → tedarikçiye e-posta + WhatsApp ile otomatik gider → tedarikçi onaylar / sevk eder → mal kabul → alış faturası."
        actions={canDraft ? <Link href="/alis/siparisler/yeni" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white text-sm font-semibold">+ Yeni sipariş</Link> : undefined} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">{orderError(error.message)}</Notice>}
        {pending > 0 && lvl >= 3 && <Notice>{pending} sipariş onayınızı bekliyor.</Notice>}
        <nav className="flex flex-wrap gap-1 rounded-[14px] bg-[#EEF2F6] p-1 text-sm font-semibold self-start">
          {([["acik", "Açık"], ["draft", "Taslak (hazırlanan)"], ["pending", "Onay bekleyen"], ["approved", "Onaylı"], ["sent", "Tedarikçide / yolda"], ["kapali", "Kapanan"]] as const).map(([k, l]) => <Link key={k} href={`/alis/siparisler?durum=${k}`} className={`rounded-[10px] px-4 py-2 ${tab === k ? "bg-white shadow-sm" : "text-muted"}`}>{l}</Link>)}
        </nav>
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[760px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">No</th><th className="p-3">Tedarikçi</th><th className="p-3">Tarih</th><th className="p-3">Beklenen</th><th className="p-3">Durum</th><th className="p-3">Tedarikçi tarafı</th><th className="p-3 text-right">Tutar</th></tr></thead>
            <tbody>
              {pos.map((p) => (
                <tr key={p.id} className="border-t border-[#EEF2F6]">
                  <td className="p-3"><Link href={`/alis/siparisler/${p.id}`} className="font-mono font-semibold text-brand-700">{poNo(p.year, p.no)}</Link></td>
                  <td className="p-3">{p.fin_parties?.name}</td>
                  <td className="p-3">{formatDate(p.order_date)}</td>
                  <td className={`p-3 ${p.expected_date && p.expected_date < today && ["approved", "sent", "partial"].includes(p.status) ? "text-bad font-semibold" : ""}`}>{p.expected_date ? formatDate(p.expected_date) : "—"}</td>
                  <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${PO_STATUS[p.status]?.[1]}`}>{PO_STATUS[p.status]?.[0]}</span></td>
                  <td className="p-3">{(() => { const ss = supStatus(p); return ss ? <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${ss[1]}`}>{ss[0]}</span> : <span className="text-muted">—</span>; })()}</td>
                  <td className="p-3 text-right num font-semibold">{money(p.total, p.currency)}</td>
                </tr>
              ))}
              {pos.length === 0 && <tr><td colSpan={7} className="p-8 text-center text-muted">Sipariş yok.</td></tr>}
            </tbody>
          </table>
        </section>

        {sugg.length > 0 && (
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Stok önerisi <span className="text-sm font-normal text-muted">— minimum seviyenin altına düşen kalemler (yoldaki siparişler düşüldü)</span></h2>
            {[...bySupplier.entries()].map(([sid, rows]) => (
              <form key={sid || "none"} action={draftFromSuggestions} className="border-t border-[#EEF2F6] pt-3 flex flex-col gap-2">
                <input type="hidden" name="supplier_id" value={sid} />
                <div className="flex items-center gap-3"><b>{rows[0]!.supplier ?? "Tedarikçisi tanımsız"}</b>{sid && canDraft && <PendingSubmit className="ml-auto h-9 px-3 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Seçilenlerden sipariş taslağı</PendingSubmit>}</div>
                <div className="flex flex-wrap gap-2">
                  {rows.map((r) => (
                    <label key={r.item_id} className="flex items-center gap-2 rounded-[10px] border border-line px-3 py-1.5 text-sm">
                      {sid && <input type="checkbox" name="item" value={r.item_id} defaultChecked />}
                      <span><b>{r.name}</b><span className="block text-[11px] text-muted">eldeki {Number(r.qty)} / min {Number(r.min_qty)}{Number(r.on_order) ? ` · yolda ${Number(r.on_order)}` : ""} → öneri <b className="text-ink">{Number(r.suggest)} {r.unit}</b></span></span>
                    </label>
                  ))}
                </div>
              </form>
            ))}
          </section>
        )}

        {lvl >= 3 && (
          <form action={savePOSettings} className="rounded-[16px] border border-line bg-white p-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Onay limiti (TL, KDV dahil)
              <input name="limit" inputMode="decimal" defaultValue={set?.approval_limit ? (Number(set.approval_limit) / 100).toLocaleString("tr-TR") : ""} placeholder="0 = onaysız" className="h-10 w-48 rounded-[10px] border border-[#D5DEE8] px-3" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Siparişi gönderen e-posta (Gmail)
              <select name="mail_account_id" defaultValue={set?.mail_account_id ?? ""} className="h-10 w-64 rounded-[10px] border border-[#D5DEE8] bg-white px-2 text-sm text-ink">
                <option value="">— seçilmedi (e-posta gitmez) —</option>
                {((mails ?? []) as { id: string; email: string }[]).map((m) => <option key={m.id} value={m.id}>{m.email}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Bilgi (CC) e-posta
              <input name="cc_email" type="email" defaultValue={set?.cc_email ?? ""} placeholder="satinalma@…" className="h-10 w-56 rounded-[10px] border border-[#D5DEE8] px-3" />
            </label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="auto_send" value="1" defaultChecked={set?.auto_send !== false} className="w-5 h-5" /> Onaylanınca otomatik gönder</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send_whatsapp" value="1" defaultChecked={set?.send_whatsapp !== false} className="w-5 h-5" /> WhatsApp ile de gönder</label>
            <PendingSubmit className="h-10 px-4 rounded-[10px] border border-[#D5DEE8] text-sm font-semibold">Kaydet</PendingSubmit>
            <span className="text-xs text-muted w-full">Depo sorumlusunun hazırladığı siparişler her zaman satın alma onayına düşer; satın alma personelinin siparişleri onay limitini aşarsa “Alış: yönetir” onayına düşer. Gönderen e-posta listesinde, Posta sayfasından bağladığınız Gmail hesapları çıkar. WhatsApp için Meta onaylı şablon gerekir; yoksa sipariş sayfasındaki “WhatsApp&apos;tan aç” düğmesiyle elle gönderilir.</span>
          </form>
        )}
      </div>
    </>
  );
}
