import Link from "next/link";
import { money } from "@/lib/jobs";
import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { PAY_KINDS, daysTo, dmy, portalCtx, portalHome, withQ } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

const ST: Record<string, string> = { approved: "Yeni sipariş", sent: "Açık", partial: "Kısmen teslim alındı", received: "Teslim alındı", invoiced: "Faturalandı" };
const MON = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

/** Tedarikçi portalı ana sayfa: bekleyen işler, bakiye, sıradaki ödemeler, son siparişler ve mesajlar */
export default async function SupplierHome({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const ctx = await portalCtx(await searchParams);
  if (!ctx) return <NotLinked />;
  const { home: h, badges, error } = await portalHome(ctx);
  const [{ data: orders }, { data: msgs }] = await Promise.all([
    ctx.sb.from("pur_orders").select("id, year, no, order_date, expected_date, status, currency, total, supplier_token, sup_ack_at, sup_promised_date, sup_shipped_at, sup_seen_at")
      .eq("party_id", ctx.party.id).in("status", ["approved", "sent", "partial", "received", "invoiced"]).order("created_at", { ascending: false }).limit(6),
    ctx.sb.from("sup_messages").select("id, side, sender_name, body, created_at, read_at").eq("party_id", ctx.party.id).order("created_at", { ascending: false }).limit(4),
  ]);
  type O = { id: string; year: number; no: number; order_date: string; expected_date: string | null; status: string; currency: string; total: number; supplier_token: string; sup_ack_at: string | null; sup_promised_date: string | null; sup_shipped_at: string | null };
  const list = (orders ?? []) as O[];
  const ms = (msgs ?? []) as { id: string; side: string; sender_name: string | null; body: string; created_at: string; read_at: string | null }[];
  const viewer = ctx.mode === "supplier" ? "supplier" : "lab";
  const hour = Number(new Date().toLocaleString("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }));
  const greet = hour < 12 ? "Günaydın" : hour < 18 ? "İyi günler" : "İyi akşamlar";
  const maxM = Math.max(1, ...(h?.monthly ?? []).map((m) => m.t));
  const q = (p: string) => withQ(p, ctx.q);

  return (
    <PortalShell ctx={ctx} active="/tedarikci" badges={badges}>
      {error && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{error}</p>}
      {h && (
        <>
          <section className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <h2 className="font-display text-2xl md:text-3xl font-bold text-brand-800">{greet}{ctx.mode === "supplier" ? `, ${ctx.me.split(" ")[0]}` : ""} 👋</h2>
              <p className="text-muted">{h.orders_new ? <b className="text-warn">{h.orders_new} yeni sipariş onayınızı bekliyor.</b> : "Onay bekleyen yeni sipariş yok."}{h.unread ? ` ${h.unread} okunmamış mesajınız var.` : ""}</p>
            </div>
            <Link href={q("/tedarikci/urunler")} className="h-11 px-5 inline-flex items-center rounded-xl bg-brand-700 text-white font-semibold">Yeni fiyat listesi gönder</Link>
            <Link href={q("/tedarikci/belgeler")} className="h-11 px-5 inline-flex items-center rounded-xl border border-line bg-white font-semibold text-brand-800">Belge gönder</Link>
          </section>

          <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <Card href={q("/tedarikci/siparisler?s=yeni")} label="Yeni sipariş" value={String(h.orders_new)} hot={h.orders_new > 0} sub="Onaylayıp termin verin" />
            <Card href={q("/tedarikci/siparisler")} label="Açık sipariş" value={String(h.orders_open)} sub={h.orders_late ? `${h.orders_late} tanesi termini geçti` : "Zamanında"} warn={h.orders_late > 0} />
            <Card href={q("/tedarikci/mesajlar")} label="Okunmamış mesaj" value={String(h.unread)} hot={h.unread > 0} sub="Satın alma ekibinden" />
            <Card href={q("/tedarikci/urunler")} label="İncelenen fiyat listesi" value={String(h.prices_pending)} sub="Onay bekliyor" />
          </section>

          <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
            <div className="flex flex-col gap-5">
              {h.balances && (
                <section className="grid gap-3 sm:grid-cols-2">
                  <Link href={q("/tedarikci/cari")} className="rounded-[20px] p-5 text-white bg-gradient-to-br from-[#0a3d73] via-[#0f5a96] to-[#1a86c7] shadow-lg shadow-[#0a3d73]/20 hover:-translate-y-0.5 transition">
                    <div className="text-xs font-semibold text-white/70">Faturalı hesap · alacağınız</div>
                    <div className="font-display text-3xl font-bold tabular-nums mt-1">{money(Number(h.balances.invoice), h.balances.currency)}</div>
                    <div className="text-xs text-white/70 mt-2">Ekstreyi gör →</div>
                  </Link>
                  {h.has_slip && h.balances.slip != null && (
                    <Link href={q("/tedarikci/cari?defter=fis")} className="rounded-[20px] p-5 bg-white border border-line hover:-translate-y-0.5 transition">
                      <div className="text-xs font-semibold text-muted">Faturasız (fişli) hesap · alacağınız</div>
                      <div className="font-display text-3xl font-bold tabular-nums mt-1 text-brand-800">{money(Number(h.balances.slip), h.balances.currency)}</div>
                      <div className="text-xs text-muted mt-2">Fiş ekstresi →</div>
                    </Link>
                  )}
                </section>
              )}

              <section className="rounded-[20px] border border-line bg-white overflow-hidden">
                <div className="flex items-center p-4 pb-2"><h3 className="font-display font-bold text-brand-800">Son siparişler</h3><Link href={q("/tedarikci/siparisler")} className="ml-auto text-sm font-semibold text-brand-700">Tümü →</Link></div>
                <ul className="divide-y divide-[#EEF2F6]">
                  {list.map((o) => {
                    const fresh = ["approved", "sent"].includes(o.status) && !o.sup_ack_at;
                    return (
                      <li key={o.id}>
                        <Link href={`/tedarikci/siparis/${o.supplier_token}`} className={`flex items-center gap-3 px-4 py-3 hover:bg-[#F7F9FB] ${fresh ? "bg-[#FFF9EE]" : ""}`}>
                          <span className={`w-2.5 h-2.5 rounded-full ${fresh ? "bg-warn animate-pulse" : o.status === "received" || o.status === "invoiced" ? "bg-ok" : "bg-brand-600"}`} />
                          <span className="font-mono font-semibold text-brand-700">SA-{o.year}-{String(o.no).padStart(4, "0")}</span>
                          <span className="text-xs text-muted hidden sm:inline">{dmy(o.order_date)}{o.expected_date ? ` · teslim ${dmy(o.expected_date)}` : ""}</span>
                          <span className="ml-auto text-xs font-semibold">{o.sup_shipped_at && ["approved", "sent"].includes(o.status) ? "Sevk ettiniz" : o.sup_ack_at && ["approved", "sent"].includes(o.status) ? "Onayladınız" : ST[o.status]}</span>
                          <span className="tabular-nums font-semibold w-28 text-right">{money(o.total, o.currency)}</span>
                        </Link>
                      </li>
                    );
                  })}
                  {!list.length && <li className="p-6 text-center text-sm text-muted">Henüz sipariş yok.</li>}
                </ul>
              </section>

              <section className="rounded-[20px] border border-line bg-white p-4">
                <div className="flex items-baseline gap-2 mb-3"><h3 className="font-display font-bold text-brand-800">Son 12 ay siparişler</h3><span className="text-sm text-muted">Bu yıl {money(h.year_total, "TRY")}</span></div>
                <div className="flex items-end gap-1.5 h-28">
                  {h.monthly.map((m) => (
                    <div key={m.m} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={`${m.m}: ${money(m.t, "TRY")}`}>
                      <div className="w-full max-w-6 rounded-t-md bg-gradient-to-t from-[#0a3d73] to-[#1a86c7]" style={{ height: `${Math.max(2, (m.t / maxM) * 100)}%`, opacity: m.t ? 1 : 0.15 }} />
                      <span className="text-[10px] text-muted">{MON[Number(m.m.slice(5)) - 1]}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <div className="flex flex-col gap-5">
              {h.balances && (
                <section className="rounded-[20px] border border-line bg-white p-4">
                  <div className="flex items-center mb-2"><h3 className="font-display font-bold text-brand-800">Sıradaki ödemeler</h3><Link href={q("/tedarikci/odemeler")} className="ml-auto text-sm font-semibold text-brand-700">Takvim →</Link></div>
                  <ol className="relative border-l-2 border-[#E1E7EE] ml-2 flex flex-col gap-3 py-1">
                    {h.next_pay.map((p, i) => {
                      const d = daysTo(p.due_date);
                      return (
                        <li key={i} className="ml-4">
                          <span className={`absolute -left-[7px] w-3 h-3 rounded-full ${d < 0 ? "bg-bad" : d <= 3 ? "bg-warn" : "bg-ok"}`} style={{ marginTop: 6 }} />
                          <div className="flex items-center gap-2">
                            <span className="font-semibold">{dmy(p.due_date)}</span>
                            <span className={`text-[11px] font-semibold rounded-full px-2 ${d < 0 ? "bg-bad-bg text-bad" : d <= 3 ? "bg-warn-bg text-warn" : "bg-[#EEF2F6] text-muted"}`}>{d < 0 ? `${-d} gün geçti` : d === 0 ? "bugün" : `${d} gün`}</span>
                            <span className="ml-auto tabular-nums font-bold">{money(p.amount, p.currency)}</span>
                          </div>
                          <div className="text-xs text-muted">{PAY_KINDS[p.kind]?.[1]} {PAY_KINDS[p.kind]?.[0]}{p.doc ? ` · ${p.doc}` : ""}</div>
                        </li>
                      );
                    })}
                    {!h.next_pay.length && <li className="ml-4 text-sm text-muted">Planlanmış ödeme yok.</li>}
                  </ol>
                </section>
              )}
              <section className="rounded-[20px] border border-line bg-white p-4">
                <div className="flex items-center mb-2"><h3 className="font-display font-bold text-brand-800">Mesajlar</h3><Link href={q("/tedarikci/mesajlar")} className="ml-auto text-sm font-semibold text-brand-700">Yazışmaya git →</Link></div>
                <ul className="flex flex-col gap-2">
                  {ms.map((m) => (
                    <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.side === viewer ? "bg-[#F4F8FC]" : !m.read_at ? "bg-[#FFF9EE] border border-warn/30" : "bg-[#F7F9FB]"}`}>
                      <div className="text-[11px] text-muted flex gap-2"><b>{m.side === viewer ? "Siz" : m.sender_name ?? "MB Dental"}</b><span>{new Date(m.created_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span></div>
                      <div className="line-clamp-2">{m.body}</div>
                    </li>
                  ))}
                  {!ms.length && <li className="text-sm text-muted">Henüz mesaj yok.</li>}
                </ul>
              </section>
            </div>
          </div>
        </>
      )}
    </PortalShell>
  );
}

function Card({ href, label, value, sub, hot, warn }: { href: string; label: string; value: string; sub: string; hot?: boolean; warn?: boolean }) {
  return (
    <Link href={href} className={`rounded-[20px] border bg-white p-4 flex flex-col gap-1 hover:-translate-y-0.5 hover:shadow-md transition ${hot ? "border-warn ring-4 ring-warn/10" : "border-line"}`}>
      <span className="text-xs font-semibold text-muted">{label}</span>
      <span className={`font-display text-3xl font-bold ${hot ? "text-warn" : ""}`}>{value}</span>
      <span className={`text-[11px] ${warn ? "text-bad font-semibold" : "text-muted"}`}>{sub}</span>
    </Link>
  );
}
