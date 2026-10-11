import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, PageHeader } from "@/components/ui";
import { Notice } from "@/components/erp";
import { ConfirmSubmit, PendingSubmit } from "@/components/ConfirmSubmit";
import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/session";
import { fmt } from "@/lib/fin";
import { adjustBonus, computeBonus, postBonus, saveBonusRule } from "@/lib/bonus-actions";

export const dynamic = "force-dynamic";

type Rule = { id: string; name: string; employee_id: string | null; unit_amount: number; free_units: number; target_units: number | null; target_bonus: number; reject_penalty: number; min_on_time_pct: number | null; on_time_factor: number; max_amount: number | null; is_active: boolean };
type Line = { id: string; employee_id: string; units: number; jobs: number; rejects: number; on_time_pct: number | null; amount: number; adjust: number; detail: { rule?: string; paid_units?: number; base?: number; target_hit?: boolean; target_bonus?: number; factor?: number; penalty?: number; capped?: boolean }; ledger_entry_id: string | null };
const tl = (k: number | null | undefined) => (k ? String(Number(k) / 100).replace(".", ",") : "");

/** Teknisyen primi: kurallar, aylık hesap (kutu okutmalarından), bordroya aktarım */
export default async function BonusPage({ searchParams }: { searchParams: Promise<{ donem?: string }> }) {
  const s = await getSession();
  const mayPost = (s.modules.payroll ?? 0) >= 2 || ["owner", "accountant"].includes(s.role);
  if ((s.modules.production ?? 0) < 3 && !mayPost) redirect("/");
  const sp = await searchParams;
  const now = new Date(Date.now() + 3 * 3600 * 1000);
  const period = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.donem ?? "") ? sp.donem! : now.toISOString().slice(0, 7);
  const supabase = await createClient();
  const [{ data: rd, error }, { data: run }, { data: emp }] = await Promise.all([
    supabase.from("prd_bonus_rules").select("*").order("employee_id", { nullsFirst: true }).order("created_at"),
    supabase.from("prd_bonus_runs").select("id, status, total, computed_at, posted_at").eq("period", period).maybeSingle(),
    supabase.from("employees").select("id, first_name, last_name").eq("status", "active").order("first_name"),
  ]);
  const { data: ld } = run ? await supabase.from("prd_bonus_lines").select("*").eq("run_id", run.id) : { data: [] };
  const rules = (rd ?? []) as Rule[];
  const lines = ((ld ?? []) as Line[]).sort((a, b) => b.amount + b.adjust - (a.amount + a.adjust));
  const ename = new Map((emp ?? []).map((e) => [e.id, `${e.first_name} ${e.last_name}`]));
  const posted = run?.status === "posted";
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); return d.toISOString().slice(0, 7); });
  const inp = "h-10 rounded-[10px] border border-line bg-white px-3 text-sm w-full";

  const RuleForm = ({ r }: { r?: Rule }) => (
    <form action={saveBonusRule} className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6 items-end">
      {r && <><input type="hidden" name="id" value={r.id} /><input type="hidden" name="is_active_set" value="1" /></>}
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Kural adı<input name="name" required defaultValue={r?.name ?? ""} placeholder="ör. Genel teknisyen primi" className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Kime<select name="employee_id" defaultValue={r?.employee_id ?? ""} className={inp}><option value="">Tüm teknisyenler</option>{(emp ?? []).map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}</select></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Birim başı (₺)<input name="unit_amount" inputMode="decimal" defaultValue={tl(r?.unit_amount)} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Primsiz ilk birim<input name="free_units" type="number" min={0} defaultValue={r?.free_units ?? 0} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Hedef (birim)<input name="target_units" type="number" min={1} defaultValue={r?.target_units ?? ""} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Hedef primi (₺)<input name="target_bonus" inputMode="decimal" defaultValue={tl(r?.target_bonus)} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Geri dönüş kesintisi (₺/iş)<input name="reject_penalty" inputMode="decimal" defaultValue={tl(r?.reject_penalty)} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Zamanında teslim şartı (%)<input name="min_on_time_pct" type="number" min={0} max={100} defaultValue={r?.min_on_time_pct ?? ""} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Şart sağlanmazsa çarpan<input name="on_time_factor" inputMode="decimal" defaultValue={String(r?.on_time_factor ?? 0.5).replace(".", ",")} className={inp} /></label>
      <label className="text-xs font-semibold text-muted flex flex-col gap-1">Üst sınır (₺)<input name="max_amount" inputMode="decimal" defaultValue={tl(r?.max_amount)} className={inp} /></label>
      {r && <label className="text-sm flex items-center gap-2 h-10"><input type="checkbox" name="is_active" defaultChecked={r.is_active} /> Aktif</label>}
      <div className="flex gap-2 h-10 items-center"><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{r ? "Kaydet" : "Kural ekle"}</PendingSubmit>{r && <ConfirmSubmit label="Sil" name="delete" value="1" question="Kural silinsin mi?" className="text-sm text-bad font-semibold" />}</div>
    </form>
  );

  return (
    <>
      <PageHeader title="Teknisyen primi" subtitle="Kutu okutmalarından otomatik: biten birim, geri dönen iş, zamanında teslim. Hesapla, kontrol et, bordroya aktar." actions={<Link href="/uretim/performans" className="text-sm font-semibold text-brand-700">Personel performansı</Link>} />
      <div className="p-4 md:p-8 flex flex-col gap-5 max-w-[1320px]">
        {error && <Notice tone="bad">Supabase&apos;de 20261224000000_bonus.sql çalıştırılmalı.</Notice>}
        <Card title={`${period} primi`} action={<span className="flex flex-wrap gap-1">{months.map((m) => <Link key={m} href={`/uretim/prim?donem=${m}`} className={`h-8 px-3 inline-flex items-center rounded-[8px] text-sm font-semibold ${m === period ? "bg-brand-700 text-white" : "border border-line"}`}>{m.slice(5)}.{m.slice(0, 4)}</Link>)}</span>}>
          <div className="flex flex-wrap gap-3 items-center">
            {!posted && (
              <form action={computeBonus}><input type="hidden" name="period" value={period} /><PendingSubmit className="h-10 px-4 rounded-[10px] bg-brand-700 text-white text-sm font-semibold">{run ? "Yeniden hesapla" : "Hesapla"}</PendingSubmit></form>
            )}
            {run && !posted && mayPost && lines.length > 0 && (
              <form action={postBonus}><input type="hidden" name="id" value={run.id} /><ConfirmSubmit label="Bordroya aktar" question={`Toplam ${fmt(run.total)} prim personel carilerine işlensin mi? Bu işlem geri alınamaz (cari hareketi iptal edilebilir).`} className="h-10 px-4 rounded-[10px] bg-ok text-white text-sm font-semibold" /></form>
            )}
            {run && <span className="text-sm">Toplam: <b className="font-display text-lg">{fmt(run.total)}</b></span>}
            {posted && <span className="px-2 py-1 rounded-md bg-ok-bg text-ok text-sm font-semibold">Bordroya aktarıldı</span>}
            {!rules.some((r) => r.is_active) && <span className="text-sm text-warn">Önce aşağıdan bir prim kuralı ekleyin.</span>}
          </div>
          {lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead><tr className="text-left text-xs text-muted"><th className="py-2">Personel</th><th className="text-right">Biten iş</th><th className="text-right">Birim</th><th className="text-right">Geri dönen</th><th className="text-right">Zamanında</th><th>Hesap</th><th className="text-right">Prim</th><th className="text-right">Düzeltme</th><th className="text-right">Ödenecek</th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-t border-[#EEF2F6] align-top">
                      <td className="py-2 font-semibold">{ename.get(l.employee_id) ?? "—"}</td>
                      <td className="text-right">{l.jobs}</td>
                      <td className="text-right">{l.units}</td>
                      <td className={`text-right ${l.rejects ? "text-bad font-semibold" : ""}`}>{l.rejects}</td>
                      <td className="text-right">{l.on_time_pct != null ? `%${l.on_time_pct}` : "—"}</td>
                      <td className="text-xs text-muted max-w-[280px]">{l.detail.rule}: {l.detail.paid_units} birim × {fmt((l.detail.base ?? 0) / Math.max(1, l.detail.paid_units ?? 1))}{l.detail.target_hit ? ` + hedef ${fmt(l.detail.target_bonus)}` : ""}{(l.detail.factor ?? 1) < 1 ? ` × ${l.detail.factor} (zamanında şartı)` : ""}{l.detail.penalty ? ` − ${fmt(l.detail.penalty)} kesinti` : ""}{l.detail.capped ? " (üst sınır)" : ""}</td>
                      <td className="text-right num">{fmt(l.amount)}</td>
                      <td className="text-right">{posted || !mayPost ? (l.adjust ? fmt(l.adjust, "TRY", { sign: true }) : "") : (
                        <form action={adjustBonus} className="flex justify-end gap-1"><input type="hidden" name="id" value={l.id} /><input name="adjust" defaultValue={l.adjust ? String(l.adjust / 100).replace(".", ",") : ""} placeholder="±" className="h-8 w-20 rounded-[8px] border border-line px-2 text-right text-sm" /><PendingSubmit className="h-8 px-2 rounded-[8px] border border-line text-xs font-semibold">✓</PendingSubmit></form>
                      )}</td>
                      <td className="text-right num font-bold">{fmt(Math.max(0, l.amount + l.adjust))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {run && lines.length === 0 && <p className="text-sm text-muted">Bu dönemde prim hesaplanacak teknisyen hareketi yok.</p>}
        </Card>

        <Card title="Prim kuralları">
          <p className="text-xs text-muted">Kişiye özel kural varsa o, yoksa &quot;Tüm teknisyenler&quot; kuralı uygulanır. Prim = (birim − primsiz birim) × birim başı + hedef primi; zamanında teslim şartı sağlanmazsa çarpanla azalır; geri dönen her iş için kesinti düşülür; üst sınırı geçemez.</p>
          {!mayPost && <p className="text-xs text-warn">Kuralları ve düzeltmeleri bordro yetkilisi değiştirir; siz hesaplayıp kontrol edebilirsiniz.</p>}
          {rules.map((r) => <div key={r.id} className={`border-t border-line pt-3 ${r.is_active ? "" : "opacity-60"}`}>{mayPost ? <RuleForm r={r} /> : <p className="text-sm"><b>{r.name}</b> · {r.employee_id ? ename.get(r.employee_id) : "Tüm teknisyenler"} · birim {fmt(r.unit_amount)}{r.free_units ? ` (ilk ${r.free_units} primsiz)` : ""}{r.target_units ? ` · hedef ${r.target_units} → ${fmt(r.target_bonus)}` : ""}{r.reject_penalty ? ` · geri dönüş −${fmt(r.reject_penalty)}` : ""}</p>}</div>)}
          {mayPost && <div className="border-t border-line pt-3"><RuleForm /></div>}
        </Card>
      </div>
    </>
  );
}
