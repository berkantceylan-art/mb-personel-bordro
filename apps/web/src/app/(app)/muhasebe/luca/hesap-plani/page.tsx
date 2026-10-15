import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice, btnPrimary, btnSecondary, inputCls, page, td, tdNum, th } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { glError } from "@/lib/gl";
import { lucaApplySuggestions, lucaCategorySet, lucaMapSet, lucaSetRedirect, lucaSyncToErp } from "@/lib/luca-actions";

export const dynamic = "force-dynamic";

type Opt = { code: string; name: string | null };
type Sync = { plan: number; create: number; skip: number; sample: Opt[]; synced_at: string | null; redirect: boolean };
type Redirect = { code: string; name: string; target: string | null; target_name: string | null; suggest: string | null; fallback: string | null; lines: number; maps: number; options: Opt[] };
type Cat = { id: string; code: string; name: string; kind: string; parent: string | null; account: string | null; account_name: string | null; own: boolean; leaf: boolean; suggest: string | null; options: Opt[] };

const KIND: Record<string, string> = { income: "Gelir", expense: "Gider", other: "Diğer", stock: "Stok", equity: "Özkaynak" };

function Pick({ name, options, value, suggest }: { name: string; options: Opt[]; value: string | null; suggest: string | null }) {
  return (
    <select name={name} defaultValue={value ?? suggest ?? ""} className={`${inputCls} h-9 w-80`}>
      <option value="">— Luca alt hesabı seçin —</option>
      {options.map((o) => <option key={o.code} value={o.code}>{o.code} · {o.name}{o.code === suggest ? " (öneri)" : ""}</option>)}
    </select>
  );
}

