import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { PhoneCapture } from "./PhoneCapture";

export const maxDuration = 120;

/** Telefonu kamera olarak kullan: QR ile açılır, çekilen belgeler masaüstündeki sihirbaza düşer */
export default async function DossierPhone({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr"].includes(s.role)) redirect("/");
  const { id } = await params;
  const sb = await createClient();
  const [{ data: e }, { count }] = await Promise.all([
    sb.from("employees").select("first_name, last_name").eq("id", id).maybeSingle(),
    sb.from("employee_documents").select("id", { count: "exact", head: true }).eq("employee_id", id),
  ]);
  if (!e) redirect("/ozluk-sihirbazi");
  return (
    <div className="p-4 flex flex-col gap-4 max-w-xl mx-auto">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-brand-800">{e.first_name} {e.last_name}</h1>
          <p className="text-sm text-muted">Özlük klasörü · {count ?? 0} belge kayıtlı</p>
        </div>
        <Link href={`/ozluk-sihirbazi/${id}`} className="text-sm font-semibold text-brand-700">Sihirbaz</Link>
      </div>
      <PhoneCapture employeeId={id} companyId={s.companyId} />
    </div>
  );
}
