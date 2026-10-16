import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { money } from "@/lib/jobs";
import { PO_STATUS, poNo, supStatus } from "@/lib/orders";
import { Thread } from "@/components/supplier/Thread";
import { Docs } from "@/components/supplier/Docs";
import { Ledger } from "@/components/supplier/Ledger";
import { PayCalendar, monthRange } from "@/components/supplier/PayCalendar";
import { decidePriceList, savePortalSettings } from "@/lib/supplier-portal-actions";
import { PlanForm } from "@/components/supplier/PlanForm";
import { PRICE_STATUS, dmy, portalError, type Home, type PayItem, type PriceList } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

const TABS: [string, string][] = [["ozet", "Özet"], ["mesaj", "Mesajlar"], ["belge", "Belgeler"], ["fiyat", "Fiyat listeleri"], ["cari", "Cari"], ["odeme", "Ödemeler"], ["ayar", "Portal ayarları"]];

/** ERP'deki tedarikçi sayfası: portalla aynı veri, laboratuvar tarafından */
export default async function SupplierPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ t?: string; defter?: string; bas?: string; ay?: string }> }) {
  const s = await getSession();
  const lvl = Math.max(s.modules.purchases ?? 0, s.modules.finance ?? 0);
  if (lvl < 1) redirect("/");
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t[0] === sp.t)?.[0] ?? "ozet";
  const sb = await createClient();
  const { data: p } = await sb.from("fin_parties").select("id, name, phone, email, order_email, order_phone, contact_name, currency, iban, payment_term_days, portal_show_ledger, portal_show_slip, slip_of").eq("id", id).maybeSingle();
  if (!p) notFound();
  if (p.slip_of) redirect(`/satinalma/tedarikci/${p.slip_of}?t=${tab}`);
  if (tab === "mesaj" || tab === "belge") await sb.rpc("sup_mark_read", { p_party: id }).then(() => undefined, () => undefined);
  const [{ data: hd, error }, { data: users }] = await Promise.all([
    sb.rpc("sup_home", { p_party: id }),
    sb.from("sup_portal_users").select("name, email, last_seen_at, is_active").eq("party_id", id),
  ]);
  const h = (hd ?? null) as Home | null;
  const phone = (p.order_phone as string) || (p.phone as string) || null;
  const badge: Record<string, number> = { mesaj: h?.unread ?? 0, belge: h?.docs_new ?? 0, fiyat: h?.prices_pending ?? 0 };
  const canWrite = (s.modules.purchases ?? 0) >= 2 || (s.modules.finance ?? 0) >= 2;

  return (
    <>
      <PageHeader title={p.name as string} subtitle={[p.contact_name, phone, (p.order_email as string) || (p.email as string), p.payment_term_days ? `vade ${p.payment_term_days} gün` : null].filter(Boolean).join(" · ")}
        actions={<span className="flex flex-wrap gap-2 text-sm font-semibold">
          <Link href={`/tedarikci?cari=${id}`} target="_blank" className="h-10 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white">Tedarikçi gözüyle gör ↗</Link>
          <Link href={`/finans/cariler/${id}`} className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-brand-700">Cari kartı</Link>
          <Link href="/satinalma/tedarikci-merkezi" className="h-10 px-4 inline-flex items-center text-brand-700">← Merkez</Link>
        </span>} />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1300px]">
        {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p>}
        <nav className="flex gap-1 overflow-x-auto border-b border-line">
          {TABS.map(([k, l]) => (
            <Link key={k} href={`?t=${k}`} className={`shrink-0 h-10 px-4 inline-flex items-center gap-2 text-sm font-semibold border-b-2 -mb-px ${tab === k ? "border-brand-700 text-brand-800" : "border-transparent text-muted hover:text-brand-800"}`}>
              {l}{badge[k] ? <span className="min-w-5 h-5 px-1 rounded-full bg-bad text-white text-[11px] grid place-items-center">{badge[k]}</span> : null}
            </Link>
          ))}
        </nav>

        {tab === "ozet" && h && <Overview id={id} h={h} users={(users ?? []) as { name: string; email: string; last_seen_at: string | null; is_active: boolean }[]} />}
        {tab === "mesaj" && <Thread sb={sb} partyId={id} viewer="lab" phone={phone} canWrite={canWrite} />}
        {tab === "belge" && <Docs sb={sb} partyId={id} viewer="lab" canWrite={canWrite} />}
        {tab === "fiyat" && <Prices id={id} canDecide={(s.modules.purchases ?? 0) >= 2} />}
        {tab === "cari" && <Ledger sb={sb} partyId={id} book={sp.defter === "fis" ? "slip" : "invoice"} hasSlip={!!h?.has_slip} showSlip base={`/satinalma/tedarikci/${id}?t=cari`} from={sp.bas && /^\d{4}-\d{2}-\d{2}$/.test(sp.bas) ? sp.bas : undefined} />}
        {tab === "odeme" && <Payments id={id} ay={sp.ay} currency={p.currency as string} canWrite={canWrite} />}
        {tab === "ayar" && (
          <form action={savePortalSettings} className="rounded-[16px] border border-line bg-white p-5 flex flex-col gap-3 text-sm max-w-xl">
            <input type="hidden" name="party_id" value={id} />
            <h2 className="font-display font-bold text-brand-800">Tedarikçi portalında neler görünsün?</h2>
            <label className="flex items-center gap-2"><input type="checkbox" name="ledger" defaultChecked={p.portal_show_ledger as boolean} /> Cari hesap, bakiye ve ödeme takvimi</label>
            <label className="flex items-center gap-2"><input type="checkbox" name="slip" defaultChecked={p.portal_show_slip as boolean} /> Faturasız (fişli) hesap da görünsün</label>
            <p className="text-xs text-muted">Siparişler, mesajlar, belgeler ve fiyat listesi her zaman açıktır. Portal kullanıcısı eklemek için <Link href="/alis/tedarikci-kullanicilari" className="font-semibold text-brand-700">Tedarikçi kullanıcıları</Link>.</p>
            <PendingSubmit className="h-10 w-fit px-5 rounded-[10px] bg-brand-700 text-white font-semibold">Kaydet</PendingSubmit>
          </form>
        )}
      </div>
    </>
  );
}

