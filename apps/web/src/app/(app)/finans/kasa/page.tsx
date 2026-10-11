import { AccountsView } from "../_parts/AccountsView";
export const dynamic = "force-dynamic";
export default function CashPage() {
  return <AccountsView kinds={["cash"]} newKind="cash" title="Kasa" subtitle="Nakit kasalar: TL ve döviz kasaları ayrı açılır" />;
}
