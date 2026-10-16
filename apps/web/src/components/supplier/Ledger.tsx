import Link from "next/link";
import { money } from "@/lib/jobs";
import { dmy, portalError, type LedgerRow } from "@/lib/supplier-portal";

type Sb = { rpc: (f: string, a: Record<string, unknown>) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any

/**
 * Cari ekstre. Tedarikçi gözüyle: "Alacağınız" (+). Faturalı (resmi) ve fişli (faturasız) hesap ayrı sekme.
 * base: sekme bağlantılarının yolu (ör. /tedarikci/cari?cari=… ya da ERP sayfası)
 */
export async function Ledger({ sb, partyId, book, hasSlip, showSlip, base, from }: { sb: Sb; partyId: string; book: "invoice" | "slip"; hasSlip: boolean; showSlip: boolean; base: string; from?: string }) {
  const { data, error } = await sb.rpc("sup_portal_ledger", { p_party: partyId, p_book: book, p_from: from || null });
  const rows = (data ?? []) as LedgerRow[];
  const cur = rows[0]?.currency ?? "TRY";
  const last = rows.length ? rows[rows.length - 1].balance : 0;
  const owed = rows.reduce((a, r) => a + Number(r.owed), 0);
  const paid = rows.reduce((a, r) => a + Number(r.paid), 0);
  const sep = base.includes("?") ? "&" : "?";
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <Link href={`${base}${sep}defter=fatura`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold border ${book === "invoice" ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>Faturalı hesap</Link>
        {hasSlip && showSlip && <Link href={`${base}${sep}defter=fis`} className={`h-10 px-4 inline-flex items-center rounded-full text-sm font-semibold border ${book === "slip" ? "bg-brand-700 text-white border-brand-700" : "bg-white border-line"}`}>Faturasız (fişli) hesap</Link>}
        <form className="ml-auto flex items-center gap-2 text-sm">
          {base.includes("cari=") && <input type="hidden" name="cari" value={new URLSearchParams(base.split("?")[1]).get("cari") ?? ""} />}
          <input type="hidden" name="defter" value={book === "slip" ? "fis" : "fatura"} />
          <label className="text-muted">Başlangıç</label><input type="date" name="bas" defaultValue={from} className="h-10 rounded-[10px] border border-[#D5DEE8] px-2" />
          <button className="h-10 px-3 rounded-[10px] border border-line bg-white font-semibold">Göster</button>
        </form>
      </div>
      {error ? <p className="text-sm text-bad bg-bad-bg rounded-lg p-3">{portalError(error.message)}</p> : (
        <>
          <section className="grid gap-3 grid-cols-1 sm:grid-cols-3">
            <div className="rounded-[18px] p-5 text-white bg-gradient-to-br from-[#0a3d73] to-[#0f6aa8]">
              <div className="text-xs font-semibold text-white/70">{last >= 0 ? "Alacağınız (güncel bakiye)" : "Borcunuz (güncel bakiye)"}</div>
              <div className="font-display text-3xl font-bold tabular-nums mt-1">{money(Math.abs(last), cur)}</div>
              <div className="text-xs text-white/70 mt-1">{book === "slip" ? "Faturasız (fişli) alımlar" : "Faturalı alımlar"}</div>
            </div>
            <div className="rounded-[18px] border border-line bg-white p-5"><div className="text-xs font-semibold text-muted">Fatura / fiş toplamı</div><div className="font-display text-2xl font-bold tabular-nums">{money(owed, cur)}</div></div>
            <div className="rounded-[18px] border border-line bg-white p-5"><div className="text-xs font-semibold text-muted">Ödenen</div><div className="font-display text-2xl font-bold tabular-nums text-ok">{money(paid, cur)}</div></div>
          </section>
          <section className="rounded-[20px] border border-line bg-white overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead><tr className="text-left text-xs text-muted bg-[#F7F9FB]"><th className="p-3">Tarih</th><th className="p-3">İşlem</th><th className="p-3">Belge no</th><th className="p-3">Açıklama</th><th className="p-3 text-right">Fatura / fiş</th><th className="p-3 text-right">Ödeme</th><th className="p-3 text-right">Bakiye</th></tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className="border-t border-[#EEF2F6]">
                    <td className="p-3 whitespace-nowrap">{r.at ? dmy(r.at) : "—"}</td>
                    <td className="p-3"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${r.paid > 0 ? "bg-ok-bg text-ok" : r.kind === "Devir" ? "bg-[#EEF2F6] text-muted" : "bg-[#EEF4FB] text-brand-700"}`}>{r.kind}</span></td>
                    <td className="p-3 font-mono text-xs">{r.doc ?? ""}</td>
                    <td className="p-3 max-w-[320px] truncate" title={r.description}>{r.description}</td>
                    <td className="p-3 text-right tabular-nums">{r.owed ? money(r.owed, cur) : ""}</td>
                    <td className="p-3 text-right tabular-nums text-ok">{r.paid ? money(r.paid, cur) : ""}</td>
                    <td className={`p-3 text-right tabular-nums font-semibold ${r.balance < 0 ? "text-bad" : ""}`}>{money(r.balance, cur)}</td>
                  </tr>
                ))}
                {!rows.length && <tr><td colSpan={7} className="p-8 text-center text-muted">Hareket yok.</td></tr>}
              </tbody>
            </table>
          </section>
          <p className="text-xs text-muted">Bakiye (+): size olan borcumuz. Ödemeler (havale, çek, senet) tek kez girilir ve faturalı / fişli hesabın ikisine de yansır.</p>
        </>
      )}
    </div>
  );
}