async function Overview({ id, h, users }: { id: string; h: Home; users: { name: string; email: string; last_seen_at: string | null; is_active: boolean }[] }) {
  const sb = await createClient();
  const { data: os } = await sb.from("pur_orders").select("id, year, no, order_date, status, total, currency, billing, send_state, sup_seen_at, sup_ack_at, sup_promised_date, sup_shipped_at, sup_declined_at").eq("party_id", id).order("order_date", { ascending: false }).limit(10);
  const orders = (os ?? []) as { id: string; year: number; no: number; order_date: string; status: string; total: number; currency: string; billing?: string; sup_seen_at: string | null; sup_ack_at: string | null; sup_promised_date: string | null; sup_shipped_at: string | null; sup_declined_at: string | null }[];
  const cur = h.balances?.currency ?? "TRY";
  return (
    <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="flex flex-col gap-5">
        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[16px] p-4 text-white bg-gradient-to-br from-[#0a3d73] to-[#1a86c7]"><div className="text-xs text-white/70 font-semibold">Faturalı borcumuz</div><div className="font-display text-2xl font-bold tabular-nums">{money(Number(h.balances?.invoice ?? 0), cur)}</div></div>
          <div className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs text-muted font-semibold">Fişli (faturasız) borcumuz</div><div className="font-display text-2xl font-bold tabular-nums">{h.has_slip ? money(Number(h.balances?.slip ?? 0), cur) : "—"}</div></div>
          <div className="rounded-[16px] border border-line bg-white p-4"><div className="text-xs text-muted font-semibold">Bu yıl sipariş</div><div className="font-display text-2xl font-bold tabular-nums">{money(h.year_total, "TRY")}</div></div>
        </section>
        <section className="rounded-[16px] border border-line bg-white overflow-x-auto">
          <div className="flex items-center p-4 pb-2"><h3 className="font-display font-bold text-brand-800">Siparişler</h3><Link href={`/alis/siparisler/yeni`} className="ml-auto text-sm font-semibold text-brand-700">+ Yeni sipariş</Link></div>
          <table className="w-full text-sm min-w-[620px]">
            <tbody>
              {orders.map((o) => {
                const ss = supStatus(o);
                return (
                  <tr key={o.id} className="border-t border-[#EEF2F6]">
                    <td className="p-3"><Link href={`/alis/siparisler/${o.id}`} className="font-mono font-semibold text-brand-700">{poNo(o.year, o.no)}</Link><span className="block text-xs text-muted">{dmy(o.order_date)}{o.billing === "slip" ? " · faturasız" : ""}</span></td>
                    <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${PO_STATUS[o.status]?.[1]}`}>{PO_STATUS[o.status]?.[0]}</span></td>
                    <td className="p-3 text-xs">{ss ? <span className={`rounded-md px-2 py-0.5 font-semibold ${ss[1]}`}>{ss[0]}</span> : ""}{o.sup_seen_at && <span className="ml-1 text-[#1D9BF0] font-semibold" title={`Okundu ${dmy(o.sup_seen_at)}`}>✓✓</span>}</td>
                    <td className="p-3 text-right tabular-nums font-semibold">{money(o.total, o.currency)}</td>
                  </tr>
                );
              })}
              {!orders.length && <tr><td className="p-6 text-center text-muted">Sipariş yok.</td></tr>}
            </tbody>
          </table>
        </section>
      </div>
      <div className="flex flex-col gap-5">
        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
          <h3 className="font-display font-bold text-brand-800">Bekleyenler</h3>
          {([["mesaj", "Okunmamış mesaj", h.unread], ["belge", "Yeni belge", h.docs_new], ["fiyat", "Onay bekleyen fiyat listesi", h.prices_pending]] as const).map(([t, l, n]) => (
            <Link key={t} href={`?t=${t}`} className={`flex items-center rounded-xl px-3 py-2 text-sm ${n ? "bg-warn-bg text-warn font-semibold" : "bg-[#F7F9FB] text-muted"}`}>{l}<span className="ml-auto font-bold">{n}</span></Link>
          ))}
        </section>
        <section className="rounded-[16px] border border-line bg-white p-4">
          <div className="flex items-center mb-2"><h3 className="font-display font-bold text-brand-800">Sıradaki ödemeler</h3><Link href="?t=odeme" className="ml-auto text-sm font-semibold text-brand-700">Planla →</Link></div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {h.next_pay.map((x, i) => <li key={i} className="flex gap-2"><span className="font-semibold">{dmy(x.due_date)}</span><span className="text-muted text-xs">{x.kind === "invoice" ? "fatura" : x.kind === "plan" ? "plan" : x.kind === "note" ? "senet" : "çek"}{x.doc ? ` · ${x.doc}` : ""}</span><span className="ml-auto tabular-nums font-semibold">{money(x.amount, x.currency)}</span></li>)}
            {!h.next_pay.length && <li className="text-muted">Yok.</li>}
          </ul>
        </section>
        <section className="rounded-[16px] border border-line bg-white p-4">
          <div className="flex items-center mb-2"><h3 className="font-display font-bold text-brand-800">Portal kullanıcıları</h3><Link href="/alis/tedarikci-kullanicilari" className="ml-auto text-sm font-semibold text-brand-700">Ekle →</Link></div>
          <ul className="flex flex-col gap-1.5 text-sm">
            {users.map((u) => <li key={u.email} className="flex gap-2"><span className={u.is_active ? "" : "line-through text-muted"}>{u.name}</span><span className="text-xs text-muted truncate">{u.email}</span><span className="ml-auto text-xs text-muted">{u.last_seen_at ? `son giriş ${dmy(u.last_seen_at)}` : "hiç girmedi"}</span></li>)}
            {!users.length && <li className="text-muted">Henüz kullanıcı yok — davet gönderin, tedarikçi siparişlerini, carisini ve ödemelerini kendisi görsün.</li>}
          </ul>
        </section>
      </div>
    </div>
  );
}

async function Prices({ id, canDecide }: { id: string; canDecide: boolean }) {
  const sb = await createClient();
  const { data: ls } = await sb.from("sup_price_lists").select("id, title, currency, valid_from, status, note, submitted_at, sender_name, decision_note, doc_id").eq("party_id", id).order("submitted_at", { ascending: false }).limit(30);
  const lists = (ls ?? []) as PriceList[];
  const ids = lists.map((l) => l.id);
  const { data: ln } = ids.length ? await sb.from("sup_price_lines").select("id, list_id, item_id, code, name, unit, old_price, old_currency, new_price, approved").in("list_id", ids).order("sort") : { data: [] };
  const lines = (ln ?? []) as { id: string; list_id: string; item_id: string | null; code: string | null; name: string; unit: string; old_price: number | null; old_currency: string | null; new_price: number; approved: boolean | null }[];
  return (
    <div className="flex flex-col gap-4">
      {lists.map((l) => {
        const ll = lines.filter((x) => x.list_id === l.id);
        const open = l.status === "submitted";
        const avg = ll.filter((x) => x.old_price).map((x) => (x.new_price - x.old_price!) / x.old_price!);
        const avgPct = avg.length ? Math.round((avg.reduce((a, b) => a + b, 0) / avg.length) * 1000) / 10 : null;
        return (
          <form key={l.id} action={decidePriceList} className={`rounded-[16px] border bg-white ${open ? "border-warn" : "border-line"}`}>
            <input type="hidden" name="party_id" value={id} /><input type="hidden" name="id" value={l.id} />
            <div className="p-4 flex flex-wrap items-center gap-2">
              <h3 className="font-display font-bold text-brand-800">{l.title}</h3>
              <span className="text-sm text-muted">{dmy(l.submitted_at)}{l.sender_name ? ` · ${l.sender_name}` : ""} · {l.currency} · geçerli {dmy(l.valid_from)}</span>
              {avgPct != null && <span className={`text-sm font-semibold ${avgPct > 0 ? "text-bad" : "text-ok"}`}>ort. {avgPct > 0 ? "+" : ""}%{avgPct}</span>}
              {l.doc_id && <a href={`/api/tedarikci-dosya/${l.doc_id}`} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-700">Dosya ↗</a>}
              <span className={`ml-auto rounded-md px-2 py-0.5 text-xs font-semibold ${PRICE_STATUS[l.status]?.[1]}`}>{PRICE_STATUS[l.status]?.[0]}</span>
            </div>
            {l.note && <p className="px-4 text-sm"><b>Tedarikçinin notu:</b> {l.note}</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead><tr className="text-left text-xs text-muted"><th className="p-3 w-8" /><th className="p-3">Ürün</th><th className="p-3 text-right">Eski fiyat</th><th className="p-3 text-right">Yeni fiyat</th><th className="p-3 text-right">Değişim</th><th className="p-3">Stok kartı</th></tr></thead>
                <tbody>
                  {ll.map((x) => {
                    const ch = x.old_price ? Math.round(((x.new_price - x.old_price) / x.old_price) * 1000) / 10 : null;
                    return (
                      <tr key={x.id} className="border-t border-[#EEF2F6]">
                        <td className="p-3">{open ? <input type="checkbox" name="line" value={x.id} defaultChecked={ch == null || ch <= 10} /> : x.approved ? "✓" : x.approved === false ? "✗" : ""}</td>
                        <td className="p-3">{x.name}{x.code && <span className="ml-2 text-xs text-muted font-mono">{x.code}</span>}<span className="text-xs text-muted"> · {x.unit}</span></td>
                        <td className="p-3 text-right tabular-nums text-muted">{x.old_price != null ? money(x.old_price, x.old_currency ?? l.currency) : "—"}</td>
                        <td className="p-3 text-right tabular-nums font-semibold">{money(x.new_price, l.currency)}</td>
                        <td className={`p-3 text-right font-semibold ${ch && ch > 10 ? "text-bad" : ch && ch > 0 ? "text-warn" : "text-ok"}`}>{ch != null ? `${ch > 0 ? "+" : ""}%${ch}` : "yeni"}</td>
                        <td className="p-3 text-xs">{x.item_id ? "bağlı — onayda güncellenir" : <span className="text-muted">kart yok</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {open && canDecide && (
              <div className="p-4 border-t border-line flex flex-wrap items-center gap-2">
                <input name="note" maxLength={500} placeholder="Tedarikçiye not (isteğe bağlı)" className="h-10 flex-1 min-w-[240px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
                <PendingSubmit className="h-10 px-4 rounded-[10px] bg-ok text-white text-sm font-semibold">Seçilenleri onayla</PendingSubmit>
                <PendingSubmit name="reject" value="1" className="h-10 px-4 rounded-[10px] border border-bad text-bad text-sm font-semibold">Listeyi reddet</PendingSubmit>
                <span className="w-full text-xs text-muted">%10&apos;dan fazla artanlar seçili gelmez. Onaylanan, stok kartına bağlı ürünlerin alış fiyatı güncellenir; yeni siparişlerde bu fiyat gelir. Tedarikçiye mesaj gider.</span>
              </div>
            )}
          </form>
        );
      })}
      {!lists.length && <p className="rounded-[16px] border border-line bg-white p-8 text-center text-muted">Bu tedarikçi henüz fiyat listesi göndermedi.</p>}
    </div>
  );
}

async function Payments({ id, ay, currency, canWrite }: { id: string; ay?: string; currency: string; canWrite: boolean }) {
  const sb = await createClient();
  const r = monthRange(ay);
  const { data, error } = await sb.rpc("pay_calendar", { p_from: r.from, p_to: new Date(Date.parse(r.to) + 120 * 864e5).toISOString().slice(0, 10), p_party: id });
  return (
    <div className="flex flex-col gap-5">
      {canWrite && <PlanForm partyId={id} currency={currency} />}
      {error ? <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p> : <PayCalendar items={(data ?? []) as PayItem[]} ay={r.month} base={`/satinalma/tedarikci/${id}?t=odeme`} lab />}
    </div>
  );
}
