import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { MR_EVENT, MR_STATUS, mrNo, qtyFmt } from "@/lib/material";
import { DeliverForm, PurchaseActions, StockActions } from "../RequestActions";

export const dynamic = "force-dynamic";

type Req = { id: string; kind?: string; requested_by?: string; year: number; no: number; status: string; reason: string | null; needed_by: string | null; decision_note: string | null; created_at: string; delivered_at: string | null; completed_at: string | null; employees: { first_name: string; last_name: string; departments: { name: string } | null } | null };
type Line = { id: string; sort: number; item_id: string | null; name: string; unit: string; qty: number; issued_qty: number; to_purchase: boolean; note: string | null };
const dt = (iso: string) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Malzeme isteği ayrıntısı: depo ve satın alma işlemleri, teslim ve imza */
export default async function MaterialRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const ses = await getSession();
  const stock = ses.modules.stock ?? 0;
  const pur = ses.modules.purchases ?? 0;
  if (stock < 1 && pur < 1) redirect("/");
  const supabase = await createClient();
  const [{ data: r }, { data: lns }, { data: ev }, { data: sigs }, { data: whs }] = await Promise.all([
    supabase.from("stk_requests").select("*, employees(first_name, last_name, departments(name))").eq("id", id).maybeSingle(),
    supabase.from("stk_request_lines").select("id, sort, item_id, name, unit, qty, issued_qty, to_purchase, note").eq("request_id", id).order("sort"),
    supabase.from("stk_request_events").select("id, at, action, note, by_user").eq("request_id", id).order("at"),
    supabase.from("stk_request_signatures").select("role, signer_name, signed_at").eq("request_id", id),
    supabase.from("stk_warehouses").select("id, name, is_default").eq("is_active", true).order("name"),
  ]);
  if (!r) notFound();
  const req = r as unknown as Req;
  const lines = (lns ?? []) as Line[];
  const itemIds = lines.map((l) => l.item_id).filter(Boolean) as string[];
  const { data: st } = itemIds.length ? await supabase.from("stk_stock").select("item_id, qty").in("item_id", itemIds) : { data: [] };
  const onHand = new Map<string, number>();
  for (const x of (st ?? []) as { item_id: string; qty: number }[]) onHand.set(x.item_id, (onHand.get(x.item_id) ?? 0) + Number(x.qty));
  const L = lines.map((l) => ({ ...l, qty: Number(l.qty), issued_qty: Number(l.issued_qty), onHand: l.item_id ? onHand.get(l.item_id) ?? 0 : null }));
  const allAvail = L.every((l) => l.onHand == null || l.onHand >= l.qty);
  let emp = req.employees ? `${req.employees.first_name} ${req.employees.last_name}` : "Personel";
  if (!req.employees && req.requested_by) {
    const { data: dir } = await supabase.rpc("company_directory");
    emp = ((dir ?? []) as { user_id: string; display_name: string }[]).find((d) => d.user_id === req.requested_by)?.display_name ?? emp;
  }
  const isAsset = req.kind === "asset";
  const { data: freeAssets } = isAsset ? await supabase.from("assets").select("id, code, name, category").eq("status", "AVAILABLE").order("name").limit(500) : { data: [] };
  const [label, cls] = MR_STATUS[req.status] ?? MR_STATUS.pending!;
  const signed = new Map(((sigs ?? []) as { role: string; signer_name: string; signed_at: string }[]).map((x) => [x.role, x]));

  return (
    <>
      <PageHeader title={`${mrNo(req)} · ${emp}`} subtitle={`${req.employees?.departments?.name ?? ""} · ${dt(req.created_at)}`}
        actions={["delivered", "completed"].includes(req.status) ? <Link href={`/yazdir/malzeme/${id}`} className="text-sm font-semibold text-brand-700">Teslim tutanağı ↗</Link> : undefined} />
      <div className={`${page} max-w-[1000px]`}>
        <Link href="/stok/talepler" className="text-sm font-semibold text-brand-700">← İstekler</Link>
        {req.kind && req.kind !== "material" && <span className="self-start rounded-md bg-[#F3E8FF] px-2.5 py-1 text-xs font-bold text-[#6D28D9]">{req.kind === "asset" ? "Demirbaş isteği · teslimde seçilen demirbaş kişinin zimmetine geçer" : "Dış sipariş · satın alma onayından sonra alım listesine eklenir"}</span>}
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5 flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-sm font-semibold px-2.5 py-1 rounded-md ${cls}`}>{label}</span>
            {req.needed_by && <span className="text-sm text-muted">Lazım: <b>{formatDate(req.needed_by)}</b></span>}
          </div>
          {req.reason && <p className="text-sm"><b>Gerekçe:</b> {req.reason}</p>}
          {req.decision_note && <p className="text-sm"><b>Not:</b> {req.decision_note}</p>}
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Malzeme</th><th className="py-1.5 text-right">İstenen</th><th className="py-1.5 text-right">Depoda</th><th className="py-1.5 text-right">Teslim edilen</th></tr></thead>
            <tbody>
              {L.map((l) => (
                <tr key={l.id} className="border-t border-[#EEF2F6]">
                  <td className="py-2">{l.item_id ? <Link href={`/stok/urunler/${l.item_id}`} className="font-semibold text-brand-700">{l.name}</Link> : <b>{l.name}</b>}
                    {l.to_purchase && <span className="ml-2 text-xs font-semibold text-[#6D28D9]">satın alınacak</span>}{l.note && <span className="block text-xs text-muted">{l.note}</span>}</td>
                  <td className="py-2 text-right num">{qtyFmt(l.qty)} {l.unit}</td>
                  <td className={`py-2 text-right num ${l.onHand != null && l.onHand < l.qty ? "text-bad font-semibold" : "text-muted"}`}>{l.onHand == null ? "kart yok" : qtyFmt(l.onHand)}</td>
                  <td className="py-2 text-right num">{l.issued_qty ? qtyFmt(l.issued_qty) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {req.status === "pending" && stock >= 2 && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
            <h2 className="font-display font-semibold mb-3">Depo kararı</h2>
            <StockActions id={id} lines={L} canPrepare={allAvail} />
            {!allAvail && <p className="mt-2 text-xs text-warn">Bazı kalemler depoda yetersiz; satın almaya gönderebilir ya da elinizdekini doğrudan teslim edebilirsiniz.</p>}
          </section>
        )}
        {(req.status === "purchase" || req.status === "approved") && (pur >= 2 || stock >= 2) && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
            <h2 className="font-display font-semibold mb-3">Satın alma</h2>
            <PurchaseActions id={id} status={req.status} canApprove={pur >= 3} canBought={pur >= 2 || stock >= 2} />
            {req.status === "approved" && <p className="mt-2 text-xs text-muted">Malzeme alındığında alış faturasını her zamanki gibi işleyin (stoğa giriş faturayla olur); burada yalnız teslime hazır olarak işaretlenir.</p>}
          </section>
        )}
        {["pending", "ready"].includes(req.status) && stock >= 2 && (
          <section className="bg-white border-2 border-[#22C55E]/40 rounded-[16px] p-4 md:p-5">
            <h2 className="font-display font-semibold mb-3">Teslim et ve imzala</h2>
            <DeliverForm id={id} lines={L} warehouses={(whs ?? []) as { id: string; name: string; is_default: boolean }[]} signer={ses.email?.split("@")[0] ?? ""} employee={emp} assets={isAsset ? ((freeAssets ?? []) as { id: string; code: string | null; name: string }[]) : undefined} />
          </section>
        )}
        {signed.size > 0 && (
          <section className="bg-white border border-line rounded-[16px] p-4 md:p-5 text-sm flex flex-wrap gap-6">
            {(["warehouse", "employee"] as const).map((k) => {
              const x = signed.get(k);
              return <div key={k}><span className="text-xs text-muted">{k === "warehouse" ? "Teslim eden (depo)" : "Teslim alan (personel)"}</span><b className="block">{x ? `✓ ${x.signer_name}` : "İmza bekleniyor"}</b>{x && <span className="text-xs text-muted">{dt(x.signed_at)}</span>}</div>;
            })}
          </section>
        )}
        <section className="bg-white border border-line rounded-[16px] p-4 md:p-5">
          <h2 className="font-display font-semibold mb-2">Geçmiş</h2>
          <ol className="flex flex-col gap-1.5 text-sm">
            {((ev ?? []) as { id: number; at: string; action: string; note: string | null }[]).map((e) => (
              <li key={e.id} className="flex gap-3"><span className="w-36 shrink-0 text-xs text-muted num">{dt(e.at)}</span><span>{MR_EVENT[e.action] ?? e.action}{e.note ? <span className="text-muted"> · {e.note}</span> : null}</span></li>
            ))}
          </ol>
        </section>
      </div>
    </>
  );
}
