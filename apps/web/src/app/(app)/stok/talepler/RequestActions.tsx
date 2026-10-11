"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useActionForm } from "@/lib/use-action-form";
import { SignaturePad, type SignaturePadHandle } from "@/components/SignaturePad";
import { Field, Notice, btnPrimary, btnSecondary, inputCls, selectCls } from "@/components/erp";
import { deliverMaterial, purchaseDecision, stockDecision, type MrState } from "@/lib/material-actions";

type Line = { id: string; name: string; unit: string; qty: number; issued_qty: number; item_id: string | null; to_purchase: boolean; onHand: number | null };

function Msg({ state }: { state: MrState | null }) {
  return state ? <Notice tone={state.ok ? "ok" : "bad"}>{state.message}</Notice> : null;
}

/** Depo kararı: teslime hazır / satın almaya gönder / reddet */
export function StockActions({ id, lines, canPrepare }: { id: string; lines: Line[]; canPrepare: boolean }) {
  const router = useRouter();
  const [mode, setMode] = useState<"" | "purchase" | "reject">("");
  const { state, pending, formProps } = useActionForm(stockDecision, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {mode === "purchase" && (
        <fieldset className="flex flex-col gap-1.5 text-sm">
          <legend className="font-semibold mb-1">Satın alınacak kalemler</legend>
          {lines.map((l) => (
            <label key={l.id} className="flex items-center gap-2">
              <input type="checkbox" name="purchase_line" value={l.id} defaultChecked={l.onHand == null || l.onHand < l.qty} className="w-4 h-4" />
              {l.name} × {l.qty} {l.unit} <span className="text-xs text-muted">({l.onHand == null ? "stok kartı yok" : `depoda ${l.onHand}`})</span>
            </label>
          ))}
        </fieldset>
      )}
      {mode && <Field label={mode === "reject" ? "Ret gerekçesi" : "Not"} hint={mode === "reject" ? "personele gider" : "isteğe bağlı"}><input name="note" maxLength={500} required={mode === "reject"} className={inputCls} /></Field>}
      <Msg state={state} />
      <div className="flex flex-wrap gap-2">
        {!mode && canPrepare && <button name="action" value="prepare" disabled={pending} className={btnPrimary}>Depoda var · teslime hazırla</button>}
        {!mode && <button type="button" onClick={() => setMode("purchase")} className={btnSecondary}>Depoda yok · satın almaya gönder</button>}
        {!mode && <button type="button" onClick={() => setMode("reject")} className={`${btnSecondary} text-bad`}>Reddet</button>}
        {mode === "purchase" && <button name="action" value="purchase" disabled={pending} className={btnPrimary}>Satın almaya gönder</button>}
        {mode === "reject" && <button name="action" value="reject" disabled={pending} className={`${btnPrimary} bg-bad hover:bg-bad`}>Reddet</button>}
        {mode && <button type="button" onClick={() => setMode("")} className={btnSecondary}>Vazgeç</button>}
      </div>
    </form>
  );
}

/** Satın alma: onayla / reddet / alındı */
export function PurchaseActions({ id, status, canApprove, canBought }: { id: string; status: string; canApprove: boolean; canBought: boolean }) {
  const router = useRouter();
  const [reject, setReject] = useState(false);
  const { state, pending, formProps } = useActionForm(purchaseDecision, { onSuccess: () => router.refresh() });
  return (
    <form {...formProps} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={id} />
      {(reject || status === "purchase") && <Field label={reject ? "Ret gerekçesi" : "Not"} hint={reject ? "zorunlu" : "isteğe bağlı (tedarikçi, fiyat…)"}><input name="note" maxLength={500} required={reject} className={inputCls} /></Field>}
      <Msg state={state} />
      <div className="flex flex-wrap gap-2">
        {status === "purchase" && canApprove && !reject && <button name="action" value="approve" disabled={pending} className={btnPrimary}>Satın almayı onayla</button>}
        {status === "purchase" && canApprove && !reject && <button type="button" onClick={() => setReject(true)} className={`${btnSecondary} text-bad`}>Reddet</button>}
        {reject && <button name="action" value="reject" disabled={pending} className={`${btnPrimary} bg-bad hover:bg-bad`}>Reddet</button>}
        {reject && <button type="button" onClick={() => setReject(false)} className={btnSecondary}>Vazgeç</button>}
        {status === "approved" && canBought && <button name="action" value="bought" disabled={pending} className={btnPrimary}>Satın alındı · depoya geldi</button>}
      </div>
      {status === "purchase" && !canApprove && <p className="text-xs text-muted">Onay için satın alma &ldquo;yönet&rdquo; yetkisi gerekir.</p>}
    </form>
  );
}

