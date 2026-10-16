import { NotLinked, PortalShell } from "@/components/supplier/PortalShell";
import { Thread } from "@/components/supplier/Thread";
import { portalCtx, portalHome } from "@/lib/supplier-portal";

export const dynamic = "force-dynamic";

/** Tedarikçi ↔ satın alma yazışması */
export default async function SupplierMessages({ searchParams }: { searchParams: Promise<{ cari?: string }> }) {
  const ctx = await portalCtx(await searchParams, "/tedarikci/mesajlar");
  if (!ctx) return <NotLinked />;
  await ctx.sb.rpc("sup_mark_read", { p_party: ctx.party.id }).then(() => undefined, () => undefined);
  const { badges } = await portalHome(ctx);
  return (
    <PortalShell ctx={ctx} active="/tedarikci/mesajlar" badges={badges}>
      <div className="flex items-end gap-3">
        <div><h2 className="font-display text-2xl font-bold text-brand-800">Mesajlar</h2><p className="text-sm text-muted">Satın alma ekibiyle doğrudan yazışın; siparişe bağlayın, dosya ekleyin. Okunduğunda ✓✓ görürsünüz.</p></div>
      </div>
      <Thread sb={ctx.sb} partyId={ctx.party.id} viewer={ctx.mode === "supplier" ? "supplier" : "lab"} />
    </PortalShell>
  );
}
