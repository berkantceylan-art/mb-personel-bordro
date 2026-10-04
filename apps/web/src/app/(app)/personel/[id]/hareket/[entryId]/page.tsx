import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { formatTL } from "@mb/core";
import { EntryEditForm } from "@/components/EntryEditForm";
import { PageHeader, TYPE_LABEL } from "@/components/ui";
import { deleteLedgerEntry } from "@/lib/ledger-actions";
import { createClient } from "@/lib/supabase/server";
import { canManagePay, formatDate, getSession } from "@/lib/session";

export default async function EditEntryPage({ params }: { params: Promise<{ id: string; entryId: string }> }) {
  const { id, entryId } = await params;
  const s = await getSession();
  if (!canManagePay(s.role)) redirect(`/personel/${id}`);
  const supabase = await createClient();
  const { data: e } = await supabase
    .from("ledger_entries")
    .select("*, employees(first_name, last_name)")
    .eq("id", entryId)
    .eq("employee_id", id)
    .maybeSingle();
  if (!e) notFound();
  const { data: per } = await supabase.from("payroll_periods").select("status").eq("period", e.period).maybeSingle();
  const closed = per?.status === "closed";
  const emp = e.employees as unknown as { first_name: string; last_name: string };
  const amountText = (Number(e.amount) / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

  return (
    <>
      <PageHeader
        title={`${TYPE_LABEL[e.type]} düzenle`}
        subtitle={`${emp.first_name} ${emp.last_name} · ${formatDate(e.entry_date)} · ${formatTL(Number(e.amount))}`}
        actions={<Link href={`/personel/${id}`} className="text-sm font-semibold text-brand-700">← Profile dön</Link>}
      />
      <div className="p-4 md:p-8 flex flex-col gap-6 max-w-3xl">
        {e.voided_at ? (
          <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">Bu hareket {formatDate(e.voided_at)} tarihinde iptal edilmiş: {e.void_reason}</p>
        ) : closed ? (
          <p className="text-sm rounded-lg px-3 py-2 bg-warn-bg text-warn">
            {e.period} dönemi kapalı; bu hareket düzeltilemez veya silinemez. Gerekirse <Link href="/donemler" className="font-semibold underline">Dönemler</Link> sayfasından dönemi yeniden açın ya da açık döneme düzeltme hareketi girin.
          </p>
        ) : (
          <>
            <EntryEditForm
              id={e.id}
              employeeId={id}
              type={e.type}
              channel={e.channel}
              date={e.entry_date}
              period={e.period}
              amount={amountText}
              note={e.note ?? ""}
            />
            <form action={deleteLedgerEntry} className="bg-white border border-[#F3C9C5] rounded-2xl p-6 flex flex-col gap-3">
              <h2 className="font-display font-semibold text-bad">Hareketi sil</h2>
              <p className="text-sm text-muted">Silinen hareket hesaplardan çıkar; denetim için kim, ne zaman, neden sildiği saklanır.</p>
              <input type="hidden" name="id" value={e.id} />
              <input type="hidden" name="employeeId" value={id} />
              <input name="reason" required placeholder="Silme gerekçesi" className="h-12 rounded-[10px] border border-[#D5DEE8] px-3" />
              <button className="h-11 px-5 rounded-[10px] bg-[#B42318] text-white font-semibold self-start">Sil</button>
            </form>
          </>
        )}
      </div>
    </>
  );
}
