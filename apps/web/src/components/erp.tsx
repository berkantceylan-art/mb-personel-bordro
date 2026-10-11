import Link from "next/link";
import { fmt } from "@/lib/fin";

/** ERP modülleri için ortak görünüm parçaları (finans, stok, alış-satış, üretim) */

export const inputCls = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-sm w-full focus:outline-2 focus:outline-brand-600";
export const selectCls = inputCls;
export const textareaCls = "rounded-[10px] border border-[#D5DEE8] px-3 py-2 bg-white text-sm w-full";
export const btnPrimary = "h-11 px-5 rounded-[10px] bg-brand-700 text-white font-semibold hover:bg-brand-800 disabled:opacity-60 inline-flex items-center justify-center gap-2";
export const btnSecondary = "h-11 px-4 rounded-[10px] border border-[#D5DEE8] bg-white text-ink font-semibold hover:border-brand-600 inline-flex items-center justify-center gap-2";
export const btnGhost = "text-sm font-semibold text-brand-700 hover:underline";
export const th = "py-2.5 px-3 font-semibold border-b border-line text-left whitespace-nowrap";
export const td = "py-2.5 px-3 border-b border-[#EEF2F6] align-top";
export const tdNum = `${td} num text-right whitespace-nowrap`;

export function Field({ label, hint, children, className = "" }: { label: string; hint?: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-semibold text-ink ${className}`}>
      <span>{label}{hint && <span className="ml-1 font-normal text-muted">· {hint}</span>}</span>
      {children}
    </label>
  );
}

/** Para: negatif kırmızı, isteğe bağlı +/− işareti */
export function Money({ v, cur = "TRY", sign, strong, tone }: { v: number | string | null | undefined; cur?: string; sign?: boolean; strong?: boolean; tone?: "auto" | "none" }) {
  const n = Number(v ?? 0);
  const color = tone === "none" ? "" : n < 0 ? "text-bad" : "";
  return <span className={`num whitespace-nowrap ${color} ${strong ? "font-semibold" : ""}`}>{fmt(n, cur, { sign })}</span>;
}

export function Table({ head, children, min = 720, foot }: { head: React.ReactNode[]; children: React.ReactNode; min?: number; foot?: React.ReactNode }) {
  return (
    <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
      <table className="w-full text-sm" style={{ minWidth: min }}>
        <thead><tr className="text-xs text-muted">{head.map((h, i) => <th key={i} className={th}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
        {foot && <tfoot>{foot}</tfoot>}
      </table>
    </section>
  );
}

export function EmptyRow({ cols, text = "Kayıt yok." }: { cols: number; text?: string }) {
  return <tr><td colSpan={cols} className="py-10 text-center text-muted">{text}</td></tr>;
}

export function Notice({ tone = "warn", children }: { tone?: "warn" | "bad" | "ok" | "info"; children: React.ReactNode }) {
  const cls = { warn: "bg-warn-bg text-warn", bad: "bg-bad-bg text-bad", ok: "bg-ok-bg text-ok", info: "bg-[#EAF2FB] text-brand-700" }[tone];
  return <p className={`text-sm rounded-[10px] px-4 py-3 ${cls}`}>{children}</p>;
}

export function Chip({ children, tone = "gray" }: { children: React.ReactNode; tone?: "gray" | "blue" | "green" | "amber" | "red" }) {
  const cls = { gray: "bg-[#EEF2F6] text-ink", blue: "bg-[#EAF2FB] text-brand-700", green: "bg-ok-bg text-ok", amber: "bg-warn-bg text-warn", red: "bg-bad-bg text-bad" }[tone];
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap ${cls}`}>{children}</span>;
}

/** Üst özet kutusu */
export function KPI({ label, value, sub, href, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; href?: string; tone?: "bad" | "ok" }) {
  const body = (
    <>
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-display text-xl md:text-2xl font-bold ${tone === "bad" ? "text-bad" : tone === "ok" ? "text-ok" : "text-brand-800"}`}>{value}</span>
      {sub && <span className="text-xs text-muted">{sub}</span>}
    </>
  );
  const cls = "bg-white border border-line rounded-[14px] px-4 py-3 flex flex-col gap-0.5 min-w-0";
  return href ? <Link href={href} className={`${cls} hover:border-brand-600`}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Sekmeli bağlantılar (sayfa içi filtre) */
export function Tabs({ items, active }: { items: [string, string, number?][]; active: string }) {
  return (
    <nav className="flex gap-1.5 overflow-x-auto text-sm">
      {items.map(([href, label, count]) => (
        <Link key={href} href={href} aria-current={active === href ? "page" : undefined} className="shrink-0 rounded-full px-3.5 py-1.5 font-semibold border border-line bg-white text-ink aria-[current=page]:bg-brand-700 aria-[current=page]:text-white aria-[current=page]:border-brand-700">
          {label}{typeof count === "number" && <span className="ml-1.5 opacity-70">{count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export const page = "p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]";
