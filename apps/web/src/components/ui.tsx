import Link from "next/link";

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-center gap-4 px-4 md:px-8 py-3 md:py-4 bg-white border-b border-line">
      <div className="flex-1 min-w-60">
        <h1 className="font-display text-xl md:text-[22px] font-bold text-brand-800">{title}</h1>
        {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions}
    </header>
  );
}

export function Card({ title, action, children, className = "" }: { title?: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-line rounded-[14px] p-5 flex flex-col gap-3.5 ${className}`}>
      {(title || action) && (
        <div className="flex flex-wrap justify-between items-baseline gap-2">
          {title && <h2 className="font-display text-base font-semibold text-brand-800">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: React.ReactNode }) {
  return (
    <div className="bg-white border border-line rounded-[14px] px-3.5 py-3 md:px-5 md:py-4 flex flex-col gap-1 md:gap-1.5 min-w-0">
      <span className="text-xs md:text-[13px] text-muted leading-tight">{label}</span>
      <span className="num font-display text-lg md:text-[26px] font-bold text-brand-800 leading-tight break-words">{value}</span>
      {sub && <span className="text-[11px] md:text-xs text-muted leading-snug">{sub}</span>}
    </div>
  );
}

export function PrimaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold">
      {children}
    </Link>
  );
}

export function SecondaryLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="h-11 px-4 inline-flex items-center rounded-[10px] border border-[#D5DEE8] bg-white text-brand-700 font-semibold">
      {children}
    </Link>
  );
}

const CHANNEL: Record<string, { label: string; cls: string }> = {
  BANK: { label: "Banka", cls: "bg-[#E7F1FB] text-brand-700" },
  CASH: { label: "Elden", cls: "bg-[#E0F5FB] text-accent-ink" },
  NONE: { label: "Kesinti", cls: "bg-[#F1ECFA] text-[#5B3A9A]" },
};

export function ChannelChip({ channel, credit }: { channel: string; credit?: boolean }) {
  if (credit) return <span className="text-xs text-muted">—</span>;
  const c = CHANNEL[channel] ?? CHANNEL.NONE!;
  return <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${c.cls}`}>{c.label}</span>;
}

export const TYPE_LABEL: Record<string, string> = {
  ACCRUAL: "Hakediş",
  BONUS: "Prim / ikramiye",
  OVERTIME: "Fazla mesai",
  ADVANCE: "Avans",
  SALARY: "Maaş ödemesi",
  BES: "BES kesintisi",
  GARNISHMENT: "İcra / nafaka kesintisi",
  DEDUCTION: "Borç / iş kesintisi",
  ADJUSTMENT: "Düzeltme",
};