/** Luca hesap planı ERP'ye: hesapları aç, ana hesapları ve kategorileri Luca alt hesaplarına bağla */
export default async function LucaPlan({ searchParams }: { searchParams: Promise<{ hepsi?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const approver = (s.modules.ledger ?? 0) >= 3;
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: sd, error }, { data: rd }, { data: cd }] = await Promise.all([
    supabase.rpc("gl_luca_sync_preview"), supabase.rpc("gl_luca_redirects"), supabase.rpc("gl_luca_categories"),
  ]);
  const sync = sd as Sync | null;
  const reds = (rd ?? []) as Redirect[];
  const cats = (cd ?? []) as Cat[];
  const openReds = reds.filter((r) => !r.target);
  const openCats = cats.filter((c) => c.account && !c.leaf);
  const shownCats = sp.hepsi ? cats : cats.filter((c) => !c.leaf || c.own);
  const anySuggest = openReds.some((r) => r.suggest) || openCats.some((c) => c.suggest);

  return (
    <>
      <PageHeader title="Luca hesap planı ve kategoriler" subtitle="Luca'daki hesaplar ERP'de de açılır; giderler ve gelirler doğrudan Luca alt hesaplarına yazılır" actions={<Link href="/muhasebe/luca" className="text-sm font-semibold text-brand-700">Luca aktarımı</Link>} />
      <div className={page}>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270220000000_luca_plan_sync.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {sync && !sync.plan && <Notice tone="warn">Önce Luca hesap planını (mizan Excel&apos;i) yükleyin: <Link href="/muhasebe/luca/ayarlar" className="font-semibold text-brand-700">Luca aktarım ayarları</Link>.</Notice>}

        {sync && sync.plan > 0 && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="Luca hesap planı" value={String(sync.plan)} sub="hesap" />
            <KPI label="ERP'de açılacak" value={String(sync.create)} tone={sync.create ? "bad" : "ok"} sub={sync.synced_at ? `son aktarım ${formatDate(sync.synced_at.slice(0, 10))}` : "henüz aktarılmadı"} />
            <KPI label="Yönlendirmesi eksik ana hesap" value={String(openReds.length)} tone={openReds.length ? "bad" : "ok"} />
            <KPI label="Ana hesaba giden kategori" value={String(openCats.length)} tone={openCats.length ? "bad" : "ok"} />
          </div>
        )}

        {sync && sync.plan > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <h2 className="font-bold">1. Luca hesaplarını ERP&apos;de aç</h2>
            <p className="text-sm text-muted">Luca planında olup ERP&apos;de olmayan hesaplar aynı kod ve adla açılır. Mevcut hesaplar ve geçmiş fişler değişmez. Alt hesabı açılan ana hesaba (ör. 770) artık elle kayıt yapılamaz; sistem fişleri aşağıdaki yönlendirmeye göre alt hesaba yazılır.</p>
            {sync.create > 0 && <p className="text-sm">Açılacaklardan örnek: {sync.sample.map((x) => `${x.code} ${x.name ?? ""}`).join(" · ")}{sync.create > sync.sample.length ? " …" : ""}</p>}
            {sync.skip > 0 && <p className="text-xs text-muted">{sync.skip} kod ERP kod biçimine uymadığı için atlanacak.</p>}
            {approver && sync.create > 0 && <form action={lucaSyncToErp}><ConfirmSubmit label={`${sync.create} hesabı ERP'de aç`} question="Luca hesapları ERP hesap planında açılsın mı? Bu işlem hesap ekler, silmez." className={btnPrimary} yes="Evet, aç" /></form>}
            {sync.create === 0 && <Notice tone="ok">Luca planındaki bütün hesaplar ERP&apos;de var.</Notice>}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>Yeni fişlerde Luca alt hesabına yönlendirme: <b>{sync.redirect ? "açık" : "kapalı"}</b></span>
              {approver && <form action={lucaSetRedirect}><input type="hidden" name="on" value={sync.redirect ? "0" : "1"} /><PendingSubmit className="text-xs font-semibold text-brand-700">{sync.redirect ? "Kapat" : "Aç"}</PendingSubmit></form>}
            </div>
          </section>
        )}

        {approver && anySuggest && <form action={lucaApplySuggestions}><PendingSubmit className={btnSecondary}>Önerilenlerin hepsini bağla</PendingSubmit></form>}

        {reds.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <h2 className="font-bold">2. Ana hesap yönlendirmeleri · {reds.length}</h2>
            <p className="text-sm text-muted">Sistem bu ana hesaplara kayıt yapıyor (KDV, amortisman, bordro, vergi fişleri ve eşleştirmeler). Hangi Luca alt hesabına yazılacağını seçin. Seçilmezse sistem listedeki ilk alt hesabı kullanır.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Ana hesap</th><th className={`${th} text-right`}>Satır</th><th className={th}>Şu an gidecek</th><th className={th}>Luca alt hesabı</th></tr></thead>
                <tbody>
                  {reds.map((r) => (
                    <tr key={r.code} className={!r.target ? "bg-[#FFF8F0]" : ""}>
                      <td className={td}><span className="num">{r.code}</span> {r.name}</td>
                      <td className={tdNum}>{r.lines}</td>
                      <td className={td}>{r.target ? <span className="text-[#1A7F52]">{r.target} · {r.target_name}</span> : <span className="text-[#7A4F00]">{r.fallback ?? "—"} (otomatik ilk alt hesap)</span>}</td>
                      <td className={td}>{approver ? <form action={lucaMapSet} className="flex gap-2 items-center"><input type="hidden" name="erp" value={r.code} /><Pick name="luca" options={r.options} value={r.target} suggest={r.suggest} /><PendingSubmit className="text-xs font-semibold text-brand-700">Kaydet</PendingSubmit></form> : (r.target ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {cats.length > 0 && (
          <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h2 className="font-bold">3. Kategoriler · {shownCats.length}</h2>
              <span className="text-sm text-muted">· gelir / gider kategorisi hangi Luca hesabına yazılsın</span>
              <Link href={sp.hepsi ? "/muhasebe/luca/hesap-plani" : "/muhasebe/luca/hesap-plani?hepsi=1"} className="ml-auto text-sm font-semibold text-brand-700">{sp.hepsi ? "Yalnız bağlanması gerekenler" : "Tüm kategoriler"}</Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr><th className={th}>Kategori</th><th className={th}>Tür</th><th className={th}>Şu an</th><th className={th}>Luca hesabı</th></tr></thead>
                <tbody>
                  {shownCats.map((c) => (
                    <tr key={c.id} className={c.account && !c.leaf ? "bg-[#FFF8F0]" : ""}>
                      <td className={td}>{c.name}{c.parent && <div className="text-xs text-muted">{c.parent}</div>}</td>
                      <td className={td}>{KIND[c.kind] ?? c.kind}</td>
                      <td className={td}>{c.account ? <span className={c.leaf ? "text-[#1A7F52]" : "text-[#7A4F00]"}><span className="num">{c.account}</span> {c.account_name}{!c.leaf && " (ana hesap)"}</span> : <span className="text-muted">eşleştirme yok</span>}</td>
                      <td className={td}>{approver && c.options.length > 0 ? <form action={lucaCategorySet} className="flex gap-2 items-center"><input type="hidden" name="cat" value={c.id} /><Pick name="code" options={c.options} value={c.leaf ? c.account : null} suggest={c.suggest} /><PendingSubmit className="text-xs font-semibold text-brand-700">Kaydet</PendingSubmit></form> : <span className="text-muted">{c.account ? "—" : "Muhasebe › Eşleştirmeler'den hesap atayın"}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!shownCats.length && <Notice tone="ok">Bütün kategoriler alt hesaplara bağlı.</Notice>}
          </section>
        )}
        <p className="text-xs text-muted">Kasa, banka ve cari hesapları ERP&apos;deki kendi alt hesaplarında kalır; Luca&apos;ya aktarırken Luca aktarımı ekranındaki eşleştirmeyle Luca koduna çevrilir.</p>
      </div>
    </>
  );
}
