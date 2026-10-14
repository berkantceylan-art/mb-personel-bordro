import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { qty } from "@/lib/stock";
import { utsConfigured } from "@/lib/uts";
import { saveUtsSettings, utsAction, utsAdd } from "@/lib/uts-actions";

export const dynamic = "force-dynamic";

type N = {
  id: string; kind: "alma" | "kullanim" | "verme" | "ismarlama"; status: string; item_id: string | null; item_name: string | null; product_no: string | null; lot_no: string | null; serial_no: string | null;
  qty: number | null; expiry_date: string | null; counterparty_no: string | null; counterparty_name: string | null; job_id: string | null; receipt_id: string | null; payload: Record<string, unknown>;
  env: string | null; uts_ref: string | null; error: string | null; attempts: number; created_at: string; sent_at: string | null;
};
type S = { enabled: boolean; auto_alma: boolean; auto_kullanim: boolean; auto_verme: boolean; auto_ismarlama: boolean; env: "test" | "live"; start_date: string };

const KIND: Record<N["kind"], [string, string]> = {
  alma: ["Alma", "Tedarikçiden gelen ürünü ÜTS'de kabul"],
  kullanim: ["Kullanım", "Ürün bir işte (protezde) kullanıldı"],
  verme: ["Verme", "Ürün işle birlikte kliniğe devredildi"],
  ismarlama: ["Ismarlama", "Kişiye özel protez · ÜTS ekranından elle yapılır"],
};
const STATUS: Record<string, [string, string]> = {
  pending: ["Bekliyor", "bg-[#EEF2F6] text-ink"], sending: ["Gönderiliyor", "bg-[#EAF2FB] text-brand-700"], sent: ["ÜTS'ye iletildi", "bg-ok-bg text-ok"],
  manual: ["Elle yapıldı", "bg-ok-bg text-ok"], error: ["Hata", "bg-bad-bg text-bad"], cancelled: ["İptal", "bg-[#F3F4F6] text-muted"], cancel_needed: ["ÜTS'de iptal gerekli", "bg-warn-bg text-warn"],
};
const TABS: Array<[string, string]> = [["", "Yapılacaklar"], ["error", "Hatalı"], ["cancel_needed", "İptal gerekli"], ["done", "Tamamlanan"], ["all", "Tümü"]];

