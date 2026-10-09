import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";

/** İK: dijital imzalı belgenin yazdırılabilir hali (metin + imza + zaman damgası) */
export default async function SignedDocPage({ params }: { params: Promise<{ id: string; sigId: string }> }) {
  const s = await getSession();
  if (!["owner", "accountant", "hr", "branch_manager"].includes(s.role)) redirect("/");
  const { id, sigId } = await params;
  const supabase = await createClient();
  const [{ data: sig }, { data: e }, { data: c }] = await Promise.all([
    supabase.from("document_signatures").select("*, document_types(name)").eq("id", sigId).eq("employee_id", id).maybeSingle(),
    supabase.from("employees").select("first_name, last_name").eq("id", id).maybeSingle(),
    supabase.from("companies").select("name").eq("id", s.companyId).maybeSingle(),
  ]);
  if (!sig || !e) notFound();
  const { data: url } = await supabase.storage.from("documents").createSignedUrl(sig.signature_path, 600);
  const paras = String(sig.content_text).split("\n");
  const when = new Date(sig.signed_at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });
  return (
    <main className="max-w-[800px] mx-auto p-8 bg-white text-ink print:p-0">
      <div className="flex justify-between items-start mb-6 print:hidden">
        <h1 className="font-display text-xl font-bold">{(sig.document_types as unknown as { name: string } | null)?.name ?? sig.template_key}</h1>
        <a href="#" onClick={undefined} className="h-11 px-4 inline-flex items-center rounded-[10px] bg-brand-700 text-white font-semibold print:hidden" data-print>Yazdır / PDF</a>
      </div>
      <div className="text-xs text-muted mb-4">{c?.name}</div>
      <div className="flex flex-col gap-2 text-sm leading-relaxed">{paras.map((p, i) => <p key={i} className={i === 0 ? "font-bold text-center text-base" : ""}>{p}</p>)}</div>
      <div className="mt-8 grid grid-cols-2 gap-6 items-end">
        <div className="text-sm"><div className="font-semibold">İŞVEREN</div><div>{c?.name}</div><div className="text-xs text-muted mt-6">(Kaşe – İmza)</div></div>
        <div className="text-sm">
          <div className="font-semibold">PERSONEL · {e.first_name} {e.last_name}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url?.signedUrl && <img src={url.signedUrl} alt="Dijital imza" className="h-24 border-b border-ink mt-2" />}
          <div className="text-xs text-muted mt-1">Dijital imza · {when}{sig.ip ? ` · IP ${sig.ip}` : ""}</div>
          <div className="text-[10px] text-muted break-all">{sig.user_agent}</div>
        </div>
      </div>
      <p className="text-[10px] text-muted mt-6">Bu belge personel tarafından MB Personel uygulamasında okunarak dijital imzalanmıştır; imza görüntüsü, metin ve zaman damgası sistemde saklanır (kayıt no {sig.id}).</p>
      <script dangerouslySetInnerHTML={{ __html: `document.querySelector('[data-print]').addEventListener('click',function(e){e.preventDefault();window.print();});` }} />
    </main>
  );
}
