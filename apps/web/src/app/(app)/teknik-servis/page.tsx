import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice, page } from "@/components/erp";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { SVC_STATUS, svcNo } from "@/lib/service";
import { startTicket } from "@/lib/service-actions";
import { TICKET_COLS, TicketList, type TicketRow } from "../servis/TicketList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Teknik servis" };

type Asset = { id: string; code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null; location: string | null; status: string; next_maintenance: string | null; warranty_until: string | null; maintenance_interval_months: number | null };
const AST: Record<string, [string, string]> = { AVAILABLE: ["Boşta", "bg-ok-bg text-ok"], ASSIGNED: ["Zimmetli", "bg-[#EAF2FB] text-brand-700"], MAINTENANCE: ["Bakımda", "bg-warn-bg text-warn"], LOST: ["Kayıp", "bg-bad-bg text-bad"], RETIRED: ["Hurda", "bg-[#EEF2F6] text-[#33414F]"] };
const CAT: Record<string, string> = { BILGISAYAR: "Bilgisayar", TELEFON: "Telefon", EL_ALETI: "El aleti", MAKINE: "Makine / cihaz", ANAHTAR_KART: "Anahtar / kart", ARAC: "Araç", KIYAFET_KKD: "Kıyafet / KKD", MOBILYA: "Mobilya", DIGER: "Diğer" };

