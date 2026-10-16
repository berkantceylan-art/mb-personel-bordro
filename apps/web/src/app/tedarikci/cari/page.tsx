import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { Ledger } from "@/components/supplier/Ledger";
import { PrintButton } from "@/components/PrintButton";
import { portalCtx, portalHome } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

/** Tedarikçinin carisi: faturalı ve faturasız (fişli) hesap ekstresi */
export default async function SupplierLedger({ searchParams }: { searchParams: Promise<{ cari?: string; defter?: string; bas?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalCtx(sp, "/tedarikci/cari");
  if (!ctx) return <NotLinked />;
  const { home, badges } = await portalHome(ctx);
  const show = home?.show_ledger !== false || ctx.mode === "preview";
  return (
    <PortalShell ctx={ctx} active="/tedarikci/cari" badges={badges}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1"><h2 className="font-display text-2xl font-bold text-brand-800">Cari hesap</h2><p className="text-sm text-muted">Kayıtlarımıza göre faturalarınız, fişleriniz ve size yaptığımız ödemeler. Fark görürseniz Mesajlar&apos;dan yazın.</p></div>
        <PrintButton />
      </div>
      {show ? (
        <Ledger sb={ctx.sb} partyId={ctx.party.id} book={sp.defter === "fis" ? "slip" : "invoice"} hasSlip={!!home?.has_slip} showSlip={home?.show_slip !== false || ctx.mode === "preview"}
          base={`/tedarikci/cari${ctx.q}`} from={sp.bas && /^\d{4}-\d{2}-\d{2}$/.test(sp.bas) ? sp.bas : undefined} />
      ) : <p className="rounded-[20px] border border-line bg-white p-8 text-center text-muted">Cari bilgileri bu hesap için paylaşılmıyor.</p>}
    </PortalShell>
  );
}