/** Teslim: miktarlar, depo, depo sorumlusu imzası; isteğe bağlı personel aynı ekranda imzalar */
export function DeliverForm({ id, lines, warehouses, signer, employee, assets }: { id: string; lines: Line[]; warehouses: { id: string; name: string; is_default: boolean }[]; signer: string; employee: string; assets?: { id: string; code: string | null; name: string }[] }) {
  const [pick, setPick] = useState<Record<string, string>>({});
  const router = useRouter();
  const wpad = useRef<SignaturePadHandle>(null);
  const epad = useRef<SignaturePadHandle>(null);
  const [here, setHere] = useState(true);
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(Math.max(0, l.qty - l.issued_qty))])));
  const { state, pending, formProps } = useActionForm(deliverMaterial, {
    prepare: (fd) => {
      fd.set("lines", JSON.stringify(lines.map((l) => ({ line_id: l.id, qty: Number((qty[l.id] ?? "0").replace(",", ".")) || 0, asset_id: pick[l.id] || null }))));
      fd.set("sig_warehouse", wpad.current?.toDataURL() ?? "");
      fd.set("sig_employee", here ? epad.current?.toDataURL() ?? "" : "");
    },
    onSuccess: () => router.refresh(),
  });
  return (
    <form {...formProps} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={id} />
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-xs text-muted"><th className="py-1.5">Malzeme</th><th className="py-1.5 text-right">İstenen</th><th className="py-1.5 text-right">Depoda</th><th className="py-1.5 text-right w-32">Teslim edilen</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id} className="border-t border-[#EEF2F6]">
                <td className="py-2">{l.name}{!l.item_id && !assets && <span className="ml-1 text-xs text-muted">(stoktan düşmez)</span>}
                  {assets && (
                    <select value={pick[l.id] ?? ""} onChange={(e) => setPick((p) => ({ ...p, [l.id]: e.target.value }))} className={`${selectCls} mt-1`} aria-label="Zimmetlenecek demirbaş">
                      <option value="">— Zimmetlenecek demirbaşı seçin (boşta olanlar) —</option>
                      {assets.filter((a) => !Object.entries(pick).some(([k, v]) => k !== l.id && v === a.id)).map((a) => <option key={a.id} value={a.id}>{a.name}{a.code ? ` · ${a.code}` : ""}</option>)}
                    </select>
                  )}</td>
                <td className="py-2 text-right num">{l.qty} {l.unit}</td>
                <td className={`py-2 text-right num ${l.onHand != null && l.onHand < Number(qty[l.id] || 0) ? "text-bad font-semibold" : "text-muted"}`}>{l.onHand ?? "—"}</td>
                <td className="py-2"><input inputMode="decimal" value={qty[l.id] ?? ""} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} className={`${inputCls} num text-right`} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Çıkış deposu"><select name="warehouse" defaultValue={warehouses.find((w) => w.is_default)?.id} className={selectCls}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select></Field>
        <Field label="Teslim eden (depo sorumlusu)"><input name="signer" defaultValue={signer} maxLength={160} className={inputCls} /></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Depo sorumlusu imzası</span>
          <SignaturePad ref={wpad} />
          <button type="button" onClick={() => wpad.current?.clear()} className="self-start text-xs font-semibold text-muted hover:text-bad">İmzayı sil</button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" name="employee_here" checked={here} onChange={(e) => setHere(e.target.checked)} className="w-4 h-4" />Personel ({employee}) şimdi burada imzalasın</label>
          {here ? (
            <>
              <SignaturePad ref={epad} />
              <button type="button" onClick={() => epad.current?.clear()} className="self-start text-xs font-semibold text-muted hover:text-bad">İmzayı sil</button>
            </>
          ) : <p className="rounded-xl bg-[#F8FAFC] p-3 text-sm text-muted">Personel, “Benim sayfam › Malzeme isteklerim” bölümünden kendi telefonunda imzalayacak; bildirim gönderilir.</p>}
        </div>
      </div>
      <Msg state={state} />
      <div><button disabled={pending} className={btnPrimary}>{pending ? "Kaydediliyor…" : assets ? "Teslim et ve zimmetle" : "Teslim et ve stoktan düş"}</button></div>
    </form>
  );
}
