import { Flash, PageHead } from "@/components/admin/ui";
import { saveLead } from "@/lib/growth-actions";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Adaylar" };

type Lead = { source: string; id: string; at: string; name: string; company: string | null; email: string | null; phone: string | null; country: string | null; topic: string | null; body: string | null; page: string | null; status: string; owner: string | null; note: string | null };
const SRC: Record<string, [string, string]> = { message: ["✉️ Form", "/admin/gelen-kutusu/"], chat: ["💬 Canlı destek", "/admin/canli-destek/"], visit: ["📅 Ziyaret", ""], portal: ["🦷 Portal kaydı", "/admin/portal/hesap/"] };
const ST: Record<string, [string, string]> = { new: ["Yeni", "bg-blue-50 text-blue-700"], contacted: ["Görüşüldü", "bg-amber-50 text-amber-800"], quoted: ["Teklif verildi", "bg-violet-50 text-violet-700"], won: ["Müşteri oldu", "bg-emerald-50 text-emerald-700"], lost: ["Kaybedildi", "bg-slate-100 text-slate-600"] };

/** Tüm potansiyel müşteriler tek listede: form, canlı destek, ziyaret randevusu, portal kaydı */
export default async function Leads({ searchParams }: { searchParams: Promise<{ d?: string; ok?: string; hata?: string }> }) {
  const { d = "", ok, hata } = await searchParams;
  const supabase = await createClient();
  const [{ data, error }, { data: team }] = await Promise.all([supabase.rpc("site_leads"), supabase.rpc("company_directory")]);
  const all = (data ?? []) as Lead[];
  const people = (team ?? []) as Array<{ user_id: string; display_name: string }>;
  const rows = d ? all.filter((l) => l.status === d) : all.filter((l) => !["won", "lost"].includes(l.status));
  const count = (k: string) => all.filter((l) => l.status === k).length;
  const won = count("won"), closed = won + count("lost");
  return (
    <>
      <PageHead title="Adaylar" lead="Formlar, canlı destek, ziyaret randevuları ve portal kayıtları tek listede. Her adayı takip edin: kim ilgileniyor, ne konuşuldu, müşteri oldu mu?" />
      <Flash ok={ok} hata={hata ?? (error ? "Supabase'de 20270203000000_site_admin_plus.sql çalıştırılmalı." : undefined)} />
      <nav className="mb-5 flex flex-wrap gap-2 text-sm font-semibold">
        <a href="/admin/adaylar" className={`rounded-full px-3.5 py-1.5 ${!d ? "bg-navy text-white" : "border border-gypsum bg-white"}`}>Açık ({all.length - closed})</a>
        {Object.entries(ST).map(([k, [l]]) => <a key={k} href={`/admin/adaylar?d=${k}`} className={`rounded-full px-3.5 py-1.5 ${d === k ? "bg-navy text-white" : "border border-gypsum bg-white"}`}>{l} ({count(k)})</a>)}
        {closed > 0 && <span className="ml-auto self-center text-slate">Dönüşüm: %{Math.round((won / closed) * 100)}</span>}
      </nav>
      <ul className="grid gap-3">
        {rows.map((l) => (
          <li key={`${l.source}:${l.id}`} className="rounded-2xl border border-gypsum bg-white p-4">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-xs font-semibold text-slate">{SRC[l.source]?.[0]}</span>
              <b className="text-navy">{l.name}</b>{l.company && <span className="text-slate">· {l.company}</span>}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${ST[l.status]?.[1]}`}>{ST[l.status]?.[0]}</span>
              <span className="ml-auto text-xs text-slate">{new Date(l.at).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" })}</span>
            </div>
            <p className="mt-1 text-sm text-slate">{[l.email, l.phone, l.country, l.topic].filter(Boolean).join(" · ")}{l.body ? ` — ${l.body}` : ""}</p>
            <form action={saveLead} className="mt-3 flex flex-wrap items-center gap-2 text-sm">
              <input type="hidden" name="source" value={l.source} /><input type="hidden" name="id" value={l.id} /><input type="hidden" name="q" value={d} />
              <select name="status" defaultValue={l.status} className="field w-40">{Object.entries(ST).map(([k, [lab]]) => <option key={k} value={k}>{lab}</option>)}</select>
              <select name="owner" defaultValue={l.owner ?? ""} className="field w-44"><option value="">Sorumlu yok</option>{people.map((p) => <option key={p.user_id} value={p.user_id}>{p.display_name}</option>)}</select>
              <input name="note" defaultValue={l.note ?? ""} maxLength={1000} placeholder="Not: ne konuşuldu, sonraki adım" className="field min-w-[200px] flex-1" />
              <button className="rounded-full bg-navy px-4 py-2 font-semibold text-white">Kaydet</button>
              {SRC[l.source]?.[1] && <a href={`${SRC[l.source]![1]}${l.id}`} className="text-xs font-semibold text-slate hover:text-navy">Aç →</a>}
              {l.phone && <a href={`https://wa.me/${l.phone.replace(/\D/g, "").replace(/^0/, "90")}`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-emerald-700">WhatsApp</a>}
            </form>
          </li>
        ))}
        {!rows.length && <li className="rounded-2xl border border-dashed border-gypsum bg-white p-10 text-center text-slate">Bu listede aday yok.</li>}
      </ul>
    </>
  );
}
