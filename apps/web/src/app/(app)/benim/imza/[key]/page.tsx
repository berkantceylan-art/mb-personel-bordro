import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { docData, renderText, TEMPLATES, assetItems } from "@/lib/ozluk-docs";
import { me, MyHeader, NotLinked } from "../../_shared";
import { signDocument } from "../actions";
import { SignaturePad } from "../SignaturePad";

export default async function SignPage({ params }: { params: Promise<{ key: string }> }) {
  const { supabase, me: e, s } = await me();
  if (!e) return <NotLinked title="İmzala" />;
  const { key } = await params;
  if (!TEMPLATES[key]) notFound();
  const [{ data: type }, d] = await Promise.all([
    supabase.from("document_types").select("id, name, digital_sign").eq("template_key", key).maybeSingle(),
    docData(supabase, e.id, s.companyId),
  ]);
  if (!d || !type?.digital_sign) notFound();
  const data: Record<string, unknown> = { ...d.data };
  if (key === "zimmet-tutanagi") { data.items = await assetItems(supabase, e.id, false); data.tutanak_no = `${new Date().getFullYear()}-${e.id.slice(0, 6).toUpperCase()}`; }
  const doc = await renderText(key, data);
  if (!doc) notFound();
  const text = doc.paragraphs.join("\n");
  return (
    <>
      <MyHeader title={type.name} subtitle="Okuyun, kutuyu işaretleyin, imzalayın" />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        <Card>
          <div className="max-h-[48vh] overflow-y-auto pr-1 flex flex-col gap-2 text-sm leading-relaxed">
            {doc.paragraphs.map((p, i) => <p key={i} className={i === 0 ? "font-bold text-brand-800" : ""}>{p}</p>)}
          </div>
        </Card>
        <Card title="İmza">
          <SignaturePad action={signDocument} hidden={{ key, typeId: type.id, text }} />
        </Card>
      </div>
    </>
  );
}
