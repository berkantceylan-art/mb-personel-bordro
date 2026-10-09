import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { MEVZUAT, systemValue } from "@/lib/mevzuat";
import { formatDate, getSession, todayIso } from "@/lib/session";

const TABS = [["bulten", "Mevzuat bülteni"], ["degerler", "Güncel değerler"], ["takvim", "Yasal takvim"]] as const;
const STATUS: Record<string, [string, string]> = { uygulandi: ["Sisteme uygulandı", "bg-[#E6F4EC] text-[#1A7F52]"], bilgi: ["Bilgi", "bg-[#EEF3F9] text-brand-700"], "onay-bekliyor": ["Onayınızı bekliyor", "bg-[#FFF4E0] text-[#7A4F00]"] };
const fmt = (v: number, unit: string) => (unit === "TL" ? `${v.toLocaleString("tr-TR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} TL` : `${v.toLocaleString("tr-TR")} ${unit}`);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };

/** Mevzuat: haftalık kontrol edilen bülten, sistemde kullanılan yasal değerler ve yasal takvim */
export default async function MevzuatPage({ searchParams }: { searchParams: Promise<{ sekme?: string; kategori?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.sekme)?.[0] ?? "bulten") as (typeof TABS)[number][0];
  const today = todayIso();
  const pending = MEVZUAT.bulletin.filter((b) => b.status === "onay-bekliyor");
  const cats = [...new Set(MEVZUAT.bulletin.map((b) => b.category))];
  const list = MEVZUAT.bulletin.filter((b) => !sp.kategori || b.category === sp.kategori).sort((a, b) => b.date.localeCompare(a.date));
  const current = MEVZUAT.params.filter((p) => p.valid_from <= today && (!p.valid_to || p.valid_to >= today));
  const mismatch = current.filter((p) => { const v = systemValue(p.key, today); return v !== null && Math.abs(v - p.value) > 0.005; });
  const nextYear = Number(today.slice(0, 4)) + 1;
  const missingNext = today.slice(5) >= "12-01" && !MEVZUAT.params.some((p) => p.key === "minWageGross" && p.valid_from.startsWith(String(nextYear)));
  return (
    <>
      <PageHeader title="Mevzuat" subtitle={`Son kontrol ${formatDate(MEVZUAT.last_checked)} · her hafta resmî kaynaklardan otomatik kontrol edilir`} actions={["owner", "accountant"].includes(s.role) ? <Link href="/mevzuat/ayarlar" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Bordro yorum ayarları</Link> : undefined} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        {(pending.length > 0 || mismatch.length > 0 || missingNext) && (
          <div className="rounded-[14px] border border-[#F2C94C] bg-[#FFF4E0] p-4 text-sm flex flex-col gap-1.5">
            {pending.map((b) => <div key={b.id}><b>Onay bekleyen değişiklik:</b> {b.title}{b.pr ? <> · <a href={b.pr} target="_blank" rel="noopener" className="font-semibold text-brand-700">değişikliği incele ↗</a></> : null}</div>)}
            {mismatch.map((p) => <div key={p.key}><b>{p.label}</b> güncel değeri {fmt(p.value, p.unit)}, bordro motorunda {fmt(systemValue(p.key, today)!, p.unit)} kullanılıyor — güncelleme onayınızı bekliyor.</div>)}
            {missingNext && <div><b>{nextYear} asgari ücreti</b> henüz açıklanmadı / sisteme girilmedi. Açıklanınca haftalık kontrol değerleri ekleyip onayınıza sunar.</div>}
          </div>
        )}
        <nav className="flex flex-wrap gap-1.5" aria-label="Mevzuat bölümleri">
          {TABS.map(([k, l]) => <Link key={k} href={`/mevzuat?sekme=${k}`} aria-current={tab === k ? "page" : undefined} className={`h-10 px-4 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}</Link>)}
        </nav>

        {tab === "bulten" && (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Link href="/mevzuat" className={`rounded-full px-3 py-1 border ${!sp.kategori ? "bg-[#EEF3F9] border-brand-600 font-semibold" : "border-line bg-white"}`}>Tümü</Link>
              {cats.map((c) => <Link key={c} href={`/mevzuat?kategori=${encodeURIComponent(c)}`} className={`rounded-full px-3 py-1 border ${sp.kategori === c ? "bg-[#EEF3F9] border-brand-600 font-semibold" : "border-line bg-white"}`}>{c}</Link>)}
            </div>
            <ol className="flex flex-col gap-3">
              {list.map((b) => {
                const [l, cls] = STATUS[b.status] ?? STATUS.bilgi!;
                return (
                  <li key={b.id} className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs"><span className="font-semibold text-brand-700">{formatDate(b.date)}</span><span className="rounded-full bg-[#F2F4F7] px-2 py-0.5">{b.category}</span><span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{l}</span></div>
                    <h2 className="font-display font-semibold text-brand-800">{b.title}</h2>
                    <p className="text-sm leading-relaxed">{b.summary}</p>
                    <p className="text-sm rounded-lg bg-[#F5F7FA] p-2"><b>Sisteme etkisi:</b> {b.impact}</p>
                    <a href={b.source} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700 self-start">Kaynak: {host(b.source)} ↗</a>
                  </li>
                );
              })}
            </ol>
          </>
        )}

        {tab === "degerler" && (
          <Card title={`${today.slice(0, 4)} yılında geçerli yasal değerler`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Değer</th><th className="py-2 px-2 text-right">Tutar</th><th className="py-2 px-2">Geçerlilik</th><th className="py-2 px-2">Sistemde</th><th className="py-2 px-2">Kaynak</th></tr></thead>
                <tbody>{MEVZUAT.params.sort((a, b) => a.label.localeCompare(b.label, "tr")).map((p) => {
                  const sv = systemValue(p.key, today);
                  const active = p.valid_from <= today && (!p.valid_to || p.valid_to >= today);
                  const bad = active && sv !== null && Math.abs(sv - p.value) > 0.005;
                  return (
                    <tr key={p.key} className={`border-t border-[#EEF2F6] ${active ? "" : "text-muted"}`}>
                      <td className="py-2 px-2 font-medium">{p.label}</td>
                      <td className="py-2 px-2 text-right num">{fmt(p.value, p.unit)}</td>
                      <td className="py-2 px-2 whitespace-nowrap">{formatDate(p.valid_from)} – {p.valid_to ? formatDate(p.valid_to) : "…"}</td>
                      <td className="py-2 px-2">{bad ? <span className="text-bad font-semibold">güncellenmedi ({fmt(sv!, p.unit)})</span> : p.system ? <span className="text-ok">✓ kullanılıyor</span> : <span className="text-muted">bilgi</span>}</td>
                      <td className="py-2 px-2 text-xs">{p.source.startsWith("http") ? <a href={p.source} target="_blank" rel="noopener" className="text-brand-700">{host(p.source)} ↗</a> : p.source}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
            <p className="text-xs text-muted">Haftalık kontrol yeni bir değer bulduğunda buraya ekler. Bordro hesabını etkileyen değerler (asgari ücret, SGK sınırları, vergi dilimleri) sizin onayınızla devreye girer; o zamana kadar bu tabloda &quot;güncellenmedi&quot; olarak görünür.</p>
          </Card>
        )}

        {tab === "takvim" && (
          <Card title="Yasal takvim">
            <ul className="divide-y divide-[#EEF2F6] text-sm">{MEVZUAT.calendar.map((c, i) => <li key={i} className="py-2 grid grid-cols-[170px_1fr] gap-3"><b className="text-brand-800">{c.when}</b><span>{c.what}</span></li>)}</ul>
          </Card>
        )}
        <p className="text-xs text-muted">Bülten bilgilendirme amaçlıdır; uygulamadan önce mali müşavirinizle teyit edin.</p>
      </div>
    </>
  );
}
