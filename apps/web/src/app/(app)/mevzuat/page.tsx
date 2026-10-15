import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { AREAS, MEVZUAT, areaOf, severityOf, systemValue, type Area, type Bulletin } from "@/lib/mevzuat";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, todayIso } from "@/lib/session";
import { markReg } from "./actions";

const TABS = [["bulten", "Gelişmeler"], ["yapilacak", "Yapılacaklar"], ["degerler", "Güncel değerler"], ["takvim", "Yasal takvim"]] as const;
const STATUS: Record<string, [string, string]> = { uygulandi: ["Sisteme uygulandı", "bg-[#E6F4EC] text-[#1A7F52]"], bilgi: ["Bilgi", "bg-[#EEF3F9] text-brand-700"], "onay-bekliyor": ["Onayınızı bekliyor", "bg-[#FFF4E0] text-[#7A4F00]"] };
const SEV: Record<string, [string, string]> = { kritik: ["Önemli", "bg-[#FDECEC] text-bad"], aksiyon: ["Yapılacak var", "bg-[#FFF4E0] text-[#7A4F00]"], bilgi: ["", ""] };
const fmt = (v: number, unit: string) => (unit === "TL" ? `${v.toLocaleString("tr-TR", { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })} TL` : `${v.toLocaleString("tr-TR")} ${unit}`);
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } };
const chip = (on: boolean) => `rounded-full px-3 py-1 border ${on ? "bg-[#EEF3F9] border-brand-600 font-semibold" : "border-line bg-white"}`;

type Read = { item_id: string; read_at: string | null; done_at: string | null };

