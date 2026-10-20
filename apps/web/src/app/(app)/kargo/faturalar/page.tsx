import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** Kargo faturaları: DHL ve UPS ayrı ekranlarda */
export default function Page() {
  redirect("/kargo/faturalar/dhl");
}
