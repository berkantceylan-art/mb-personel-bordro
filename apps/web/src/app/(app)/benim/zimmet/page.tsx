import { Card } from "@/components/ui";
import { PendingSubmit } from "@/components/ConfirmSubmit";
import { ASSET_CATEGORY } from "@/lib/ozluk-docs";
import { formatDate } from "@/lib/session";
import { acknowledgeAsset } from "../../zimmet/actions";
import { me, MyHeader, NotLinked } from "../_shared";

export default async function MyAssetsPage() {
  const { supabase, me: e } = await me();
  if (!e) return <NotLinked title="Zimmetim" />;
  const { data } = await supabase.from("asset_assignments").select("id, assigned_on, returned_on, condition_out, condition_in, acknowledged_at, note, assets(code, name, category, brand_model, serial_no)").eq("employee_id", e.id).order("assigned_on", { ascending: false });
  const rows = data ?? [];
  const open = rows.filter((r) => !r.returned_on);
  const past = rows.filter((r) => r.returned_on);
  const A = (r: (typeof rows)[number]) => r.assets as unknown as { code: string | null; name: string; category: string; brand_model: string | null; serial_no: string | null } | null;
  return (
    <>
      <MyHeader title="Zimmetim" subtitle={`${open.length} demirbaş üzerinizde`} />
      <div className="p-4 md:p-6 flex flex-col gap-4 max-w-[760px]">
        {open.filter((r) => !r.acknowledged_at).length > 0 && (
          <p className="text-sm rounded-lg bg-[#FFF4E0] text-[#8A5A00] p-3">Teslim aldığınız demirbaşları onaylayın. Onay, imzalı tutanağın yerine geçmez; tutanağı İK&apos;da imzalayın.</p>
        )}
        <Card title="Üzerimdeki demirbaşlar">
          {open.length === 0 ? <p className="text-sm text-muted">Üzerinizde zimmetli demirbaş yok.</p> : open.map((r) => { const a = A(r); return (
            <div key={r.id} className="border-b border-[#EEF2F6] last:border-0 pb-3 flex flex-col gap-1 text-sm">
              <div className="flex justify-between gap-2"><b>{a?.name}</b><span className="text-xs text-muted">{ASSET_CATEGORY[a?.category ?? ""] ?? ""}</span></div>
              <div className="text-xs text-muted">{[a?.code ? `No ${a.code}` : null, a?.brand_model, a?.serial_no ? `Seri ${a.serial_no}` : null].filter(Boolean).join(" · ")}</div>
              <div className="text-xs text-muted">Teslim {formatDate(r.assigned_on)} · {r.condition_out ?? "Sağlam"}{r.note ? ` · ${r.note}` : ""}</div>
              {r.acknowledged_at ? <div className="text-xs text-ok font-semibold">✓ Teslim aldığınızı onayladınız ({formatDate(r.acknowledged_at.slice(0, 10))})</div> : (
                <form action={acknowledgeAsset}><input type="hidden" name="id" value={r.id} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">Teslim aldım, onaylıyorum</PendingSubmit></form>
              )}
            </div>
          ); })}
        </Card>
        {past.length > 0 && (
          <Card title="İade ettiklerim">
            {past.map((r) => { const a = A(r); return (
              <div key={r.id} className="text-sm flex justify-between gap-2 border-b border-[#EEF2F6] last:border-0 py-1">
                <span>{a?.name}<span className="block text-xs text-muted">{formatDate(r.assigned_on)} – {formatDate(r.returned_on!)} · iade: {r.condition_in ?? "Sağlam"}</span></span>
              </div>
            ); })}
          </Card>
        )}
        <p className="text-xs text-muted">Arıza veya kayıp olursa hemen şefinize veya İK&apos;ya bildirin (Mesajlar).</p>
      </div>
    </>
  );
}
