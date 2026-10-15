import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { KPI, Notice, btnSecondary, inputCls, page } from "@/components/erp";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { glError } from "@/lib/gl";
import { glCheckAck } from "@/lib/gl-actions";

export const dynamic = "force-dynamic";

type Check = { key: string; title: string; area: string; severity: "critical" | "warning" | "info"; count: number; link: string; items: Array<{ label: string; amount?: number; link?: string }>; acked: boolean; note: string | null; acked_at: string | null };

const SEV: Record<string, [string, string, string]> = {
  critical: ["Kritik", "bg-[#FDECEC] text-bad", "border-l-[#C62828]"],
  warning: ["Uyarı", "bg-[#FFF4E0] text-[#7A4F00]", "border-l-[#E0A100]"],
  info: ["Bilgi", "bg-[#EEF3F9] text-brand-700", "border-l-brand-600"],
};

/** Kontroller ve uyarılar: ay için muhasebe kontrol listesi; kritik uyarı açıkken dönem kilitlenmez */
export default async function Checks({ searchParams }: { searchParams: Promise<{ ay?: string; hepsi?: string }> }) {
  const s = await getSession();
  if ((s.modules.ledger ?? 0) < 1) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600000);
  const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
  const month = sp.ay && /^\d{4}-\d{2}$/.test(sp.ay) ? sp.ay : prev;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gl_checks", { p_month: month });
  const all = (data ?? []) as Check[];
  const open = all.filter((c) => c.count > 0 && !c.acked);
  const shown = sp.hepsi ? all : all.filter((c) => c.count > 0);
  const crit = open.filter((c) => c.severity === "critical").length;
  const warn = open.filter((c) => c.severity === "warning").length;
  const approver = (s.modules.ledger ?? 0) >= 3;
  return (
    <>
      <PageHeader title="Kontroller ve uyarılar" subtitle={`${month} · ${all.length} kontrol · kritik uyarılar kapanmadan dönem kilitlenemez`} actions={<Link href={`/muhasebe/donem-sonu?ay=${month}`} className="text-sm font-semibold text-brand-700">Dönem sonu işlemleri</Link>} />
      <div className={page}>
        <form className="flex flex-wrap gap-2"><input type="month" name="ay" defaultValue={month} className={`${inputCls} w-44`} /><button className={btnSecondary}>Göster</button>
          <Link href={`/muhasebe/kontroller?ay=${month}${sp.hepsi ? "" : "&hepsi=1"}`} className={btnSecondary}>{sp.hepsi ? "Yalnız bulunanlar" : "Tüm kontrolleri göster"}</Link></form>
        {error && <Notice tone="bad">{/function|does not exist|schema cache|relation/.test(error.message) ? "Supabase'de 20270218000000_gl_checks.sql çalıştırılmalı." : glError(error.message)}</Notice>}
        {!error && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KPI label="Açık kritik" value={String(crit)} tone={crit ? "bad" : "ok"} sub="dönem kilidini engeller" />
            <KPI label="Açık uyarı" value={String(warn)} tone={warn ? "bad" : undefined} />
            <KPI label="Bilerek geçilen" value={String(all.filter((c) => c.count > 0 && c.acked).length)} />
            <KPI label="Temiz kontrol" value={`${all.filter((c) => c.count === 0).length} / ${all.length}`} tone="ok" />
          </div>
        )}
        {!error && !open.length && <Notice tone="ok">Bu ay açık uyarı yok.</Notice>}
        <ol className="flex flex-col gap-3">
          {shown.map((c) => {
            const [sl, scls, border] = SEV[c.severity] ?? SEV.info!;
            return (
              <li key={c.key} className={`bg-white border border-line border-l-4 ${c.count ? border : "border-l-[#1A7F52]"} rounded-[14px] p-4 flex flex-col gap-2 ${c.acked ? "opacity-70" : ""}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  {c.count > 0 ? <span className={`rounded-full px-2 py-0.5 font-semibold ${scls}`}>{sl}</span> : <span className="rounded-full px-2 py-0.5 font-semibold bg-[#E6F4EC] text-[#1A7F52]">Temiz</span>}
                  <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5">{c.area}</span>
                  {c.acked && <span className="rounded-full bg-[#F2F4F7] px-2 py-0.5">Bilerek geçildi{c.acked_at ? ` · ${formatDate(c.acked_at.slice(0, 10))}` : ""}{c.note ? ` · ${c.note}` : ""}</span>}
                </div>
                <div className="flex flex-wrap items-baseline gap-2"><b>{c.title}</b>{c.count > 0 && <span className="text-sm text-muted">· {c.count}</span>}<Link href={c.link} className="ml-auto text-sm font-semibold text-brand-700">Düzelt →</Link></div>
                {c.items.length > 0 && (
                  <ul className="text-sm divide-y divide-[#EEF2F6]">
                    {c.items.map((i, k) => <li key={k} className="py-1.5 flex justify-between gap-3">{i.link ? <Link href={i.link} className="text-brand-700">{i.label}</Link> : <span>{i.label}</span>}{i.amount != null && <span className="num">{fmt(i.amount)}</span>}</li>)}
                    {c.count > c.items.length && <li className="py-1.5 text-xs text-muted">ve {c.count - c.items.length} kayıt daha</li>}
                  </ul>
                )}
                {approver && c.count > 0 && (
                  c.acked
                    ? <form action={glCheckAck}><input type="hidden" name="key" value={c.key} /><input type="hidden" name="period" value={month} /><input type="hidden" name="on" value="0" /><PendingSubmit className="text-xs font-semibold text-brand-700">Yeniden aç</PendingSubmit></form>
                    : <form action={glCheckAck} className="flex flex-wrap items-center gap-2"><input type="hidden" name="key" value={c.key} /><input type="hidden" name="period" value={month} /><input name="note" placeholder="neden (ör. müşavirle konuşuldu)" className={`${inputCls} h-9 w-72`} /><PendingSubmit className="text-xs font-semibold text-brand-700">Bilerek geç</PendingSubmit></form>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
