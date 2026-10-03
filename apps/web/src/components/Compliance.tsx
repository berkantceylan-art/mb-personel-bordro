import Link from "next/link";
import { cellStyle, type ComplianceData } from "@/lib/compliance";
import { formatDate } from "@/lib/session";

const LEVEL: Record<string, [string, string]> = {
  EXPIRED: ["Süresi geçti", "bg-bad-bg text-bad"],
  D7: ["7 gün içinde", "bg-bad-bg text-bad"],
  D15: ["15 gün içinde", "bg-warn-bg text-warn"],
  D30: ["30 gün içinde", "bg-warn-bg text-warn"],
  MISSING: ["Hiç yapılmamış", "bg-[#EEF2F6] text-[#33414F]"],
};

export function ComplianceSummary({ data, base }: { data: ComplianceData; base: string }) {
  const c = data.counts;
  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]">
        {[
          ["Süresi geçmiş", c.expired, "text-bad"],
          ["7 gün içinde", c.d7, "text-bad"],
          ["15 gün içinde", c.d15, "text-warn"],
          ["30 gün içinde", c.d30, "text-warn"],
          ["Eksik (zorunlu)", c.missing, "text-[#33414F]"],
        ].map(([l, v, cls]) => (
          <div key={l as string} className="bg-white border border-line rounded-[14px] px-4 py-3 flex flex-col gap-1">
            <span className="text-xs text-muted">{l}</span>
            <span className={`num font-display text-2xl font-bold ${cls}`}>{v as number}</span>
          </div>
        ))}
      </section>
      <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead><tr className="text-left text-xs text-muted"><th className="py-3 px-3 font-semibold border-b border-line">Durum</th><th className="py-3 px-3 font-semibold border-b border-line">Personel</th><th className="py-3 px-3 font-semibold border-b border-line">Bölüm</th><th className="py-3 px-3 font-semibold border-b border-line">Konu</th><th className="py-3 px-3 font-semibold border-b border-line">Son tarih</th><th className="py-3 px-3 border-b border-line"><span className="sr-only">İşlem</span></th></tr></thead>
          <tbody>
            {data.alerts.slice(0, 300).map((a) => {
              const [l, cls] = LEVEL[a.level] ?? ["", ""];
              return (
                <tr key={`${a.employeeId}|${a.typeId}`}>
                  <td className="py-2.5 px-3 border-b border-[#EEF2F6]"><span className={`text-xs font-semibold px-2 py-1 rounded-full ${cls}`}>{l}</span></td>
                  <td className="py-2.5 px-3 border-b border-[#EEF2F6] font-semibold"><Link href={`/personel/${a.employeeId}`} className="text-brand-700">{a.name}</Link></td>
                  <td className="py-2.5 px-3 border-b border-[#EEF2F6]">{a.dept}</td>
                  <td className="py-2.5 px-3 border-b border-[#EEF2F6]">{a.typeName}</td>
                  <td className="num py-2.5 px-3 border-b border-[#EEF2F6]">{a.expiresOn ? `${formatDate(a.expiresOn)} (${a.daysLeft! < 0 ? `${-a.daysLeft!} gün geçti` : `${a.daysLeft} gün`})` : "—"}</td>
                  <td className="py-2.5 px-3 border-b border-[#EEF2F6] text-right"><Link href={`${base}?sekme=kayit&personel=${a.employeeId}&tur=${a.typeId}`} className="text-xs font-semibold text-brand-700">Kayıt gir</Link></td>
                </tr>
              );
            })}
            {data.alerts.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-ok font-semibold">Tüm kayıtlar güncel.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export function ComplianceMatrix({ data, base }: { data: ComplianceData; base: string }) {
  let lastDept = "";
  return (
    <section className="bg-white border border-line rounded-[14px] overflow-x-auto">
      <table className="text-xs border-collapse min-w-full">
        <thead>
          <tr>
            <th className="sticky left-0 bg-white text-left py-2 px-3 font-semibold text-muted border-b border-line min-w-44">Personel</th>
            {data.types.map((t) => (
              <th key={t.id} className="py-2 px-1 font-semibold border-b border-line text-center align-bottom min-w-20" title={t.name}>
                <span className="block leading-tight">{t.name}</span>
                {!t.required && <span className="font-normal text-muted">(isteğe bağlı)</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.employees.map((e) => {
            const header = e.dept !== lastDept;
            lastDept = e.dept;
            const row = data.cells.get(e.id)!;
            return [
              header && <tr key={`h-${e.dept}`}><td colSpan={data.types.length + 1} className="sticky left-0 py-1.5 px-3 bg-[#F3F6F9] font-bold uppercase tracking-wider text-[#33414F]">{e.dept}</td></tr>,
              <tr key={e.id}>
                <td className="sticky left-0 bg-white py-1 px-3 border-b border-[#EEF2F6]"><Link href={`/personel/${e.id}`} className="font-semibold text-brand-700 text-[13px]">{e.name}</Link></td>
                {data.types.map((t) => {
                  const c = row.get(t.id)!;
                  const v = cellStyle(c);
                  return (
                    <td key={t.id} className="p-0.5 border-b border-[#EEF2F6]">
                      <Link
                        href={`${base}?sekme=kayit&personel=${e.id}&tur=${t.id}`}
                        title={c.expiresOn ? `Son: ${formatDate(c.doneOn!)} · bitiş ${formatDate(c.expiresOn)}` : c.doneOn ? `Yapıldı: ${formatDate(c.doneOn)}` : "Kayıt yok"}
                        className={`num flex items-center justify-center h-8 rounded ${t.required || c.status !== "MISSING" ? v.cls : "bg-white text-[#C5D0DC]"}`}
                      >
                        {v.text}
                      </Link>
                    </td>
                  );
                })}
              </tr>,
            ];
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap gap-4 p-3 text-xs text-[#33414F]">
        {[["bg-ok-bg", "Geçerli"], ["bg-warn-bg", "30 gün içinde bitiyor (kalan gün)"], ["bg-bad-bg", "Süresi geçmiş (!)"], ["bg-[#F3F6F9]", "Kayıt yok (—)"]].map(([c, l]) => (
          <span key={l} className="flex items-center gap-1.5"><span className={`w-3 h-3 rounded ${c}`} />{l}</span>
        ))}
      </div>
    </section>
  );
}

export function Tabs({ base, active, tabs }: { base: string; active: string; tabs: Array<[string, string]> }) {
  return (
    <div className="flex gap-1 border-b border-line overflow-x-auto" role="tablist">
      {tabs.map(([k, l]) => (
        <Link key={k} href={`${base}?sekme=${k}`} role="tab" aria-selected={active === k} className={`h-11 px-4 inline-flex items-center whitespace-nowrap ${active === k ? "font-bold text-brand-700 shadow-[inset_0_-3px_0_#00A6D6]" : "text-muted"}`}>{l}</Link>
      ))}
    </div>
  );
}
