import { redirect } from "next/navigation";
import { previousPeriod } from "@mb/core";
import { currentPeriod } from "@/lib/session";

/** Kısa yol: ayın ilk 10 gününde önceki ayın, sonra bu ayın maaş planı */
export default function SalaryPlanShortcut() {
  const day = Number(new Date().toISOString().slice(8, 10));
  redirect(`/donemler/${day <= 10 ? previousPeriod(currentPeriod()) : currentPeriod()}`);
}
