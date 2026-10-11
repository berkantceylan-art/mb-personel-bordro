import { InvoiceList, type ListSP } from "../../fatura/_parts/InvoiceList";

export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<ListSP> }) {
  return <InvoiceList direction="sale" sp={await searchParams} />;
}
