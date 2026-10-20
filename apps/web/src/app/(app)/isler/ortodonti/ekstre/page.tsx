import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/session";
import { DEFAULT_PRICE_LIST, OS_FLAG, outsourceStatementData, type OsFlag } from "@/lib/outsource-statement";
import { AliasSelect, DisputeBox, PriceListForm, StatementTools } from "./EkstreClient";

export const dynamic = "force-dynamic";
const tl = (k: number) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;
const day = (d: string | null | undefined) => (d ? d.slice(0, 10).split("-").reverse().join(".") : "—");
const money = (k: number, c: string) => `${(k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${c === "EUR" ? "€" : c === "USD" ? "$" : "₺"}`;

/** Dış lab ekstreleri: iş kayıtları ve fiyat listesiyle karşılaştırma */
export default async function OutsourceStatementPage({ searchParams }: { searchParams: Promise<{ uyari?: string; ay?: string; lab?: string }> }) {
  const s = await getSession();
  if (!s.logistics && (s.modules.finance ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const months = Math.min(24, Math.max(1, Number(sp.ay) || 3));
  const d = await outsourceStatementData(months);
  const head = <PageHeader title="Ortodonti ekstreleri" subtitle="Laboratuvardan gelen toplu fişler: iş kayıtları ve fiyat listesiyle karşılaştırma" actions={<Link href="/isler/ortodonti" className="text-sm font-semibold text-brand-700">← Ortodonti</Link>} />;
  if (d.missing) return (<>{head}<div className="p-4 md:p-8"><p className="rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-sm">Önce <b>mbdental-ortodonti.sql</b> (yapılmadıysa) ve <b>mbdental-ortodonti-ekstre.sql</b> dosyalarını Supabase&apos;de çalıştırın.</p></div></>);
  if (!d.labs.length) return (<>{head}<div className="p-4 md:p-8"><p className="rounded-[12px] bg-warn-bg text-warn px-4 py-3 text-sm">Önce <Link href="/isler/ortodonti" className="font-semibold underline">Ortodonti</Link> ekranından dış laboratuvarı seçin.</p></div></>);
  const lab = d.labs.find((l) => l.id === sp.lab) ?? d.labs[0]!;
  const prices = d.prices.filter((p) => p.party_id === lab.id);
  const rows = d.rows.filter((r) => r.party_id === lab.id);
  const charges = rows.filter((r) => r.kind === "charge");
  const sel = (Object.keys(OS_FLAG) as OsFlag[]).includes(sp.uyari as OsFlag) ? (sp.uyari as OsFlag) : null;
  const shown = sel ? charges.filter((r) => r.flags.includes(sel)) : rows;
  const cnt = (f: OsFlag) => charges.filter((r) => r.flags.includes(f)).length;
  const overSum = charges.reduce((a, r) => a + r.over, 0);
  const unmapped = [...new Map(charges.filter((r) => !r.confirmed && r.product).map((r) => [r.product!, r])).values()];
  const notBilled = d.notBilled.filter((b) => b.party_id === lab.id);
  const th = "py-2 px-2 font-semibold text-left text-xs text-muted";
  const td = "py-2 px-2 border-t border-[#EEF2F6] align-top";
  const q = (p: Record<string, string>) => `?${new URLSearchParams({ ay: String(months), ...(d.labs.length > 1 ? { lab: lab.id } : {}), ...p })}`;

  return (
    <>
      {head}
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {d.labs.length > 1 && <div className="flex gap-2 text-sm">{d.labs.map((l) => <Link key={l.id} href={`?lab=${l.id}&ay=${months}`} className={`rounded-full border px-3 py-1.5 font-semibold ${l.id === lab.id ? "bg-brand-700 text-white border-brand-700" : "border-line"}`}>{l.name}</Link>)}</div>}
        <StatementTools party={lab.id} email={lab.email} />

        <section className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          {[["Faturalanan", tl(charges.reduce((a, r) => a + r.amount, 0)), `${charges.length} satır · son ${months} ay`],
            ["Ödeme", tl(rows.filter((r) => r.kind === "payment").reduce((a, r) => a + r.amount, 0)), ""],
            ["Fiyat listesinden fazla", tl(overSum), `${cnt("over")} satır`],
            ["Geldi, ekstrede yok", String(notBilled.length), "5 günden eski"]].map(([l, v, sub]) => (
            <div key={l} className="rounded-[14px] border border-line bg-white p-4"><p className="text-xs text-muted font-semibold">{l}</p><p className={`text-xl font-bold num mt-1 ${l === "Fiyat listesinden fazla" && overSum ? "text-bad" : ""}`}>{v}</p><p className="text-xs text-muted mt-0.5">{sub}</p></div>
          ))}
        </section>

        <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-3">
          <h2 className="font-display text-lg font-bold">Kontrol</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {(Object.keys(OS_FLAG) as OsFlag[]).map((f) => <Link key={f} href={q({ uyari: f })} className={`rounded-full border px-3 py-1.5 font-semibold ${sel === f ? "bg-brand-700 text-white border-brand-700" : cnt(f) ? "border-[#F2D58A] bg-warn-bg text-warn" : "border-line text-muted"}`}>{OS_FLAG[f]} · {cnt(f)}</Link>)}
            {sel && <Link href={q({})} className="px-2 py-1.5 text-brand-700 font-semibold">Temizle</Link>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1100px]">
              <thead><tr><th className={th}>Tarih</th><th className={th}>İş</th><th className={th}>Bizdeki kayıt</th><th className={th}>Ekstredeki ürün</th><th className={th}>Fiyat listesi karşılığı</th><th className={`${th} text-right`}>Liste</th><th className={`${th} text-right`}>Faturalanan</th><th className={th}>Uyarı</th><th className={th}>İtiraz</th></tr></thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.id} className={r.disputed ? "bg-[#FFF6F5]" : r.kind === "payment" ? "bg-[#F3FAF6]" : ""}>
                    <td className={td}>{day(r.line_date)}</td>
                    <td className={td}>{r.job_id ? <Link href={`/isler/${r.job_id}`} className="font-semibold text-brand-700">#{r.job_no}</Link> : r.job_no ? <span className="text-bad font-semibold">#{r.job_no}</span> : "—"}<span className="block text-xs text-muted">{r.ref}</span></td>
                    <td className={`${td} text-xs`}>{r.jobs ? <><b>{r.jobs.lab_customers?.name}</b>{r.jobs.patient ? ` · ${r.jobs.patient}` : ""}<span className="block text-muted">{r.jobs.job_items.map((x) => `${x.name}${x.qty > 1 ? ` ×${x.qty}` : ""}`).join(", ")} · satış {money(r.jobs.total, r.jobs.currency)}</span></> : r.kind === "payment" ? "Ödeme" : "—"}</td>
                    <td className={td}>{r.product}</td>
                    <td className={td}>{r.kind === "charge" && r.product ? <AliasSelect party={lab.id} product={r.product} prices={prices.map((p) => ({ id: p.id, name: p.name }))} value={r.price?.id ?? ""} confirmed={r.confirmed} /> : null}</td>
                    <td className={`${td} text-right num`}>{r.price ? tl(r.price.price) : "—"}</td>
                    <td className={`${td} text-right num font-semibold ${r.over ? "text-bad" : ""}`}>{tl(r.amount)}{r.over ? <span className="block text-xs">+{tl(r.over)}</span> : null}</td>
                    <td className={`${td} text-xs`}>{r.flags.map((f) => OS_FLAG[f]).join(" · ")}</td>
                    <td className={td}>{r.kind === "charge" && <DisputeBox id={r.id} disputed={r.disputed} note={r.note ?? ""} />}</td>
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-muted">{rows.length ? "Bu kontrolde satır yok." : "Henüz ekstre yok. Yukarıdan PDF yükleyin ya da e-postadan çekin."}</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">&quot;Fiyat listesi karşılığı&quot; gri yazılıysa sistemin tahminidir; doğruysa seçip onaylayın, aynı ürün adı bundan sonra kendiliğinden eşleşir. Satış tutarı hekime kesilen iş bedelidir (karşılaştırma için).</p>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display text-lg font-bold">Geldi, ekstrede yok · {notBilled.length}</h2>
            <p className="text-xs text-muted">Laboratuvardan geri gelmiş ama hiçbir ekstrede faturalanmamış işler (sonraki ekstrede gelebilir).</p>
            <ul className="grid gap-1 text-sm">{notBilled.slice(0, 100).map((b) => <li key={b.id}><Link href={`/isler/${b.job_id}`} className="font-semibold text-brand-700">#{b.jobs?.no}</Link> · {b.jobs?.lab_customers?.name ?? ""} · {b.jobs?.patient ?? ""} · geldi {day(b.back_at)}</li>)}</ul>
          </section>
          <section className="rounded-[16px] border border-line bg-white p-4 flex flex-col gap-2">
            <h2 className="font-display text-lg font-bold">Fiyat listesi · {prices.length} kalem</h2>
            {unmapped.length > 0 && <p className="text-xs text-warn font-semibold">{unmapped.length} ekstre ürün adı için karşılık onayı bekleniyor (tabloda gri yazılı olanlar).</p>}
            <PriceListForm party={lab.id} initial={prices.length ? prices.map((p) => `${p.name}; ${(p.price / 100).toLocaleString("tr-TR", { maximumFractionDigits: 2 }).replace(/\./g, "")}`).join("\n") : DEFAULT_PRICE_LIST} saved={prices.length > 0} />
          </section>
        </div>

        <section className="rounded-[16px] border border-line bg-white p-4 overflow-x-auto">
          <h2 className="font-display text-lg font-bold mb-2">Alınan ekstreler</h2>
          <table className="w-full text-sm"><tbody>
            {d.statements.filter((x) => x.party_id === lab.id).map((x) => <tr key={x.id}><td className={td}>{day(x.doc_date ?? x.created_at)}</td><td className={td}>{x.file_name}</td><td className={td}>{x.mail_ref ? "e-posta" : "yükleme"}</td><td className={`${td} text-right num`}>{x.lines} satır</td><td className={`${td} text-right num font-semibold`}>{x.total != null ? tl(x.total) : ""}</td></tr>)}
          </tbody></table>
        </section>
      </div>
    </>
  );
}
