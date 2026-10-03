import { getSession } from "@/lib/session";
import { KioskQr } from "./KioskQr";

export const dynamic = "force-dynamic";

export default async function KioskPage({ params }: { params: Promise<{ branchId: string }> }) {
  await getSession();
  const { branchId } = await params;
  return <KioskQr branchId={branchId} />;
}
