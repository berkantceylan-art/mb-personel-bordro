import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { Docs } from "@/components/supplier/Docs";
import { portalCtx, portalHome } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

/** Belgeler: irsaliye, fatura, sertifika, katalog … iki yönlü */
export default async function SupplierDocs({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const ctx = await portalCtx(await searchParams, "/tedarikci/belgeler");
  if (!ctx) return <NotLinked />;
  await ctx.sb.rpc("sup_mark_read", { p_party: ctx.party.id }).then(() => undefined, () => undefined);
  const { badges } = await portalHome(ctx);
  return (
    <PortalShell ctx={ctx} active="/tedarikci/belgeler" badges={badges}>
      <div><h2 className="font-display text-2xl font-bold text-brand-800">Belgeler</h2><p className="text-sm text-muted">İrsaliye, fatura, ürün sertifikası, katalog ve dekontları buradan paylaşın. Sertifikaların geçerlilik tarihi yaklaşınca uyarılırsınız.</p></div>
      <Docs sb={ctx.sb} partyId={ctx.party.id} viewer={ctx.mode === "supplier" ? "supplier" : "lab"} />
    </PortalShell>
  );
}