/** Mevzuat ve gelişmeler: genel muhasebe, vergi, SGK, iş hukuku, ihracat; okundu / yapıldı takibi, güncel değerler, yasal takvim */
export default async function MevzuatPage({ searchParams }: { searchParams: Promise<{ sekme?: string; alan?: string; kategori?: string; okunmamis?: string; id?: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role) && (s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const tab = (TABS.find(([k]) => k === sp.sekme)?.[0] ?? "bulten") as (typeof TABS)[number][0];
  const today = todayIso();
  const supabase = await createClient();
  // bildirimden gelindiyse okundu say
  if (sp.id && /^[a-z0-9-]{1,120}$/i.test(sp.id)) await supabase.rpc("reg_mark", { p_action: "read", p_items: [sp.id] });
  const { data: rd, error: rdErr } = await supabase.from("reg_reads").select("item_id, read_at, done_at");
  const reads = new Map(((rd ?? []) as Read[]).map((r) => [r.item_id, r]));
  const tracking = !rdErr;
  const area = (Object.keys(AREAS) as Area[]).includes(sp.alan as Area) ? (sp.alan as Area) : null;
  const all = [...MEVZUAT.bulletin].sort((a, b) => b.date.localeCompare(a.date));
  const unread = (b: Bulletin) => tracking && !reads.get(b.id)?.read_at;
  const todo = all.filter((b) => severityOf(b) !== "bilgi" && !reads.get(b.id)?.done_at && (!b.due || b.due >= addDays(today, -60)));
  const list = all.filter((b) => (!area || areaOf(b) === area) && (!sp.kategori || b.category === sp.kategori) && (!sp.okunmamis || unread(b)));
  const unreadCount = all.filter(unread).length;
  const cats = [...new Set(all.filter((b) => !area || areaOf(b) === area).map((b) => b.category))];
  const current = MEVZUAT.params.filter((p) => p.valid_from <= today && (!p.valid_to || p.valid_to >= today));
  const mismatch = current.filter((p) => { const v = systemValue(p.key, today); return v !== null && Math.abs(v - p.value) > 0.005; });
  const nextYear = Number(today.slice(0, 4)) + 1;
  const missingNext = today.slice(5) >= "12-01" && !MEVZUAT.params.some((p) => p.key === "minWageGross" && p.valid_from.startsWith(String(nextYear)));
  const pending = all.filter((b) => b.status === "onay-bekliyor");
  const q = (p: Record<string, string | null | undefined>) => {
    const u = new URLSearchParams();
    const base = { sekme: tab === "bulten" ? null : tab, alan: area, kategori: sp.kategori, okunmamis: sp.okunmamis, ...p };
    for (const [k, v] of Object.entries(base)) if (v) u.set(k, v);
    return `/mevzuat${u.size ? `?${u}` : ""}`;
  };

  const Item = ({ b }: { b: Bulletin }) => {
    const [l, cls] = STATUS[b.status] ?? STATUS.bilgi!;
    const sev = severityOf(b);
    const r = reads.get(b.id);
    const isNew = unread(b);
    const doneAt = r?.done_at;
    return (
      <li id={b.id} className={`bg-white border rounded-[14px] p-4 flex flex-col gap-2 scroll-mt-24 ${sp.id === b.id ? "border-brand-600 ring-2 ring-brand-600/20" : isNew ? "border-brand-600/50" : "border-line"}`}>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {isNew && <span className="rounded-full bg-brand-700 text-white px-2 py-0.5 font-semibold">Yeni</span>}
          <span className="font-semibold text-brand-700">{formatDate(b.date)}</span>
          <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5">{AREAS[areaOf(b)]} · {b.category}</span>
          <span className={`rounded-full px-2 py-0.5 font-semibold ${cls}`}>{l}</span>
          {sev !== "bilgi" && <span className={`rounded-full px-2 py-0.5 font-semibold ${SEV[sev]![1]}`}>{SEV[sev]![0]}{b.due ? ` · son gün ${formatDate(b.due)}` : ""}</span>}
          {doneAt && <span className="rounded-full bg-[#E6F4EC] text-[#1A7F52] px-2 py-0.5 font-semibold">Yapıldı</span>}
        </div>
        <h2 className="font-display font-semibold text-brand-800">{b.title}</h2>
        <p className="text-sm leading-relaxed">{b.summary}</p>
        <p className="text-sm rounded-lg bg-[#F5F7FA] p-2"><b>Sisteme etkisi:</b> {b.impact}</p>
        {b.action && <p className="text-sm rounded-lg bg-[#FFF8EB] p-2"><b>Yapılacak:</b> {b.action}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <a href={b.source} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">Kaynak: {host(b.source)} ↗</a>
          {b.pr && <a href={b.pr} target="_blank" rel="noopener" className="text-xs font-semibold text-brand-700">Değişikliği incele ↗</a>}
          {tracking && (
            <div className="ml-auto flex gap-2">
              {isNew && <form action={markReg}><input type="hidden" name="action" value="read" /><input type="hidden" name="ids" value={b.id} /><PendingSubmit className="text-xs font-semibold text-brand-700">Okundu</PendingSubmit></form>}
              {sev !== "bilgi" && <form action={markReg}><input type="hidden" name="action" value={doneAt ? "undone" : "done"} /><input type="hidden" name="ids" value={b.id} /><PendingSubmit className="text-xs font-semibold text-brand-700">{doneAt ? "Yapılmadı" : "Yapıldı olarak işaretle"}</PendingSubmit></form>}
            </div>
          )}
        </div>
      </li>
    );
  };

  return (
    <>
      <PageHeader title="Mevzuat ve gelişmeler" subtitle={`Genel muhasebe, vergi, SGK, iş hukuku ve ihracat · son kontrol ${formatDate(MEVZUAT.last_checked)} · haftada iki kez resmî kaynaklardan kontrol edilir`}
        actions={["owner", "accountant"].includes(s.role) ? <Link href="/mevzuat/ayarlar" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Bordro yorum ayarları</Link> : undefined} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[1100px]">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Link href={q({ sekme: null, okunmamis: "1" })} className="bg-white border border-line rounded-[14px] p-4"><div className="text-xs text-muted">Okunmamış</div><div className={`text-2xl font-bold ${unreadCount ? "text-brand-700" : ""}`}>{tracking ? unreadCount : "—"}</div></Link>
          <Link href={q({ sekme: "yapilacak" })} className="bg-white border border-line rounded-[14px] p-4"><div className="text-xs text-muted">Yapılacak</div><div className={`text-2xl font-bold ${todo.length ? "text-[#B45309]" : ""}`}>{todo.length}</div></Link>
          <Link href={q({ sekme: null, alan: "muhasebe", okunmamis: null })} className="bg-white border border-line rounded-[14px] p-4"><div className="text-xs text-muted">Muhasebe ve vergi</div><div className="text-2xl font-bold">{all.filter((b) => areaOf(b) === "muhasebe").length}</div></Link>
          <Link href={q({ sekme: null, alan: "sgk", okunmamis: null })} className="bg-white border border-line rounded-[14px] p-4"><div className="text-xs text-muted">SGK ve iş hukuku</div><div className="text-2xl font-bold">{all.filter((b) => areaOf(b) === "sgk").length}</div></Link>
        </div>
        {!tracking && <div className="rounded-[14px] border border-line bg-white p-3 text-sm">Okundu / yapıldı takibi ve bildirimler için Supabase&apos;de <b>20270215000000_reg_center.sql</b> çalıştırılmalı.</div>}
        {(pending.length > 0 || mismatch.length > 0 || missingNext) && (
          <div className="rounded-[14px] border border-[#F2C94C] bg-[#FFF4E0] p-4 text-sm flex flex-col gap-1.5">
            {pending.map((b) => <div key={b.id}><b>Onay bekleyen değişiklik:</b> {b.title}{b.pr ? <> · <a href={b.pr} target="_blank" rel="noopener" className="font-semibold text-brand-700">değişikliği incele ↗</a></> : null}</div>)}
            {mismatch.map((p) => <div key={p.key}><b>{p.label}</b> güncel değeri {fmt(p.value, p.unit)}, bordro motorunda {fmt(systemValue(p.key, today)!, p.unit)} kullanılıyor — güncelleme onayınızı bekliyor.</div>)}
            {missingNext && <div><b>{nextYear} asgari ücreti</b> henüz açıklanmadı / sisteme girilmedi. Açıklanınca kontrol değerleri ekleyip onayınıza sunar.</div>}
          </div>
        )}
        <nav className="flex flex-wrap gap-1.5" aria-label="Mevzuat bölümleri">
          {TABS.map(([k, l]) => <Link key={k} href={`/mevzuat${k === "bulten" ? "" : `?sekme=${k}`}`} aria-current={tab === k ? "page" : undefined} className={`h-10 px-4 rounded-full text-sm font-semibold grid place-items-center ${tab === k ? "bg-brand-800 text-white" : "bg-white border border-[#D5DEE8] text-brand-700"}`}>{l}{k === "yapilacak" && todo.length ? ` (${todo.length})` : ""}</Link>)}
        </nav>

        {tab === "bulten" && (
          <>
            <div className="flex flex-wrap gap-1.5 text-xs">
              <Link href={q({ alan: null, kategori: null })} className={chip(!area)}>Tüm alanlar</Link>
              {(Object.entries(AREAS) as Array<[Area, string]>).map(([k, l]) => <Link key={k} href={q({ alan: k, kategori: null })} className={chip(area === k)}>{l}</Link>)}
              <span className="mx-1 text-muted">|</span>
              <Link href={q({ okunmamis: sp.okunmamis ? null : "1" })} className={chip(!!sp.okunmamis)}>Yalnız okunmamış</Link>
            </div>
            {cats.length > 1 && (
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Link href={q({ kategori: null })} className={chip(!sp.kategori)}>Tüm konular</Link>
                {cats.map((c) => <Link key={c} href={q({ kategori: c })} className={chip(sp.kategori === c)}>{c}</Link>)}
              </div>
            )}
            {tracking && list.some(unread) && (
              <form action={markReg} className="self-end"><input type="hidden" name="action" value="read" /><input type="hidden" name="ids" value={list.filter(unread).map((b) => b.id).join(",")} /><PendingSubmit className="text-sm font-semibold text-brand-700">Listedekilerin hepsini okundu say</PendingSubmit></form>
            )}
            <ol className="flex flex-col gap-3">{list.map((b) => <Item key={b.id} b={b} />)}</ol>
            {!list.length && <p className="text-sm text-muted">Bu filtrede gelişme yok.</p>}
          </>
        )}

        {tab === "yapilacak" && (
          <>
            <p className="text-sm text-muted">Sizden işlem bekleyen gelişmeler, son güne göre. &quot;Yapıldı&quot; dediğinizde listeden çıkar; son güne 7 gün kala yapılmamışsa bildirim gelir.</p>
            <ol className="flex flex-col gap-3">{[...todo].sort((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999")).map((b) => <Item key={b.id} b={b} />)}</ol>
            {!todo.length && <p className="text-sm text-muted">Bekleyen iş yok.</p>}
            <Link href="/muhasebe/vergi-takvimi" className="text-sm font-semibold text-brand-700">Beyanname son günleri: Vergi takvimi →</Link>
          </>
        )}

        {tab === "degerler" && (
          <Card title={`${today.slice(0, 4)} yılında geçerli yasal değerler`}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2 px-2">Değer</th><th className="py-2 px-2 text-right">Tutar</th><th className="py-2 px-2">Geçerlilik</th><th className="py-2 px-2">Sistemde</th><th className="py-2 px-2">Kaynak</th></tr></thead>
                <tbody>{[...MEVZUAT.params].sort((a, b) => a.label.localeCompare(b.label, "tr")).map((p) => {
                  const sv = systemValue(p.key, today);
                  const active = p.valid_from <= today && (!p.valid_to || p.valid_to >= today);
                  const bad = active && sv !== null && Math.abs(sv - p.value) > 0.005;
                  return (
                    <tr key={`${p.key}@${p.valid_from}`} className={`border-t border-[#EEF2F6] ${active ? "" : "text-muted"}`}>
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
            <p className="text-xs text-muted">Bordro hesabını etkileyen değerler (asgari ücret, SGK sınırları, vergi dilimleri) sizin onayınızla devreye girer; o zamana kadar bu tabloda &quot;güncellenmedi&quot; olarak görünür. Vergi oranları (kurumlar %25, damga, KDV) ilgili muhasebe ekranlarında kullanılır.</p>
          </Card>
        )}

        {tab === "takvim" && (
          <Card title="Yasal takvim">
            <ul className="divide-y divide-[#EEF2F6] text-sm">{MEVZUAT.calendar.map((c, i) => <li key={i} className="py-2 grid grid-cols-[170px_1fr] gap-3"><b className="text-brand-800">{c.when}</b><span>{c.what}</span></li>)}</ul>
            <Link href="/muhasebe/vergi-takvimi" className="text-sm font-semibold text-brand-700">Tarihli vergi takvimi ve beyanname durumları →</Link>
          </Card>
        )}
        <p className="text-xs text-muted">Bülten bilgilendirme amaçlıdır; uygulamadan önce mali müşavirinizle teyit edin.</p>
      </div>
    </>
  );
}

function addDays(d: string, n: number) {
  return new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
}