/** ÜTS bildirimleri: alma, kullanım, verme, ısmarlama — kuyruk, hata, elle tamamlama, ayarlar */
export default async function UtsPage({ searchParams }: { searchParams: Promise<{ durum?: string; tur?: string; q?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 1 && (s.modules.production ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === (sp.durum ?? "")) ? sp.durum ?? "" : "";
  const kind = sp.tur && sp.tur in KIND ? (sp.tur as N["kind"]) : null;
  const supabase = await createClient();
  let q = supabase.from("uts_notifications").select("*").order("created_at", { ascending: false }).limit(300);
  if (tab === "") q = q.in("status", ["pending", "sending", "error", "cancel_needed"]);
  else if (tab === "done") q = q.in("status", ["sent", "manual"]);
  else if (tab !== "all") q = q.eq("status", tab);
  if (kind) q = q.eq("kind", kind);
  if (sp.q?.trim()) { const t = sp.q.trim().replace(/[%,()]/g, ""); q = q.or(`item_name.ilike.%${t}%,lot_no.ilike.%${t}%,serial_no.ilike.%${t}%,counterparty_name.ilike.%${t}%,product_no.ilike.%${t}%`); }
  const [{ data, error }, { data: st }, { data: cnt }, { data: items }] = await Promise.all([
    q,
    supabase.from("uts_settings").select("*").maybeSingle(),
    supabase.from("uts_notifications").select("status, kind").in("status", ["pending", "sending", "error", "cancel_needed"]),
    supabase.from("stk_items").select("id, name").eq("uts_tracked", true).eq("is_active", true).order("name").limit(500),
  ]);
  const rows = (data ?? []) as N[];
  const set = (st ?? null) as S | null;
  const open = (cnt ?? []) as Array<{ status: string; kind: string }>;
  const canEdit = (s.modules.stock ?? 0) >= 2 || (s.modules.production ?? 0) >= 2;
  const canSet = (s.modules.stock ?? 0) >= 3 || s.role === "owner";
  const token = utsConfigured();
  const link = (p: Record<string, string | null>) => {
    const u = new URLSearchParams();
    Object.entries({ durum: tab || null, tur: kind, q: sp.q ?? null, ...p }).forEach(([k, v]) => v && u.set(k, v));
    return `/stok/uts${u.size ? `?${u}` : ""}`;
  };
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm";
  const ism = rows.filter((r) => r.kind === "ismarlama" && (r.status === "pending" || r.status === "error"));

  return (
    <>
      <PageHeader title="ÜTS bildirimleri" subtitle="Ürün Takip Sistemi: mal kabulde alma, işte kullanım, kliniğe verme ve ısmarlama protez bildirimleri" actions={<Link href="/stok/lotlar" className="text-sm font-semibold text-brand-700">Lot izlenebilirliği</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20270205000000_uts.sql çalıştırılmalı.</Notice>}
        {!error && !set?.enabled && <Notice tone="warn">ÜTS bildirimleri kapalı. Aşağıdaki ayarlardan açın; açıldıktan sonraki mal kabul, iş malzemesi ve teslimler kendiliğinden sıraya girer.</Notice>}
        {!error && set?.enabled && !token && <Notice tone="warn">ÜTS token&apos;ı tanımlı değil: bildirimler sırada bekler, gönderilmez. Token&apos;ı Vercel&apos;de ERP projesine <b>UTS_TOKEN</b> adıyla ekleyin (sohbete ya da buraya yazmayın).</Notice>}
        {!error && set?.enabled && token && set.env === "test" && <Notice tone="warn">Gönderim <b>ÜTS test ortamına</b> yapılıyor. Test bildirimleri sorunsuz geçtikten sonra ayarlardan &quot;Canlı&quot;ya alın.</Notice>}

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {(["alma", "kullanim", "verme", "ismarlama"] as const).map((k) => {
            const n = open.filter((o) => o.kind === k && o.status !== "cancel_needed").length;
            const e = open.filter((o) => o.kind === k && o.status === "error").length;
            return (
              <Link key={k} href={link({ tur: kind === k ? null : k })} className={`rounded-[16px] border bg-white p-4 hover:border-brand-700 ${kind === k ? "border-brand-700" : "border-line"}`}>
                <div className="text-xs font-semibold text-muted">{KIND[k][0]} bildirimi</div>
                <div className="font-display text-2xl font-bold mt-1">{n}</div>
                <div className="text-xs text-muted">{e ? <span className="text-bad font-semibold">{e} hatalı · </span> : null}{KIND[k][1]}</div>
              </Link>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {TABS.map(([k, l]) => <Link key={k} href={link({ durum: k || null })} className={`rounded-full px-3.5 py-1.5 text-sm font-semibold ${tab === k ? "bg-ink text-white" : "bg-white border border-line"}`}>{l}</Link>)}
          <form className="ml-auto flex gap-2">
            {tab && <input type="hidden" name="durum" value={tab} />}
            {kind && <input type="hidden" name="tur" value={kind} />}
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Ürün, lot, seri, firma" className={`${inp} w-56`} />
            <button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Ara</button>
          </form>
        </div>

        {ism.length > 0 && (
          <Notice tone="warn">{ism.length} ısmarlama bildirimi ÜTS ekranından elle girilmeyi bekliyor. Her satırdaki bilgileri ÜTS&apos;ye girin, ÜTS&apos;nin verdiği numarayı yazıp &quot;Elle yapıldı&quot;yı işaretleyin.</Notice>
        )}

        <section className="rounded-[18px] border border-line bg-white overflow-x-auto">
          <table className="w-full text-sm min-w-[1000px]">
            <thead><tr className="text-left text-xs text-muted"><th className="p-3">Tür / tarih</th><th className="p-3">Ürün</th><th className="p-3">Lot / seri</th><th className="p-3 text-right">Adet</th><th className="p-3">Karşı kurum / iş</th><th className="p-3">Durum</th><th className="p-3">İşlem</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const p = r.payload ?? {};
                return (
                  <tr key={r.id} className="border-t border-[#EEF2F6] align-top">
                    <td className="p-3"><b>{KIND[r.kind][0]}</b><div className="text-xs text-muted">{formatDate(r.created_at.slice(0, 10))}{r.env ? ` · ${r.env === "live" ? "canlı" : "test"}` : ""}</div></td>
                    <td className="p-3">
                      {r.kind === "ismarlama" ? (
                        <div className="flex flex-col gap-0.5 text-xs">
                          <b className="text-sm">{String(p.device ?? "Ismarlama protez")}</b>
                          {!!p.teeth && <span>Dişler: {String(p.teeth)}{p.shade ? ` · renk ${String(p.shade)}` : ""}</span>}
                          {!!p.patient && <span>Hasta: {String(p.patient)}</span>}
                          {!!p.doctor && <span>Hekim: {String(p.doctor)}</span>}
                          {!!p.delivered_at && <span>Teslim: {formatDate(String(p.delivered_at))}</span>}
                          {Array.isArray(p.materials) && p.materials.length > 0 && <span className="text-muted">Malzemeler: {(p.materials as Array<{ item: string; lot: string | null; uts_no: string | null }>).map((m) => `${m.item}${m.lot ? ` (lot ${m.lot})` : ""}`).join(", ")}</span>}
                        </div>
                      ) : (
                        <>{r.item_id ? <Link href={`/stok/urunler/${r.item_id}`} className="text-brand-700">{r.item_name}</Link> : r.item_name ?? "—"}<div className="text-xs text-muted num">{r.product_no ? `UNO ${r.product_no}` : <span className="text-bad">ürün numarası yok</span>}{r.expiry_date ? ` · SKT ${formatDate(r.expiry_date)}` : ""}</div></>
                      )}
                    </td>
                    <td className="p-3 num text-xs">{r.serial_no ? `Seri ${r.serial_no}` : r.lot_no ? `Lot ${r.lot_no}` : "—"}</td>
                    <td className="p-3 text-right num">{r.qty != null ? qty(r.qty) : "—"}</td>
                    <td className="p-3 text-xs">
                      {r.counterparty_name ?? (r.kind === "kullanim" ? "Laboratuvar içi" : "—")}
                      {(r.kind === "alma" || r.kind === "verme") && <div className={r.counterparty_no ? "text-muted num" : "text-bad"}>{r.counterparty_no ? `Kurum no ${r.counterparty_no}` : "ÜTS kurum no yok"}</div>}
                      {r.job_id && <div><Link href={`/isler/${r.job_id}`} className="text-brand-700">İş #{String(p.job_no ?? "")}</Link></div>}
                      {r.receipt_id && <div><Link href={`/stok/mal-kabul/${r.receipt_id}`} className="text-brand-700">{String(p.doc ?? "Mal kabul")}</Link></div>}
                    </td>
                    <td className="p-3">
                      <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-semibold ${STATUS[r.status]?.[1] ?? ""}`}>{STATUS[r.status]?.[0] ?? r.status}</span>
                      {r.uts_ref && <div className="text-xs text-muted num">ÜTS no {r.uts_ref}</div>}
                      {r.error && <div className="mt-1 max-w-[260px] text-xs text-bad">{r.error}</div>}
                    </td>
                    <td className="p-3">
                      {canEdit && (
                        <div className="flex flex-col gap-1.5 text-xs">
                          {r.status === "error" && r.kind !== "ismarlama" && (
                            <details>
                              <summary className="cursor-pointer font-semibold text-brand-700">Düzelt, tekrar dene</summary>
                              <form action={utsAction} className="mt-1 flex flex-col gap-1">
                                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="retry" />
                                <input name="product_no" defaultValue={r.product_no ?? ""} placeholder="UNO" className="h-8 rounded-md border border-line px-2" />
                                {r.serial_no || !r.lot_no ? <input name="serial_no" defaultValue={r.serial_no ?? ""} placeholder="Seri no" className="h-8 rounded-md border border-line px-2" /> : null}
                                {!r.serial_no && <input name="lot_no" defaultValue={r.lot_no ?? ""} placeholder="Lot" className="h-8 rounded-md border border-line px-2" />}
                                {(r.kind === "alma" || r.kind === "verme") && <input name="counterparty_no" defaultValue={r.counterparty_no ?? ""} placeholder="Karşı kurum no" className="h-8 rounded-md border border-line px-2" />}
                                <PendingSubmit className="h-8 rounded-md bg-brand-700 px-2 font-semibold text-white">Tekrar dene</PendingSubmit>
                              </form>
                            </details>
                          )}
                          {["pending", "error"].includes(r.status) && (
                            <details>
                              <summary className="cursor-pointer font-semibold text-ok">ÜTS&apos;de elle yaptım</summary>
                              <form action={utsAction} className="mt-1 flex flex-col gap-1">
                                <input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="manual" />
                                <input name="ref" placeholder="ÜTS bildirim no (varsa)" maxLength={120} className="h-8 rounded-md border border-line px-2" />
                                <PendingSubmit className="h-8 rounded-md bg-ok px-2 font-semibold text-white">İşaretle</PendingSubmit>
                              </form>
                            </details>
                          )}
                          {["pending", "error"].includes(r.status) && (
                            <form action={utsAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="cancel" /><PendingSubmit className="font-semibold text-muted">Gönderme</PendingSubmit></form>
                          )}
                          {r.status === "cancel_needed" && (
                            <form action={utsAction}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="action" value="cancelled_in_uts" /><PendingSubmit className="font-semibold text-warn">ÜTS&apos;de iptal ettim</PendingSubmit></form>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={7} className="p-8 text-center text-muted">{tab === "" ? "Yapılacak ÜTS bildirimi yok." : "Kayıt yok."}</td></tr>}
            </tbody>
          </table>
        </section>

        {canEdit && !error && (
          <Card title="Elle bildirim ekle">
            <p className="text-sm text-muted">Otomatik akış dışında kalan bir işlem için (ör. eski tarihli mal kabul, iade).</p>
            <form action={utsAdd} className="grid gap-2 md:grid-cols-4">
              <select name="kind" className={inp} defaultValue="alma">{(["alma", "kullanim", "verme"] as const).map((k) => <option key={k} value={k}>{KIND[k][0]}</option>)}</select>
              <select name="item_id" className={`${inp} md:col-span-3`} defaultValue=""><option value="">Ürün seçin (ÜTS takipli kartlar)</option>{((items ?? []) as Array<{ id: string; name: string }>).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
              <input name="lot_no" placeholder="Lot" className={inp} />
              <input name="serial_no" placeholder="Seri no" className={inp} />
              <input name="qty" placeholder="Adet" inputMode="decimal" defaultValue="1" className={inp} />
              <input name="expiry_date" type="date" className={inp} />
              <input name="counterparty_no" placeholder="Karşı kurum ÜTS no" inputMode="numeric" className={inp} />
              <input name="counterparty_name" placeholder="Karşı kurum adı" className={`${inp} md:col-span-2`} />
              <PendingSubmit className="h-10 rounded-[10px] bg-brand-700 px-4 text-sm font-semibold text-white">Sıraya ekle</PendingSubmit>
            </form>
          </Card>
        )}

        {canSet && !error && (
          <Card title="ÜTS ayarları">
            <form action={saveUtsSettings} className="flex flex-col gap-3 text-sm">
              <label className="flex items-center gap-2 font-semibold"><input type="checkbox" name="enabled" defaultChecked={set?.enabled} /> ÜTS bildirimleri açık</label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="flex items-center gap-2"><input type="checkbox" name="auto_alma" defaultChecked={set?.auto_alma ?? true} /> Mal kabul onaylanınca <b>alma</b> bildirimi</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="auto_kullanim" defaultChecked={set?.auto_kullanim ?? true} /> İşe malzeme düşülünce <b>kullanım</b> bildirimi</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="auto_verme" defaultChecked={set?.auto_verme ?? true} /> İş teslim edilince kliniğe <b>verme</b> bildirimi (kliniğe giden ürünler)</label>
                <label className="flex items-center gap-2"><input type="checkbox" name="auto_ismarlama" defaultChecked={set?.auto_ismarlama ?? true} /> İş teslim edilince <b>ısmarlama</b> bildirimi hazırla</label>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Ortam
                  <select name="env" defaultValue={set?.env ?? "test"} className={inp}><option value="test">Test (utstest)</option><option value="live">Canlı</option></select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-semibold text-muted">Başlangıç tarihi<input type="date" name="start_date" defaultValue={set?.start_date ?? ""} className={inp} /></label>
                <PendingSubmit className="h-10 rounded-[10px] bg-brand-700 px-4 text-sm font-semibold text-white">Kaydet</PendingSubmit>
              </div>
              <p className="text-xs text-muted">Token: {token ? "✓ Vercel'de tanımlı" : "tanımlı değil"} · Laboratuvar ÜTS no: Yönetim › Şirket bilgileri. Ürün kartlarında &quot;ÜTS&apos;de takip ediliyor&quot; işaretli malzemeler için bildirim hazırlanır; tedarikçi ve klinik kartlarına ÜTS kurum numarasını girin.</p>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
