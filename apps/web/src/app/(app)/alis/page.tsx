import { Overview } from "../fatura/_parts/Overview";

export const dynamic = "force-dynamic";

export default function Page() {
  return <Overview direction="purchase" />;
}
