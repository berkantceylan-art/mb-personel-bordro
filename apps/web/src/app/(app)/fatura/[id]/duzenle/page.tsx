import { notFound, redirect } from "next/navigation";
import { loadInvoiceInitial } from "@/lib/invoice-data";
import { NewInvoice } from "../../_parts/NewInvoice";

export const dynamic = "force-dynamic";

/** Taslak faturayı düzenle */
export default async function EditInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const init = await loadInvoiceInitial(id, "edit");
  if (!init) notFound();
  if (init.status !== "draft") redirect(`/fatura/${id}`);
  return <NewInvoice direction={init.direction} initial={init} title="Taslak faturayı düzenle" />;
}
