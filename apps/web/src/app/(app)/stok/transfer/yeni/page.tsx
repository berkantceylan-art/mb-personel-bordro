import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { page } from "@/components/erp";
import { getSession } from "@/lib/session";
import { loadItems, loadStock, loadWarehouses } from "@/lib/stock-data";
import { today } from "@/lib/fin";
import { TransferForm } from "./TransferForm";

export const dynamic = "force-dynamic";

export default async function NewTransferPage({ searchParams }: { searchParams: Promise<{ kaynak?: string }> }) {
  const s = await getSession();
  if ((s.modules.stock ?? 0) < 2) redirect("/stok");
  const sp = await searchParams;
  const [warehouses, { rows: items }, stock] = await Promise.all([loadWarehouses(), loadItems(), loadStock()]);
  return (
    <>
      <PageHeader title="Yeni depo transferi" subtitle="Tek adımda ya da gönder → yolda → teslim al" />
      <div className={page}>
        <section className="bg-white border border-line rounded-[14px] p-5">
          <TransferForm
            warehouses={warehouses.filter((w) => w.is_active).map((w) => ({ id: w.id, name: w.name }))}
            items={items.filter((i) => i.is_active && i.kind !== "service").map((i) => ({ id: i.id, code: i.code, name: i.name, unit: i.unit, track_lot: i.track_lot }))}
            stock={stock}
            today={today()}
            from={sp.kaynak}
          />
        </section>
      </div>
    </>
  );
}
