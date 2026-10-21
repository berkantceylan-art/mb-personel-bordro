import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { IbanTable } from "./IbanTable";

export const dynamic = "force-dynamic";
export const metadata = { title: "Personel IBAN'ları" };

/** Tüm personelin IBAN'ı: ekle / düzelt, eksikleri gör, ad soyad + IBAN'ı WhatsApp ile gönder */
export default async function IbanPage() {
  const s = await getSession();
  if ((s.modules.hr ?? 0) < 1 && !["owner", "hr", "accountant"].includes(s.role)) redirect("/");
  const sb = await createClient();
  const [{ data: emps }, { data: priv }] = await Promise.all([
    sb.from("employees").select("id, card_no, first_name, last_name, status, departments(name)").order("first_name").limit(2000),
    sb.from("employee_private").select("employee_id, iban, bank_name, phone").limit(2000),
  ]);
  const pm = new Map(((priv ?? []) as { employee_id: string; iban: string | null; bank_name: string | null; phone: string | null }[]).map((p) => [p.employee_id, p]));
  const rows = ((emps ?? []) as unknown as { id: string; card_no: string | null; first_name: string; last_name: string; status: string; departments: { name: string } | null }[]).map((e) => {
    const p = pm.get(e.id);
    return { id: e.id, name: `${e.first_name} ${e.last_name === "-" ? "" : e.last_name}`.trim(), card: e.card_no, dept: e.departments?.name ?? "", active: e.status !== "terminated", iban: p?.iban ?? "", bank: p?.bank_name ?? "", phone: p?.phone ?? "" };
  });
  const active = rows.filter((r) => r.active);
  return (
    <>
      <PageHeader title="Personel IBAN'ları" subtitle={`${active.length} aktif personel · ${active.filter((r) => !r.iban).length} kişinin IBAN'ı eksik`} actions={<Link href="/personel" className="text-sm font-semibold text-brand-700">← Personel</Link>} />
      <div className="p-4 md:p-8 max-w-[1200px]">
        <IbanTable rows={rows} />
      </div>
    </>
  );
}
