import { announceShipment } from "@/lib/shipment-actions";
import { SHIP_UI, shipTrackingUrl, type PortalShipment } from "@/lib/shipments-portal";
import { formatDate, portalContext, portalLocale } from "@/lib/portal";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Paketlerim" };

const STATUS_CLS: Record<string, string> = {
  expected: "bg-gypsum text-ink",
  in_transit: "bg-smile/20 text-navy",
  at_customs: "bg-warn-bg text-warn",
  out_for_delivery: "bg-smile/20 text-navy",
  arrived: "bg-ok-bg text-ok",
  opened: "bg-ok-bg text-ok",
  job_created: "bg-ok-bg text-ok",
  ready: "bg-warn-bg text-warn",
  delivered: "bg-ok-bg text-ok",
  returned: "bg-bad-bg text-bad",
  cancelled: "bg-gypsum text-slate",
};

/** Hekim / klinik / aracı: gönderdiği ve aldığı paketler; kargo bildirimi ve kurye talebi */
export default async function PortalParcels({ searchParams }: { searchParams: Promise<{ tamam?: string; hata?: string }> }) {
  const ctx = await portalContext();
  const acc = ctx!.account!;
  const locale = await portalLocale(acc);
  const ui = SHIP_UI[locale];
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: rows, error }, { data: cs }] = await Promise.all([
    supabase.from("shipments").select("id, no, direction, carrier, status, tracking_no, package_count, courier_date, courier_slot, portal_case_id, note, created_at, updated_at").eq("portal_account_id", acc.id).order("created_at", { ascending: false }).limit(200),
    supabase.from("portal_cases").select("id, no, patient_ref").eq("account_id", acc.id).not("status", "in", "(delivered,cancelled)").order("no", { ascending: false }).limit(100),
  ]);
  const list = (rows ?? []) as PortalShipment[];
  const cases = (cs ?? []) as { id: string; no: number; patient_ref: string }[];
  const caseNo = new Map(cases.map((c) => [c.id, c.no]));
  const domestic = acc.country === "TR" || acc.country === "Türkiye" || acc.type === "doctor_tr";
  const today = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
  const card = "rounded-3xl bg-white p-6";
  const lbl = "block text-sm font-medium text-slate";

  const CaseSelect = () =>
    cases.length ? (
      <label className={lbl}>
        {ui.case}
        <select name="case" className="field mt-1.5" defaultValue="">
          <option value="">{ui.none}</option>
          {cases.map((c) => <option key={c.id} value={c.id}>#{c.no} · {c.patient_ref}</option>)}
        </select>
      </label>
    ) : null;

  const shipForm = (
    <section className={card}>
      <h2 className="display text-xl font-semibold text-navy">{ui.sentTitle}</h2>
      <p className="mt-1 text-sm text-slate">{ui.sentLead}</p>
      <form action={announceShipment} className="mt-4 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="mode" value="carrier" />
        <label className={lbl}>
          {ui.carrier}
          <select name="carrier" className="field mt-1.5" defaultValue={domestic ? "client_courier" : "dhl"}>
            {["dhl", "ups", "post", "client_courier", "other"].map((k) => <option key={k} value={k}>{ui.carriers[k]}</option>)}
          </select>
        </label>
        <label className={lbl}>
          {ui.tracking} <span className="text-xs text-slate/70">({ui.trackingHint})</span>
          <input name="tracking" autoCapitalize="characters" className="field mt-1.5 font-mono" />
        </label>
        <label className={lbl}>
          {ui.count}
          <input name="count" type="number" min={1} max={99} defaultValue={1} className="field mt-1.5" />
        </label>
        <CaseSelect />
        <label className={`${lbl} sm:col-span-2`}>
          {ui.note}
          <input name="note" maxLength={1000} className="field mt-1.5" />
        </label>
        <div className="sm:col-span-2">
          <button className="rounded-full bg-navy px-5 py-3 font-semibold text-white hover:bg-blue">{ui.send}</button>
        </div>
      </form>
    </section>
  );

  const courierForm = (
    <section className={card}>
      <h2 className="display text-xl font-semibold text-navy">{ui.courierTitle}</h2>
      <p className="mt-1 text-sm text-slate">{ui.courierLead}</p>
      <form action={announceShipment} className="mt-4 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="mode" value="courier" />
        <label className={lbl}>
          {ui.date}
          <input name="date" type="date" min={today} defaultValue={today} required className="field mt-1.5" />
        </label>
        <label className={lbl}>
          {ui.slot}
          <select name="slot" className="field mt-1.5" defaultValue="any">
            {Object.entries(ui.slots).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className={`${lbl} sm:col-span-2`}>
          {ui.address}
          <textarea name="address" rows={2} maxLength={400} className="field mt-1.5 h-auto py-2" />
        </label>
        <label className={lbl}>
          {ui.count}
          <input name="count" type="number" min={1} max={99} defaultValue={1} className="field mt-1.5" />
        </label>
        <CaseSelect />
        <label className={`${lbl} sm:col-span-2`}>
          {ui.note}
          <input name="note" maxLength={1000} className="field mt-1.5" />
        </label>
        <div className="sm:col-span-2">
          <button className="rounded-full bg-smile px-5 py-3 font-semibold text-navy hover:bg-navy hover:text-white">{ui.requestCourier}</button>
        </div>
      </form>
    </section>
  );

  return (
    <>
      <h1 className="display text-3xl font-semibold text-navy">{ui.title}</h1>
      <p className="mt-1 max-w-2xl text-slate">{ui.lead}</p>
      {sp.tamam && <p className="mt-4 rounded-xl bg-ok-bg px-4 py-3 text-sm text-ok">{sp.tamam === "kurye" ? ui.okCourier : ui.ok}</p>}
      {sp.hata && <p className="mt-4 rounded-xl bg-bad-bg px-4 py-3 text-sm text-bad">{ui.errors[sp.hata] ?? ui.errors.server}</p>}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {domestic ? <>{courierForm}{shipForm}</> : <>{shipForm}{courierForm}</>}
      </div>

      <section className="mt-8">
        <h2 className="display text-xl font-semibold text-navy">{ui.list}</h2>
        {error ? (
          <p className="mt-3 text-sm text-slate">{ui.empty}</p>
        ) : list.length ? (
          <ul className="mt-3 grid gap-3">
            {list.map((x) => {
              const url = shipTrackingUrl(x.carrier, x.tracking_no);
              return (
                <li key={x.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-white px-5 py-4">
                  <span className="text-sm font-semibold text-navy">{x.direction === "in" ? `↑ ${ui.incoming}` : `↓ ${ui.outgoing}`}</span>
                  <span className="text-sm">{ui.carriers[x.carrier] ?? x.carrier}</span>
                  {x.tracking_no && (url ? <a href={url} target="_blank" rel="noreferrer" className="num text-sm text-blue underline">{x.tracking_no}</a> : <span className="num text-sm text-slate">{x.tracking_no}</span>)}
                  {x.portal_case_id && caseNo.get(x.portal_case_id) && <span className="text-sm text-slate">#{caseNo.get(x.portal_case_id)}</span>}
                  {x.carrier === "our_courier" && x.courier_date && <span className="text-sm text-slate">{formatDate(x.courier_date, locale)} · {ui.slots[x.courier_slot ?? "any"]}</span>}
                  <span className="text-xs text-slate">{formatDate(x.updated_at, locale, true)}</span>
                  <span className={`ml-auto rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLS[x.status] ?? "bg-gypsum"}`}>{ui.status[x.status] ?? x.status}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate">{ui.empty}</p>
        )}
      </section>
    </>
  );
}