/** Teknik servis ekranı: bana atanan işler, tüm açık işler, tüm demirbaşlar ve servis geçmişi */
export default async function TechScreen({ searchParams }: { searchParams: Promise<{ q?: string; st?: string; d?: string }> }) {
  const ses = await getSession();
  const sp = await searchParams;
  const supabase = await createClient();
  const { data: isTech, error: e0 } = await supabase.rpc("svc_is_tech");
  const buyer = (ses.modules.purchases ?? 0) >= 2 || (ses.modules.assets ?? 0) >= 1;
  if (!isTech && !buyer && !e0) redirect("/servis");
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
  const in7 = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const [{ data: rows }, { data: assets }, { data: dir }] = await Promise.all([
    supabase.from("svc_tickets").select(TICKET_COLS).in("status", ["reported", "approved", "in_progress", "done"]).order("created_at", { ascending: false }).limit(300),
    supabase.from("assets").select("id, code, name, category, brand_model, serial_no, location, status, next_maintenance, warranty_until, maintenance_interval_months").order("name").limit(3000),
    supabase.rpc("company_directory"),
  ]);
  const names = new Map(((dir ?? []) as { user_id: string; display_name: string }[]).map((d) => [d.user_id, d.display_name]));
  const all = (rows ?? []) as unknown as TicketRow[];
  const mine = all.filter((t) => t.technician_user === ses.userId && ["approved", "in_progress"].includes(t.status));
  const A = (assets ?? []) as Asset[];
  const q = (sp.q ?? "").trim().toLocaleLowerCase("tr");
  const st = sp.st ?? "";
  const list = A.filter((a) => (!st || (st === "bakim" ? a.next_maintenance && a.next_maintenance <= in7 : a.status === st)) && (!q || `${a.name} ${a.code ?? ""} ${a.serial_no ?? ""} ${a.location ?? ""} ${a.brand_model ?? ""}`.toLocaleLowerCase("tr").includes(q)));
  const dueSoon = A.filter((a) => a.next_maintenance && a.next_maintenance <= in7 && !["RETIRED", "LOST"].includes(a.status)).length;
  const sel = sp.d ? A.find((a) => a.id === sp.d) : undefined;
  const { data: hist } = sel ? await supabase.from("svc_tickets").select(TICKET_COLS).eq("asset_id", sel.id).order("created_at", { ascending: false }).limit(50) : { data: [] };
  const link = (p: Record<string, string | undefined>) => `/teknik-servis?${new URLSearchParams(Object.entries({ q: sp.q, st: sp.st, d: sp.d, ...p }).filter(([, v]) => v) as [string, string][])}`;

  return (
    <>
      <PageHeader title="Teknik servis" subtitle="Atanan işler · tüm açık işler · tüm demirbaşlar, bakım takvimi ve servis geçmişi"
        actions={<Link href="/servis" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white font-semibold text-brand-700">Arıza / servis kayıtları</Link>} />
      <div className={page}>
        {e0 && <Notice tone="bad">Supabase&apos;de 20270106000000_service.sql çalıştırılmalı.</Notice>}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KPI label="Bana atanan" value={mine.length} tone={mine.length ? "bad" : undefined} />
          <KPI label="Tüm açık işler" value={all.filter((t) => ["approved", "in_progress"].includes(t.status)).length} />
          <KPI label="Onay bekleyen bildirim" value={all.filter((t) => t.status === "reported").length} />
          <KPI label="7 gün içinde bakım" value={dueSoon} href={link({ st: "bakim", d: undefined })} />
        </div>

        <section className="flex flex-col gap-2">
          <h2 className="font-display text-lg font-bold">Bana atanan işler</h2>
          {mine.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-[14px] border-2 border-brand-600/30 bg-white p-4">
              <Link href={`/servis/${t.id}`} className="flex-1 min-w-[220px]"><b className="num">{svcNo(t)}</b> · <b>{t.title}</b><span className="block text-xs text-muted">{[t.assets?.name, t.location, t.due_date ? `hedef ${formatDate(t.due_date)}` : null].filter(Boolean).join(" · ")}</span></Link>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${(SVC_STATUS[t.status] ?? SVC_STATUS.approved!)[1]}`}>{(SVC_STATUS[t.status] ?? SVC_STATUS.approved!)[0]}</span>
              {t.status === "approved" && <form action={startTicket}><input type="hidden" name="id" value={t.id} /><button className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">▶ Başla</button></form>}
              <Link href={`/servis/${t.id}`} className="h-10 px-4 inline-flex items-center rounded-[10px] border border-line text-sm font-semibold">Tamamla / foto →</Link>
            </div>
          ))}
          {!mine.length && <p className="rounded-[14px] border border-dashed border-[#C5D0DB] p-5 text-center text-sm text-muted">Size atanmış açık iş yok.</p>}
        </section>

        <details className="flex flex-col gap-2">
          <summary className="cursor-pointer font-display text-lg font-bold">Tüm açık işler ({all.length})</summary>
          <div className="mt-2"><TicketList rows={all} names={names} /></div>
        </details>

        <section className="grid gap-4 lg:grid-cols-[1fr_420px]">
          <div className="flex flex-col gap-3">
            <h2 className="font-display text-lg font-bold">Demirbaşlar <span className="text-sm font-normal text-muted">· {list.length} / {A.length}</span></h2>
            <form className="flex flex-wrap gap-2">
              <input name="q" defaultValue={sp.q ?? ""} placeholder="Ad, kod, seri no, yer, marka…" className="h-11 flex-1 min-w-[200px] rounded-[10px] border border-[#D5DEE8] px-3 text-sm" />
              {st && <input type="hidden" name="st" value={st} />}
              <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ara</button>
            </form>
            <nav className="flex flex-wrap gap-1.5 text-xs">
              {[["", "Tümü"], ["AVAILABLE", "Boşta"], ["ASSIGNED", "Zimmetli"], ["MAINTENANCE", "Bakımda"], ["bakim", "Bakımı yaklaşan"], ["RETIRED", "Hurda"]].map(([k, l]) => (
                <Link key={k} href={link({ st: k || undefined, d: undefined })} className={`rounded-md px-2.5 py-1 font-semibold ${st === k ? "bg-ink text-white" : "bg-[#EEF2F6] text-ink"}`}>{l}</Link>
              ))}
            </nav>
            <ul className="flex flex-col divide-y divide-[#EEF2F6] overflow-hidden rounded-[14px] border border-line bg-white">
              {list.slice(0, 300).map((a) => {
                const [al, acls] = AST[a.status] ?? AST.AVAILABLE!;
                const due = a.next_maintenance && a.next_maintenance <= in7;
                return (
                  <li key={a.id}>
                    <Link href={link({ d: a.id })} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm hover:bg-[#F7F9FC] ${sel?.id === a.id ? "bg-[#EAF2FB]" : ""}`}>
                      <span className="flex-1 min-w-[180px]"><b>{a.name}</b><span className="block text-xs text-muted">{[a.code, CAT[a.category], a.brand_model, a.location].filter(Boolean).join(" · ")}</span></span>
                      {a.next_maintenance && <span className={`text-xs ${due ? (a.next_maintenance < today ? "text-bad font-semibold" : "text-warn font-semibold") : "text-muted"}`}>bakım {formatDate(a.next_maintenance)}</span>}
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${acls}`}>{al}</span>
                    </Link>
                  </li>
                );
              })}
              {!list.length && <li className="p-5 text-center text-sm text-muted">Demirbaş bulunamadı.</li>}
            </ul>
            {list.length > 300 && <p className="text-xs text-muted">İlk 300 gösteriliyor; aramayı daraltın.</p>}
          </div>
          <aside className="lg:sticky lg:top-4 self-start">
            {sel ? (
              <div className="flex flex-col gap-3 rounded-[16px] border border-line bg-white p-4">
                <div className="flex items-start gap-2"><h3 className="flex-1 font-display text-lg font-bold">{sel.name}</h3><Link href={link({ d: undefined })} className="text-muted" aria-label="Kapat">✕</Link></div>
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  {[["Kod", sel.code], ["Kategori", CAT[sel.category]], ["Marka / model", sel.brand_model], ["Seri no", sel.serial_no], ["Yer", sel.location], ["Durum", (AST[sel.status] ?? AST.AVAILABLE!)[0]],
                    ["Sonraki bakım", sel.next_maintenance ? formatDate(sel.next_maintenance) : null], ["Bakım aralığı", sel.maintenance_interval_months ? `${sel.maintenance_interval_months} ayda bir` : null], ["Garanti", sel.warranty_until ? formatDate(sel.warranty_until) : null]]
                    .filter(([, v]) => v).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
                </dl>
                <Link href={`/servis?demirbas=${sel.id}`} className="h-11 inline-flex items-center justify-center rounded-[10px] bg-brand-700 font-semibold text-white">+ Bu demirbaş için servis kaydı</Link>
                <h4 className="font-semibold">Servis geçmişi</h4>
                <ul className="flex flex-col gap-1.5 text-sm">
                  {((hist ?? []) as unknown as TicketRow[]).map((t) => (
                    <li key={t.id}><Link href={`/servis/${t.id}`} className="flex gap-2 hover:underline"><span className="num text-xs text-muted w-20">{formatDate(t.created_at.slice(0, 10))}</span><span className="flex-1">{t.title}</span><span className="text-xs">{(SVC_STATUS[t.status] ?? SVC_STATUS.reported!)[0]}</span></Link></li>
                  ))}
                  {!(hist ?? []).length && <li className="text-muted">Kayıt yok.</li>}
                </ul>
              </div>
            ) : <p className="rounded-[16px] border border-dashed border-[#C5D0DB] p-6 text-center text-sm text-muted">Ayrıntı ve servis geçmişi için bir demirbaş seçin.</p>}
          </aside>
        </section>
      </div>
    </>
  );
}
