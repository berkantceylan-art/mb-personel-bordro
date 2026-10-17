import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, currentPeriod, getSession, periodLabel, todayIso } from "@/lib/session";
import { bulkPiece, deleteEntry, saveEntry } from "@/lib/piecework-actions";
import { groupBy, loadPieceEntries, nextMonth, pcErr, prevMonth, type PcRate, type PcWorker } from "@/lib/piecework";
import { EntryForm } from "./EntryForm";
import { EntryList } from "./EntryList";

export const dynamic = "force-dynamic";
export const metadata = { title: "Parça başı" };

const tl = (k: number) => (k / 100).toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " ₺";

/** Parça başı: iş girişi, onay, maaşa / gidere aktarım */
export default async function PieceworkPage({ searchParams }: { searchParams: Promise<{ ay?: string }> }) {
  const sp = await searchParams;
  const s = await getSession();
  const mod = (k: string) => s.modules[k] ?? 0;
  const mgr = ["owner", "hr", "accountant", "branch_manager"].includes(s.role);
  const canView = mgr || mod("production") >= 1 || mod("payroll") >= 1 || mod("finance") >= 1;
  if (!canView) redirect("/");
  const canEnter = mgr || mod("production") >= 2;
  const canApprove = ["owner", "hr", "accountant"].includes(s.role) || mod("production") >= 3 || mod("payroll") >= 2;
  const canPost = canManagePay(s.role);
  const period = /^\d{4}-\d{2}$/.test(sp.ay ?? "") ? sp.ay! : currentPeriod();
  const sb = await createClient();
  const [{ rows, error }, { data: workers }, { data: rates }, { data: prods }] = await Promise.all([
    loadPieceEntries(sb, period, period),
    sb.from("pc_workers").select("id, name, kind, is_active").order("name"),
    sb.from("pc_rates").select("lab_product_id, work_name, unit, price, worker_id").eq("is_active", true),
    sb.from("lab_products").select("id, name").eq("is_active", true).order("sort").order("name"),
  ]);
  const ws = ((workers ?? []) as Pick<PcWorker, "id" | "name" | "kind" | "is_active">[]);
  const live = rows.filter((r) => r.status !== "rejected");
  const sum = (f: (r: (typeof rows)[number]) => boolean) => live.filter(f).reduce((t, r) => t + r.amount, 0);
  const total = sum(() => true);
  const internal = sum((r) => r.kind === "internal");
  const external = sum((r) => r.kind === "external");
  const pending = live.filter((r) => r.status === "pending");
  const toPost = live.filter((r) => r.status === "approved");
  const units = live.reduce((t, r) => t + r.qty, 0);
  const byWorker = groupBy(live, (r) => r.worker, (r) => r.qty, (r) => r.amount).slice(0, 8);
  const max = byWorker[0]?.[1].amount ?? 1;
  const kinds = new Map(rows.map((r) => [r.worker, r.kind]));
  const err = pcErr(error);

  return (
    <>
      <PageHeader
        title="Parça başı"
        subtitle="Yoğunlukta personele ya da dışarıdan ustaya parça başı ödenen işler: giriş → onay → maaşa / gidere aktarım. Ürün maliyetine otomatik yansır."
        actions={
          <span className="flex gap-4 text-sm font-semibold">
            <Link href={`/uretim/parca-basi/rapor?bas=${period}&bit=${period}`} className="text-brand-700">📊 Rapor</Link>
            <Link href="/uretim/parca-basi/tanimlar" className="text-brand-700">Ustalar ve fiyat listesi</Link>
          </span>
        }
      />
      <div className="p-4 md:p-6 flex flex-col gap-5 max-w-[1400px]">
        {err && <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{err}</p>}

        <div className="flex items-center gap-3">
          <Link href={`?ay=${prevMonth(period)}`} className="h-10 w-10 grid place-items-center rounded-full border border-[#D5DEE8] bg-white text-brand-700 font-bold" aria-label="Önceki ay">‹</Link>
          <h2 className="font-display text-xl font-bold text-brand-800 min-w-40 text-center">{periodLabel(period)}</h2>
          <Link href={`?ay=${nextMonth(period)}`} className="h-10 w-10 grid place-items-center rounded-full border border-[#D5DEE8] bg-white text-brand-700 font-bold" aria-label="Sonraki ay">›</Link>
        </div>

        {/* Özet */}
        <section className="grid gap-3 grid-cols-2 lg:grid-cols-5">
          <div className="col-span-2 lg:col-span-1 rounded-[16px] p-4 bg-gradient-to-br from-[#0A3D73] to-[#1565A8] text-white flex flex-col gap-1">
            <span className="text-xs opacity-80">Bu ay parça başı gider</span>
            <span className="num font-display text-[28px] font-bold leading-tight">{tl(total)}</span>
            <span className="text-xs opacity-80"><span className="num">{units.toLocaleString("tr-TR")}</span> adet / üye · {live.length} kayıt</span>
          </div>
          <div className="rounded-[16px] p-4 bg-white border border-line flex flex-col gap-1">
            <span className="text-xs text-muted">Kendi personelimiz</span>
            <span className="num font-display text-xl font-bold text-brand-800">{tl(internal)}</span>
            <span className="text-xs text-muted">maaşa ek ödeme</span>
          </div>
          <div className="rounded-[16px] p-4 bg-white border border-line flex flex-col gap-1">
            <span className="text-xs text-muted">Dışarıdan usta</span>
            <span className="num font-display text-xl font-bold text-[#5B3A9A]">{tl(external)}</span>
            <span className="text-xs text-muted">gider + cari borç</span>
          </div>
          <div className="rounded-[16px] p-4 bg-warn-bg flex flex-col gap-1">
            <span className="text-xs text-warn">Onay bekleyen</span>
            <span className="num font-display text-xl font-bold text-warn">{tl(pending.reduce((t, r) => t + r.amount, 0))}</span>
            <span className="text-xs text-warn">{pending.length} kayıt</span>
          </div>
          <div className="rounded-[16px] p-4 bg-[#E7F1FB] flex flex-col gap-1">
            <span className="text-xs text-brand-700">Aktarılmayı bekleyen</span>
            <span className="num font-display text-xl font-bold text-brand-700">{tl(toPost.reduce((t, r) => t + r.amount, 0))}</span>
            <span className="text-xs text-brand-700">{toPost.length} onaylı kayıt</span>
          </div>
        </section>

        <div className="flex flex-wrap gap-5 items-start">
          {canEnter && (
            <section className="flex-[999_1_640px] min-w-0 bg-white border border-line rounded-[16px] p-5 flex flex-col gap-3">
              <h2 className="font-display font-semibold text-brand-800">Hızlı iş girişi</h2>
              {ws.filter((w) => w.is_active).length === 0 ? (
                <p className="text-sm text-muted">Önce <Link href="/uretim/parca-basi/tanimlar" className="text-brand-700 font-semibold">Ustalar ve fiyat listesi</Link> sayfasından parça başı çalışan personeli / dış ustayı ekleyin.</p>
              ) : (
                <EntryForm action={saveEntry} workers={ws.filter((w) => w.is_active)} products={(prods ?? []) as { id: string; name: string }[]} rates={(rates ?? []) as PcRate[]} today={todayIso()} />
              )}
            </section>
          )}
          <section className="flex-[1_1_320px] min-w-0 bg-white border border-line rounded-[16px] p-5 flex flex-col gap-3">
            <h2 className="font-display font-semibold text-brand-800">Usta bazında bu ay</h2>
            {byWorker.length === 0 && <p className="text-sm text-muted">Henüz kayıt yok.</p>}
            <ul className="flex flex-col gap-2.5">
              {byWorker.map(([name, g]) => (
                <li key={name} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[13px]"><span className="font-semibold text-ink truncate">{name}</span><span className="num text-[#33414F]">{tl(g.amount)}</span></div>
                  <div className="h-2 rounded-full bg-[#EEF2F6] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.max(3, (g.amount / max) * 100)}%`, background: kinds.get(name) === "internal" ? "#1565A8" : "#7C5CC4" }} />
                  </div>
                  <span className="text-[11px] text-muted"><span className="num">{g.qty.toLocaleString("tr-TR")}</span> adet · {g.n} kayıt</span>
                </li>
              ))}
            </ul>
            {byWorker.length > 0 && <p className="text-[11px] text-muted flex gap-3"><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#1565A8] mr-1" />Personel</span><span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#7C5CC4] mr-1" />Dış usta</span></p>}
          </section>
        </div>

        <EntryList rows={rows} bulk={bulkPiece} del={deleteEntry} canApprove={canApprove} canPost={canPost} canEnter={canEnter} />

        <p className="text-xs text-muted leading-relaxed">
          <b>Nasıl işler?</b> Girilen iş onaya düşer. Onaylanan kayıtlar <b>Aktar</b> ile: personel için o ayın maaş carisine ek ödeme (elden ya da resmi — resmi ise brüt bordroya girer),
          dış usta için <b>“Parça başı işçilik”</b> gider kaydı + usta carisine borç + ödeme merkezinde ödeme planı (stopaj varsa ayrılır) oluşturur.
          Son 90 günün parça başı tutarı ürün bazında üretilen üye sayısına bölünerek <Link href="/uretim/maliyet" className="text-brand-700 font-semibold">ürün maliyetine</Link> “parça başı işçilik payı” olarak eklenir.
        </p>
      </div>
    </>
  );
}
