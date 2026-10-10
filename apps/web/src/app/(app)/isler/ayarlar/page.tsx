import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { addOption, deleteOption } from "../actions";

export const dynamic = "force-dynamic";

/** Teslim şekli ve prova türü listeleri */
export default async function LabSettings() {
  const s = await getSession();
  if (!s.logistics) redirect("/");
  const supabase = await createClient();
  const { data, error } = await supabase.from("lab_options").select("id, kind, value, sort").order("sort").order("value");
  const rows = (data ?? []) as { id: string; kind: string; value: string; sort: number }[];

  const Block = ({ kind, title, hint }: { kind: "delivery" | "tryin" | "bank"; title: string; hint: string }) => (
    <Card title={title}>
      <p className="text-xs text-muted">{hint}</p>
      <ul className="flex flex-wrap gap-2">
        {rows.filter((r) => r.kind === kind).map((r) => (
          <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line bg-white pl-3 pr-1 py-1 text-sm">
            {r.value}
            <form action={deleteOption}><input type="hidden" name="id" value={r.id} /><button className="h-7 w-7 rounded-md text-bad font-bold" aria-label={`${r.value} sil`}>×</button></form>
          </li>
        ))}
      </ul>
      <form action={addOption} className="flex gap-2">
        <input type="hidden" name="kind" value={kind} />
        <input name="value" required placeholder="Yeni değer" className="h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white flex-1" />
        <button className="h-11 px-4 rounded-[10px] bg-brand-700 text-white font-semibold">Ekle</button>
      </form>
    </Card>
  );

  return (
    <>
      <PageHeader title="Laboratuvar listeleri" subtitle="İş kayıt ekranındaki seçenekler" />
      <div className="p-4 md:p-8 grid gap-5 md:grid-cols-2 max-w-[1100px]">
        {error && <p className="md:col-span-2 text-sm text-bad bg-bad-bg rounded-lg p-3">Tablolar yok: Supabase&apos;de 20261125000000_lab_jobs.sql çalıştırın.</p>}
        <Block kind="delivery" title="Teslim şekli" hint="İşin hekime nasıl gideceği (kurye, kargo, elden...)" />
        <Block kind="tryin" title="Prova türü" hint="Prova / teslim adımlarında seçilir" />
        <Block kind="bank" title="Banka bilgileri" hint="Ekstre ve proformada basılır; hekim portalında görünür. Ör: Garanti BBVA · TR12 0006 2000 ... · EUR hesabı" />
        <Card title="İş numarası">
          <p className="text-sm text-muted">Yeni işler otomatik numara alır. Eski programdaki numaradan devam etmek için iş kayıt ekranında ilk işe <b>Numara</b> alanına istediğiniz numarayı yazın; sonraki işler o numaradan devam eder.</p>
        </Card>
      </div>
    </>
  );
}
