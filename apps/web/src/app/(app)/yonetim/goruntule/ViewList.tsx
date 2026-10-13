"use client";
import { useState } from "react";

export type Person = { id: string; name: string; sub: string; email: string; kind: "erp" | "portal" };

export function ViewList({ people }: { people: Person[] }) {
  const [q, setQ] = useState("");
  const [kind, setKind] = useState<"" | "erp" | "portal">("");
  const [open, setOpen] = useState<string | null>(null);
  const nq = q.toLocaleLowerCase("tr").trim();
  const list = people.filter((p) => (!kind || p.kind === kind) && (!nq || `${p.name} ${p.sub} ${p.email}`.toLocaleLowerCase("tr").includes(nq))).slice(0, 200);
  return (
    <section className="bg-white border border-line rounded-[14px] p-4 flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 items-center">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="İsim, e-posta, klinik ara" aria-label="Kişi ara" className="h-11 rounded-lg border border-[#D5DEE8] px-3 flex-1 min-w-[220px]" />
        {([["", "Hepsi"], ["erp", "Personel / yönetici"], ["portal", "Klinik / hekim / aracı"]] as const).map(([k, l]) => (
          <button key={k} type="button" onClick={() => setKind(k)} className={`h-11 px-4 rounded-full text-sm font-semibold ${kind === k ? "bg-brand-700 text-white" : "border border-[#D5DEE8] text-[#33414F]"}`}>{l} ({k ? people.filter((p) => p.kind === k).length : people.length})</button>
        ))}
      </div>
      <ul className="flex flex-col">
        {list.map((p) => (
          <li key={`${p.kind}-${p.id}`} className="py-2 border-b border-[#EEF2F6]">
            <div className="flex flex-wrap items-center gap-3">
              <span className="flex-1 min-w-[200px]">
                <span className="block font-semibold text-sm">{p.name} <span className={`ml-1 text-[11px] px-2 py-0.5 rounded-full ${p.kind === "portal" ? "bg-[#FDF0E7] text-[#9A4B12]" : "bg-[#E7F1FB] text-brand-700"}`}>{p.kind === "portal" ? "Portal" : "ERP"}</span></span>
                <span className="block text-xs text-muted">{[p.sub, p.email].filter(Boolean).join(" · ")}</span>
              </span>
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} className="h-10 px-4 rounded-lg border border-brand-700 text-brand-700 font-semibold text-sm">👁 Görüntüle</button>
            </div>
            {open === p.id && (
              <form action="/auth/goruntule/basla" method="post" className="mt-2 flex flex-wrap gap-2 items-center rounded-lg bg-[#F7F9FB] p-2">
                <input type="hidden" name="target" value={p.id} />
                <input name="reason" maxLength={200} placeholder="Neden (isteğe bağlı): ör. ekranında hata var dedi" aria-label="Görüntüleme nedeni" className="h-10 rounded-lg border border-[#D5DEE8] px-3 flex-1 min-w-[220px] text-sm" />
                <button className="h-10 px-4 rounded-lg bg-brand-700 text-white font-bold text-sm">{p.kind === "portal" ? "Portalda aç" : "Ekranını aç"}</button>
                <span className="w-full text-xs text-muted">{p.name} kişisine &quot;Yöneticiniz hesabınızı görüntüledi&quot; bildirimi gidecek.</span>
              </form>
            )}
          </li>
        ))}
        {!list.length && <li className="text-sm text-muted py-2">Kişi bulunamadı.</li>}
      </ul>
    </section>
  );
}
