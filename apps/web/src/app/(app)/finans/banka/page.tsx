import { AccountsView } from "../_parts/AccountsView";
export const dynamic = "force-dynamic";
export default function BankPage() {
  return <AccountsView kinds={["bank", "pos"]} newKind="bank" title="Banka" subtitle="Banka hesapları: her para birimi için ayrı hesap" />;
}
