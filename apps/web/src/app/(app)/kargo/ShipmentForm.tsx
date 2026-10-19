"use client";
import { useState } from "react";
import { CARRIER, CONTENTS, SLOT, type Shipment } from "@/lib/shipments";
import { saveShipment } from "./actions";

export type AccountOption = { id: string; name: string; type: string; country: string; city: string | null; phone: string | null };
export type CaseOption = { id: string; no: number; account_id: string; patient_ref: string };

const input = "h-11 rounded-[10px] border border-[#D5DEE8] px-3 bg-white text-[15px] w-full";
const label = "flex flex-col gap-1.5 text-sm text-muted";
const TYPE: Record<string, string> = { doctor_tr: "Yerli hekim", doctor_foreign: "Yabancı hekim", clinic: "Klinik", agency: "Aracı kuruluş" };

export function ShipmentForm({ shipment, direction, accounts, cases }: { shipment?: Shipment; direction: "in" | "out"; accounts: AccountOption[]; cases: CaseOption[] }) {
  const [carrier, setCarrier] = useState<string>(shipment?.carrier ?? (direction === "out" ? "our_courier" : "dhl"));
  const [accountId, setAccountId] = useState<string>(shipment?.portal_account_id ?? "");
  const acc = accounts.find((a) => a.id === accountId);
  const foreign = acc ? acc.country !== "TR" && acc.country !== "Türkiye" : carrier === "dhl" || carrier === "ups" || carrier === "customs";
  const showCustoms = direction === "in" && (carrier === "customs" || foreign) && carrier !== "our_courier" && carrier !== "client_courier";
  const accCases = cases.filter((c) => c.account_id === accountId);

  return (
    <form action={saveShipment} className="flex flex-col gap-5">
      {shipment && <input type="hidden" name="id" value={shipment.id} />}
      <input type="hidden" name="direction" value={shipment?.direction ?? direction} />

      <div className="grid gap-4 md:grid-cols-3">
        <label className={label}>
          {direction === "in" ? "Nasıl geliyor?" : "Nasıl gidiyor?"} *
          <select name="carrier" value={carrier} onChange={(e) => setCarrier(e.target.value)} className={input}>
            {Object.entries(CARRIER).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </label>
        <label className={label}>
          Takip numarası {carrier === "dhl" || carrier === "ups" ? "*" : ""}
          <input name="tracking_no" defaultValue={shipment?.tracking_no ?? ""} placeholder={carrier === "ups" ? "1Z…" : carrier === "dhl" ? "10 haneli · boş bırakılırsa DHL’de oluşturulur" : "varsa"} autoCapitalize="characters" className={`${input} font-mono`} />
        </label>
        <label className={label}>
          Paket sayısı
          <input name="package_count" type="number" min={1} max={99} defaultValue={shipment?.package_count ?? 1} className={input} />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className={label}>
          {direction === "in" ? "Gönderen (portal hesabı)" : "Alıcı (portal hesabı)"}
          <select name="portal_account_id" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={input}>
            <option value="">— portalda değil —</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {TYPE[a.type] ?? a.type} · {a.country}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          {accountId ? "Ad (boşsa hesaptan)" : `${direction === "in" ? "Gönderen" : "Alıcı"} adı *`}
          <input name="party_name" defaultValue={shipment?.party_name ?? ""} placeholder="Dr. / klinik / kurum" className={input} />
        </label>
        <label className={label}>
          İlgili vaka (portal)
          <select name="portal_case_id" defaultValue={shipment?.portal_case_id ?? ""} className={input} disabled={!accCases.length}>
            <option value="">—</option>
            {accCases.map((c) => (
              <option key={c.id} value={c.id}>#{c.no} · {c.patient_ref}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className={label}>Ülke<input name="country" defaultValue={shipment?.country ?? acc?.country ?? ""} className={input} /></label>
        <label className={label}>Şehir<input name="city" defaultValue={shipment?.city ?? acc?.city ?? ""} className={input} /></label>
        <label className={label}>Telefon<input name="phone" defaultValue={shipment?.phone ?? acc?.phone ?? ""} className={input} /></label>
        <label className={label}>{direction === "in" ? "Beklenen geliş" : "Planlanan çıkış"}<input name="expected_on" type="date" defaultValue={shipment?.expected_on ?? ""} className={input} /></label>
      </div>

      {carrier === "our_courier" && (
        <div className="grid gap-4 md:grid-cols-3 rounded-xl bg-[#F3F6F9] p-4">
          <label className={label}>Kurye günü *<input name="courier_date" type="date" required defaultValue={shipment?.courier_date ?? ""} className={input} /></label>
          <label className={label}>
            Zaman
            <select name="courier_slot" defaultValue={shipment?.courier_slot ?? "any"} className={input}>
              {Object.entries(SLOT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className={`${label} md:col-span-3`}>Adres<textarea name="address" rows={2} defaultValue={shipment?.address ?? ""} className={`${input} h-auto py-2`} /></label>
        </div>
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-muted mb-1">İçerik</legend>
        <div className="flex flex-wrap gap-2">
          {Object.entries(CONTENTS).map(([k, v]) => (
            <label key={k} className="flex items-center gap-2 rounded-lg border border-[#D5DEE8] bg-white px-3 py-2 text-sm">
              <input type="checkbox" name="contents" value={k} defaultChecked={shipment?.contents?.includes(k) ?? (direction === "out" && k === "is")} />
              {v}
            </label>
          ))}
        </div>
      </fieldset>

      {showCustoms && (
        <div className="grid gap-4 md:grid-cols-4 rounded-xl bg-warn-bg/60 p-4">
          <p className="md:col-span-4 text-sm font-semibold text-warn">Gümrük (müşavir takibi)</p>
          <label className={label}>Gümrük müşaviri<input name="customs_broker" defaultValue={shipment?.customs_broker ?? ""} className={input} /></label>
          <label className={label}>Beyanname / dosya no<input name="customs_ref" defaultValue={shipment?.customs_ref ?? ""} className={input} /></label>
          <label className={label}>Masraf<input name="customs_cost" inputMode="decimal" defaultValue={shipment?.customs_cost != null ? (shipment.customs_cost / 100).toLocaleString("tr-TR") : ""} placeholder="0,00" className={input} /></label>
          <label className={label}>
            Para birimi
            <select name="customs_currency" defaultValue={shipment?.customs_currency ?? "TRY"} className={input}>
              <option value="TRY">TL</option><option value="EUR">€</option><option value="USD">$</option>
            </select>
          </label>
        </div>
      )}

      <label className={label}>Not<textarea name="note" rows={2} defaultValue={shipment?.note ?? ""} className={`${input} h-auto py-2`} /></label>

      <div className="flex gap-3">
        <button className="h-12 px-6 rounded-[10px] bg-brand-700 text-white font-semibold">{shipment ? "Kaydet" : "Gönderiyi kaydet"}</button>
      </div>
    </form>
  );
}
