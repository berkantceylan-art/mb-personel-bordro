import Link from "next/link";
import { Card } from "@/components/ui";
import { TEMPLATES } from "@/lib/ozluk-docs";
import { formatDate } from "@/lib/session";
import { me, MyHeader, NotLinked } from "../_shared";

/** Dijital imzalanabilir belgeler ve imzalarım */
export default async function MySignaturesPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="İmzalarım" />;
  const [{ data: types }, { data: sigs }] = await Promise.all([
    supabase.from("document_types").select("id, name, template_key, description").eq("digital_sign", true).order("sort_order"),
    supabase.from("document_signatures").select("id, template_key, signed_at").eq("employee_id", e.id).order("signed_at", { ascending: false }),
  ]);
  const signed = new Map<string, string>();
  for (const s of sigs ?? []) if (!signed.has(s.template_key)) signed.set(s.template_key, s.signed_at);
  const list = (types ?? []).filter((t) => t.template_key && TEMPLATES[t.template_key]);
  return (
    <>
      <MyHeader title="İmzalarım" subtitle="Basit formları telefonda imzalayın; iş sözleşmesi gibi belgeler ıslak imzayla" />
      <div className="p-4 md:p-6 flex flex-col gap-3 max-w-[760px]">
        {list.length === 0 && <Card><p className="text-sm text-muted">Dijital imzalanacak belge tanımlı değil (İK: 20261108000000_digital_signature.sql).</p></Card>}
        {list.map((t) => { const at = signed.get(t.template_key!); return (
          <div key={t.id} className="bg-white border border-line rounded-[14px] p-4 flex gap-3 items-center">
            <span aria-hidden className={`w-3 h-3 rounded-full shrink-0 ${at ? "bg-[#1E7A4C]" : "bg-[#B42318]"}`} />
            <div className="flex-1 min-w-0">
              <div className="font-semibold">{t.name}</div>
              <div className="text-xs text-muted">{at ? `İmzalandı · ${formatDate(at.slice(0, 10))}` : t.description ?? "İmza bekliyor"}</div>
            </div>
            <Link href={`/benim/imza/${t.template_key}`} className={`h-10 px-3.5 inline-flex items-center rounded-[10px] text-sm font-semibold ${at ? "border border-[#D5DEE8] text-brand-700" : "bg-brand-700 text-white"}`}>{at ? "Gör / yeniden imzala" : "Oku ve imzala"}</Link>
          </div>
        ); })}
        <p className="text-xs text-muted">İmzanız, belgenin o anki metni, tarih-saat ve cihaz bilgisiyle birlikte saklanır. İK çıktısını alıp özlük dosyanıza koyar.</p>
      </div>
    </>
  );
}
