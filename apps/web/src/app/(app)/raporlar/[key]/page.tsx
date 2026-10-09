import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { PageHeader } from "@/components/ui";
import { PrintButton } from "@/components/PrintButton";
import { findReport, parseParams, visibleColumns, type Column } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";
import { formatDate, getSession, periodLabel } from "@/lib/session";

function fmt(v: string | number | null | undefined, c: Column): string {
  if (v === null || v === undefined || v === "") return "";
  if (c.type === "money") return formatTL(Number(v));
  if (c.type === "date") return formatDate(String(v));
  if (c.type === "number") return Number(v).toLocaleString("tr-TR");
  return String(v);
}

export default async function ReportPage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { key } = await params;
  const def = findReport(key);
  if (!def) notFound();
  const s = await getSession();
  if (!def.roles.includes(s.role)) redirect("/raporlar");
  const sp = await searchParams;
  const p = parseParams(sp);
  const supabase = await createClient();
  const [res, { data: departments }] = await Promise.all([def.run(supabase, p), supabase.from("departments").select("name").order("name")]);
  const cols = visibleColumns(def, res, s.role);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as Array<[string, string]>).toString();
  const input = "h-11 rounded-[10px] border border-[#D5DEE8] bg-white px-3";
  const periods = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(Date.UTC(new Date().getFullYear(), new Date().getMonth() + 1 - i, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={res.title}
          subtitle={res.subtitle}
          actions={
            <div className="flex gap-2 flex-wrap items-center">
              <Link href="/raporlar" className="text-sm font-semibold text-brand-700 mr-2">← Raporlar</Link>
              <a href={`/raporlar/${key}/excel${qs ? `?${qs}` : ""}`} className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">{key === "banka-maas" ? "Garanti dosyası indir" : key === "bes-liste" ? "Garanti Emeklilik dosyası indir" : key === "luca-puantaj" ? "Luca dosyası indir (.xlsx)" : "Excel indir"}</a>
              {key === "luca-puantaj" && (
                <a href={`/raporlar/${key}/excel?${qs ? `${qs}&` : ""}bicim=xls`} className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Eski Excel (.xls)</a>
              )}
              {key === "avans-listesi" && (
                <a href={`/yazdir/avans?bas=${p.from}&bit=${p.to}${p.department ? `&bolum=${encodeURIComponent(p.department)}` : ""}`} target="_blank" rel="noopener" className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">Makbuzları yazdır</a>
              )}
              <PrintButton />
            </div>
          }
        />
      </div>
      <div className="p-4 md:p-6 flex flex-col gap-4">
        <form className="flex flex-wrap gap-3 items-end print:hidden">
          {def.params.includes("period") && (
            <label className="flex flex-col gap-1 text-xs text-muted">Dönem
              <select name="donem" defaultValue={p.period} className={input}>{periods.map((x) => <option key={x} value={x}>{periodLabel(x)}</option>)}</select>
            </label>
          )}
          {def.params.includes("year") && (
            <label className="flex flex-col gap-1 text-xs text-muted">Yıl
              <select name="yil" defaultValue={p.year} className={input}>{[p.year + 1, p.year, p.year - 1, p.year - 2].map((y) => <option key={y} value={y}>{y}</option>)}</select>
            </label>
          )}
          {def.params.includes("dateRange") && (
            <>
              <label className="flex flex-col gap-1 text-xs text-muted">Başlangıç<input type="date" name="bas" defaultValue={p.from} className={input} /></label>
              <label className="flex flex-col gap-1 text-xs text-muted">Bitiş<input type="date" name="bit" defaultValue={p.to} className={input} /></label>
            </>
          )}
          {def.params.includes("payDate") && (
            <label className="flex flex-col gap-1 text-xs text-muted">Ödeme tarihi<input type="date" name="odeme" defaultValue={p.payDate} className={input} /></label>
          )}
          {def.params.includes("bankSource") && (
            <label className="flex flex-col gap-1 text-xs text-muted">Tutar
              <select name="kaynak" defaultValue={p.source} className={input}>
                <option value="kalan">Kalan (bankadan ödenmemiş kısım)</option>
                <option value="bordro">Bordro neti (tamamı)</option>
              </select>
            </label>
          )}
          {def.params.includes("department") && (
            <label className="flex flex-col gap-1 text-xs text-muted">Bölüm
              <select name="bolum" defaultValue={p.department ?? ""} className={input}>
                <option value="">Tüm bölümler</option>
                {(departments ?? []).map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
            </label>
          )}
          <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Göster</button>
        </form>

        {res.warnings && res.warnings.length > 0 && (
          <div className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn print:hidden">
            <b>{res.warnings.length} uyarı:</b> {res.warnings.slice(0, 12).join(" · ")}{res.warnings.length > 12 ? " …" : ""}
          </div>
        )}

        <div className="hidden print:block">
          <h1 className="text-lg font-bold">{s.companyName} · {res.title}</h1>
          <p className="text-sm">{res.subtitle}</p>
        </div>

        <section className="bg-white border border-line rounded-[14px] overflow-x-auto print:border-0">
          <table className="w-full text-[13px] print:text-[10px]">
            <thead>
              <tr className="text-xs text-muted">
                {cols.map((c) => <th key={c.key} className={`py-2.5 px-2 font-semibold border-b border-line whitespace-nowrap ${c.type === "money" || c.type === "number" ? "text-right" : "text-left"}`}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {res.rows.map((r, i) => (
                <tr key={i} className={r._sub ? "font-semibold bg-[#F5F8FB]" : undefined}>
                  {cols.map((c) => <td key={c.key} className={`py-2 px-2 border-b border-[#EEF2F6] ${c.type === "money" || c.type === "number" || c.type === "date" ? "num whitespace-nowrap" : ""} ${c.type === "money" || c.type === "number" ? "text-right" : ""}`}>{fmt(r[c.key], c)}</td>)}
                </tr>
              ))}
              {res.rows.length === 0 && <tr><td colSpan={cols.length} className="py-8 text-center text-muted">Kayıt yok.</td></tr>}
            </tbody>
            {res.totals && res.rows.length > 0 && (
              <tfoot>
                <tr className="font-semibold bg-[#F7F9FB]">
                  {cols.map((c) => <td key={c.key} className={`py-2.5 px-2 ${c.type === "money" || c.type === "number" ? "num text-right whitespace-nowrap" : ""}`}>{fmt(res.totals![c.key], c)}</td>)}
                </tr>
              </tfoot>
            )}
          </table>
        </section>
        <p className="text-xs text-muted print:hidden">{res.rows.length} satır</p>
      </div>
    </>
  );
}
